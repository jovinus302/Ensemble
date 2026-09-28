import { project, type EventContext, type EventPayloads, type EventType, type NewLedgerEvent } from '@ensemble/core';
import type { LedgerStore } from '@ensemble/store';
import { validateAck, validateResult, type SessionConnector, type SessionEvent, type TaskInstructionsInput, type UpdateInstructionsInput } from '@ensemble/agents';

interface TaskRun {
  input: TaskInstructionsInput;
  turnId?: string;
  updates: Map<string, { input: UpdateInstructionsInput; sent: boolean; dropped: string[] }>;
}

/** Serializes external operations and observations; every ledger mutation is transactional. */
export class SessionRunner {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly failures: unknown[] = [];
  private readonly runs = new Map<string, TaskRun>();
  private readonly turns = new Map<string, TaskRun>();
  private readonly unsubscribe: () => void;

  constructor(private readonly connector: SessionConnector, private readonly store: LedgerStore, private readonly context: EventContext) {
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
      const run: TaskRun = { input: structuredClone(input), updates: new Map() };
      this.runs.set(agentId, run);
      try {
        const turnId = await this.connector.startTask(agentId, input);
        run.turnId = turnId;
        this.turns.set(turnId, run);
        await this.append([this.event(agentId, 'task_started', { taskId: input.taskId, turnId }, `turn:${turnId}`)]);
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

  sendUpdate(agentId: string, input: UpdateInstructionsInput) {
    return this.enqueue(async () => {
      const run = this.runs.get(agentId);
      if (!run) return { sent: false as const, reason: 'No task started' };
      const previous = run.updates.get(input.updateId);
      if (previous) {
        if (JSON.stringify(previous.input) !== JSON.stringify(input)) throw new Error('Update ID reused with different content');
        return previous.sent ? { sent: true as const } : { sent: false as const, reason: 'Previous delivery was rejected or remains uncertain' };
      }
      const update = { input: structuredClone(input), sent: false, dropped: [] as string[] };
      run.updates.set(input.updateId, update);
      const result = await this.connector.sendUpdate(agentId, input);
      update.sent = result.sent;
      const taskId = run.input.taskId;
      await this.append([result.sent
        ? this.event(agentId, 'update_sent', { updateId: input.updateId, taskId, fromVersion: input.fromVersion,
          toVersion: input.toVersion, turnId: run.turnId }, `update:${input.updateId}:sent`)
        : this.event(agentId, 'update_rejected', { updateId: input.updateId, taskId, reasons: [result.reason] }, `update:${input.updateId}:rejected`)]);
      return result;
    });
  }

  private async observe(event: SessionEvent): Promise<void> {
    const { agentId, taskId, turnId } = event;
    const run = this.turns.get(turnId);
    if (!run || run.input.taskId !== taskId) return;
    if (event.type === 'turn') {
      await this.append([this.event(agentId, 'turn_observed', { agentId, taskId, turnId, status: event.status }, `observe:${turnId}:${event.status}`)]);
      return;
    }
    const reply = (text: string, suffix: string) => this.event(agentId, 'reply_recorded', { memberId: agentId, taskId, turnId, text }, `reply:${turnId}:${suffix}`);
    if (event.type === 'reply') { await this.append([reply(event.text, event.itemId)]); return; }
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
      // Artifact IDs are workspace-relative paths, never arbitrary absolute or parent paths.
      const invalidPaths = report.files.filter(file => !file.path || /^(?:[a-z]:|[\\/])/i.test(file.path) || file.path.split(/[\\/]/).includes('..'));
      if (validation.ok && !invalidPaths.length) {
        const resultId = `result:${turnId}:${event.index}`;
        await this.append([this.event(agentId, 'result_submitted', { taskId, resultId, planVersion: report.planVersion,
          summary: report.summary, artifactIds: report.files.map(file => file.path) }, resultId)]);
      } else {
        await this.append([reply(`Rejected result: ${validation.ok ? 'Artifact paths must stay inside the workspace' : validation.reasons.join('; ')}`, `result:${event.index}:rejected`)]);
      }
    } else {
      await this.append([reply(`Agent question (${report.taskId}): ${report.question}${report.options ? ` Options: ${report.options.join(', ')}` : ''}`, `question:${event.index}`)]);
    }
  }

  async flush(): Promise<void> {
    // Event handlers may extend the queue while an operation is still completing.
    let observed: Promise<unknown>;
    do { observed = this.queue; await observed; } while (observed !== this.queue);
    if (this.failures.length) throw new AggregateError(this.failures.splice(0), 'Session events could not be recorded');
  }
  async stop(agentId?: string): Promise<void> {
    await this.connector.stop(agentId); await this.flush();
    if (agentId === undefined) this.unsubscribe();
  }
}
