// 결정 대리(owner·designer)와 사람 몫 작업 대리. 사람 멤버의 명의로 제품의 공개 메서드를 직접 부른다.
// 정책은 제품에서 실제로 실행되는 분기만 남긴다(담당자 편집 분기 없음: editable은 title·priority만 쓴다).
// 제품 원장의 human 이벤트는 대리 행위다. 귀속의 정본은 하네스 원장(dogfood_proxy_action)이다.
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { automationGate, isParentTask, project, type AnyEvent, type ChangeKind, type LedgerEvent, type Priority } from '@ensemble/core';
import { taskResolutions, type ResolutionAction } from '../apps/web/lib/task-resolution.ts';
import { backlogIdsIn, boardDone, type BacklogItem } from './backlog.ts';
import { classifyCliFailure, runClaude } from './claude.ts';
import { submitHumanResult } from './human-result.ts';
import type { InterventionType } from './ledger.ts';
import { loadRolePrompt, recordHarnessUsage, type RoleContext } from './role-context.ts';

// ---------------------------------------------------------------- 인박스

export interface InboxBacklogItem {
  id: string;
  /** '제목 — 완료 조건'에서 제목 쪽. */
  title: string;
  epicId: string;
  iteration: number;
  /** '제목 — 완료 조건'에서 완료 조건 쪽. */
  acceptance?: string;
  /** 취소되지 않은 checked 작업의 제목·인계 조건에 이 id가 나온다. */
  boardDone: boolean;
  /** 취소되지 않은 작업(상태 무관)의 제목·인계 조건에 이 id가 나온다. */
  onBoard: boolean;
  /** Space 글에 이 id가 나온다. 다음 단계 선정에는 쓰지 않는다(관찰용). */
  seenInSpace: boolean;
  solo?: string;
}

export interface InboxOption {
  optionId: string;
  label: string;
  effectTypes: string[];
  planOpTypes: string[];
  planOpTaskIds: string[];
  /** planOpTaskIds에 대응하는 작업 제목(없는 id는 제외). */
  planOpTaskTitles: string[];
  /** resolve_task 효과의 처리 방법(accept·retry·recheck). */
  resolveActions: string[];
  answerText?: string;
  tradeoff: string;
}

export interface InboxDecision {
  requestId: string;
  kind: string;
  question: string;
  options: InboxOption[];
  recommendation: { optionId: string; rationale: string };
  editable: string[];
  /** 영향받는 작업 id(impact.taskIds ∪ blockedTaskIds). */
  taskIds: string[];
}

export interface InboxStopped {
  taskId: string;
  title: string;
  reason: string;
  /** taskResolutions가 이 멤버에게 허용한 처리(accept·retry·recheck). */
  actions: string[];
  hasResult: boolean;
  /** 마지막 재시도 지점 뒤의 task_blocked 수에서 인프라 사유를 뺀 수. */
  blockCount: number;
  /** 마지막 막힘 사유가 인프라(사용량 한도·로그인·과부하)다. */
  infra: boolean;
  /** infra이고 인프라 대기가 끝났다. 이때는 retry를 허용한다(정책 ④). rule과 live가 같은 판단을 쓴다. */
  infraRetryReady: boolean;
}

export interface PreviousAction {
  cycle: number;
  type: string;
  target: string;
  /** answer_decision의 answer 또는 resolve_task의 action. */
  verb?: string;
  taskIds: string[];
  ok: boolean;
}

export interface MemberInbox {
  memberId: string;
  isDecider: boolean;
  goal: string;
  cycle: number;
  backlog: InboxBacklogItem[];
  pendingPlans: { proposalId: string; version: number; taskTitles: string[]; reason: string }[];
  pendingAuthority: { requestId: string; changeKinds: ChangeKind[]; text: string }[];
  decisions: InboxDecision[];
  stopped: InboxStopped[];
  automationLimitReached: boolean;
  idle: boolean;
  recentChannel: { author: string; text: string }[];
  spaceResults: { participantId: string; text: string; taskId?: string }[];
  previous: PreviousAction[];
}

export interface InboxInput {
  /** 현재 프로젝트의 제품 원장 이벤트. */
  events: readonly LedgerEvent[];
  /** 하네스 원장 이벤트(이전 대리 행동만 쓴다. 진척은 인박스에 싣지 않는다). */
  harness: readonly LedgerEvent[];
  memberId: string;
  backlog: readonly BacklogItem[];
  goal: string;
  cycle: number;
  iteration: number;
  /** 인프라 대기 종료 판단 기준 시각(ms). 기본은 지금. */
  now?: number;
}

/** '제목 — 완료 조건'(U+2014)을 둘로 나눈다. parseBacklog는 줄 전체를 title에 담는다. */
export function splitBacklogTitle(item: Pick<BacklogItem, 'title'>): { title: string; acceptance?: string } {
  const [head, ...rest] = item.title.split(/\s+—\s+/);
  const acceptance = rest.join(' — ').trim();
  return { title: (head ?? item.title).trim(), ...(acceptance ? { acceptance } : {}) };
}

/** 인프라 사유로 멈췄고 대기가 아직 끝나지 않은 작업. 대기가 끝나면 retry 대상이 된다. */
const holdsForInfra = (s: InboxStopped): boolean => s.infra && !s.infraRetryReady;
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const RESET_KEY = (taskId: string) => `resolve:retry:${taskId}:`;

function blockCountOf(events: readonly AnyEvent[], taskId: string): number {
  let resetSeq = 0;
  for (const e of events) {
    if (e.type === 'task_resumed' && e.payload.taskId === taskId) resetSeq = e.seq;
    if (e.type === 'pm_considered') {
      const key = e.idempotencyKey ?? '';
      const id = e.payload.considerationId;
      if ((key.startsWith(RESET_KEY(taskId)) && key.endsWith(':reset')) || (id.startsWith(RESET_KEY(taskId)) && id.endsWith(':reset'))) resetSeq = e.seq;
    }
  }
  return events.filter((e) => e.type === 'task_blocked' && e.payload.taskId === taskId && e.seq > resetSeq && classifyCliFailure(e.payload.reason) !== 'infra').length;
}

