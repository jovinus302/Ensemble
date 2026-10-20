// 지표 계산. 제품 원장과 하네스 원장 두 개만 읽어 지표를 만든다(판단이 필요 없는 결정적 계산).
// 공식의 정본은 이 파일이다. docs/dogfooding/plan.md §8의 표는 이것의 요약이다.
import { isParentTask, project, type LedgerEvent, type PlanOp, type ProjectState } from '@ensemble/core';
import { classifyCliFailure } from './claude.ts';
import { aliasActor, overlapCandidates, selfReworkCandidates, SEVERITY_WEIGHT, type Severity } from './friction.ts';
import { backlogIdsIn, boardDone, verifiedDone } from './backlog.ts';
import { weightedTokens, type UsageRecord, type UsageSource } from './ledger.ts';

type Loose = Record<string, unknown>;
const payloadOf = (e: LedgerEvent): Loose => (e.payload ?? {}) as Loose;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const records = (v: unknown): Loose[] => (Array.isArray(v) ? v.filter((x): x is Loose => typeof x === 'object' && x !== null) : []);
const ms = (e: LedgerEvent): number => Date.parse(e.at);

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** 가장 가까운 순위(nearest-rank) 백분위. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]!;
}

const ratio = (a: number, b: number): number | null => (b === 0 ? null : a / b);

// ---------------------------------------------------------------------------------------------
// 타입

export type Initiator = 'proxy' | 'pm' | 'teammate' | 'unknown';

export interface UsageTotals { raw: number; weighted: number; cacheRead: number; cacheCreation: number }

export interface DogfoodMetrics {
  runId: string | null;
  iteration: number | null;
  mode: string | null;
  ensembleCommit: string | null;
  /** run_started.productDirty. 기록이 없으면 null. */
  productDirty: boolean | null;
  adapters: { pathPrepend: boolean; pmSchemaRef: boolean } | null;
  workflow: {
    planProposed: boolean;
    planCommitted: boolean;
    planVersion: number;
    planAttempts: number | null;
    /** 취소되지 않은 말단 작업 수. */
    tasks: number;
    checked: number;
    cancelled: number;
    cycles: number;
    stopReason: string | null;
    stopDetail: string | null;
  };
  duplicates: {
    planted: { items: number; realized: number; avoided: number; realizedIds: string[] };
    natural: { candidates: number; confirmed: number };
    selfRework: { candidates: number; confirmed: number };
    total: number;
  };
  statusLookup: {
    probes: number;
    medianMs: number | null;
    successMedianMs: number | null;
    successProbes: number;
    failedProbes: number;
    accuracy: number | null;
    tokens: { raw: number; weighted: number };
  };
  interventions: {
    counted: number;
    planned: number;
    rubberStamp: number;
    perTask: number | null;
    tasks: number;
    byType: Record<string, number>;
    byTask: Record<string, number>;
    ledgerHumanActs: number;
    harnessHumanActs: number;
  };
  runs: {
    turns: number;
    succeeded: number;
    failed: number;
    infraFailed: number;
    unfinished: number;
    successRate: number | null;
    rerunRatio: number | null;
    firstPassRate: number | null;
    teammateSessions: { total: number; withCommit: number; successRate: number | null };
  };
  pmDecomposition: {
    drafted: number;
    corrected: number;
    rate: number | null;
    byReason: Record<string, number>;
    v1TemplateTasks: number;
    proxyAgreement: number | null;
  };
  cost: {
    bySource: Record<UsageSource, UsageTotals>;
    byRole: Record<string, { raw: number; weighted: number }>;
    productWeighted: number;
    harnessWeighted: number;
    totalRaw: number;
    totalWeighted: number;
    costUsd: number;
    /** 시간을 잴 수 있었던 끝난 턴 수. */
    turnRuns: number;
    medianTurnMs: number | null;
    totalTurnMs: number;
    /** 턴 구간에 든 같은 agentId usage의 가중 합(중앙값·합계). ensemble-agent usage가 없으면 null. */
    turnTokens: { median: number; total: number } | null;
    leadTimeMs: { median: number; p90: number; count: number } | null;
    /** ensemble-agent usage가 1건 이상이면 true. false면 '측정 불가'. */
    agentTokensMeasured: boolean;
  };
  coordination: {
    inPlan: number;
    sequenced: number;
    beyondPlan: number;
    beyondPlanByPm: number;
    byInitiator: Record<Initiator, number>;
    pmLoopRatio: number | null;
    medianLoopLatencyMs: number | null;
    withheldReadyAtLimit: number | null;
    loops: { taskId: string; title: string; planVersion: number; initiator: Initiator; decisionRequestId: string | null; basis: string[] }[];
  };
  integration: {
    merges: number;
    conflicts: number;
    tests: number;
    passRate: number | null;
    checkedButRed: number;
    verifiedDone: number;
    boardDone: number;
    boardOnly: number;
    boardOnlyIds: string[];
  };
  frictions: {
    /** 병합된 규칙 마찰을 뺀 기록 수. */
    total: number;
    noise: number;
    byCategory: Record<string, number>;
    byRule: Record<string, number>;
    bySeverity: Record<string, number>;
    /** 잡음·병합을 뺀 점수(high 3, medium 2, low 1). */
    byGap: Record<string, { count: number; score: number }>;
    proposedGaps: { gapId: string; title: string }[];
    items: { key: string; recordedBy: string; rule: string | null; category: string; gap: string; severity: string; harnessNoise: boolean; merged: boolean; summary: string; cycle: number | null }[];
  };
  infra: { pauses: number; pausedMs: number };
}

