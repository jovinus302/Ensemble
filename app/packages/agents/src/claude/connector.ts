import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { continueInstructions, parseReports, taskInstructions, type ContinueTaskInput, type InputFile, type TaskInstructionsInput, type UpdateInstructionsInput } from '../protocol.ts';
import { roleFor } from '../roles.ts';
import type { SendUpdateResult, SessionConnector, SessionEvent, SessionInfo } from '../session.ts';
import { writeInputFiles } from '../codex/connector.ts';

/** `interrupted` is set by stop(), also while the turn is still reserved and has no process yet. */
interface ActiveTask { taskId: string; turnId: string; child?: ChildProcess; interrupted?: boolean }
interface AgentSession extends SessionInfo {
  projectId: string;
  active?: ActiveTask;
  /** Latest CLI session ID; each resumed turn forks a new one. */
  lastSessionId?: string;
  seenTasks: Set<string>;
}

export interface ClaudeConnectorOptions {
  /** Omitted: the CLI's default model (user settings are not read unless inheritUserSettings). */
  model?: string;
  /** `--effort` level; defaults to medium rather than whatever the user's own settings choose. */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Tools allowed without a prompt on top of acceptEdits; defaults to web research. */
  allowedTools?: readonly string[];
  /** Tools the agent may not use; defaults to the subagent tool, so an agent never spawns its own agents. */
  disallowedTools?: readonly string[];
  /** Load the user's ~/.claude settings, hooks and MCP servers into agent turns. Defaults to false. */
  inheritUserSettings?: boolean;
  /** Defaults to ~/ensemble-agent-workspaces; keep it outside any repository. */
  workspaceRoot?: string;
  /** System prompt appended to an agent's session; defaults to the built-in role's prompt. */
  instructionsFor?: (agentId: string) => string | undefined;
  /** CLI command; tests substitute a fake. */
  executable?: string;
  /** Prepended to the CLI arguments; lets tests run a Node script as the executable. */
  executableArgs?: string[];
}

const DEFAULT_ALLOWED_TOOLS = ['WebSearch', 'WebFetch'];
const DEFAULT_DISALLOWED_TOOLS = ['Agent', 'Task'];

const component = (value: string) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error('Project and agent IDs must contain only letters, numbers, underscores, or hyphens');
  return value;
};

interface StreamEvent {
  type?: string;
  subtype?: string;
  session_id?: string;
  result?: string;
  /** The CLI reports API and model errors as a `success` result flagged is_error. */
  is_error?: boolean;
  /** Marks the synthetic assistant message that carries an API error, not a model reply. */
  is_api_error_message?: boolean;
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
    const context = { agentId, taskId, threadId: session.threadId, turnId };
    if (active.interrupted) {
      // Stopped while its input was prepared: nothing reached the runtime, so the turn settles here.
      if (session.active === active) session.active = undefined;
      this.emit({ ...context, type: 'turn', status: 'interrupted' });
      return turnId;
    }
    const sessionArgs = session.lastSessionId ? ['--resume', session.lastSessionId] : ['--session-id', (session.lastSessionId = session.threadId)];
    const systemPrompt = (this.options.instructionsFor ?? (id => roleFor(id)?.systemPrompt))(agentId);
    const { allowedTools = DEFAULT_ALLOWED_TOOLS, disallowedTools = DEFAULT_DISALLOWED_TOOLS } = this.options;
    const args = [
      ...(this.options.executableArgs ?? []),
      '-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits',
      ...sessionArgs,
      // Joined into one value: the flags are variadic and would swallow the arguments after them.
      ...(allowedTools.length ? ['--allowedTools', allowedTools.join(',')] : []),
      ...(disallowedTools.length ? ['--disallowedTools', disallowedTools.join(',')] : []),
      '--effort', this.options.effort ?? 'medium',
      // Project settings only (none in the agent workspace): no user hooks, plugins or MCP servers.
      ...(this.options.inheritUserSettings ? [] : ['--setting-sources', 'project', '--strict-mcp-config']),
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
    this.emit({ ...context, type: 'turn', status: 'started' });

    let stdoutRest = '';
    let stderrTail = '';
    let result: { ok: boolean; error?: string } | undefined;
    let apiError: string | undefined;
    let nextReportIndex = 0;
    const handleEvent = (event: StreamEvent) => {
      if (event.session_id) session.lastSessionId = event.session_id;
      if (event.type === 'assistant') {
        const text = (event.message?.content ?? []).filter(block => block.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n');
        if (!text) return;
        if (event.is_api_error_message) { apiError = text; return; } // The turn's failure reason, not the agent speaking.
        const itemId = event.message?.id ?? randomUUID();
        this.emit({ ...context, type: 'reply', itemId, text });
        const parsed = parseReports(text);
        const firstIndex = nextReportIndex;
        nextReportIndex += parsed.reports.length;
        parsed.reports.forEach((report, index) => this.emit({ ...context, type: 'report', itemId, index: firstIndex + index, report }));
        parsed.errors.forEach((error, index) => this.emit({ ...context, type: 'parse_error', itemId, index, error }));
      } else if (event.type === 'result') {
        const ok = event.subtype === 'success' && !event.is_error;
        result = { ok, ...(ok ? {} : { error: event.error?.message ?? (typeof event.result === 'string' && event.result.trim() ? event.result : undefined) }) };
      }
    };
    const handleLine = (line: string) => {
      if (!line.trim()) return;
      try { handleEvent(JSON.parse(line) as StreamEvent); } catch { /* Non-JSON noise on stdout is diagnostic only. */ }
    };
    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (chunk: string) => {
      const lines = (stdoutRest + chunk).split('\n');
      stdoutRest = lines.pop() ?? '';
      lines.forEach(handleLine);
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
    // 'close' follows the end of stdout: records written just before exit are read first.
    child.once('close', (code, signal) => {
      handleLine(stdoutRest); stdoutRest = '';
      if (active.interrupted) return finish();
      if (code === 0 && result?.ok) return finish();
      // stderr carries warnings even on healthy turns; it explains a failure only when nothing better does.
      const stderr = stderrTail.trim();
      finish(result?.error ?? apiError ?? `Claude 턴이 비정상 종료되었습니다 (code ${code ?? signal})${stderr ? `: ${stderr}` : ''}`);
    });
    child.stdin!.on('error', () => { /* A dead process closes stdin; close handling reports the turn. */ });
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
    if (agentId === undefined) this.closed = true;
    const sessions = agentId === undefined ? [...this.sessions.values()] : [this.sessions.get(agentId)];
    // A reserved turn without a process yet is cancelled before it spawns.
    for (const active of sessions.map(session => session?.active)) if (active) { active.interrupted = true; active.child?.kill(); }
  }
}
