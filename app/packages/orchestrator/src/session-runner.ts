import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { project, type EventContext, type EventPayloads, type EventType, type LedgerEvent, type NewLedgerEvent } from '@ensemble/core';
import type { LedgerStore } from '@ensemble/store';
import { MAX_FILE_BYTES, validateAck, validateResult, type ResultReport, type SessionConnector, type SessionEvent, type TaskInstructionsInput, type UpdateInstructionsInput } from '@ensemble/agents';
import { buildTaskContext, humanizeRefs, plainAgentText, summarizeForHuman } from './context.ts';

interface TaskRun {
  agentId: string;
  input: TaskInstructionsInput;
  turnId?: string;
  updates: Map<string, { input: UpdateInstructionsInput; sent: boolean; dropped: string[] }>;
  timer?: ReturnType<typeof setTimeout>;
  timedOut?: boolean;
  blocked?: boolean;
  finished?: boolean;
}

/** A turn that stopped without a result; the task is left blocked for a person to reconcile. */
export interface BlockedTurn { agentId: string; taskId: string; turnId: string; reason: string }
export interface SessionRunnerOptions {
  /** Interrupts a turn that runs longer than this and blocks its task. Omitted: no limit. */
  turnTimeoutMs?: number;
  /** Called once per blocked turn, after task_blocked is recorded. */
  onBlocked?: (blocked: BlockedTurn) => void;
  /** Largest result file recorded as an attachment. */
  maxAttachmentBytes?: number;
}
export const MAX_ATTACHMENT_BYTES = MAX_FILE_BYTES;
/** How a change or answer reached the agent: steered into its live turn, or carried by a new turn. */
export type Delivery = { via: 'steer' | 'next_turn'; sent: true; turnId?: string } | { via: 'next_turn'; sent: false; reason: string };
type UpdateRecord = { input: UpdateInstructionsInput; sent: boolean; dropped: string[] };
const MIME_TYPES: Record<string, string> = { '.md': 'text/markdown', '.markdown': 'text/markdown', '.html': 'text/html', '.htm': 'text/html',
  '.txt': 'text/plain', '.csv': 'text/csv', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
/** Readable and URL-safe: the web runtime serves attachments by ID. */
const attachmentId = (resultId: string, file: string) =>
  `${path.basename(file).replace(/[^\w-]+/g, '-').slice(0, 40)}-${createHash('sha256').update(`${resultId}\0${file}`).digest('hex').slice(0, 12)}`;
const withPending = (events: readonly LedgerEvent[], pending: NewLedgerEvent[]): LedgerEvent[] =>
  [...events, ...pending.map((event, i) => ({ ...event, id: `pending-${i}`, seq: (events.at(-1)?.seq ?? 0) + i + 1, at: event.at ?? '' }))];
const BLOCKABLE = new Set(['reserved', 'running', 'revising']);
type ResultFile = { path: string; data: Buffer };

/** Serializes external operations and observations; every ledger mutation is transactional. */
export class SessionRunner {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly failures: unknown[] = [];
  private readonly runs = new Map<string, TaskRun>();
  private readonly turns = new Map<string, TaskRun>();
  private readonly workspaces = new Map<string, string>();
  private readonly unsubscribe: () => void;

  constructor(private readonly connector: SessionConnector, private readonly store: LedgerStore, private readonly context: EventContext,
    private readonly options: SessionRunnerOptions = {}) {
    this.unsubscribe = connector.onEvent(event => {
      void this.enqueue(() => this.observe(event)).catch(error => { this.failures.push(error); });
    });
  }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation);
    this.queue = next.catch(() => undefined);
    return next;
  }
  private event<K extends EventType>(agentId: string, type: K, payload: EventPayloads[K], idempotencyKey: string): NewLedgerEvent {
    return { ...this.context, actor: { kind: 'agent', id: agentId }, type, payload, idempotencyKey };
  }
  private async append(events: NewLedgerEvent[]): Promise<void> {
    await this.store.transaction(this.context.projectId, () => ({ append: events, result: undefined }));
  }
  startSession(agentId: string) {
    return this.enqueue(async () => {
      const session = await this.connector.startSession(agentId, this.context.projectId);
      this.workspaces.set(agentId, session.workspace);
      await this.append([this.event(agentId, 'session_linked', { agentId, ...session }, `session:${session.threadId}`)]);
      return session;
    });
  }

  startTask(agentId: string, input: TaskInstructionsInput): Promise<string> {
    return this.enqueue(async () => {
      await this.store.transaction(this.context.projectId, events => {
        const state = project(events);
        const task = state.tasks.get(input.taskId);
        if (!task || task.spec.assignee !== agentId) throw new Error('Task is not assigned to this agent');
        if (input.planVersion !== state.plan?.version) throw new Error('Task instructions do not match the current plan');
        const occupied = state.activeTurn.get(agentId);
        if (occupied && occupied !== input.taskId) throw new Error('Agent already reserved for another task');
        if (task.status !== 'ready' && task.status !== 'reserved') throw new Error(`Task cannot start from ${task.status}`);
        return { append: task.status === 'ready' ? [{ ...this.context, actor: { kind: 'system' as const, id: 'session-runner' },
          type: 'task_start_reserved', idempotencyKey: `start:${input.taskId}:v${task.specVersion}`,
          payload: { taskId: input.taskId, specVersion: task.specVersion, trigger: 'session-runner' } }] : [], result: undefined };
      });
      const run: TaskRun = { agentId, input: structuredClone(input), updates: new Map() };
      this.runs.set(agentId, run);
      try {
        const turnId = await this.connector.startTask(agentId, input);
        run.turnId = turnId;
        this.turns.set(turnId, run);
        await this.append([this.event(agentId, 'task_started', { taskId: input.taskId, turnId }, `turn:${turnId}`)]);
        this.arm(run);
        return turnId;
      } catch (error) {
        // Preserve the reservation on ambiguous delivery; never retry automatically.
        await this.append([this.event(agentId, 'task_blocked', { taskId: input.taskId,
          reason: `Session start failed; reconcile before retry: ${error instanceof Error ? error.message : 'unknown error'}` },
        `start-failed:${this.context.projectId}:${input.taskId}:v${input.planVersion}`)]);
        throw error;
      }
    });
  }

  /** Interrupts a turn that outlives the configured limit. */
  private arm(run: TaskRun): void {
    const limit = this.options.turnTimeoutMs;
    if (limit === undefined || run.blocked) return;
    run.timer = setTimeout(() => { void this.enqueue(() => this.timeout(run, limit)).catch(error => { this.failures.push(error); }); }, limit);
    run.timer.unref?.();
  }

  sendUpdate(agentId: string, input: UpdateInstructionsInput) {
    return this.enqueue(async () => {
      const run = this.runs.get(agentId);
      if (!run) return { sent: false as const, reason: 'No task started' };
      // The PM's own steer: its one update_sent counts as the PM's automatic action.
      return this.steer(run, input, true, { kind: 'pm', id: 'pm' });
    });
  }

  private async steer(run: TaskRun, input: UpdateInstructionsInput, recordRejection: boolean, actor?: NewLedgerEvent['actor']): Promise<{ sent: true } | { sent: false; reason: string }> {
    const { agentId } = run;
    const previous = run.updates.get(input.updateId);
    if (previous) {
      if (JSON.stringify(previous.input) !== JSON.stringify(input)) throw new Error('Update ID reused with different content');
      return previous.sent ? { sent: true as const } : { sent: false as const, reason: 'Previous delivery was rejected or remains uncertain' };
    }
    const update: UpdateRecord = { input: structuredClone(input), sent: false, dropped: [] };
    run.updates.set(input.updateId, update);
    const result = await this.connector.sendUpdate(agentId, input);
    update.sent = result.sent;
    // An unsent update may still go out in a new turn under the same ID.
    if (!result.sent && !recordRejection) run.updates.delete(input.updateId);
    const taskId = run.input.taskId;
    if (result.sent || recordRejection) await this.append([result.sent
      ? { ...this.event(agentId, 'update_sent', { updateId: input.updateId, taskId, fromVersion: input.fromVersion,
        toVersion: input.toVersion, turnId: run.turnId }, `update:${input.updateId}:sent`), ...(actor ? { actor } : {}) }
      : this.event(agentId, 'update_rejected', { updateId: input.updateId, taskId, reasons: [result.reason] }, `update:${input.updateId}:rejected`)]);
    return result;
  }

  /**
   * Delivers a change, a person's answer or a PM revision request to the agent working on a task: steered into its live
   * turn, otherwise a new turn on the same thread carries it, and the agent acknowledges it before
   * it carries on. At most one turn per agent; an update already sent is never sent again.
   * Tasks that are not running need nothing: their next start reads the current ledger.
   */
  deliver(agentId: string, taskId: string, update: UpdateInstructionsInput): Promise<Delivery> {
    return this.enqueue(async (): Promise<Delivery> => {
      const events = await this.store.read({ projectId: this.context.projectId });
      if (events.some(e => e.idempotencyKey === `update:${update.updateId}:sent`)) return { via: 'next_turn', sent: true };
      if (events.some(e => e.idempotencyKey === `update:${update.updateId}:rejected`)) return { via: 'next_turn', sent: false, reason: 'Previous delivery was rejected' };
      const run = this.runs.get(agentId);
      if (run && run.input.taskId === taskId && run.turnId && !run.finished && !run.blocked) {
        const steered = await this.steer(run, update, false);
        if (steered.sent) return { via: 'steer', sent: true, turnId: run.turnId };
      }
      const state = project(events);
      const task = state.tasks.get(taskId);
      // A revising task waits for exactly this: the PM's revision request, carried by a new turn.
      if (!task || task.spec.assignee !== agentId || (task.status !== 'running' && task.status !== 'revising')) return { via: 'next_turn', sent: false, reason: 'Task is not running; its next start carries the change' };
      const occupied = state.activeTurn.get(agentId);
      if (occupied && occupied !== taskId) return { via: 'next_turn', sent: false, reason: 'Agent is working on another task' };
      if (!this.connector.continueTask) return { via: 'next_turn', sent: false, reason: 'This runtime cannot start a follow-up turn' };
      if (!this.workspaces.has(agentId)) {
        const session = await this.connector.startSession(agentId, this.context.projectId);
        this.workspaces.set(agentId, session.workspace);
        await this.append([this.event(agentId, 'session_linked', { agentId, ...session }, `session:${session.threadId}`)]);
      }
      let input: TaskInstructionsInput;
      try { input = buildTaskContext(state, taskId, events); } catch (error) {
        if (run?.input.taskId !== taskId) return { via: 'next_turn', sent: false, reason: error instanceof Error ? error.message : 'Task context unavailable' };
        input = run.input; // The thread already holds this task's instructions.
      }
      const next: TaskRun = { agentId, input: structuredClone(input), updates: run?.input.taskId === taskId ? run.updates : new Map() };
      const record: UpdateRecord = { input: structuredClone(update), sent: false, dropped: [] };
      next.updates.set(update.updateId, record);
      const planVersion = Math.max(input.planVersion, ...[...next.updates.values()].filter(u => u.sent || u === record).map(u => u.input.toVersion));
      if (run?.timer) { clearTimeout(run.timer); run.timer = undefined; }
      this.runs.set(agentId, next);
      try {
        const turnId = await this.connector.continueTask(agentId, { taskId, planVersion, update, task: input });
        record.sent = true;
        next.turnId = turnId;
        this.turns.set(turnId, next);
        await this.append([
          this.event(agentId, 'task_started', { taskId, turnId }, `turn:${turnId}`),
          this.event(agentId, 'update_sent', { updateId: update.updateId, taskId, fromVersion: update.fromVersion, toVersion: update.toVersion, turnId }, `update:${update.updateId}:sent`),
        ]);
        this.arm(next);
        return { via: 'next_turn', sent: true, turnId };
      } catch (error) {
        // Acceptance may be unknown: never retry blindly; a person reconciles the blocked task.
        const reason = `변경을 전달할 작업 턴을 시작하지 못했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}`;
        const turnId = `continue:${update.updateId}`;
        await this.append([this.event(agentId, 'update_rejected', { updateId: update.updateId, taskId, reasons: [reason] }, `update:${update.updateId}:rejected`)]);
        const { result: blocked } = await this.store.transaction(this.context.projectId, current => {
          const status = project(current).tasks.get(taskId)?.status;
          if (!status || !BLOCKABLE.has(status)) return { append: [], result: false };
          return { append: [{ ...this.context, actor: { kind: 'system' as const, id: 'session-runner' }, type: 'task_blocked',
            idempotencyKey: `turn-blocked:${turnId}`, payload: { taskId, reason } }], result: true };
        });
        if (blocked) this.options.onBlocked?.({ agentId, taskId, turnId, reason });
        return { via: 'next_turn', sent: false, reason };
      }
    });
  }

  private async timeout(run: TaskRun, limit: number): Promise<void> {
    run.timer = undefined;
    if (!run.turnId || run.blocked || run.finished) return;
    run.timedOut = true;
    await this.block(run, `작업 제한 시간(${Math.round(limit / 6000) / 10}분)을 넘겨 중단했습니다`);
    // The interrupt's own turn event is recorded as an observation; the task stays blocked.
    try { await this.connector.stop(run.agentId); } catch { /* A lost session cannot be interrupted; the task is already blocked. */ }
  }

  /** Blocks the task once per turn unless its result already moved it on; nothing restarts automatically. */
  private async block(run: TaskRun, reason: string): Promise<void> {
    if (run.blocked || !run.turnId) return;
    run.blocked = true;
    const { agentId, input: { taskId } } = run;
    const turnId = run.turnId;
    const { result: blocked } = await this.store.transaction(this.context.projectId, events => {
      const status = project(events).tasks.get(taskId)?.status;
      if (!status || !BLOCKABLE.has(status)) return { append: [], result: false };
      return { append: [{ ...this.context, actor: { kind: 'system' as const, id: 'session-runner' }, type: 'task_blocked',
        idempotencyKey: `turn-blocked:${turnId}`, payload: { taskId, reason } }], result: true };
    });
    if (blocked) this.options.onBlocked?.({ agentId, taskId, turnId, reason });
  }

  private async observe(event: SessionEvent): Promise<void> {
    const { agentId, taskId, turnId } = event;
    const run = this.turns.get(turnId);
    if (!run || run.input.taskId !== taskId) return;
    if (event.type === 'turn') {
      await this.append([this.event(agentId, 'turn_observed', { agentId, taskId, turnId, status: event.status }, `observe:${turnId}:${event.status}`)]);
      if (event.status === 'started') return;
      run.finished = true;
      clearTimeout(run.timer); run.timer = undefined;
      if (event.status === 'failed') await this.block(run, `Agent 세션 오류: ${event.reason ?? '알 수 없는 오류'}`);
      else if (event.status === 'interrupted' && !run.timedOut) await this.block(run, 'Agent 작업이 중단되었습니다');
      return;
    }
    const reply = (text: string, suffix: string) => this.event(agentId, 'reply_recorded', { memberId: agentId, taskId, turnId, text }, `reply:${turnId}:${suffix}`);
    if (event.type === 'reply') {
      if (event.text.includes('```ensemble-report')) {
        await this.append([this.event(agentId, 'agent_report_recorded', { memberId: agentId, taskId, turnId, text: event.text }, `raw:${turnId}:${event.itemId}`)]);
        return;
      }
      // A message that only reported a review label says nothing to people.
      const text = plainAgentText(event.text);
      if (text) await this.append([reply(text, event.itemId)]);
      return;
    }
    if (event.type === 'parse_error') {
      await this.append([reply(`Invalid agent report: ${event.error.reason}`, `${event.itemId}:error:${event.index}`)]); return;
    }
    const report = event.report;
    if (report.type === 'acknowledge_update') {
      const update = run.updates.get(report.updateId);
      const validation = update?.sent ? validateAck(report, { updateId: update.input.updateId, planVersion: update.input.toVersion, drop: update.input.drop })
        : { ok: false as const, reasons: ['No matching update was sent for this turn'] };
      if (validation.ok && update) update.dropped = report.dropped;
      await this.append([validation.ok
        ? this.event(agentId, 'update_acknowledged', { updateId: report.updateId, taskId, planVersion: report.planVersion,
          applied: report.applied, dropped: report.dropped }, `update:${report.updateId}:acknowledged`)
        : this.event(agentId, 'update_rejected', { updateId: report.updateId, taskId, reasons: validation.reasons }, `update:${report.updateId}:rejected`)]);
    } else if (report.type === 'result_report') {
      const updates = [...run.updates.values()].filter(update => update.sent);
      const validation = validateResult(report, { taskId, planVersion: Math.max(run.input.planVersion, ...updates.map(update => update.input.toVersion)),
        dropped: updates.flatMap(update => [...update.input.drop, ...update.dropped]) });
      // Reported paths are workspace-relative, never arbitrary absolute or parent paths.
      const invalidPaths = report.files.filter(file => !file.path || /^(?:[a-z]:|[\\/])/i.test(file.path) || file.path.split(/[\\/]/).includes('..'));
      const reasons = validation.ok ? invalidPaths.length ? ['Artifact paths must stay inside the workspace'] : [] : validation.reasons;
      const resultId = `result:${turnId}:${event.index}`;
      if (!reasons.length && (await this.store.read({ projectId: this.context.projectId })).some(e => e.idempotencyKey === resultId)) return;
      const files = reasons.length ? [] : await this.readFiles(agentId, report);
      if (!Array.isArray(files)) reasons.push(...files.rejected);
      if (reasons.length || !Array.isArray(files)) {
        await this.append([reply(`Rejected result: ${reasons.join('; ')}`, `result:${event.index}:rejected`)]);
        await this.block(run, `Agent 결과를 받지 못했습니다: ${reasons.join('; ')}`);
        return;
      }
      await this.recordResult(agentId, turnId, resultId, report, files);
    } else {
      const events = await this.store.read({ projectId: this.context.projectId });
      const choices = report.options?.length ? `\n선택지: ${report.options.map(option => humanizeRefs(option, events)).join(' / ')}` : '';
      await this.append([reply(`질문이 있습니다. ${humanizeRefs(report.question, events)}${choices}`, `question:${event.index}`)]);
    }
  }

  /** Reads every reported file from the agent's workspace; any unsafe, missing or oversized file rejects the result. */
  private async readFiles(agentId: string, report: ResultReport): Promise<ResultFile[] | { rejected: string[] }> {
    const workspace = this.workspaces.get(agentId) ?? project(await this.store.read({ projectId: this.context.projectId })).sessions.get(agentId)?.workspace;
    if (!workspace) return { rejected: ['Agent workspace is unknown'] };
    const limit = this.options.maxAttachmentBytes ?? MAX_ATTACHMENT_BYTES;
    const rejected: string[] = [];
    const files: ResultFile[] = [];
    let root: string;
    try { root = await realpath(workspace); } catch { return { rejected: ['Agent workspace is missing'] }; }
    for (const file of report.files) {
      let real: string;
      try { real = await realpath(path.resolve(root, file.path)); } catch { rejected.push(`Result file not found: ${file.path}`); continue; }
      // Symlinks and junctions may not lead out of the workspace.
      const relative = path.relative(root, real);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) { rejected.push(`Result file is outside the workspace: ${file.path}`); continue; }
      const info = await stat(real);
      if (!info.isFile()) { rejected.push(`Result path is not a file: ${file.path}`); continue; }
      if (info.size > limit) { rejected.push(`Result file exceeds ${limit} bytes: ${file.path}`); continue; }
      files.push({ path: file.path, data: await readFile(real) });
    }
    return rejected.length ? { rejected } : files;
  }

  /** Attachments, the submission (whose artifacts are those attachments) and the human summary land together. */
  private async recordResult(agentId: string, turnId: string, resultId: string, report: ResultReport, files: ResultFile[]): Promise<void> {
    const { taskId } = report;
    const attachments = files.map(file => {
      const mimeType = MIME_TYPES[path.extname(file.path).toLowerCase()] ?? 'application/octet-stream';
      return { id: attachmentId(resultId, file.path), name: path.basename(file.path), mimeType, uri: `data:${mimeType};base64,${file.data.toString('base64')}` };
    });
    const attachmentIds = attachments.map(a => a.id);
    await this.store.transaction(this.context.projectId, events => {
      const pending: NewLedgerEvent[] = [
        ...attachments.map(a => this.event(agentId, 'attachment_recorded', { attachmentId: a.id, name: a.name, mimeType: a.mimeType, uri: a.uri, taskId }, `${resultId}:attachment:${a.id}`)),
        this.event(agentId, 'result_submitted', { taskId, resultId, planVersion: report.planVersion, summary: report.summary, artifactIds: attachmentIds }, resultId),
      ];
      const text = summarizeForHuman(project(withPending(events, pending)), taskId, report);
      pending.push(this.event(agentId, 'reply_recorded', { memberId: agentId, taskId, turnId, text, attachmentIds }, `${resultId}:summary`));
      return { append: pending, result: undefined };
    });
  }

  async flush(): Promise<void> {
    // Event handlers may extend the queue while an operation is still completing.
    let observed: Promise<unknown>;
    do { observed = this.queue; await observed; } while (observed !== this.queue);
    if (this.failures.length) throw new AggregateError(this.failures.splice(0), 'Session events could not be recorded');
  }
  async stop(agentId?: string): Promise<void> {
    if (agentId === undefined) for (const run of this.turns.values()) { clearTimeout(run.timer); run.timer = undefined; }
    await this.connector.stop(agentId); await this.flush();
    if (agentId === undefined) this.unsubscribe();
  }
}
