import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { continueInstructions, INPUTS_DIR, MAX_FILE_BYTES, parseReports, taskInstructions, updateInstructions, type ContinueTaskInput, type InputFile, type TaskInstructionsInput, type UpdateInstructionsInput } from '../protocol.ts';
import { roleFor } from '../roles.ts';
import type { SendUpdateResult, SessionConnector, SessionEvent, SessionInfo } from '../session.ts';
import { CodexAppServerClient, declineServerRequest, SteerRejectedError } from './app-server.ts';
import { RpcError, type RpcOptions } from './rpc.ts';

interface ActiveTask { taskId: string; turnId?: string; started: boolean }
interface AgentSession extends SessionInfo {
  projectId: string;
  active?: ActiveTask;
  tasks: Map<string, string>;
  reportIndexes: Map<string, number>;
  nextReportIndex: Map<string, number>;
}
export interface CodexConnectorOptions {
  rpc?: RpcOptions;
  /** Omitted: the user's Codex default model. */
  model?: string;
  /** Defaults to ~/ensemble-agent-workspaces; keep it outside any repository. */
  workspaceRoot?: string;
  /** Developer instructions for an agent's thread; defaults to the built-in role's system prompt. */
  instructionsFor?: (agentId: string) => string | undefined;
}
const component = (value: string) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error('Project and agent IDs must contain only letters, numbers, underscores, or hyphens');
  return value;
};