// ---------------------------------------------------------------------------------------------
// 계산

interface PauseInterval { from: number; until: number }

function pauseIntervals(harness: readonly LedgerEvent[]): PauseInterval[] {
  const out: PauseInterval[] = [];
  for (const e of harness) {
    if (e.type !== 'dogfood_infra_pause') continue;
    const p = payloadOf(e);
    const from = Date.parse(str(p.from));
    const until = Date.parse(str(p.until));
    if (Number.isFinite(from) && Number.isFinite(until)) out.push({ from, until });
  }
  return out;
}

function unionLength(intervals: readonly PauseInterval[], endAt: number): number {
  const sorted = intervals.map((i) => ({ from: i.from, until: Math.min(i.until, endAt) })).filter((i) => i.until > i.from).sort((a, b) => a.from - b.from);
  let total = 0;
  let curFrom = -Infinity;
  let curUntil = -Infinity;
  for (const i of sorted) {
    if (i.from > curUntil) {
      if (curUntil > curFrom) total += curUntil - curFrom;
      curFrom = i.from;
      curUntil = i.until;
    } else curUntil = Math.max(curUntil, i.until);
  }
  if (curUntil > curFrom) total += curUntil - curFrom;
  return total;
}

function hasCommit(p: Loose): boolean {
  if (Array.isArray(p.commits)) return p.commits.length > 0;
  return typeof p.commits === 'number' && p.commits > 0;
}

function sessionTeammate(e: LedgerEvent): string {
  const p = payloadOf(e);
  return aliasActor(str(p.teammate) || str(p.teammateId) || str(p.memberId) || e.actor.id);
}

/** 통합 테스트 기록이 실패인가. friction R10과 같은 판정이다. */
function testFailed(p: Loose): boolean {
  return p.ok === false || p.passed === false || p.status === 'failed';
}

interface DraftInfo { ids: Set<string>; parents: Set<string>; byRequest: Map<string, Set<string>> }

/** 결정 요청 옵션의 plan_ops 초안(create_task tempId, split_task children tempId)과 그 부모. */
function collectDrafts(product: readonly LedgerEvent[]): DraftInfo {
  const info: DraftInfo = { ids: new Set(), parents: new Set(), byRequest: new Map() };
  for (const e of product) {
    if (e.type !== 'decision_requested') continue;
    const p = payloadOf(e);
    const requestId = str(p.requestId);
    const mine = new Set<string>();
    for (const option of records(p.options)) {
      for (const effect of records(option.effects)) {
        if (effect.type !== 'plan_ops') continue;
        for (const op of (Array.isArray(effect.ops) ? effect.ops : []) as PlanOp[]) {
          if (op.type === 'create_task') {
            mine.add(op.tempId);
            if (op.parentId !== undefined) info.parents.add(op.parentId);
          } else if (op.type === 'split_task') {
            info.parents.add(op.taskId);
            for (const child of op.children) mine.add(child.tempId);
          }
        }
      }
    }
    for (const id of mine) info.ids.add(id);
    info.byRequest.set(requestId, mine);
  }
  return info;
}

const TEMPLATE_ROLES = ['research', 'interview', 'flow', 'prototype'];

interface Specs { id: string; title: string; assignee: string; dependsOn: string[]; handoffConditions: string[]; parentId?: string }