/** 하네스 원장의 대리 행동 기록에서 대상·행동을 뽑는다. 알 수 없는 모양이면 undefined. */
function describeAction(action: unknown): { type: string; target: string; verb?: string; taskIds: string[] } | undefined {
  if (!action || typeof action !== 'object') return undefined;
  const a = action as Record<string, unknown>;
  if (typeof a.type !== 'string') return undefined;
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  const target = str(a.proposalId) ?? str(a.requestId) ?? str(a.taskId) ?? a.type;
  const verb = a.type === 'resolve_task' ? str(a.action) : a.type === 'answer_decision' ? str(a.answer) : a.type === 'approve_plan' || a.type === 'answer_authority' ? String(a.approve) : undefined;
  const taskIds = [...(Array.isArray(a.taskIds) ? a.taskIds.filter((v): v is string => typeof v === 'string') : []), ...(a.type === 'resolve_task' && str(a.taskId) ? [str(a.taskId)!] : [])];
  return { type: a.type, target, ...(verb === undefined ? {} : { verb }), taskIds };
}

function previousActions(harness: readonly LedgerEvent[], memberId: string): PreviousAction[] {
  const out: PreviousAction[] = [];
  for (const e of harness) {
    if (e.type !== 'dogfood_proxy_action') continue;
    const p = e.payload as { role?: string; memberId?: string; cycle?: number; action?: unknown; ok?: boolean };
    if (p.role !== 'decision-proxy' || p.memberId !== memberId) continue;
    const d = describeAction(p.action);
    if (!d || d.type === 'next_step_request') continue;
    out.push({ cycle: p.cycle ?? 0, type: d.type, target: d.target, ...(d.verb === undefined ? {} : { verb: d.verb }), taskIds: d.taskIds, ok: p.ok === true });
  }
  return out;
}

/** 멤버 한 명이 볼 수 있는 사실만 모은다. 원장 정답이나 하네스 진척(verifiedDone)은 담지 않는다. */
export function buildInbox(input: InboxInput): MemberInbox {
  const { events, harness, memberId } = input;
  const now = input.now ?? Date.now();
  const pausedNow = harness.some((e) => e.type === 'dogfood_infra_pause' && Date.parse(String((e.payload as { until?: unknown }).until)) > now);
  const typed = events as readonly AnyEvent[];
  const state = project(events);
  const live = [...state.tasks.values()].filter((t) => t.status !== 'cancelled');
  const onBoardIds = new Set<string>();
  for (const t of live) for (const id of backlogIdsIn([t.spec.title, ...t.spec.handoffConditions].join('\n'))) onBoardIds.add(id);
  const doneIds = boardDone(events);
  const posts = typed.flatMap((e) => (e.type === 'space_post_recorded' ? [e.payload] : []));
  const backlog: InboxBacklogItem[] = input.backlog.map((item) => {
    const { title, acceptance } = splitBacklogTitle(item);
    return {
      id: item.id, title, epicId: item.epicId, iteration: item.iteration, ...(acceptance === undefined ? {} : { acceptance }),
      boardDone: doneIds.has(item.id), onBoard: onBoardIds.has(item.id), seenInSpace: posts.some((p) => p.text.includes(item.id)),
      ...(item.solo === undefined ? {} : { solo: item.solo }),
    };
  });

  const titleOf = (id: string) => state.tasks.get(id)?.spec.title;
  const decisions: InboxDecision[] = [...state.decisionRequests.values()]
    .filter((entry) => entry.status === 'open' && entry.request.targetMemberId === memberId)
    .sort((a, b) => a.requestedSeq - b.requestedSeq)
    .map(({ request }) => ({
      requestId: request.requestId,
      kind: request.kind,
      question: request.question,
      options: request.options.map((o): InboxOption => {
        const ops = o.effects.flatMap((e) => (e.type === 'plan_ops' ? e.ops : []));
        const ids = ops.flatMap((op) => {
          const r = op as unknown as { taskId?: unknown; task?: { id?: unknown } };
          const id = r.taskId ?? r.task?.id;
          return typeof id === 'string' ? [id] : [];
        });
        return {
          optionId: o.optionId, label: o.label, effectTypes: [...new Set(o.effects.map((e) => e.type))],
          planOpTypes: [...new Set(ops.map((op) => op.type))], planOpTaskIds: [...new Set(ids)],
          planOpTaskTitles: [...new Set(ids.flatMap((id) => titleOf(id) ?? []))],
          resolveActions: o.effects.flatMap((e) => (e.type === 'resolve_task' ? [e.action] : [])),
          ...(o.answerText === undefined ? {} : { answerText: o.answerText }), tradeoff: o.tradeoff,
        };
      }),
      recommendation: { optionId: request.recommendation.optionId, rationale: request.recommendation.rationale },
      editable: [...(request.editable ?? [])],
      taskIds: [...new Set([...request.impact.taskIds, ...request.impact.blockedTaskIds])],
    }));

  const stopped: InboxStopped[] = taskResolutions(events, memberId).filter((r) => r.actions.length > 0).map((r) => {
    const task = state.tasks.get(r.taskId)!;
    const lastBlock = typed.findLast((e) => e.type === 'task_blocked' && e.payload.taskId === r.taskId);
    const infra = lastBlock?.type === 'task_blocked' && classifyCliFailure(lastBlock.payload.reason) === 'infra';
    return {
      taskId: r.taskId, title: r.title, reason: r.reason, actions: [...r.actions], hasResult: task.results.length > 0,
      blockCount: blockCountOf(typed, r.taskId),
      infra,
      infraRetryReady: infra && !pausedNow,
    };
  });

  const limitReached = !automationGate(state).allowed;
  const work = live.filter((t) => !isParentTask(state, t));
  const busy = work.some((t) => ['reserved', 'running', 'submitted', 'revising'].includes(t.status));
  const openDecision = [...state.decisionRequests.values()].some((entry) => entry.status === 'open');
  const hasReady = work.some((t) => t.status === 'ready');
  const idle = !busy && !openDecision && state.pendingPlans.size === 0 && state.pendingAuthority.size === 0 && (!hasReady || limitReached);

  return {
    memberId,
    isDecider: state.goal?.decider === memberId,
    goal: input.goal,
    cycle: input.cycle,
    backlog: backlog.filter((b) => b.iteration === input.iteration),
    pendingPlans: [...state.pendingPlans.values()].filter((p) => p.forMemberId === memberId)
      .map((p) => ({ proposalId: p.proposalId, version: p.version, taskTitles: p.tasks.map((t) => t.title), reason: p.reason })),
    pendingAuthority: [...state.pendingAuthority.values()].filter((a) => a.personId === memberId)
      .map((a) => ({ requestId: a.requestId, changeKinds: [...a.changeKinds], text: a.text })),
    decisions,
    stopped,
    automationLimitReached: limitReached,
    idle,
    recentChannel: state.messages.slice(-12).map((m) => ({ author: state.members.get(m.authorId)?.displayName ?? m.authorId, text: clip(m.text, 200) })),
    spaceResults: posts.filter((p) => p.kind === 'result').slice(-5).map((p) => ({ participantId: p.participantId, text: clip(p.text, 200), ...(p.taskId === undefined ? {} : { taskId: p.taskId }) })),
    previous: previousActions(harness, memberId).slice(-30),
  };
}

