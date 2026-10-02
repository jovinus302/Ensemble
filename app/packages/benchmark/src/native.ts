import { randomUUID } from 'node:crypto';
import { CodexSessionConnector, ClaudeSessionConnector, type SessionConnector } from '@ensemble/agents';
import { project, type NewLedgerEvent, type ValidationEvidence } from '@ensemble/core';
import { CodexCliProvider, ClaudeCliProvider, type LlmProvider } from '@ensemble/llm';
import { ProjectManager, buildTaskContext, type TrustedValidator } from '@ensemble/orchestrator';
import { MemoryLedgerStore } from '@ensemble/store';
import { PROMPT_B_INITIAL } from './protocol.ts';
import { createDirectDriver } from './direct.ts';
import { CLAUDE_DISALLOWED, CODEX_RESTRICTIONS, codexWorkerArgs, DEVELOPMENT_SYSTEM } from './runtime-config.ts';

export interface NativeDriverOptions {
  provider: 'codex' | 'claude'; ensemble: boolean; model: string; effort: string;
  workspaceRoot: string; projectId: string; prompt: string; signal: AbortSignal;
  meter: <T>(role: 'pm' | 'worker' | 'judge', operation: () => Promise<T>) => Promise<T>;
  onWorkspace: (path: string) => Promise<void>;
  record: (event: unknown) => void;
  trustedValidator?: TrustedValidator;
  onValidatedHandoff?: (evidence: ValidationEvidence) => void;
}

