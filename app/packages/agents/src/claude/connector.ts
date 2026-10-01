import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { continueInstructions, parseReports, taskInstructions, type ContinueTaskInput, type InputFile, type TaskInstructionsInput, type UpdateInstructionsInput } from '../protocol.ts';
import { roleFor } from '../roles.ts';
import type { SendUpdateResult, SessionConnector, SessionEvent, SessionInfo } from '../session.ts';
import { writeInputFiles } from '../codex/connector.ts';

interface ActiveTask { taskId: string; turnId: string; child?: ChildProcess; interrupted?: boolean }
interface AgentSession extends SessionInfo {
  projectId: string;
  active?: ActiveTask;
  /** Latest CLI session ID; each resumed turn forks a new one. */
  lastSessionId?: string;
  seenTasks: Set<string>;
}

export interface ClaudeConnectorOptions {
  /** Omitted: the user's Claude Code default model. */
  model?: string;
  /** Defaults to ~/ensemble-agent-workspaces; keep it outside any repository. */
  workspaceRoot?: string;
  /** System prompt appended to an agent's session; defaults to the built-in role's prompt. */
  instructionsFor?: (agentId: string) => string | undefined;
  /** CLI command; tests substitute a fake. */
  executable?: string;
  /** Prepended to the CLI arguments; lets tests run a Node script as the executable. */
  executableArgs?: string[];
}

const component = (value: string) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error('Project and agent IDs must contain only letters, numbers, underscores, or hyphens');
  return value;
};

interface StreamEvent {
  type?: string;
  subtype?: string;
  session_id?: string;
  result?: string;
  message?: { id?: string; content?: { type?: string; text?: string }[] };
  error?: { message?: string };
}

/**
 * Runs each turn as one `claude -p --output-format stream-json` process in the agent's workspace.
 * The thread continues across turns through `--resume`; print mode cannot steer a running turn, so
 * sendUpdate reports unsent and the update reaches the agent on its next turn (continueTask).
 */
export class ClaudeSessionConnector implements SessionConnector {
  private readonly sessions = new Map<string, AgentSession>();
  private readonly starting = new Map<string, { projectId: string; promise: Promise<SessionInfo> }>();
  private readonly listeners = new Set<(event: SessionEvent) => void>();
  private closed = false;

  constructor(private readonly options: ClaudeConnectorOptions = {}) {}

  private emit(event: SessionEvent): void { for (const listener of this.listeners) listener(event); }
  onEvent(handler: (event: SessionEvent) => void): () => void {
    this.listeners.add(handler); return () => { this.listeners.delete(handler); };
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
    const threadId = randomUUID();
    this.sessions.set(agentId, { projectId, threadId, workspace, seenTasks: new Set() });
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
    const known = session.seenTasks.has(input.taskId);
    return this.turn(session, agentId, input.taskId, known ? [] : input.task.files, continueInstructions(input, !known));
  }