function pmDecomposition(product: readonly LedgerEvent[], harness: readonly LedgerEvent[], state: ProjectState, humanMessages: ReadonlySet<string>): DogfoodMetrics['pmDecomposition'] {
  const drafts = collectDrafts(product);
  const ids = new Set<string>(drafts.ids);
  const parents = new Set<string>(drafts.parents);
  const proposalTasks = new Map<string, string[]>();
  const commits: { version: number; tasks: Specs[]; sources: string[] }[] = [];
  for (const e of product) {
    const p = payloadOf(e);
    if (e.type === 'plan_proposed' || e.type === 'plan_committed') {
      const tasks = records(p.tasks) as unknown as Specs[];
      for (const t of tasks) {
        ids.add(t.id);
        if (t.parentId !== undefined) parents.add(t.parentId);
      }
      if (e.type === 'plan_proposed') proposalTasks.set(str(p.proposalId), tasks.map((t) => t.id));
      else commits.push({ version: num(p.version), tasks, sources: strings(p.sourceMessageIds) });
    }
  }
  for (const task of state.tasks.values()) if (isParentTask(state, task)) parents.add(task.spec.id);
  for (const id of parents) ids.delete(id);

  const reasons = new Map<string, string>();
  const mark = (id: string, reason: string) => {
    if (ids.has(id) && !reasons.has(id)) reasons.set(id, reason);
  };
  // (a) 최종 취소
  for (const task of state.tasks.values()) if (task.status === 'cancelled') mark(task.spec.id, 'cancelled');
  // (d) 거절된 초안의 작업
  for (const e of product) {
    if (e.type !== 'plan_decided' || payloadOf(e).approved !== false) continue;
    for (const id of proposalTasks.get(str(payloadOf(e).proposalId)) ?? []) mark(id, 'rejected_draft');
  }
  // (b) 결정 outcome
  const requests = new Map<string, Loose>();
  for (const e of product) if (e.type === 'decision_requested') requests.set(str(payloadOf(e).requestId), payloadOf(e));
  for (const e of product) {
    if (e.type !== 'decision_resolved') continue;
    const p = payloadOf(e);
    const outcome = str(p.outcome);
    if (outcome !== 'edited' && outcome !== 'rejected' && outcome !== 'chose_other') continue;
    const requestId = str(p.requestId);
    const impact = (requests.get(requestId)?.impact ?? {}) as Loose;
    if (outcome === 'rejected') for (const id of drafts.byRequest.get(requestId) ?? []) mark(id, 'rejected_draft');
    for (const id of strings(impact.taskIds)) mark(id, outcome);
  }
  // (c) 첫 커밋 이후 사람 근거 메시지로 title·assignee·handoffConditions·dependsOn이 바뀜
  const sig = (t: Specs) => JSON.stringify([t.title, t.assignee, t.handoffConditions, t.dependsOn]);
  for (let i = 1; i < commits.length; i++) {
    if (!commits[i]!.sources.some((id) => humanMessages.has(id))) continue;
    const before = new Map(commits[i - 1]!.tasks.map((t) => [t.id, sig(t)]));
    for (const t of commits[i]!.tasks) {
      const old = before.get(t.id);
      if (old !== undefined && old !== sig(t)) mark(t.id, 'human_spec_change');
    }
  }

  const byReason: Record<string, number> = {};
  for (const reason of reasons.values()) byReason[reason] = (byReason[reason] ?? 0) + 1;

  const first = commits.find((c) => c.version === 1) ?? commits[0];
  let v1TemplateTasks = 0;
  if (first) {
    const tops = first.tasks.filter((t) => t.parentId === undefined).map((t) => t.id);
    if (tops.length === TEMPLATE_ROLES.length && TEMPLATE_ROLES.every((r) => tops.includes(r))) {
      v1TemplateTasks = first.tasks.filter((t) => !parents.has(t.id)).length;
    }
  }

  let dissent = 0;
  let okActions = 0;
  for (const e of harness) {
    const p = payloadOf(e);
    if (e.type === 'dogfood_role_note' && p.kind === 'dissent') dissent += 1;
    if (e.type === 'dogfood_proxy_action' && p.role === 'decision-proxy' && p.ok === true) okActions += 1;
  }
  const agreement = okActions === 0 ? null : Math.max(0, 1 - dissent / okActions);
  return { drafted: ids.size, corrected: reasons.size, rate: ratio(reasons.size, ids.size), byReason, v1TemplateTasks, proxyAgreement: agreement };
}

function usageTotals(): UsageTotals { return { raw: 0, weighted: 0, cacheRead: 0, cacheCreation: 0 }; }

function usageRecord(p: Loose): UsageRecord {
  const read = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return { inputTokens: num(p.inputTokens), outputTokens: num(p.outputTokens), cacheReadTokens: read(p.cacheReadTokens), cacheCreationTokens: read(p.cacheCreationTokens) };
}

interface Turn { turnId: string; taskId: string; agentId: string | null; startedAt: number; end: number | null; status: string | null; blocked: string | null }

function collectTurns(product: readonly LedgerEvent[]): Turn[] {
  const turns = new Map<string, Turn>();
  for (const e of product) {
    const p = payloadOf(e);
    if (e.type === 'task_started' && str(p.turnId)) {
      const turnId = str(p.turnId);
      if (!turns.has(turnId)) turns.set(turnId, { turnId, taskId: str(p.taskId), agentId: null, startedAt: ms(e), end: null, status: null, blocked: null });
    }
  }
  for (const e of product) {
    const p = payloadOf(e);
    if (e.type === 'turn_observed') {
      const turn = turns.get(str(p.turnId));
      if (!turn) continue;
      turn.agentId = str(p.agentId) || turn.agentId;
      if (p.status === 'started') turn.startedAt = Math.min(turn.startedAt, ms(e));
      else {
        turn.status = str(p.status);
        turn.end = ms(e);
      }
    } else if (e.type === 'task_blocked' && e.idempotencyKey?.startsWith('turn-blocked:')) {
      const turn = turns.get(e.idempotencyKey.slice('turn-blocked:'.length));
      if (turn) {
        turn.blocked = str(p.reason) || '(사유 없음)';
        turn.end ??= ms(e);
      }
    }
  }
  return [...turns.values()];
}