// ---------------------------------------------------------------- 행동

export type DecisionVerb = 'approve' | 'reject' | 'choose' | 'edit' | 'answer';

export type ProxyAction =
  | { type: 'approve_plan'; proposalId: string; approve: boolean; rationale: string }
  | { type: 'answer_authority'; requestId: string; approve: boolean; rationale: string }
  | { type: 'answer_decision'; requestId: string; answer: DecisionVerb; optionId?: string; edits?: { title?: string; priority?: Priority }; text?: string; rationale: string; taskIds?: string[] }
  | { type: 'resolve_task'; taskId: string; action: ResolutionAction; note?: string; rationale: string }
  | { type: 'post_message'; text: string; rationale: string };

/** 결정 대리가 직접 고르지 않는 행동. 분류 표에는 들어간다. */
export type OtherAction =
  | { type: 'next_step_request'; items: string[]; text: string; planVersionBefore: number; limitRelease?: boolean }
  | { type: 'owner_code_redirect'; taskId: string }
  | { type: 'plan_retry' };

export interface ProxyNote {
  kind: 'dissent' | 'info';
  text: string;
  gapHint?: string;
}

export interface Classified {
  interventionType: InterventionType;
  /** 개입 횟수에 세는 유형(override·answer·recover·initiate)이면 true. rubber_stamp와 defer는 계획된 입력이다. */
  counted: boolean;
}

const COUNTED = new Set<InterventionType>(['override', 'answer', 'recover', 'initiate']);

/**
 * 행동을 결정적으로 분류한다(모델이 아니라 하네스가 한다).
 * approve_plan·answer_authority: 승인은 rubber_stamp, 거절은 override. answer_decision: approve 또는 추천 choose는
 * rubber_stamp(missing_info면 answer), edit·reject·추천 외 choose는 override, answer는 answer. resolve_task는 recover.
 * next_step_request는 initiate, 그 밖의 post_message는 answer.
 */
export function classifyIntervention(action: ProxyAction | OtherAction, inbox?: Pick<MemberInbox, 'decisions'>): Classified {
  const make = (interventionType: InterventionType): Classified => ({ interventionType, counted: COUNTED.has(interventionType) });
  switch (action.type) {
    case 'approve_plan': case 'answer_authority': return make(action.approve ? 'rubber_stamp' : 'override');
    case 'answer_decision': {
      const decision = inbox?.decisions.find((d) => d.requestId === action.requestId);
      if (action.answer === 'answer') return make('answer');
      const agreed = action.answer === 'approve' || (action.answer === 'choose' && decision !== undefined && action.optionId === decision.recommendation.optionId);
      if (!agreed) return make('override');
      return make(decision?.kind === 'missing_info' ? 'answer' : 'rubber_stamp');
    }
    case 'resolve_task': return make('recover');
    case 'next_step_request': return make('initiate');
    case 'post_message': return make('answer');
    case 'owner_code_redirect': case 'plan_retry': return make('override');
  }
}

// ---------------------------------------------------------------- 정책(규칙)

const DEFAULT_ANSWER = '목표와 백로그 범위 안에서 가장 작은 안으로 진행해 주세요. 범위를 넓히는 일은 하지 않습니다.';
const MAX_ACTIONS_PER_PASS = 6;
const MAX_SAME_ACTION = 2;
const TITLE_MAX = 120;

export interface Proposal {
  actions: ProxyAction[];
  notes: ProxyNote[];
}

const unverifiedIds = (inbox: MemberInbox) => new Set(inbox.backlog.filter((b) => !b.boardDone).map((b) => b.id));

/** 같은 작업을 이미 한 번 처리했는가(결정 대응이나 멈춘 작업 처리 어느 쪽이든). */
function handledBefore(inbox: MemberInbox, taskIds: readonly string[]): boolean {
  return inbox.previous.some((p) => p.ok && p.taskIds.some((id) => taskIds.includes(id)));
}

/**
 * 결정 대리의 규칙 정책 ①~⑥(⑤ 다음 단계는 runNextStep이 한다).
 * ① 계획 카드는 승인. ② 권한 카드는 goal_change·deadline_change이면 거절, 그 밖(availability는 human_commitment)은 승인.
 * ③ 결정 요청: missing_info는 승인 또는 기본 답, stuck_work는 두 번째 처리면 accept, 처음이면 cancel, plan_change·assignment는
 *   추천이 이번 반복의 보드 미완료 B-id 작업을 cancel_task·exclude_scope로 지우면 거절 아니면 승인, choice는 승인.
 * ④ 멈춘 작업: 인프라 사유는 건너뛴다. 결과가 있고 (사유에 '보완'이 있거나 recheck가 가능하거나 blockCount ≥ 2)이면 accept,
 *   아니고 blockCount < 2이면 retry, 그 밖에는 info 노트만. ⑥ 개수 제한은 validateActions가 건다. 담당자 편집은 하지 않는다.
 * '미검증'은 보드 기준(boardDone)이다. 대리는 하네스 원장의 진척(verified)을 보지 못한다.
 */