  private async turn(session: AgentSession, agentId: string, taskId: string, files: readonly InputFile[] | undefined, text: string): Promise<string> {
    const turnId = randomUUID();
    const active: ActiveTask = { taskId, turnId };
    session.active = active; // Reserve before awaiting: concurrent starts cannot both pass.
    try {
      await writeInputFiles(session.workspace, files);
    } catch (error) {
      if (session.active === active) session.active = undefined; // Nothing reached the runtime.
      throw error;
    }
    const sessionArgs = session.lastSessionId ? ['--resume', session.lastSessionId] : ['--session-id', (session.lastSessionId = session.threadId)];
    const systemPrompt = (this.options.instructionsFor ?? (id => roleFor(id)?.systemPrompt))(agentId);
    const args = [
      ...(this.options.executableArgs ?? []),
      '-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits',
      ...sessionArgs,
      ...(this.options.model ? ['--model', this.options.model] : []),
      ...(systemPrompt ? ['--append-system-prompt', systemPrompt] : []),
    ];
    let child: ChildProcess;
    try {
      child = spawn(this.options.executable ?? 'claude', args, { cwd: session.workspace, env: process.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      if (session.active === active) session.active = undefined;
      throw error;
    }
    active.child = child;
    session.seenTasks.add(taskId);
    const context = { agentId, taskId, threadId: session.threadId, turnId };
    this.emit({ ...context, type: 'turn', status: 'started' });

    let stdoutRest = '';
    let stderrTail = '';
    let resultSubtype: string | undefined;
    let resultError: string | undefined;
    let nextReportIndex = 0;
    const handleEvent = (event: StreamEvent) => {
      if (event.session_id) session.lastSessionId = event.session_id;
      if (event.type === 'assistant') {
        const text = (event.message?.content ?? []).filter(block => block.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n');
        if (!text) return;
        const itemId = event.message?.id ?? randomUUID();
        this.emit({ ...context, type: 'reply', itemId, text });
        const parsed = parseReports(text);
        const firstIndex = nextReportIndex;
        nextReportIndex += parsed.reports.length;
        parsed.reports.forEach((report, index) => this.emit({ ...context, type: 'report', itemId, index: firstIndex + index, report }));
        parsed.errors.forEach((error, index) => this.emit({ ...context, type: 'parse_error', itemId, index, error }));
      } else if (event.type === 'result') {
        resultSubtype = event.subtype;
        if (event.subtype !== 'success') resultError = event.error?.message ?? (typeof event.result === 'string' ? event.result : undefined);
      }
    };
    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (chunk: string) => {
      const lines = (stdoutRest + chunk).split('\n');
      stdoutRest = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try { handleEvent(JSON.parse(line) as StreamEvent); } catch { /* Non-JSON noise on stdout is diagnostic only. */ }
      }
    });
    child.stderr!.setEncoding('utf8');
    child.stderr!.on('data', (chunk: string) => { stderrTail = (stderrTail + chunk).slice(-2000); });
    let finished = false;
    const finish = (reason?: string) => {
      if (finished) return;
      finished = true;
      if (session.active === active) session.active = undefined;
      const status = active.interrupted ? 'interrupted' : reason === undefined ? 'completed' : 'failed';
      this.emit({ ...context, type: 'turn', status, ...(status === 'failed' && reason ? { reason } : {}) });
    };
    child.once('error', error => finish(`Claude CLI를 실행하지 못했습니다: ${error.message}`));
    child.once('exit', (code, signal) => {
      if (stdoutRest.trim()) { try { handleEvent(JSON.parse(stdoutRest) as StreamEvent); } catch { /* incomplete trailing line */ } }
      if (active.interrupted) return finish();
      if (code === 0 && resultSubtype === 'success') return finish();
      finish(resultError ?? (stderrTail.trim() || `Claude 턴이 비정상 종료되었습니다 (code ${code ?? signal})`));
    });
    child.stdin!.on('error', () => { /* A dead process closes stdin; exit handling reports the turn. */ });
    child.stdin!.end(text);
    return turnId;
  }

  async sendUpdate(agentId: string, input: UpdateInstructionsInput): Promise<SendUpdateResult> {
    const session = this.sessions.get(agentId);
    if (!session?.active) return { sent: false, reason: 'No active turn' };
    // Print mode cannot steer a running turn; the update waits for continueTask.
    return { sent: false, reason: 'Claude 실행기는 진행 중인 턴에 전달을 보내지 못합니다. 턴이 끝나면 전달합니다.' };
  }

  async stop(agentId?: string): Promise<void> {
    if (agentId === undefined) {
      this.closed = true;
      for (const session of this.sessions.values()) if (session.active?.child) { session.active.interrupted = true; session.active.child.kill(); }
      return;
    }
    const session = this.sessions.get(agentId);
    if (session?.active?.child) { session.active.interrupted = true; session.active.child.kill(); }
  }
}