/** 새 작업의 근거 메시지로 주체를 판정한다. */
function initiatorOf(basis: readonly string[], nextStepIds: ReadonlySet<string>, humanMessages: ReadonlyMap<string, string>): Initiator {
  if (basis.some((id) => nextStepIds.has(id))) return 'proxy';
  if (!basis.some((id) => humanMessages.has(id))) return 'pm';
  if (basis.some((id) => humanMessages.get(id) === 'designer')) return 'teammate';
  return 'unknown';
}

/** 두 원장에서 지표를 계산한다. 둘 다 비어 있으면 null. */
export function computeMetrics(product: readonly LedgerEvent[], harness: readonly LedgerEvent[]): DogfoodMetrics | null {
  if (product.length === 0 && harness.length === 0) return null;
  const state = project(product);
  const started = harness.find((e) => e.type === 'dogfood_run_started');
  const startedPayload = started ? payloadOf(started) : {};
  const plantedSolo = new Set(strings(startedPayload.plantedSolo));
  const iterationIds = new Set(strings(startedPayload.backlogIds));
  const endAt = Math.max(0, ...product.map(ms), ...harness.map(ms));
  const pauses = pauseIntervals(harness);

  const humanMessages = new Map<string, string>();
  for (const e of product) if (e.type === 'message_recorded' && e.actor.kind === 'human') humanMessages.set(str(payloadOf(e).messageId), str(payloadOf(e).authorId));

  const leaves = [...state.tasks.values()].filter((t) => t.status !== 'cancelled' && !isParentTask(state, t));
  const checkedTaskIds = new Set<string>();
  const revisedTaskIds = new Set<string>();
  for (const e of product) {
    if (e.type === 'task_checked') checkedTaskIds.add(str(payloadOf(e).taskId));
    if (e.type === 'revision_requested') revisedTaskIds.add(str(payloadOf(e).taskId));
  }

  // ---- workflow
  const stopped = [...harness].reverse().find((e) => e.type === 'dogfood_run_stopped');
  const iterationProject = harness.find((e) => e.type === 'dogfood_iteration_project');
  const workflow: DogfoodMetrics['workflow'] = {
    planProposed: product.some((e) => e.type === 'plan_proposed'),
    planCommitted: product.some((e) => e.type === 'plan_committed'),
    planVersion: Math.max(0, ...product.filter((e) => e.type === 'plan_committed').map((e) => num(payloadOf(e).version))),
    planAttempts: iterationProject ? num(payloadOf(iterationProject).planAttempts) : null,
    tasks: leaves.length,
    checked: leaves.filter((t) => t.status === 'checked').length,
    cancelled: [...state.tasks.values()].filter((t) => t.status === 'cancelled').length,
    cycles: Math.max(0, ...harness.filter((e) => e.type === 'dogfood_cycle_finished').map((e) => num(payloadOf(e).cycle))),
    stopReason: stopped ? str(payloadOf(stopped).reason) : null,
    stopDetail: stopped && str(payloadOf(stopped).detail) ? str(payloadOf(stopped).detail) : null,
  };

  // ---- 턴·실행 품질
  const turns = collectTurns(product);
  let succeeded = 0;
  let failed = 0;
  let infraFailed = 0;
  let unfinished = 0;
  for (const t of turns) {
    const failure = t.blocked !== null || t.status === 'failed' || t.status === 'interrupted';
    if (!failure) {
      if (t.status === 'completed') succeeded += 1;
      else unfinished += 1;
      continue;
    }
    const infra = (t.blocked !== null && classifyCliFailure(t.blocked) === 'infra') || pauses.some((i) => t.startedAt >= i.from && t.startedAt <= i.until);
    if (infra) infraFailed += 1;
    else failed += 1;
  }
  const turnTasks = new Set(turns.map((t) => t.taskId));
  const sessions = harness.filter((e) => e.type === 'dogfood_teammate_session' && payloadOf(e).skipped !== true);
  const withCommit = sessions.filter((e) => hasCommit(payloadOf(e))).length;
  const checkedList = [...checkedTaskIds];
  const runs: DogfoodMetrics['runs'] = {
    turns: turns.length,
    succeeded,
    failed,
    infraFailed,
    unfinished,
    successRate: ratio(succeeded, succeeded + failed),
    rerunRatio: ratio(turns.length - turnTasks.size, turns.length),
    firstPassRate: ratio(checkedList.filter((id) => !revisedTaskIds.has(id)).length, checkedList.length),
    teammateSessions: { total: sessions.length, withCommit, successRate: ratio(withCommit, sessions.length) },
  };

  // ---- 개입
  const byType: Record<string, number> = {};
  const byTask: Record<string, number> = {};
  let counted = 0;
  let planned = 0;
  let planRetryActions = 0;
  let planRetryNotes = 0;
  let extraSubmissions = 0;
  const add = (type: string, isCounted: boolean, taskIds: readonly string[] = []) => {
    byType[type] = (byType[type] ?? 0) + 1;
    if (isCounted) {
      counted += 1;
      for (const id of taskIds) byTask[id] = (byTask[id] ?? 0) + 1;
    }
  };
  for (const e of harness) {
    const p = payloadOf(e);
    switch (e.type) {
      case 'dogfood_proxy_action': {
        if (p.ok !== true) break;
        const action = (p.action ?? {}) as Loose;
        if (action.type === 'plan_retry') planRetryActions += 1;
        const type = str(p.interventionType);
        if (!type) break;
        const taskIds = [...(str(action.taskId) ? [str(action.taskId)] : []), ...strings(action.taskIds)];
        add(type, p.counted === true, taskIds);
        if (type === 'rubber_stamp') planned += 1;
        break;
      }
      case 'dogfood_human_task_submitted': {
        const taskIds = str(p.taskId) ? [str(p.taskId)] : [];
        if (p.via === 'fallback') { add('human_result_fallback', true, taskIds); extraSubmissions += 1; }
        else if (p.via === 'misrouted') add('human_result_misrouted', true, taskIds);
        else if (p.via === 'http') {
          if (p.firstSubmission === true) planned += 1;
          else extraSubmissions += 1;
        }
        break;
      }
      case 'dogfood_setup_step':
        // 계획된 개입: 팀원 Space 링크 확인(연결 확인).
        if (p.step === 'teammate_linked') {
          planned += 1;
          add('link_confirm', false);
        }
        break;
      case 'dogfood_manual_integration': add('manual_merge', true, strings(p.taskIds)); break;
      case 'dogfood_role_note':
        if (str(p.text).startsWith('plan_retry')) planRetryNotes += 1;
        break;
      default: break;
    }
  }
  // role_note로 남은 plan_retry는 override다. proxy_action으로 이미 센 것은 다시 세지 않는다.
  for (let i = planRetryActions; i < planRetryNotes; i++) add('override', true);

  const goalIds = new Set(strings(((product.find((e) => e.type === 'plan_proposed') ?? { payload: {} }).payload as Loose).sourceMessageIds));
  const humanMessageEvents = product.filter((e) => e.type === 'message_recorded' && e.actor.kind === 'human');
  const goalMessage = humanMessageEvents.find((e) => goalIds.has(str(payloadOf(e).messageId))) ?? humanMessageEvents[0];
  let ledgerHumanActs = 0;
  const resolveKeys = new Set<string>();
  for (const e of product) {
    const p = payloadOf(e);
    let acted = false;
    if (e.type === 'message_recorded' && e.actor.kind === 'human') {
      acted = true;
      if (!str(p.messageId).startsWith('decision-answer:') && e !== goalMessage) ledgerHumanActs += 1;
    } else if (e.type === 'plan_decided' || e.type === 'authority_granted' || e.type === 'participant_linked' || (e.type === 'decision_resolved' && e.actor.kind === 'human')) {
      acted = true;
      ledgerHumanActs += 1;
    }
    if (!acted && e.idempotencyKey?.startsWith('resolve:')) resolveKeys.add(e.idempotencyKey.replace(/:(?:resume|revision|reset|message)$/, ''));
  }
  ledgerHumanActs += resolveKeys.size;
  const interventions: DogfoodMetrics['interventions'] = {
    counted,
    planned,
    rubberStamp: byType.rubber_stamp ?? 0,
    perTask: ratio(counted, leaves.length),
    tasks: leaves.length,
    byType,
    byTask,
    ledgerHumanActs,
    harnessHumanActs: counted + planned + extraSubmissions,
  };

  // ---- 비용
  const bySource: Record<UsageSource, UsageTotals> = { pm: usageTotals(), 'ensemble-agent': usageTotals(), harness: usageTotals() };
  const byRole: Record<string, { raw: number; weighted: number }> = {};
  const probeTokens = { raw: 0, weighted: 0 };
  let costUsd = 0;
  const agentUsage: { agentId: string; at: number; weighted: number }[] = [];
  for (const e of harness) {
    if (e.type !== 'dogfood_usage_recorded') continue;
    const p = payloadOf(e);
    const source = (['pm', 'ensemble-agent', 'harness'] as const).find((s) => s === p.source);
    if (!source) continue;
    const u = usageRecord(p);
    const raw = u.inputTokens + u.outputTokens;
    const weighted = weightedTokens(u, source);
    const t = bySource[source];
    t.raw += raw; t.weighted += weighted; t.cacheRead += u.cacheReadTokens ?? 0; t.cacheCreation += u.cacheCreationTokens ?? 0;
    const role = str(p.role) || source;
    const r = (byRole[role] ??= { raw: 0, weighted: 0 });
    r.raw += raw; r.weighted += weighted;
    if (role === 'status-probe') { probeTokens.raw += raw; probeTokens.weighted += weighted; }
    costUsd += num(p.costUsd);
    if (source === 'ensemble-agent' && str(p.agentId)) agentUsage.push({ agentId: str(p.agentId), at: ms(e), weighted });
  }
  const turnMs = turns.filter((t) => t.end !== null && t.end >= t.startedAt).map((t) => ({ turn: t, ms: t.end! - t.startedAt }));
  const agentMeasured = harness.some((e) => e.type === 'dogfood_usage_recorded' && payloadOf(e).source === 'ensemble-agent');
  const perTurnTokens = turnMs.filter(({ turn }) => turn.agentId !== null).map(({ turn }) =>
    agentUsage.filter((u) => u.agentId === turn.agentId && u.at >= turn.startedAt && u.at <= turn.end!).reduce((s, u) => s + u.weighted, 0));
  // 리드타임: 첫 task_start_reserved부터 task_checked까지
  const reservedAt = new Map<string, number>();
  const checkedAt = new Map<string, number>();
  for (const e of product) {
    const taskId = str(payloadOf(e).taskId);
    if (e.type === 'task_start_reserved' && !reservedAt.has(taskId)) reservedAt.set(taskId, ms(e));
    if (e.type === 'task_checked') checkedAt.set(taskId, ms(e));
  }
  const leads = [...checkedAt].flatMap(([id, at]) => (reservedAt.has(id) && at >= reservedAt.get(id)! ? [at - reservedAt.get(id)!] : []));
  const productWeighted = bySource.pm.weighted + bySource['ensemble-agent'].weighted;
  const cost: DogfoodMetrics['cost'] = {
    bySource,
    byRole,
    productWeighted,
    harnessWeighted: bySource.harness.weighted,
    totalRaw: bySource.pm.raw + bySource['ensemble-agent'].raw + bySource.harness.raw,
    totalWeighted: productWeighted + bySource.harness.weighted,
    costUsd,
    turnRuns: turnMs.length,
    medianTurnMs: median(turnMs.map((t) => t.ms)),
    totalTurnMs: turnMs.reduce((s, t) => s + t.ms, 0),
    turnTokens: agentMeasured && perTurnTokens.length > 0 ? { median: median(perTurnTokens)!, total: perTurnTokens.reduce((s, v) => s + v, 0) } : null,
    leadTimeMs: leads.length === 0 ? null : { median: median(leads)!, p90: percentile(leads, 0.9)!, count: leads.length },
    agentTokensMeasured: agentMeasured,
  };

  // ---- 현황 파악
  const allProbes = harness.filter((e) => e.type === 'dogfood_status_probe');
  // 프로브 실행 자체가 실패한 기록(failed)은 정확도·시간 지표에서 빼고 따로 센다.
  const probes = allProbes.filter((e) => payloadOf(e).failed !== true);
  const accuracy = (e: LedgerEvent) => ratio(num(payloadOf(e).correct), num(payloadOf(e).total));
  const goodProbes = probes.filter((e) => (accuracy(e) ?? 0) >= 0.8);
  const statusLookup: DogfoodMetrics['statusLookup'] = {
    probes: probes.length,
    medianMs: median(probes.map((e) => num(payloadOf(e).durationMs))),
    successMedianMs: median(goodProbes.map((e) => num(payloadOf(e).durationMs))),
    successProbes: goodProbes.length,
    failedProbes: allProbes.length - probes.length,
    accuracy: ratio(probes.reduce((s, e) => s + num(payloadOf(e).correct), 0), probes.reduce((s, e) => s + num(payloadOf(e).total), 0)),
    tokens: probeTokens,
  };

  // ---- 고리
  const nextStepIds = new Set<string>();
  for (const e of harness) {
    const p = payloadOf(e);
    if (e.type === 'dogfood_proxy_action' && p.ok === true && ((p.action ?? {}) as Loose).type === 'next_step_request' && str(p.messageId)) nextStepIds.add(str(p.messageId));
  }
  const requests = new Map<string, Loose>();
  for (const e of product) if (e.type === 'decision_requested') requests.set(str(payloadOf(e).requestId), payloadOf(e));
  const firstOrigin = new Map<string, Loose>();
  for (const e of product) {
    const p = payloadOf(e);
    if (e.type === 'task_meta_set' && p.origin && typeof p.origin === 'object' && !firstOrigin.has(str(p.taskId))) firstOrigin.set(str(p.taskId), p.origin as Loose);
  }
  const beyondTasks = new Set<string>();
  const beyondCommitAt: { seq: number; at: number }[] = [];
  let previousIds: Set<string> | null = null;
  const commitVersion = new Map<string, number>();
  for (const e of product) {
    if (e.type !== 'plan_committed') continue;
    const p = payloadOf(e);
    const ids = records(p.tasks).map((t) => str(t.id));
    if (previousIds !== null && num(p.version) >= 2) {
      const added = ids.filter((id) => !previousIds!.has(id));
      if (added.length > 0) {
        for (const id of added) { beyondTasks.add(id); commitVersion.set(id, num(p.version)); }
        beyondCommitAt.push({ seq: e.seq, at: ms(e) });
      }
    }
    previousIds = new Set(ids);
  }
  const resultTask = new Map<string, string>();
  for (const e of product) if (e.type === 'task_checked') resultTask.set(str(payloadOf(e).resultId), str(payloadOf(e).taskId));
  const parentOf = (id: string) => state.tasks.get(id)?.spec.parentId;
  const isBeyond = (id: string) => beyondTasks.has(id) || (parentOf(id) !== undefined && beyondTasks.has(parentOf(id)!));
  let inPlan = 0;
  let sequenced = 0;
  for (const e of product) {
    if (e.type !== 'task_start_reserved') continue;
    const p = payloadOf(e);
    const taskId = str(p.taskId);
    const x = resultTask.get(str(p.trigger));
    let hit = false;
    if (x !== undefined && !isBeyond(taskId)) {
      const deps = new Set([...(state.tasks.get(taskId)?.spec.dependsOn ?? []), ...(parentOf(taskId) !== undefined ? (state.tasks.get(parentOf(taskId)!)?.spec.dependsOn ?? []) : [])]);
      hit = deps.has(x) || (parentOf(x) !== undefined && deps.has(parentOf(x)!));
    }
    if (hit) inPlan += 1;
    else sequenced += 1;
  }
  const byInitiator: Record<Initiator, number> = { proxy: 0, pm: 0, teammate: 0, unknown: 0 };
  const loops: DogfoodMetrics['coordination']['loops'] = [];
  for (const id of beyondTasks) {
    const task = state.tasks.get(id);
    if (task && isParentTask(state, task)) continue;
    const origin = firstOrigin.get(id);
    const requestId = origin && str(origin.decisionRequestId) ? str(origin.decisionRequestId) : null;
    const basis = !origin ? [] : requestId !== null ? strings(requests.get(requestId)?.sourceMessageIds) : strings(origin.sourceMessageIds);
    const initiator: Initiator = origin ? initiatorOf(basis, nextStepIds, humanMessages) : 'unknown';
    byInitiator[initiator] += 1;
    loops.push({ taskId: id, title: task?.spec.title ?? id, planVersion: commitVersion.get(id) ?? 0, initiator, decisionRequestId: requestId, basis });
  }
  const beyondTotal = loops.length;
  const latencies: number[] = [];
  for (const c of beyondCommitAt) {
    const before = product.filter((e) => e.type === 'task_checked' && e.seq < c.seq).at(-1);
    if (before) latencies.push(c.at - ms(before));
  }
  const limit = product.find((e) => e.type === 'action_limit_reached');
  let withheld: number | null = null;
  if (limit) {
    const at = project(product.filter((e) => e.seq <= limit.seq));
    withheld = [...at.tasks.values()].filter((t) => t.status === 'ready' && !isParentTask(at, t)).length;
  }
  const coordination: DogfoodMetrics['coordination'] = {
    inPlan,
    sequenced,
    beyondPlan: beyondTotal,
    beyondPlanByPm: byInitiator.pm,
    byInitiator,
    pmLoopRatio: ratio(byInitiator.pm, beyondTotal),
    medianLoopLatencyMs: median(latencies),
    withheldReadyAtLimit: withheld,
    loops,
  };

  // ---- 중복
  const boardTasks = [...state.tasks.values()].filter((t) => t.status !== 'cancelled');
  const reservedTasks = new Set<string>();
  for (const e of product) if (e.type === 'task_start_reserved') reservedTasks.add(str(payloadOf(e).taskId));
  const bSessionItems = new Set<string>();
  for (const e of sessions) if (sessionTeammate(e) === 'teammate-b') for (const id of strings(payloadOf(e).backlogItems)) bSessionItems.add(id);
  const realizedIds = [...plantedSolo].filter((id) => bSessionItems.has(id)
    && boardTasks.some((t) => reservedTasks.has(t.spec.id) && backlogIdsIn([t.spec.title, ...t.spec.handoffConditions].join('\n')).includes(id)));
  const recordedCandidates = (kind: 'overlap' | 'self_rework') => harness.flatMap((e) => (e.type === 'dogfood_overlap_candidate' && payloadOf(e).kind === kind ? [{ key: str(payloadOf(e).key), backlogId: str(payloadOf(e).backlogId) }] : []));
  const candidateSet = (computed: { key: string; backlogId: string }[], kind: 'overlap' | 'self_rework') => {
    const keys = new Map<string, string>();
    for (const c of [...computed, ...recordedCandidates(kind)]) if (c.key && !plantedSolo.has(c.backlogId)) keys.set(c.key, c.backlogId);
    return keys;
  };
  const natural = candidateSet(overlapCandidates(product, harness), 'overlap');
  const rework = candidateSet(selfReworkCandidates(product, harness), 'self_rework');
  const confirmed = new Set<string>();
  for (const e of harness) {
    const p = payloadOf(e);
    if (e.type === 'dogfood_friction_recorded' && p.recordedBy === 'agent' && p.category === 'duplicate' && str(p.confirmsCandidate)) confirmed.add(str(p.confirmsCandidate));
  }
  const duplicates: DogfoodMetrics['duplicates'] = {
    planted: { items: plantedSolo.size, realized: realizedIds.length, avoided: plantedSolo.size - realizedIds.length, realizedIds },
    natural: { candidates: natural.size, confirmed: [...natural.keys()].filter((k) => confirmed.has(k)).length },
    selfRework: { candidates: rework.size, confirmed: [...rework.keys()].filter((k) => confirmed.has(k)).length },
    total: 0,
  };
  duplicates.total = duplicates.planted.realized + duplicates.natural.confirmed;

  // ---- 통합
  let merges = 0;
  let conflicts = 0;
  const tests = harness.filter((e) => e.type === 'dogfood_integration_test');
  const redTasks = new Set<string>();
  for (const e of harness) {
    if (e.type !== 'dogfood_manual_integration') continue;
    const p = payloadOf(e);
    const conflictList = strings(p.conflicts);
    conflicts += conflictList.length;
    if (conflictList.length === 0) merges += 1;
    const red = tests.some((t) => str(payloadOf(t).commit) === str(p.commit) && testFailed(payloadOf(t)));
    if (red) for (const id of strings(p.taskIds)) if (state.tasks.get(id)?.status === 'checked') redTasks.add(id);
  }
  const verified = verifiedDone(harness);
  const board = [...boardDone(product)].filter((id) => iterationIds.size === 0 || iterationIds.has(id));
  const boardOnlyIds = board.filter((id) => !verified.has(id)).sort();
  const integration: DogfoodMetrics['integration'] = {
    merges,
    conflicts,
    tests: tests.length,
    passRate: ratio(tests.filter((e) => !testFailed(payloadOf(e))).length, tests.length),
    checkedButRed: redTasks.size,
    verifiedDone: verified.size,
    boardDone: board.length,
    boardOnly: boardOnlyIds.length,
    boardOnlyIds,
  };

  // ---- 마찰
  const frictionEvents = harness.filter((e) => e.type === 'dogfood_friction_recorded');
  const merged = new Set<string>();
  for (const e of frictionEvents) if (payloadOf(e).recordedBy === 'agent') for (const k of strings(payloadOf(e).mergesKeys)) merged.add(k);
  const items: DogfoodMetrics['frictions']['items'] = frictionEvents.map((e) => {
    const p = payloadOf(e);
    return {
      key: str(p.key), recordedBy: str(p.recordedBy), rule: str(p.rule) || null, category: str(p.category), gap: str(p.gap) || 'UNMAPPED', severity: str(p.severity),
      harnessNoise: p.harnessNoise === true, merged: p.recordedBy !== 'agent' && merged.has(str(p.key)), summary: str(p.summary), cycle: typeof p.cycle === 'number' ? p.cycle : null,
    };
  });
  const live = items.filter((i) => !i.merged);
  const tally = (pick: (i: (typeof items)[number]) => string | null) => {
    const out: Record<string, number> = {};
    for (const i of live) { const k = pick(i); if (k) out[k] = (out[k] ?? 0) + 1; }
    return out;
  };
  const byGap: Record<string, { count: number; score: number }> = {};
  for (const i of live) {
    if (i.harnessNoise) continue;
    const g = (byGap[i.gap] ??= { count: 0, score: 0 });
    g.count += 1;
    g.score += SEVERITY_WEIGHT[i.severity as Severity] ?? 0;
  }
  const frictions: DogfoodMetrics['frictions'] = {
    total: live.length,
    noise: live.filter((i) => i.harnessNoise).length,
    byCategory: tally((i) => i.category),
    byRule: tally((i) => i.rule),
    bySeverity: tally((i) => i.severity),
    byGap,
    proposedGaps: harness.filter((e) => e.type === 'dogfood_gap_proposed').map((e) => ({ gapId: str(payloadOf(e).gapId), title: str(payloadOf(e).title) })),
    items,
  };

  return {
    runId: str(startedPayload.runId) || null,
    iteration: typeof startedPayload.iteration === 'number' ? startedPayload.iteration : null,
    mode: str(startedPayload.mode) || null,
    ensembleCommit: str(startedPayload.ensembleCommit) || null,
    productDirty: typeof startedPayload.productDirty === 'boolean' ? startedPayload.productDirty : null,
    adapters: startedPayload.adapters && typeof startedPayload.adapters === 'object'
      ? { pathPrepend: (startedPayload.adapters as Loose).pathPrepend === true, pmSchemaRef: (startedPayload.adapters as Loose).pmSchemaRef === true }
      : null,
    workflow,
    duplicates,
    statusLookup,
    interventions,
    runs,
    pmDecomposition: pmDecomposition(product, harness, state, new Set(humanMessages.keys())),
    cost,
    coordination,
    integration,
    frictions,
    infra: { pauses: pauses.length, pausedMs: unionLength(pauses, endAt) },
  };
}