export function ruleDecide(inbox: MemberInbox): Proposal {
  const actions: ProxyAction[] = [];
  const notes: ProxyNote[] = [];
  const unverified = unverifiedIds(inbox);

  for (const plan of inbox.pendingPlans) {
    actions.push({ type: 'approve_plan', proposalId: plan.proposalId, approve: true, rationale: `계획 ${plan.version}판을 승인합니다. 첫 계획 검토는 PM 품질 측정의 대상이라 그대로 진행합니다.` });
  }
  for (const card of inbox.pendingAuthority) {
    const refuse = card.changeKinds.some((k) => k === 'goal_change' || k === 'deadline_change');
    actions.push({ type: 'answer_authority', requestId: card.requestId, approve: !refuse, rationale: refuse ? '목표·기한 변경은 DOGFOOD_GOAL에 없는 요청이라 거절합니다.' : '가용 시간 같은 본인의 약속이라 승인합니다.' });
    if (refuse) notes.push({ kind: 'dissent', text: `권한 카드 ${card.requestId}가 목표나 기한 변경을 요청해 거절했습니다.` });
  }

  const targeted = new Set<string>();
  for (const d of inbox.decisions) {
    for (const id of d.taskIds) targeted.add(id);
    const rec = d.options.find((o) => o.optionId === d.recommendation.optionId);
    const approve = (why: string): ProxyAction => ({ type: 'answer_decision', requestId: d.requestId, answer: 'approve', rationale: why, taskIds: d.taskIds });
    if (d.kind === 'missing_info') {
      const needsText = rec !== undefined && rec.effectTypes.includes('answer') && !rec.answerText?.trim();
      actions.push(needsText
        ? { type: 'answer_decision', requestId: d.requestId, answer: 'answer', text: DEFAULT_ANSWER, rationale: '추천 선택지에 답 문구가 없어 범위 안의 최소 답을 씁니다.', taskIds: d.taskIds }
        : approve('추천 답을 그대로 씁니다.'));
    } else if (d.kind === 'stuck_work') {
      const second = handledBefore(inbox, d.taskIds);
      const wanted = second
        ? d.options.find((o) => o.optionId === 'accept' || o.resolveActions.includes('accept'))
        : d.options.find((o) => o.optionId === 'cancel' || o.planOpTypes.includes('cancel_task'));
      actions.push(wanted
        ? { type: 'answer_decision', requestId: d.requestId, answer: 'choose', optionId: wanted.optionId, rationale: second ? '같은 작업을 두 번째로 처리하므로 지금 결과로 확인합니다.' : '처음 멈춘 작업이므로 취소합니다.', taskIds: d.taskIds }
        : approve('원하는 선택지가 없어 추천을 따릅니다.'));
    } else if (d.kind === 'plan_change' || d.kind === 'assignment') {
      const erases = rec !== undefined && rec.planOpTypes.some((t) => t === 'cancel_task' || t === 'exclude_scope')
        && rec.planOpTaskTitles.some((title) => backlogIdsIn(title).some((id) => unverified.has(id)));
      if (erases) {
        actions.push({ type: 'answer_decision', requestId: d.requestId, answer: 'reject', rationale: '추천안이 이번 반복의 아직 끝나지 않은 백로그 작업을 지웁니다.', taskIds: d.taskIds });
        notes.push({ kind: 'dissent', gapHint: 'G5', text: `결정 요청 ${d.requestId}의 추천이 BACKLOG 항목 작업을 지워 거절했습니다.` });
      } else actions.push(approve('추천안이 이번 반복의 백로그를 지우지 않아 승인합니다.'));
    } else actions.push(approve('추천안을 승인합니다.'));
  }

  for (const s of inbox.stopped) {
    if (holdsForInfra(s) || targeted.has(s.taskId)) continue;
    const can = (a: string) => s.actions.includes(a);
    if (can('accept') && s.hasResult && (/보완/.test(s.reason) || can('recheck') || s.blockCount >= 2)) {
      actions.push({ type: 'resolve_task', taskId: s.taskId, action: 'accept', rationale: `결과가 있고 막힘 ${s.blockCount}회라 지금 결과로 확인합니다.` });
    } else if (can('retry') && s.blockCount < 2) {
      actions.push({ type: 'resolve_task', taskId: s.taskId, action: 'retry', note: '멈춘 지점부터 다시 진행해 주세요.', rationale: `막힘 ${s.blockCount}회라 한 번 더 맡깁니다.` });
    } else notes.push({ kind: 'info', text: `멈춘 작업 "${s.title}"은 허용된 처리(${s.actions.join('·') || '없음'})로 풀 수 없어 그대로 둡니다.` });
  }
  return { actions, notes };
}

// ---------------------------------------------------------------- 검증

export interface RejectedAction {
  raw: unknown;
  reason: string;
}

const VERBS: readonly DecisionVerb[] = ['approve', 'reject', 'choose', 'edit', 'answer'];
const RESOLUTIONS: readonly ResolutionAction[] = ['accept', 'retry', 'recheck'];
const PRIORITIES: readonly Priority[] = ['high', 'normal', 'low'];
const NEW_WORK_PHRASE = /만들어\s*(?:줘|줄래|주세요|주실래요)/;

function targetOf(a: ProxyAction): string {
  switch (a.type) {
    case 'approve_plan': return a.proposalId;
    case 'answer_authority': case 'answer_decision': return a.requestId;
    case 'resolve_task': return a.taskId;
    case 'post_message': return 'post_message';
  }
}
const verbOf = (a: ProxyAction): string | undefined => (a.type === 'answer_decision' ? a.answer : a.type === 'resolve_task' ? a.action : a.type === 'approve_plan' || a.type === 'answer_authority' ? String(a.approve) : undefined);

/**
 * 모델(또는 규칙)이 낸 행동 목록을 인박스에 비추어 검증한다. 거절 사유는 한국어다.
 * 대상이 인박스에 없음, 허용되지 않은 행동, editable 밖이거나 title·priority 밖의 edit, 답 문구가 필요한 선택지,
 * 같은 대상에 같은 행동 3회째, 한 패스 6개 초과, 같은 패스의 같은 대상 중복, 새 작업 요청 문구(다음 단계는 하네스가 한다).
 */
export function validateActions(raw: unknown, inbox: MemberInbox): { actions: ProxyAction[]; rejected: RejectedAction[] } {
  const actions: ProxyAction[] = [];
  const rejected: RejectedAction[] = [];
  if (!Array.isArray(raw)) return { actions, rejected: [{ raw, reason: 'actions가 배열이 아닙니다' }] };
  const seen = new Set<string>();
  for (const item of raw) {
    const reject = (reason: string) => { rejected.push({ raw: item, reason }); };
    const parsed = parseAction(item, inbox);
    if (typeof parsed === 'string') { reject(parsed); continue; }
    const target = targetOf(parsed);
    if (parsed.type !== 'post_message' && seen.has(target)) { reject(`같은 패스에서 같은 대상(${target})을 두 번 처리할 수 없습니다`); continue; }
    const verb = verbOf(parsed);
    const times = inbox.previous.filter((p) => p.type === parsed.type && p.target === target && p.verb === verb).length;
    if (times >= MAX_SAME_ACTION) { reject(`같은 대상(${target})에 같은 행동을 ${MAX_SAME_ACTION}회 했습니다`); continue; }
    if (actions.length >= MAX_ACTIONS_PER_PASS) { reject(`한 패스에 ${MAX_ACTIONS_PER_PASS}개까지만 할 수 있습니다`); continue; }
    seen.add(target);
    actions.push(parsed);
  }
  return { actions, rejected };
}