const UNSAFE_SEGMENT = /[<>:"/\\|?*\u0000-\u001f]/;

/**
 * Copies predecessor result files into the workspace under inputs/. Every path segment is checked,
 * no existing link may redirect a write outside the workspace, and identical files are left alone,
 * so a restart or retry rewrites nothing.
 */
export async function writeInputFiles(workspace: string, files: readonly InputFile[] = []): Promise<void> {
  if (!files.length) return;
  const root = await realpath(workspace);
  for (const file of files) {
    const parts = file.path.split('/');
    if (parts[0] !== INPUTS_DIR || parts.length < 2 || parts.some(part => !part || part === '.' || part === '..' || UNSAFE_SEGMENT.test(part) || /[. ]$/.test(part))) {
      throw new Error(`Unsafe input file path: ${file.path}`);
    }
    const data = Buffer.from(file.data, 'base64');
    if (data.length > MAX_FILE_BYTES) throw new Error(`Input file exceeds ${MAX_FILE_BYTES} bytes: ${file.path}`);
    let dir = root;
    for (const part of parts.slice(0, -1)) {
      dir = path.join(dir, part);
      const info = await lstat(dir).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
      if (!info) await mkdir(dir);
      else if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Input folder is not a plain folder: ${file.path}`);
    }
    const relative = path.relative(root, await realpath(dir));
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Input folder resolves outside the workspace: ${file.path}`);
    const target = path.join(dir, parts.at(-1)!);
    const existing = await lstat(target).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
    if (existing && !existing.isFile()) throw new Error(`Input path is not a plain file: ${file.path}`);
    if (existing && existing.size === data.length && (await readFile(target)).equals(data)) continue;
    await writeFile(target, data);
  }
}

export class CodexSessionConnector implements SessionConnector {
  private readonly client: CodexAppServerClient;
  private readonly sessions = new Map<string, AgentSession>();
  private readonly starting = new Map<string, { projectId: string; promise: Promise<SessionInfo> }>();
  private readonly listeners = new Set<(event: SessionEvent) => void>();
  private closed = false;
  private readonly sandboxFailures = new Set<string>();

  constructor(private readonly options: CodexConnectorOptions = {}) {
    this.client = new CodexAppServerClient({ ...options.rpc, serverRequestHandler: declineServerRequest });
    this.client.on('turn/started', ({ threadId, turn }) => {
      const entry = this.findThread(threadId);
      if (entry) this.started(entry[0], entry[1], turn.id);
    });
    this.client.on('item/completed', ({ threadId, turnId, item }) => {
      const entry = this.findThread(threadId);
      if (!entry) return;
      const [agentId, session] = entry;
      const taskId = session.tasks.get(turnId);
      if (!taskId) return;
      // A sandbox launcher failure cannot be repaired by another model-generated command.
      // Stop promptly; keep the sandbox intact and surface a recoverable blocked task.
      if (item.type === 'commandExecution' && item.status === 'failed' && typeof item.aggregatedOutput === 'string'
        && item.aggregatedOutput.startsWith('error building bubblewrap command:') && !this.sandboxFailures.has(turnId)) {
        this.sandboxFailures.add(turnId);
        this.emit({ type: 'turn', agentId, taskId, threadId, turnId, status: 'failed',
          reason: 'Codex 실행 환경에서 샌드박스를 초기화하지 못했습니다. 환경 설정을 확인한 후 다시 맡겨 주세요.' });
        void this.client.turnInterrupt({ threadId, turnId }).catch(() => undefined);
        return;
      }
      if (item.type !== 'agentMessage' || this.sandboxFailures.has(turnId)) return;
      const context = { agentId, taskId, threadId, turnId, itemId: item.id };
      this.emit({ ...context, type: 'reply', text: item.text });
      const parsed = parseReports(item.text);
      const key = `${turnId}:${item.id}`;
      let firstIndex = session.reportIndexes.get(key);
      if (firstIndex === undefined) {
        firstIndex = session.nextReportIndex.get(turnId) ?? 0;
        session.reportIndexes.set(key, firstIndex);
        session.nextReportIndex.set(turnId, firstIndex + parsed.reports.length);
      }
      parsed.reports.forEach((report, index) => this.emit({ ...context, type: 'report', index: firstIndex + index, report }));
      parsed.errors.forEach((error, index) => this.emit({ ...context, type: 'parse_error', index, error }));
    });
    this.client.on('turn/completed', ({ threadId, turn }) => {
      const entry = this.findThread(threadId);
      if (!entry || turn.status === 'inProgress') return;
      const [agentId, session] = entry;
      const taskId = session.tasks.get(turn.id);
      if (!taskId) return;
      if (session.active?.turnId === turn.id) session.active = undefined;
      const reason = turn.status === 'failed' ? turn.error?.message ?? 'Codex turn failed' : undefined;
      this.emit({ type: 'turn', agentId, taskId, threadId, turnId: turn.id, status: turn.status, ...(reason ? { reason } : {}) });
    });
    // A lost app-server ends every running turn; nothing restarts it automatically.
    this.client.onFailure(error => {
      if (this.closed) return;
      for (const [agentId, session] of this.sessions) {
        const active = session.active;
        if (!active?.turnId) continue;
        session.active = undefined;
        this.emit({ type: 'turn', agentId, taskId: active.taskId, threadId: session.threadId, turnId: active.turnId, status: 'failed',
          reason: `Codex 세션 연결이 끊겼습니다: ${error.message}` });
      }
    });
  }

  private emit(event: SessionEvent): void { for (const listener of this.listeners) listener(event); }
  onEvent(handler: (event: SessionEvent) => void): () => void {
    this.listeners.add(handler); return () => { this.listeners.delete(handler); };
  }
  private findThread(threadId: string): [string, AgentSession] | undefined {
    return [...this.sessions].find(([, session]) => session.threadId === threadId);
  }
  private started(agentId: string, session: AgentSession, turnId: string): void {
    const active = session.active;
    if (!active || (active.turnId && active.turnId !== turnId) || session.tasks.has(turnId)) return;
    active.turnId = turnId;
    session.tasks.set(turnId, active.taskId);
    active.started = true;
    this.emit({ type: 'turn', agentId, taskId: active.taskId, threadId: session.threadId, turnId, status: 'started' });
  }

  async startSession(agentId: string, projectId: string): Promise<SessionInfo> {
    if (this.closed) throw new Error('Connector closed');
    component(agentId); component(projectId);
    const existing = this.sessions.get(agentId) ?? this.starting.get(agentId);
    if (existing) {
      if (existing.projectId !== projectId) throw new Error('Agent session belongs to a different project');
      return 'promise' in existing ? existing.promise : { threadId: existing.threadId, workspace: existing.workspace };
    }
    const promise = this.createSession(agentId, projectId);
    this.starting.set(agentId, { projectId, promise });
    try { return await promise; } finally { this.starting.delete(agentId); }
  }
  private async createSession(agentId: string, projectId: string): Promise<SessionInfo> {
    const configured = this.options.workspaceRoot;
    if (configured) await mkdir(configured, { recursive: true });
    const root = configured ? await realpath(configured) : path.join(await realpath(homedir()), 'ensemble-agent-workspaces');
    const workspace = path.join(root, projectId, agentId);
    await mkdir(workspace, { recursive: true });
    // Reject symlink/junction redirection outside the assigned home workspace.
    if (path.relative(workspace, await realpath(workspace)) !== '') throw new Error('Workspace resolves outside its assigned path');
    await this.client.initialize();
    const threadId = await this.client.threadStart({ cwd: workspace, sandbox: 'workspace-write', approvalPolicy: 'never', model: this.options.model,
      developerInstructions: (this.options.instructionsFor ?? (id => roleFor(id)?.systemPrompt))(agentId) });
    this.sessions.set(agentId, { projectId, threadId, workspace, tasks: new Map(), reportIndexes: new Map(), nextReportIndex: new Map() });
    return { threadId, workspace };
  }

  async startTask(agentId: string, input: TaskInstructionsInput): Promise<string> {
    if (this.closed) throw new Error('Connector closed');
    const session = this.sessions.get(agentId);
    if (!session) throw new Error('Start the agent session first');
    if (session.active) throw new Error('Agent already has an active or starting turn');
    return this.turn(session, agentId, input.taskId, input.files, taskInstructions(input));
  }

  async continueTask(agentId: string, input: ContinueTaskInput): Promise<string> {
    if (this.closed) throw new Error('Connector closed');
    const session = this.sessions.get(agentId);
    if (!session) throw new Error('Start the agent session first');
    if (session.active) throw new Error('Agent already has an active or starting turn');
    // A thread that never saw this task (a new session after a restart) gets the full instructions.
    const known = [...session.tasks.values()].includes(input.taskId);
    return this.turn(session, agentId, input.taskId, known ? [] : input.task.files, continueInstructions(input, !known));
  }

  private async turn(session: AgentSession, agentId: string, taskId: string, files: readonly InputFile[] | undefined, text: string): Promise<string> {
    const active: ActiveTask = { taskId, started: false };
    session.active = active; // Reserve before awaiting: concurrent starts cannot both pass.
    try {
      await writeInputFiles(session.workspace, files);
    } catch (error) {
      if (session.active === active) session.active = undefined; // Nothing reached the runtime.
      throw error;
    }
    try {
      const turnId = await this.client.turnStart({ threadId: session.threadId, text });
      this.started(agentId, session, turnId);
      return turnId;
    } catch (error) {
      // A server rejection proves no new turn; a transport error leaves acceptance unknown.
      if (error instanceof RpcError && !active.started && session.active === active) session.active = undefined;
      throw error;
    }
  }

  async sendUpdate(agentId: string, input: UpdateInstructionsInput): Promise<SendUpdateResult> {
    const session = this.sessions.get(agentId);
    const turnId = session?.active?.turnId;
    if (!session || !turnId) return { sent: false, reason: 'No active turn' };
    try {
      await this.client.turnSteer({ threadId: session.threadId, expectedTurnId: turnId, text: updateInstructions(input), clientUserMessageId: input.updateId });
      return { sent: true };
    } catch (error) {
      if (error instanceof SteerRejectedError) return { sent: false, reason: error.message };
      throw error;
    }
  }

  async stop(agentId?: string): Promise<void> {
    if (agentId === undefined) { this.closed = true; await this.client.close(); return; }
    const session = this.sessions.get(agentId);
    if (session?.active?.turnId) await this.client.turnInterrupt({ threadId: session.threadId, turnId: session.active.turnId });
  }
}