/** Construction is inert. Only start/change may call a provider; the caller owns approval and the total run deadline. */
export async function createNativeDriver(options: NativeDriverOptions): Promise<{
  start(): Promise<void>; change(prompt: string): Promise<void>; settled(): Promise<boolean>; stop(): Promise<void>;
}> {
  if (!options.model.trim() || !/^[a-z]+$/.test(options.effort)) throw new Error('Explicit model and effort required');
  if (options.provider === 'claude' && !['low', 'medium', 'high', 'xhigh', 'max'].includes(options.effort)) throw new Error('Unsupported Claude effort');
  if (!options.ensemble) return createDirectDriver(options);
  const controller = new AbortController();
  const signal = AbortSignal.any([options.signal, controller.signal]);
  const store = new MemoryLedgerStore();
  const context = { projectId: options.projectId, targetProductId: 'reservation' };
  const agentId = 'prototype-agent';
  const taskId = 'reservation';
  // B must stop at the externally tested checkpoint. Judging the full initial goal here
  // would trigger revisions that implement the remaining requirements before the change.
  const handoffConditions = options.prompt === PROMPT_B_INITIAL
    ? ['Initial checkpoint only: supplied source files implement real date, time and 1–6 guest selection controls. The host trusted validator validates the captured submitted source build and browser selection before final handoff review; do not treat worker self-report as measured evidence. Stop at this checkpoint. Confirmation, persistence and other remaining goal requirements are deliberately deferred until the next instruction and are not required for this initial handoff.']
    : [options.prompt];
  const actor = { kind: 'human' as const, id: 'owner' };
  const seed = (type: NewLedgerEvent['type'], payload: unknown): NewLedgerEvent => ({ ...context, actor, type, payload, idempotencyKey: `benchmark:${type}:${randomUUID()}` });
  await store.append([
    seed('member_joined', { memberId: 'owner', kind: 'human', displayName: 'Benchmark owner' }),
    seed('member_joined', { memberId: agentId, kind: 'agent', displayName: 'Prototype agent', role: 'Implement React applications' }),
    seed('goal_set', { text: options.prompt, decider: 'owner', delegation: { pmMayApply: ['scope_add', 'scope_reduce', 'goal_change'] } }),
    seed('plan_committed', { version: 1, basedOn: null, tasks: [{ id: taskId, title: 'Reservation application', baseTitle: 'Reservation application', assignee: agentId,
      dependsOn: [], handoffConditions, exclusions: [], limits: ['No publishing, commits, payments, authentication or permission changes.'] }],
      reason: 'Preregistered single-task benchmark', approvedBy: 'owner', sourceMessageIds: [] }),
  ]);
  // Ensemble reporting is part of the treatment; direct bypasses this entire ledger/scaffold.
  let raw: SessionConnector | undefined;
  let connector: SessionConnector | undefined;
  let provider: LlmProvider | undefined;
  let pm: ProjectManager | undefined;
  let started = false;
  let stopped = false;
  let stopPromise: Promise<void> | undefined;
  let failure: unknown;
  let pending = 0;
  let completedTurns = 0;
  const active = new Set<string>();
  const turnStarts = new Map<string, number>();
  const prepared = new Set<string>();
  let unsubscribe = () => {};
  const check = () => { signal.throwIfAborted(); if (stopped) throw new Error('Driver stopped'); if (failure) throw failure; };
  const run = async <T>(role: 'pm' | 'worker' | 'judge', operation: () => Promise<T>): Promise<T> => {
    check(); pending++;
    try { return await options.meter(role, async () => { check(); return operation(); }); }
    catch (error) { failure = error; throw error; }
    finally { pending--; }
  };
  const stop = (): Promise<void> => {
    if (stopPromise) return stopPromise;
    stopped = true; controller.abort();
    // Abort CLI calls before draining the PM queue, so stopping never waits for a model's full timeout.
    stopPromise = (async () => {
      await Promise.allSettled([raw?.stop(), provider?.close?.()]);
      try {
        // Claude stop signals its own CLI child but returns before its close event.
        // Wait only for turns this driver owns; never inspect or stop other processes.
        if (options.provider === 'claude') {
          const deadline = performance.now() + 4000;
          while (active.size && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
          if (active.size) throw new Error('Owned Claude CLI did not terminate within cleanup budget');
        }
        await pm?.stop();
      } finally { unsubscribe(); options.record({ type: 'native_ledger', events: await store.read() }); store.close(); }
    })();
    return stopPromise;
  };
  signal.addEventListener('abort', () => { if (!stopped) void stop().catch(error => { failure = error; }); }, { once: true });
  return {
    async start() {
      check(); if (started) throw new Error('Driver already started'); started = true;
      raw = options.provider === 'codex'
        ? new CodexSessionConnector({ model: options.model, workspaceRoot: options.workspaceRoot,
          instructionsFor: () => DEVELOPMENT_SYSTEM, rpc: { args: codexWorkerArgs(options.effort) } })
        : new ClaudeSessionConnector({ model: options.model, effort: options.effort as 'medium', workspaceRoot: options.workspaceRoot,
          instructionsFor: () => DEVELOPMENT_SYSTEM, allowedTools: [], disallowedTools: CLAUDE_DISALLOWED });
      unsubscribe = raw.onEvent(event => {
        options.record({ type: 'native_session', at: new Date().toISOString(), event, usage: null, underlyingApiCalls: null });
        if (event.type !== 'turn') return;
        if (event.status === 'started') { active.add(event.turnId); turnStarts.set(event.turnId, performance.now()); }
        else {
          active.delete(event.turnId);
          const startedAt = turnStarts.get(event.turnId);
          options.record({ type: 'native_worker_duration', turnId: event.turnId, elapsedMs: startedAt === undefined ? null : performance.now() - startedAt,
            status: event.status, usage: null });
          turnStarts.delete(event.turnId);
          if (event.status === 'completed') completedTurns++;
          else if (!stopped) failure = new Error(event.reason ?? `Worker ${event.status}`);
        }
      });
      connector = {
        async startSession(id, projectId) {
          check();
          const session = await raw!.startSession(id, projectId);
          if (!prepared.has(session.workspace)) { await options.onWorkspace(session.workspace); prepared.add(session.workspace); }
          check();
          return session;
        },
        startTask: (id, input) => run('worker', () => raw!.startTask(id, input)),
        continueTask: (id, input) => run('worker', () => raw!.continueTask!(id, input)),
        // Claude's unsupported steer returns locally and is not a CLI request.
        sendUpdate: (id, input) => options.provider === 'claude' ? raw!.sendUpdate(id, input) : run('worker', () => raw!.sendUpdate(id, input)),
        onEvent: handler => raw!.onEvent(handler), stop: id => raw!.stop(id),
      };
      options.record({ type: 'native_config', provider: options.provider, model: options.model, effort: options.effort,
        workerUsage: null, underlyingApiCalls: null, callUnit: 'top-level CLI requests plus worker turns and Codex steer requests',
        workerMeterElapsedMeaning: 'submission latency only; native_worker_duration records full turn wall time',
        permissions: options.provider === 'codex' ? 'native workspace-write; approval never; node_repl MCP, multi_agent/multi_agent_v2 and web_search disabled per invocation' : 'native acceptEdits; no additional auto-approved tools; Agent/Task/WebSearch/WebFetch denied; isolated project settings' });
      {
        provider = options.provider === 'codex' ? new CodexCliProvider({ model: options.model, effort: options.effort, executableArgs: [...CODEX_RESTRICTIONS] }) : new ClaudeCliProvider({ model: options.model, effort: options.effort });
        const llm: LlmProvider = { complete: request => {
          const role = request.forceTool === 'record_handoff_review' ? 'judge' : 'pm';
          return run(role, async () => {
            const response = await provider!.complete({ ...request, model: options.model, signal });
            options.record({ type: 'native_usage', role, tool: request.forceTool, model: response.model, usage: response.usage, underlyingApiCalls: null });
            return response;
          });
        } };
        pm = new ProjectManager({ ...context, store, llm, connector, model: options.model, turnTimeoutMs: 20 * 60_000,
          trustedValidator: options.trustedValidator && {
            policyFingerprint: options.trustedValidator.policyFingerprint,
            validate: (input, validationSignal) => options.trustedValidator!.validate(input, AbortSignal.any([signal, validationSignal])),
          }, requireValidation: true, validationTimeoutMs: 120_000,
          onTiming: timing => options.record({ type: 'native_pm_timing', ...timing }) });
        // Coordination is part of measured Ensemble work, even with a fixed initial task.
        await pm.postMessage('owner', options.prompt);
        const task = project(await store.read()).tasks.get(taskId);
        if (task && (task.status === 'ready' || task.status === 'reserved')) {
          await pm.sessions.startSession(agentId);
          await pm.sessions.startTask(agentId, buildTaskContext(project(await store.read()), taskId, await store.read()));
        }
      }
    },
    async change(prompt) {
      check(); if (!started || !connector) throw new Error('Driver not started');
      if (pm) {
        const before = completedTurns;
        await pm.postMessage('owner', prompt);
        await pm.flush();
        const task = project(await store.read()).tasks.get(taskId);
        if (!active.size && completedTurns === before && task?.status === 'checked') throw new Error('Requirement change did not reopen the completed Ensemble task');
        return;
      }
      throw new Error('ProjectManager not started');
    },
    async settled() {
      check(); if (!started || pending || active.size || pm?.isProcessing) return false;
      if (pm) {
        await pm.flush(); check();
        if (pending || active.size || pm.isProcessing) return false;
        const state = project(await store.read());
        const tasks = [...state.tasks.values()];
        const waiting = tasks.find(task => task.validation?.status === 'environment_blocked' || task.validation?.status === 'not_run');
        if (waiting) throw new Error(`validation_${waiting.validation!.status}: ${waiting.validation!.summary}`);
        if (tasks.some(task => task.status === 'blocked' || task.reviewFailedResultId)) throw new Error('Ensemble task blocked or native handoff review failed');
        if (state.pendingAuthority.size || [...state.decisionRequests.values()].some(request => request.status === 'open')) throw new Error('Ensemble requires human intervention');
        const settled = tasks.length > 0 && tasks.every(task => task.status === 'checked');
        if (settled) for (const task of tasks) {
          if (task.validation?.status !== 'passed') throw new Error('validation_not_run: handoff has no current passed trusted evidence');
          options.onValidatedHandoff?.(task.validation);
        }
        return settled;
      }
      return false;
    },
    stop,
  };
}