function parseAction(item: unknown, inbox: MemberInbox): ProxyAction | string {
  if (!item || typeof item !== 'object') return '행동이 객체가 아닙니다';
  const a = item as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  const rationale = str(a.rationale)?.trim() ?? '';
  switch (a.type) {
    case 'approve_plan': {
      const id = str(a.proposalId);
      if (!id || !inbox.pendingPlans.some((p) => p.proposalId === id)) return `대기 중인 계획 카드가 아닙니다: ${id ?? '(없음)'}`;
      if (typeof a.approve !== 'boolean') return 'approve는 true/false여야 합니다';
      return { type: 'approve_plan', proposalId: id, approve: a.approve, rationale };
    }
    case 'answer_authority': {
      const id = str(a.requestId);
      if (!id || !inbox.pendingAuthority.some((p) => p.requestId === id)) return `인박스에 없는 권한 카드입니다: ${id ?? '(없음)'}`;
      if (typeof a.approve !== 'boolean') return 'approve는 true/false여야 합니다';
      return { type: 'answer_authority', requestId: id, approve: a.approve, rationale };
    }
    case 'answer_decision': {
      const id = str(a.requestId);
      const decision = inbox.decisions.find((d) => d.requestId === id);
      if (!id || !decision) return `인박스에 없는 결정 요청입니다: ${id ?? '(없음)'}`;
      const verb = VERBS.find((v) => v === a.answer);
      if (!verb) return `answer는 ${VERBS.join('·')} 중 하나여야 합니다`;
      const optionId = str(a.optionId);
      const option = (oid: string | undefined) => decision.options.find((o) => o.optionId === oid);
      const needsText = (oid: string | undefined) => { const o = option(oid); return o !== undefined && o.effectTypes.includes('answer') && !o.answerText?.trim(); };
      const base = { type: 'answer_decision' as const, requestId: id, answer: verb, rationale, taskIds: decision.taskIds };
      if (verb === 'approve') {
        if (needsText(decision.recommendation.optionId)) return '추천 선택지는 답 문구가 필요합니다. answer로 답을 적으세요';
        return base;
      }
      if (verb === 'reject') return base;
      if (verb === 'choose') {
        if (!optionId || !option(optionId)) return `없는 선택지입니다: ${optionId ?? '(없음)'}`;
        if (needsText(optionId)) return '이 선택지는 답 문구가 필요합니다. answer로 답을 적으세요';
        return { ...base, optionId };
      }
      if (verb === 'answer') {
        const text = str(a.text)?.trim();
        return text ? { ...base, text } : 'answer에는 text가 필요합니다';
      }
      // edit: editable 안의 title·priority만 허용한다(담당자·포함 작업 편집은 하지 않는다).
      const edits = a.edits && typeof a.edits === 'object' && !Array.isArray(a.edits) ? a.edits as Record<string, unknown> : undefined;
      if (!edits || Object.keys(edits).length === 0) return 'edit에는 edits가 필요합니다';
      const clean: { title?: string; priority?: Priority } = {};
      for (const [key, value] of Object.entries(edits)) {
        if (key !== 'title' && key !== 'priority') return `edits는 title·priority만 허용합니다: ${key}`;
        if (!decision.editable.includes(key)) return `이 요청에서 편집할 수 없는 필드입니다: ${key}`;
        if (key === 'title') {
          if (typeof value !== 'string' || !value.trim() || value.length > TITLE_MAX) return `title은 1~${TITLE_MAX}자 문자열이어야 합니다`;
          clean.title = value.trim();
        } else {
          const p = PRIORITIES.find((x) => x === value);
          if (!p) return `priority는 ${PRIORITIES.join('·')} 중 하나여야 합니다`;
          clean.priority = p;
        }
      }
      if (optionId && !option(optionId)) return `없는 선택지입니다: ${optionId}`;
      if (needsText(optionId ?? decision.recommendation.optionId)) return '답 문구가 필요한 선택지는 edit할 수 없습니다';
      return { ...base, edits: clean, ...(optionId ? { optionId } : {}) };
    }
    case 'resolve_task': {
      const id = str(a.taskId);
      const stopped = inbox.stopped.find((s) => s.taskId === id);
      if (!id || !stopped) return `인박스의 멈춘 작업이 아닙니다: ${id ?? '(없음)'}`;
      const action = RESOLUTIONS.find((r) => r === a.action);
      if (!action) return `action은 ${RESOLUTIONS.join('·')} 중 하나여야 합니다`;
      if (!stopped.actions.includes(action)) return `이 멤버에게 허용되지 않은 처리입니다: ${action}`;
      if (holdsForInfra(stopped)) return '인프라 사유로 멈춘 작업은 대기가 끝난 뒤 처리합니다';
      const note = str(a.note)?.trim();
      return { type: 'resolve_task', taskId: id, action, ...(note ? { note } : {}), rationale };
    }
    case 'post_message': {
      const text = str(a.text)?.trim();
      if (!text) return 'post_message에는 text가 필요합니다';
      if (text.length > 500) return 'post_message는 500자 이하여야 합니다';
      if (NEW_WORK_PHRASE.test(text)) return '새 작업 요청 문구는 쓸 수 없습니다(다음 단계 요청은 하네스가 합니다)';
      return { type: 'post_message', text, rationale };
    }
    default: return `알 수 없는 행동 유형입니다: ${String(a.type)}`;
  }
}

// ---------------------------------------------------------------- 실행

const PROXY_TIMEOUT_MS = 5 * 60_000;

export const PROXY_SCHEMA = {
  type: 'object',
  required: ['actions', 'notes'],
  properties: {
    actions: {
      type: 'array',
      maxItems: MAX_ACTIONS_PER_PASS,
      items: {
        type: 'object',
        required: ['type', 'rationale'],
        properties: {
          type: { enum: ['approve_plan', 'answer_authority', 'answer_decision', 'resolve_task', 'post_message'] },
          proposalId: { type: 'string' },
          requestId: { type: 'string' },
          taskId: { type: 'string' },
          approve: { type: 'boolean' },
          answer: { enum: [...VERBS] },
          action: { enum: [...RESOLUTIONS] },
          optionId: { type: 'string' },
          text: { type: 'string' },
          note: { type: 'string' },
          edits: { type: 'object', properties: { title: { type: 'string' }, priority: { enum: [...PRIORITIES] } } },
          rationale: { type: 'string' },
        },
      },
    },
    notes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['kind', 'text'],
        properties: { kind: { enum: ['dissent', 'info'] }, text: { type: 'string' }, gapHint: { type: 'string' } },
      },
    },
  },
} as const;

function hasWork(inbox: MemberInbox): boolean {
  return inbox.pendingPlans.length > 0 || inbox.pendingAuthority.length > 0 || inbox.decisions.length > 0 || inbox.stopped.some((s) => s.actions.length > 0 && !holdsForInfra(s));
}

