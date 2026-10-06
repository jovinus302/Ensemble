import { project, type AnyEvent, type LedgerEvent, type ProjectState, type TaskStatus } from '@ensemble/core';
import type { ProjectManager } from '@ensemble/orchestrator';
import type { ScriptedStep } from './index.ts';
import type { PagesStep } from './pages-v25/lines.ts';
import { respondToRevision, type RevisionGenerator } from './revision.ts';
import { ScenarioError, draftFailureDetail } from './errors.ts';

export interface Target { assignee: string; pick?: 'active' | 'next' }
export type Condition = (
  | { kind: 'taskOf'; assignee: string; status: TaskStatus | readonly TaskStatus[] }
  | { kind: 'pmSpokeAfter' | 'silentAfter'; stepIndex: number }
  | { kind: 'planVersionAtLeast'; version: number }
  | { kind: 'planApprovalPending' }
  | { kind: 'agentTurnFinished' | 'agentTurnRunning'; agentId: string }
  | { kind: 'agentUpdated'; agentId: string; afterStep: number }
  | { kind: 'all' | 'any'; conditions: Condition[] }
  // Pages v2.5 Work Context (pages-v25/lines.ts `WorkContextCondition` is the subset its script uses).
  | { kind: 'memberJoined'; memberId: string }
  | { kind: 'branchOpen'; itemId: string }
  | { kind: 'branchPreviewed'; itemId: string; optionId: string }
  | { kind: 'proposalStatus'; proposalId: string; status: 'generated' | 'confirmed' }
  /** The build exists and the PM has announced it (a build card), so the next line follows the announcement. */
  | { kind: 'buildProduced'; version: string }
  | { kind: 'changeSetProposed'; changeSetId: string }
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
  if (!id) {
    console.error(`[ensemble] No ${target.pick ?? 'active'} task for assignee ${target.assignee} in plan v${state.plan?.version ?? 0} (expected ${statuses.join('/')})`);
    const names: Record<string, string> = { waiting: '선행 작업 대기', ready: '시작 가능', reserved: '시작 준비', running: '진행 중', submitted: '확인 중', checked: '확인됨', revising: '보완 중', blocked: '멈춤', cancelled: '취소됨' };
    const current = [...state.tasks.values()].filter(t => t.spec.assignee === target.assignee).map(t => names[t.status] ?? '알 수 없음');
    const who = state.members.get(target.assignee)?.displayName ?? '담당자';
    throw new ScenarioError(`대본: ${who} 작업이 진행 가능한 상태가 아닙니다(현재: ${current.join(', ') || '작업 없음'})`);
  }
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
    case 'memberJoined': return state.members.has(condition.memberId);
    case 'branchOpen': return !!state.workContext?.branches.has(condition.itemId);
    case 'branchPreviewed': return state.workContext?.branches.get(condition.itemId)?.preview?.optionId === condition.optionId;
    case 'proposalStatus': {
      const status = state.workContext?.proposals.get(condition.proposalId)?.status;
      return condition.status === 'generated' ? !!status : status === 'confirmed';
    }
    case 'buildProduced': {
      const build = [...(state.workContext?.builds.values() ?? [])].find(b => b.version === condition.version);
      return !!build && [...state.workContext!.cards.values()].some(c => c.kind === 'build' && c.buildId === build.buildId);
    }
    case 'changeSetProposed': return !!state.workContext?.changeSets.has(condition.changeSetId);
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
/** A line said only when the PM asks for it: a choice (`answerIfAsked`), a scope clarification (`clarifyScopeIfAsked`), or revised material (`respondToRevision`). */
export function isConditionalStep(step: ScriptedStep): boolean {
  return step.action === 'answerIfAsked' || step.action === 'clarifyScopeIfAsked' || step.action === 'respondToRevision';
}
/** The PM question a conditional line answers, asked after `after` (the ledger seq before the previous line); undefined when none. */
export function promptFor(step: ScriptedStep, events: readonly LedgerEvent[], after: number): Extract<AnyEvent, { type: 'pm_spoke' }> | undefined {
  const spoken = (events as readonly AnyEvent[]).filter((e): e is Extract<AnyEvent, { type: 'pm_spoke' }> => e.seq > after && e.type === 'pm_spoke');
  if (step.action === 'clarifyScopeIfAsked') return spoken.findLast(e => /적용할 작업.*범위/.test(e.payload.text) && /알려|확인/.test(e.payload.text));
  if (step.action === 'answerIfAsked') return spoken.findLast(e => e.payload.kind === 'ask' && e.payload.text.includes('(선택지:'));
  return undefined;
}
/** Whether a conditional line will post once delivered: a PM question to answer, or a revision (or its stop) on the speaker's submitted work. */
export function conditionalLineDue(step: ScriptedStep, events: readonly LedgerEvent[], after: number): boolean {
  if (step.action !== 'respondToRevision') return !!promptFor(step, events, after);
  const last = (events as readonly AnyEvent[]).findLast(e => e.type === 'attachment_recorded' && e.actor.id === step.as && e.payload.taskId);
  const taskId = last?.type === 'attachment_recorded' ? last.payload.taskId : undefined;
  const status = taskId ? project(events).tasks.get(taskId)?.status : undefined;
  // `blocked` still delivers the step, so its stop reason reaches the person instead of a silent skip.
  return status === 'revising' || status === 'blocked';
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
      if (state.members.get(step.as)?.kind !== 'human') throw new ScenarioError(`대본의 ${step.as === 'designer' ? '디자이너' : '사용자'} 담당자가 사람으로 등록되지 않았습니다.`);
      if (['goal', 'approvePlan', 'availability'].includes(step.action ?? '')) await host.recordHuman?.(step.as, step.text, progress.step);
      if (step.action === 'respondToRevision') {
        await respondToRevision(host, step, progress);
      } else if (step.action === 'goal') {
        const result = await host.pm.startFreeProject(step.text, '2026-10-12T00:00:00Z');
        if (result.failure) {
          const detail = draftFailureDetail(result.failure.detail);
          console.error(`[ensemble] 계획 초안 실패: ${detail}`, result.failure.detail);
          throw new ScenarioError(`계획 초안을 만들지 못했습니다: ${result.failure.reason}. 세부 원인: ${detail}`);
        }
      } else if (step.action === 'approvePlan') {
        const proposal = [...state.pendingPlans.values()].find(p => p.forMemberId === step.as);
        const plan = proposal ?? state.plan;
        if (!plan || (!proposal && state.plan?.approvedBy !== step.as)) throw new Error(`No plan approval pending or recorded for ${step.as}`);
        // Validate the draft before approving; never replace or repair it for the script.
        for (const assignee of ['owner', 'designer', 'prototype-agent']) {
          if (!plan.tasks.some(t => t.assignee === assignee)) throw new ScenarioError(`계획 초안에 ${assignee === 'owner' ? '사용자' : assignee === 'designer' ? '디자이너' : '프로토타입 Agent'} 담당 작업이 없습니다.`);
        }
        if (proposal) await host.pm.decidePlan(proposal.proposalId, step.as, true);
      } else if (step.action === 'availability') {
        await host.pm.setAvailability(step.as, step.weeklyHours!);
      } else if (step.action === 'clarifyScopeIfAsked') {
        // A literal owner reply to the PM's visible clarification, never a repaired PM decision.
        const question = promptFor(step, events, progress.anchors[progress.step - 1] ?? state.lastSeq);
        if (question) {
          if (state.goal?.decider !== step.as) throw new Error('범위 재확인은 결정권자가 답해야 합니다');
          await host.pm.postMessage(step.as, step.text);
        }
      } else if (step.action === 'answerIfAsked') {
        // A literal human choice, conditional on a new PM question. Never invent PM dialogue.
        const question = promptFor(step, events, progress.anchors[progress.step - 1] ?? state.lastSeq);
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
    // A line that is said only when the PM asks for it (a clarification, a choice, revised material) is never offered
    // as the next line once the PM, having handled this step, did not ask: it is passed over, so the script ends (or
    // moves on) instead of showing a line that "다음 발언" would never post. Its own wait (e.g. the PM's review) runs
    // first, so the decision is made on the PM's verdict rather than before it.
    let next = progress.step + 1;
    while (steps[next] && isConditionalStep(steps[next]!)) {
      const step = steps[next]!;
      if (step.waitFor) await waitForCondition(step.waitFor, () => host.read(), progress.anchors, host.waitOptions);
      const after = await host.read(), anchor = progress.anchors[next - 1] ?? project(after).lastSeq;
      if (conditionalLineDue(step, after, anchor)) break;
      progress.anchors[next] = anchor;
      (progress.executed ??= {})[next] = true;
      next++;
    }
    if (next >= steps.length && completion) await waitForCondition(completion, () => host.read(), progress.anchors, host.waitOptions);
    progress.step = next;
  } catch (error) {
    console.error(`[ensemble] 대본 ${progress.step + 1}단계 중단`, error);
    const reason = error instanceof ScenarioError ? error.message : error instanceof Error && error.message === '대본 대기를 취소했습니다.' ? error.message : '대본 진행 조건을 확인하지 못했습니다. 현재 작업 상태를 확인한 뒤 다시 시도해 주세요.';
    progress.stopped = `대본 ${progress.step + 1}단계: ${reason}`;
    await host.recordStop(progress.stopped);
    throw new Error(progress.stopped);
  }
}

/** Pages v2.5 script host: posting a line (a person's message, or an agent's scripted premise) and pressing 변경 적용. */
export interface PagesScriptHost {
  waitOptions?: WaitOptions;
  read(): Promise<LedgerEvent[]>;
  say(step: PagesStep): Promise<void>;
  applyChange(step: PagesStep): Promise<void>;
  recordStop(reason: string): Promise<void>;
}
/** One Pages v2.5 step: wait for its condition, post it, and (after the last step) wait for completion. Only inputs, never PM output. */
export async function advancePagesScript(host: PagesScriptHost, steps: readonly PagesStep[], progress: ScriptProgress, completion?: Condition) {
  if (progress.stopped) throw new Error(progress.stopped);
  try {
    const step = steps[progress.step];
    if (!step) return;
    if (!progress.executed?.[progress.step]) {
      if (step.waitFor) await waitForCondition(step.waitFor, () => host.read(), progress.anchors, host.waitOptions);
      const state = project(await host.read());
      progress.anchors[progress.step] = state.lastSeq;
      const kind = state.members.get(step.as)?.kind;
      if (step.action === 'applyChange') {
        if (kind !== 'human' || state.goal?.decider !== step.as) throw new ScenarioError('대본: 변경 적용은 결정권자가 해야 합니다.');
        await host.applyChange(step);
      } else {
        if (kind !== 'human' && kind !== 'agent') throw new ScenarioError(`대본: ${step.as} 멤버가 아직 채널에 없습니다.`);
        await host.say(step);
      }
      (progress.executed ??= {})[progress.step] = true;
    }
    if (progress.step === steps.length - 1 && completion) await waitForCondition(completion, () => host.read(), progress.anchors, host.waitOptions);
    progress.step++;
  } catch (error) {
    console.error(`[ensemble] 대본 ${progress.step + 1}단계 중단`, error);
    const reason = error instanceof ScenarioError ? error.message : error instanceof Error && error.message === '대본 대기를 취소했습니다.' ? error.message : '대본 진행 조건을 확인하지 못했습니다. 현재 작업 상태를 확인한 뒤 다시 시도해 주세요.';
    progress.stopped = `대본 ${progress.step + 1}단계: ${reason}`;
    await host.recordStop(progress.stopped);
    throw new Error(progress.stopped);
  }
}
