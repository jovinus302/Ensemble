import { project, type AnyEvent, type LedgerEvent, type ProjectState, type TaskStatus } from '@ensemble/core';
import type { ProjectManager } from '@ensemble/orchestrator';
import type { ScriptedStep } from './index.ts';
import { respondToRevision, type RevisionGenerator } from './revision.ts';

export interface Target { assignee: string; pick?: 'active' | 'next' }
export type Condition = (
  | { kind: 'taskOf'; assignee: string; status: TaskStatus | readonly TaskStatus[] }
  | { kind: 'pmSpokeAfter' | 'silentAfter'; stepIndex: number }
  | { kind: 'planVersionAtLeast'; version: number }
  | { kind: 'planApprovalPending' }
  | { kind: 'agentTurnFinished' | 'agentTurnRunning'; agentId: string }
  | { kind: 'agentUpdated'; agentId: string; afterStep: number }
  | { kind: 'all' | 'any'; conditions: Condition[] }
) & { timeoutMs?: number };
export const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;

/** Dependency order first, declaration order for independent tasks. */
export function resolveTarget(state: ProjectState, target: Target): string {
  const ordered: string[] = [], seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const task = state.tasks.get(id);
    task?.spec.dependsOn.forEach(visit);
    ordered.push(id);
  };
  state.plan?.tasks.forEach(t => visit(t.id));
  const statuses: TaskStatus[] = target.pick === 'next' ? ['ready', 'waiting'] : ['running', 'reserved', 'revising', 'ready'];
  const id = ordered.find(id => {
    const t = state.tasks.get(id)!;
    return t.spec.assignee === target.assignee && statuses.includes(t.status);
  });
  if (!id) throw new Error(`No ${target.pick ?? 'active'} task for assignee ${target.assignee} in plan v${state.plan?.version ?? 0} (expected ${statuses.join('/')})`);
  return id;
}
export interface ScriptProgress {
  step: number;
  /** Ledger sequence immediately before each human input. */
  anchors: Record<number, number>;
  /** Retain a delivered input when a subsequent completion wait is retried. */
  executed?: Record<number, boolean>;
  stopped?: string;
  revisions?: Record<string, number>;
  revisionHistory?: { taskId: string; round: number; request: string; content: string }[];
}
export function conditionMet(condition: Condition, events: readonly LedgerEvent[], anchors: Record<number, number>): boolean {
  const state = project(events), typed = events as readonly AnyEvent[];
  switch (condition.kind) {
    case 'all': return condition.conditions.every(c => conditionMet(c, events, anchors));
    case 'any': return condition.conditions.some(c => conditionMet(c, events, anchors));
    case 'taskOf': return [...state.tasks.values()].some(t => t.spec.assignee === condition.assignee && (Array.isArray(condition.status) ? condition.status.includes(t.status) : t.status === condition.status));
    case 'planVersionAtLeast': return (state.plan?.version ?? 0) >= condition.version;
    case 'planApprovalPending': return state.pendingPlans.size > 0;
    case 'pmSpokeAfter': case 'silentAfter': {
      const seq = anchors[condition.stepIndex];
      if (seq === undefined) return false;
      return typed.some(e => e.seq > seq && (condition.kind === 'pmSpokeAfter' ? e.type === 'pm_spoke' : e.type === 'pm_considered' && e.payload.decision === 'silent'));
    }
    case 'agentTurnFinished': return typed.some(e => (e.type === 'turn_finished' || e.type === 'turn_observed' && e.payload.status === 'completed') && e.payload.agentId === condition.agentId) && !state.activeTurn.has(condition.agentId);
    case 'agentTurnRunning': {
      const taskId = state.activeTurn.get(condition.agentId);
      return taskId !== undefined && state.tasks.get(taskId)?.status === 'running';
    }
    case 'agentUpdated': {
      const seq = anchors[condition.afterStep];
      return seq !== undefined && typed.some(e => e.seq > seq && e.type === 'update_acknowledged' && state.tasks.get(e.payload.taskId)?.spec.assignee === condition.agentId);
    }
  }
}
export interface WaitOptions {
  now?: () => number;
  pause?: (ms: number) => Promise<void>;
  onWaiting?: (condition: Condition, events: readonly LedgerEvent[]) => void;
  onReady?: () => void;
  signal?: AbortSignal;
}
export async function waitForCondition(condition: Condition, read: () => Promise<LedgerEvent[]>, anchors: Record<number, number>, options: WaitOptions = {}) {
  const now = options.now ?? Date.now, pause = options.pause ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const started = now(), timeout = condition.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeout) || timeout < 0) throw new Error('Invalid scenario condition timeout');
  while (true) {
    if (options.signal?.aborted) throw new Error('대본 대기를 취소했습니다.');
    const events = await read();
    if (conditionMet(condition, events, anchors)) { options.onReady?.(); return; }
    options.onWaiting?.(condition, events);
    if (now() - started >= timeout) throw new Error(`Scenario timed out after ${timeout}ms waiting for ${JSON.stringify(condition)}`);
    await pause(Math.min(100, timeout - (now() - started)));
  }
}
export interface ScriptHost {
  waitOptions?: WaitOptions;
  recordHuman?: (authorId: string, text: string, step: number) => Promise<void>;
  generateRevision?: RevisionGenerator;
  pm: Pick<ProjectManager, 'startFreeProject' | 'decidePlan' | 'setAvailability' | 'postMessage'>;
  read(): Promise<LedgerEvent[]>;
  recordStop(reason: string): Promise<void>;
}
/** Executes only human inputs; PM and agent output must come from their normal paths. */
export async function advanceScript(host: ScriptHost, steps: readonly ScriptedStep[], progress: ScriptProgress, completion?: Condition) {
  if (progress.stopped) throw new Error(progress.stopped);
  try {
    const step = steps[progress.step];
    if (!step) return;
    if (!progress.executed?.[progress.step]) {
      if (step.waitFor) await waitForCondition(step.waitFor, () => host.read(), progress.anchors, host.waitOptions);
      const events = await host.read(), state = project(events);
      progress.anchors[progress.step] = state.lastSeq;
      if (state.members.get(step.as)?.kind !== 'human') throw new Error(`Script author ${step.as} is not human`);
      if (['goal', 'approvePlan', 'availability'].includes(step.action ?? '')) await host.recordHuman?.(step.as, step.text, progress.step);
      if (step.action === 'respondToRevision') {
        await respondToRevision(host, step, progress);
      } else if (step.action === 'goal') {
        const result = await host.pm.startFreeProject(step.text, '2026-10-12T00:00:00Z');
        if (result.failure) throw new Error(result.failure.reason);
      } else if (step.action === 'approvePlan') {
        const proposal = [...state.pendingPlans.values()].find(p => p.forMemberId === step.as);
        const plan = proposal ?? state.plan;
        if (!plan || (!proposal && state.plan?.approvedBy !== step.as)) throw new Error(`No plan approval pending or recorded for ${step.as}`);
        // Validate the draft before approving; never replace or repair it for the script.
        for (const assignee of ['owner', 'designer', 'prototype-agent']) {
          if (!plan.tasks.some(t => t.assignee === assignee)) throw new Error(`Drafted plan lacks required tasks for ${assignee}`);
        }
        if (proposal) await host.pm.decidePlan(proposal.proposalId, step.as, true);
      } else if (step.action === 'availability') {
        await host.pm.setAvailability(step.as, step.weeklyHours!);
      } else if (step.action === 'clarifyScopeIfAsked') {
        // A literal owner reply to the PM's visible clarification, never a repaired PM decision.
        const after = progress.anchors[progress.step - 1] ?? state.lastSeq;
        const question = (events as AnyEvent[]).findLast(e => e.seq > after && e.type === 'pm_spoke' && /적용할 작업.*범위/.test(e.payload.text) && /알려|확인/.test(e.payload.text));
        if (question) {
          if (state.goal?.decider !== step.as) throw new Error('범위 재확인은 결정권자가 답해야 합니다');
          await host.pm.postMessage(step.as, step.text);
        }
      } else if (step.action === 'answerIfAsked') {
        // A literal human choice, conditional on a new PM question. Never invent PM dialogue.
        const after = progress.anchors[progress.step - 1] ?? state.lastSeq;
        const question = (events as AnyEvent[]).findLast(e => e.seq > after && e.type === 'pm_spoke' && e.payload.kind === 'ask' && e.payload.text.includes('(선택지:'));
        if (question?.type === 'pm_spoke') {
          const choice = /\(선택지:\s*([^)]*)\)/.exec(question.payload.text)?.[1]?.split(' / ')[0]?.trim();
          if (!choice) throw new Error('PM decision question has no readable choice');
          await host.pm.postMessage(step.as, choice);
        }
      } else {
        const taskId = step.target ? resolveTarget(state, step.target) : undefined;
        await host.pm.postMessage(step.as, step.text, step.attachments?.map(a => ({ ...a, ...(taskId ? { taskId } : {}) })));
      }
      (progress.executed ??= {})[progress.step] = true;
    }
    if (progress.step === steps.length - 1 && completion) await waitForCondition(completion, () => host.read(), progress.anchors, host.waitOptions);
    progress.step++;
  } catch (error) {
    progress.stopped = `Step ${progress.step}: ${error instanceof Error ? error.message : String(error)}`;
    await host.recordStop(progress.stopped);
    throw new Error(progress.stopped);
  }
}