const paused = (ctx: RoleContext) => ctx.infraPausedUntil !== undefined && Date.parse(ctx.infraPausedUntil) > Date.now();

async function currentInbox(ctx: RoleContext, memberId: string): Promise<MemberInbox> {
  return buildInbox({
    events: await ctx.host.events(), harness: await ctx.ledger.read(), memberId, backlog: ctx.backlog,
    goal: ctx.goal, cycle: ctx.cycle, iteration: ctx.config.iteration,
  });
}

function parseNotes(raw: unknown): ProxyNote[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((n): ProxyNote[] => {
    if (!n || typeof n !== 'object') return [];
    const r = n as Record<string, unknown>;
    if ((r.kind !== 'dissent' && r.kind !== 'info') || typeof r.text !== 'string' || !r.text.trim()) return [];
    return [{ kind: r.kind, text: clip(r.text.trim(), 500), ...(typeof r.gapHint === 'string' && /^G\d+$/.test(r.gapHint) ? { gapHint: r.gapHint } : {}) }];
  });
}

type LiveProposal = { kind: 'ok'; actions: unknown; notes: ProxyNote[] } | { kind: 'infra' } | { kind: 'failed'; error: string };

async function proposeLive(ctx: RoleContext, memberId: string, inbox: MemberInbox): Promise<LiveProposal> {
  let system: string;
  try {
    system = loadRolePrompt('decision-proxy');
  } catch (error) {
    return { kind: 'failed', error: error instanceof Error ? error.message : String(error) };
  }
  mkdirSync(ctx.layout.logs, { recursive: true });
  const r = await runClaude({
    role: 'decision-proxy', cwd: ctx.layout.logs, tools: 'none', appendSystemPrompt: system, jsonSchema: PROXY_SCHEMA,
    prompt: `당신은 멤버 ${memberId}의 결정 대리입니다. 아래 인박스만 보고 정책에 따라 행동과 노트를 스키마 JSON으로만 답하세요.\n${JSON.stringify(inbox)}`,
    budgetUsd: ctx.config.proxyBudgetUsd, timeoutMs: PROXY_TIMEOUT_MS, signal: ctx.signal,
    ...(ctx.config.harnessModel ? { model: ctx.config.harnessModel } : {}),
    logFile: join(ctx.layout.logs, `c${ctx.cycle}-decision-proxy-${memberId}.json`),
  });
  const until = await recordHarnessUsage(ctx, 'decision-proxy', r);
  if (until !== undefined) return { kind: 'infra' };
  const out = r.structured as { actions?: unknown; notes?: unknown } | undefined;
  if (!r.ok || !out || !Array.isArray(out.actions)) return { kind: 'failed', error: r.error ?? '구조화된 출력이 없습니다' };
  return { kind: 'ok', actions: out.actions, notes: parseNotes(out.notes) };
}

async function execute(ctx: RoleContext, memberId: string, action: ProxyAction): Promise<void> {
  const { runtime } = ctx.host;
  switch (action.type) {
    case 'approve_plan': return void await runtime.run(() => runtime.pm.decideCard(action.proposalId, memberId, action.approve));
    case 'answer_authority': return void await runtime.run(() => runtime.pm.decideCard(action.requestId, memberId, action.approve));
    case 'answer_decision':
      return runtime.run(() => runtime.decide(action.requestId, memberId, {
        action: action.answer,
        ...(action.optionId === undefined ? {} : { optionId: action.optionId }),
        ...(action.edits === undefined ? {} : { edits: { ...action.edits } }),
        ...(action.text === undefined ? {} : { text: action.text }),
      }));
    case 'resolve_task': await runtime.resolveTask(action.taskId, action.action, memberId, action.note); return;
    case 'post_message': await runtime.message(memberId, action.text); return;
  }
}

async function recordNote(ctx: RoleContext, memberId: string, note: ProxyNote): Promise<void> {
  const digest = createHash('sha1').update(`${note.kind}:${note.text}`).digest('hex').slice(0, 16);
  await ctx.ledger.record('dogfood_role_note', {
    role: 'decision-proxy', memberId, cycle: ctx.cycle, kind: note.kind, text: note.text, ...(note.gapHint === undefined ? {} : { gapHint: note.gapHint }),
  }, { key: `proxy-note:${memberId}:${digest}`, actor: 'decision-proxy' });
}

/**
 * 멤버 한 명의 결정 대리를 한 번 돈다(한 패스, 행동 6개까지). live는 headless claude -p의 제안을, rule은 ruleDecide를 쓴다.
 * 제안이 실패하거나 전부 거절되면 ruleDecide로 폴백하고 harnessNoise로 표시한다. 인프라 실패이면 폴백하지 않고 0을 돌려준다
 * (recordHarnessUsage가 dogfood_infra_pause를 남긴다). 돌려주는 값은 성공한 행동 수다.
 */
export async function runDecisionProxy(ctx: RoleContext, memberId: string): Promise<number> {
  if (paused(ctx) || ctx.signal.aborted) return 0;
  const inbox = await currentInbox(ctx, memberId);
  if (!hasWork(inbox)) return 0;

  let via: 'live' | 'rule' | 'rule-fallback' = 'rule';
  let notes: ProxyNote[] = [];
  let valid: ProxyAction[] = [];
  let rejected: RejectedAction[] = [];
  let useRule = true;
  if (ctx.config.mode === 'live') {
    const live = await proposeLive(ctx, memberId, inbox);
    if (live.kind === 'infra') return 0;
    if (live.kind === 'ok') {
      const checked = validateActions(live.actions, inbox);
      notes = live.notes;
      rejected = checked.rejected;
      valid = checked.actions;
      via = 'live';
      // 모델이 행동을 하나도 내지 않았으면(노트만) 그대로 존중한다. 낸 것이 전부 거절됐을 때만 폴백한다.
      useRule = valid.length === 0 && rejected.length > 0;
    } else {
      await ctx.ledger.record('dogfood_role_note', { role: 'decision-proxy', memberId, cycle: ctx.cycle, kind: 'info', text: `live 제안 실패: ${live.error}` }, { actor: 'decision-proxy' });
    }
    if (useRule) via = 'rule-fallback';
  }
  const noise = via === 'rule-fallback';
  for (const r of rejected) {
    await ctx.ledger.record('dogfood_proxy_action', {
      role: 'decision-proxy', memberId, cycle: ctx.cycle, action: { rejected: true, raw: r.raw }, interventionType: 'defer', counted: false, ok: false, error: r.reason, via: 'live', harnessNoise: true,
    }, { actor: 'decision-proxy' });
  }
  if (useRule) {
    const proposal = ruleDecide(inbox);
    valid = validateActions(proposal.actions, inbox).actions;
    notes = [...notes, ...proposal.notes];
  }

  let done = 0;
  for (const action of valid) {
    if (ctx.signal.aborted) break;
    const { interventionType, counted } = classifyIntervention(action, inbox);
    let error: string | undefined;
    try {
      await execute(ctx, memberId, action);
      done++;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    await ctx.ledger.record('dogfood_proxy_action', {
      role: 'decision-proxy', memberId, cycle: ctx.cycle, action, interventionType, counted, ok: error === undefined,
      ...(error === undefined ? {} : { error }), via, harnessNoise: noise || error !== undefined,
    }, { actor: 'decision-proxy' });
  }
  for (const note of notes) await recordNote(ctx, memberId, note);
  return done;
}

// ---------------------------------------------------------------- 사람 몫 작업 대리

export interface WorkerOutput {
  fileName: string;
  content: string;
  summary: string;
}

export const WORKER_SCHEMA = {
  type: 'object',
  required: ['fileName', 'content', 'summary'],
  properties: { fileName: { type: 'string' }, content: { type: 'string' }, summary: { type: 'string' } },
} as const;

const SYNTHETIC_LINE = '합성 자료입니다. 실제 고객·내부 정보가 아니며 하네스의 사람 몫 작업 대리가 쓴 내용입니다.';

/** '조건 → 응답' 절. 인계 조건마다 '### n. 조건'을 쓰고 조건 문구를 본문에도 인용해 검토가 인용할 수 있게 한다. */
export function ruleWorkerOutput(title: string, conditions: readonly string[], missing: readonly string[]): WorkerOutput {
  // 보완 요청에서 모자란 것으로 지적된 조건을 앞에 둔다.
  const isMissing = (c: string) => missing.some((m) => m.includes(c) || c.includes(m));
  const ordered = [...conditions.filter(isMissing), ...conditions.filter((c) => !isMissing(c))];
  const sections = ordered.map((c, i) => `### ${i + 1}. ${c}\n${c}에 대해 합성 자료로 정리한 내용입니다. 항목을 나누어 근거와 함께 적었고, 확인하지 못한 부분은 한계로 구분했습니다.`);
  const safe = title.replace(/[^\w가-힣-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'result';
  return {
    fileName: `${safe}.md`,
    content: [SYNTHETIC_LINE, '', `# ${title}`, '', '## 인계 조건 대응', '', ...sections].join('\n'),
    summary: `"${title}" 결과를 올립니다.`,
  };
}

const REQUEST_PHRASE = /만들어\s*(?:줘|줄래|주세요|주실래요)/g;
/** 제출 본문에는 새 작업 요청처럼 읽히는 표현을 남기지 않는다. */
export function cleanSummary(text: string, fallback: string): string {
  const t = text.replace(REQUEST_PHRASE, '작성했습니다').replace(/\s+/g, ' ').trim();
  return clip(t || fallback, 300);
}

function validWorkerOutput(raw: unknown): WorkerOutput | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.content !== 'string' || !r.content.trim() || typeof r.summary !== 'string') return undefined;
  const name = typeof r.fileName === 'string' ? r.fileName.split(/[\\/]/).pop()!.replace(/[^\w.가-힣-]+/g, '-') : '';
  return { fileName: /\.md$/i.test(name) ? name : `${name || 'result'}.md`, content: r.content, summary: r.summary };
}

/**
 * 사람 몫 작업 대리. 대상은 owner 담당이고 제목에 B-id가 없고 reserved·revising이며 부모가 아니고, 이번 사이클에 제출하지 않았고,
 * 하네스 원장에 pending으로 남지 않은 작업 1건이다(사이클당 1건). 규칙 모드는 결정적 템플릿을, live는 읽기 전용 claude -p를 쓴다.
 * 제출은 submitHumanResult(actor 'member-worker')로 한다. 돌려주는 값은 제출 수(0 또는 1)다.
 */
export async function runMemberWorker(ctx: RoleContext): Promise<number> {
  if (paused(ctx) || ctx.signal.aborted) return 0;
  const events = await ctx.host.events();
  const harness = await ctx.ledger.read();
  const submissions = harness.flatMap((e) => (e.type === 'dogfood_human_task_submitted'
    ? [{ ...(e.payload as { taskId: string; via: string; actor: string; cycle: number; httpMessageId: string | null }), key: e.idempotencyKey }] : []));
  if (submissions.some((s) => s.actor === 'member-worker' && s.cycle === ctx.cycle)) return 0;
  const finalIds = new Set(submissions.flatMap((s) => (s.key?.startsWith('human-submit-final:') ? [s.key.slice('human-submit-final:'.length)] : [])));
  const pendingTasks = new Set(submissions.filter((s) => s.via === 'pending' && s.httpMessageId !== null && !finalIds.has(s.httpMessageId)).map((s) => s.taskId));
  const state = project(events);
  const task = [...state.tasks.values()].find((t) => t.spec.assignee === 'owner' && backlogIdsIn(t.spec.title).length === 0
    && (t.status === 'reserved' || t.status === 'revising') && !isParentTask(state, t) && !pendingTasks.has(t.spec.id));
  if (!task) return 0;

  const typed = events as readonly AnyEvent[];
  const revision = typed.findLast((e) => e.type === 'revision_requested' && e.payload.taskId === task.spec.id);
  const missing = task.status === 'revising' && revision?.type === 'revision_requested' ? revision.payload.missing : [];
  const conditions = task.spec.handoffConditions;
  let out: WorkerOutput | undefined;
  if (ctx.config.mode === 'live') {
    let system: string | undefined;
    try { system = loadRolePrompt('member-worker'); } catch { system = undefined; }
    if (system !== undefined) {
      const deps = task.spec.dependsOn.flatMap((id) => {
        const dep = state.tasks.get(id);
        const result = typed.findLast((e) => e.type === 'result_submitted' && e.payload.taskId === id);
        return dep ? [{ title: dep.spec.title, status: dep.status, summary: result?.type === 'result_submitted' ? clip(result.payload.summary, 300) : undefined }] : [];
      });
      const r = await runClaude({
        role: 'member-worker', cwd: ctx.layout.targetMain, tools: { allowed: ['Read', 'Glob', 'Grep'] }, appendSystemPrompt: system, jsonSchema: WORKER_SCHEMA,
        prompt: JSON.stringify({ goal: ctx.goal, task: { title: task.spec.title, conditions, missing }, predecessors: deps, backlog: ctx.backlog.map((b) => ({ id: b.id, title: splitBacklogTitle(b).title })) }),
        budgetUsd: ctx.config.proxyBudgetUsd, timeoutMs: PROXY_TIMEOUT_MS, signal: ctx.signal,
        ...(ctx.config.harnessModel ? { model: ctx.config.harnessModel } : {}),
        logFile: join(ctx.layout.logs, `c${ctx.cycle}-member-worker.json`),
      });
      const until = await recordHarnessUsage(ctx, 'member-worker', r);
      if (until !== undefined) return 0;
      if (r.ok) out = validWorkerOutput(r.structured);
    }
    if (!out) await ctx.ledger.record('dogfood_role_note', { role: 'member-worker', memberId: 'owner', cycle: ctx.cycle, kind: 'info', text: '사람 몫 작업 내용을 만들지 못해 규칙 템플릿으로 대체했습니다.' }, { actor: 'member-worker' });
  }
  out ??= ruleWorkerOutput(task.spec.title, conditions, missing);
  const first = !submissions.some((s) => s.taskId === task.spec.id);
  try {
    await submitHumanResult(ctx, {
      memberId: 'owner', actor: 'member-worker', taskId: task.spec.id, text: cleanSummary(out.summary, `"${task.spec.title}" 결과를 올립니다.`),
      files: [{ name: out.fileName, content: out.content }], firstSubmission: first,
    });
    return 1;
  } catch (error) {
    await ctx.ledger.record('dogfood_role_note', { role: 'member-worker', memberId: 'owner', cycle: ctx.cycle, kind: 'info', text: `제출하지 못했습니다: ${error instanceof Error ? error.message : String(error)}` }, { actor: 'member-worker' });
    return 0;
  }
}

// ---------------------------------------------------------------- 다음 단계(07)

const NEXT_STEP_WAIT_CYCLES = 2;
const NEXT_STEP_MAX_FAILURES = 3;

/**
 * 다음 단계 후보. 이번 반복 항목 중 보드에 끝나지도 올라가지도 않은 것을 BACKLOG 순서로 고른다.
 * seenInSpace(Space에 글이 있는지)와 하네스 verifiedDone(팀원이 보드 밖에서 끝낸 것)은 보지 않는다:
 * 결정권자는 화면에 보이는 정보만 쓰므로 팀원 B가 solo로 끝낸 항목도 요청한다. 그것이 계획 표본 중복이다.
 */
export function nextStepCandidates(inbox: MemberInbox): InboxBacklogItem[] {
  return inbox.backlog.filter((b) => !b.boardDone && !b.onBoard);
}

export function nextStepText(items: readonly InboxBacklogItem[], assignee: 'pm' | 'designer'): string {
  const names = items.map((i) => `[${i.id}] ${i.title}`).join(', ');
  const conditions = items.filter((i) => i.acceptance).map((i) => (items.length > 1 ? `[${i.id}] ${i.acceptance}` : i.acceptance!)).join(' / ');
  return `${names}을 만들어 주세요.${conditions ? ` 완료 조건: ${conditions}.` : ''} 작업 제목 앞에 항목 id를 붙여 주세요.${assignee === 'designer' ? ' 대상 레포 코드 작업이라 디자이너에게 맡겨 주세요.' : ''}`;
}

/**
 * 07 -> 02 고리를 결정 대리(owner)가 대신 닫는다. owner 인박스가 idle일 때만 움직인다.
 * 사이클당 1회, 효과(plan_committed version 상승)가 없으면 2사이클 기다린다. 3회 연속 효과가 없으면 더는 보내지 않는다.
 * 후보가 없는데 상한에 닿아 있으면 'limit_stall'(loop가 즉시 정지한다). 상한에 닿은 채 보내면 action.limitRelease=true다.
 */
export async function runNextStep(ctx: RoleContext): Promise<'sent' | 'none' | 'limit_stall'> {
  if (paused(ctx) || ctx.signal.aborted) return 'none';
  const events = await ctx.host.events();
  const harness = await ctx.ledger.read();
  const inbox = buildInbox({ events, harness, memberId: 'owner', backlog: ctx.backlog, goal: ctx.goal, cycle: ctx.cycle, iteration: ctx.config.iteration });
  if (!inbox.isDecider || !inbox.idle) return 'none';
  const candidates = nextStepCandidates(inbox);
  if (candidates.length === 0) return inbox.automationLimitReached ? 'limit_stall' : 'none';

  const version = project(events).plan?.version ?? 0;
  const sent = harness.flatMap((e) => {
    if (e.type !== 'dogfood_proxy_action') return [];
    const p = e.payload as { cycle: number; ok: boolean; action: { type?: string; planVersionBefore?: number } };
    return p.action?.type === 'next_step_request' && p.ok ? [{ cycle: p.cycle, before: p.action.planVersionBefore ?? 0 }] : [];
  });
  if (sent.some((s) => s.cycle === ctx.cycle)) return 'none';
  const last = sent.at(-1);
  if (last && version <= last.before && ctx.cycle - last.cycle <= NEXT_STEP_WAIT_CYCLES) return 'none';
  // 앞선 요청이 효과 없이 끝난 횟수. 가장 최근 요청은 기다리는 중이 아닐 때만(이미 위에서 걸렀다) 실패로 센다.
  let failures = 0;
  for (let i = sent.length - 1; i >= 0 && version <= sent[i]!.before; i--) failures++;
  if (failures >= NEXT_STEP_MAX_FAILURES) return 'none';

  const items = candidates.slice(0, ctx.config.mode === 'live' ? 2 : 1);
  const text = nextStepText(items, ctx.config.nextStepAssignee);
  const action: OtherAction = { type: 'next_step_request', items: items.map((i) => i.id), text, planVersionBefore: version, ...(inbox.automationLimitReached ? { limitRelease: true } : {}) };
  try {
    const { messageId } = await ctx.host.runtime.message('owner', text);
    await ctx.ledger.record('dogfood_proxy_action', {
      role: 'decision-proxy', memberId: 'owner', cycle: ctx.cycle, action, interventionType: 'initiate', counted: true, ok: true, messageId, via: 'rule', harnessNoise: false,
    }, { actor: 'decision-proxy' });
    return 'sent';
  } catch (error) {
    await ctx.ledger.record('dogfood_proxy_action', {
      role: 'decision-proxy', memberId: 'owner', cycle: ctx.cycle, action, interventionType: 'initiate', counted: true, ok: false,
      error: error instanceof Error ? error.message : String(error), via: 'rule', harnessNoise: true,
    }, { actor: 'decision-proxy' });
    return 'none';
  }
}
