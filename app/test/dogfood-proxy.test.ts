import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Actor, LedgerEvent } from '@ensemble/core';
import { MemoryLedgerStore } from '@ensemble/store';
import { FAKE_NEW_WORK } from '../apps/web/lib/fake-connector.ts';
import { appDir, type DogfoodConfig } from '../dogfood/config.ts';
import { ARG_LIMIT_CHARS } from '../dogfood/claude.ts';
import { parseBacklog } from '../dogfood/backlog.ts';
import { judgeSubmission } from '../dogfood/human-result.ts';
import {
  PROXY_SCHEMA, buildInbox, classifyIntervention, cleanSummary, nextStepCandidates, nextStepText, ruleDecide, ruleWorkerOutput, runNextStep,
  splitBacklogTitle, validateActions, type InboxBacklogItem, type InboxDecision, type InboxStopped, type MemberInbox, type PreviousAction, type ProxyAction,
} from '../dogfood/proxy.ts';
import { DogfoodLedger } from '../dogfood/ledger.ts';
import { recordProductInfraPauses, type RoleContext } from '../dogfood/role-context.ts';

// ---- 합성 원장 도우미

const CTX = { projectId: 'p', targetProductId: 'dogfood-test' };
interface Seed { type: string; payload: unknown; actor?: Actor; key?: string }

async function ledger(seeds: Seed[]): Promise<LedgerEvent[]> {
  const store = new MemoryLedgerStore();
  await store.append(seeds.map((s) => ({
    ...CTX, type: s.type, actor: s.actor ?? { kind: 'system', id: 'test' }, payload: s.payload, ...(s.key === undefined ? {} : { idempotencyKey: s.key }),
  })));
  return store.read({ projectId: 'p' });
}

const human = (memberId: string, displayName = memberId): Seed => ({ type: 'member_joined', payload: { memberId, kind: 'human', displayName } });
const agent = (memberId: string): Seed => ({ type: 'member_joined', payload: { memberId, kind: 'agent', displayName: memberId, role: memberId } });
interface TaskSeed { id: string; title: string; assignee: string; dependsOn?: string[]; conditions?: string[] }
const spec = (t: TaskSeed) => ({ id: t.id, title: t.title, assignee: t.assignee, dependsOn: t.dependsOn ?? [], handoffConditions: t.conditions ?? ['조건 하나'] });

function base(tasks: TaskSeed[], extra: Seed[] = []): Seed[] {
  return [
    human('owner', '사용자'), human('designer', '디자이너'), agent('research-agent'), agent('prototype-agent'),
    { type: 'goal_set', payload: { text: '회의록 검색 도구', decider: 'owner', delegation: { pmMayApply: [] } } },
    { type: 'plan_committed', payload: { version: 1, basedOn: null, tasks: tasks.map(spec), reason: '테스트', approvedBy: 'owner', sourceMessageIds: [] } },
    ...extra,
  ];
}

const SEED_BACKLOG = parseBacklog(readFileSync(join(appDir(), 'dogfood', 'seed-project', 'BACKLOG.md'), 'utf8'));
const inboxOf = (events: readonly LedgerEvent[], harness: readonly LedgerEvent[] = [], memberId = 'owner', cycle = 1) =>
  buildInbox({ events, harness, memberId, backlog: SEED_BACKLOG, goal: '회의록 검색 도구', cycle, iteration: 1 });

const reserved = (taskId: string, specVersion = 1): Seed => ({ type: 'task_start_reserved', actor: { kind: 'pm', id: 'pm' }, payload: { taskId, specVersion, trigger: 'seed' } });
const started = (taskId: string): Seed => ({ type: 'task_started', actor: { kind: 'pm', id: 'pm' }, payload: { taskId } });
const submitted = (taskId: string, resultId: string, actor = 'owner'): Seed => ({ type: 'result_submitted', actor: { kind: 'human', id: actor }, payload: { taskId, resultId, planVersion: 1, summary: '결과', artifactIds: [] } });
const blocked = (taskId: string, reason: string): Seed => ({ type: 'task_blocked', actor: { kind: 'system', id: 'pm' }, payload: { taskId, reason } });

// ---- MemberInbox 직접 만들기(ruleDecide·validateActions용)

function mk(over: Partial<MemberInbox> = {}): MemberInbox {
  return {
    memberId: 'owner', isDecider: true, goal: '목표', cycle: 1, backlog: [], pendingPlans: [], pendingAuthority: [], decisions: [], stopped: [],
    automationLimitReached: false, idle: false, recentChannel: [], spaceResults: [], previous: [], ...over,
  };
}
const item = (id: string, over: Partial<InboxBacklogItem> = {}): InboxBacklogItem => ({ id, title: `${id} 제목`, epicId: 'E1', iteration: 1, boardDone: false, onBoard: false, seenInSpace: false, ...over });
function decision(over: Partial<InboxDecision> & { kind: string }): InboxDecision {
  return {
    requestId: 'r1', question: '질문', recommendation: { optionId: 'rec', rationale: '근거' }, editable: [], taskIds: ['t1'],
    options: [
      { optionId: 'rec', label: '추천', effectTypes: ['none'], planOpTypes: [], planOpTaskIds: [], planOpTaskTitles: [], resolveActions: [], tradeoff: '' },
      { optionId: 'hold', label: '보류', effectTypes: ['none'], planOpTypes: [], planOpTaskIds: [], planOpTaskTitles: [], resolveActions: [], tradeoff: '' },
    ],
    ...over,
  };
}
const stoppedTask = (over: Partial<InboxStopped> = {}): InboxStopped => ({
  taskId: 's1', title: '멈춘 작업', reason: '세션 오류', actions: ['accept', 'retry'], hasResult: true, blockCount: 0, infra: false, infraRetryReady: false, ...over,
});
const only = <T extends ProxyAction['type']>(actions: ProxyAction[], type: T) => actions.filter((a): a is Extract<ProxyAction, { type: T }> => a.type === type);

// ---- buildInbox

test('buildInbox: pendingAuthority는 본인 몫만, 결정 옵션의 계획 연산과 작업 제목을 풀어 준다', async () => {
  const events = await ledger(base([
    { id: 't1', title: '조사', assignee: 'research-agent' },
    { id: 't2', title: '[B-02] 액션아이템 파싱', assignee: 'prototype-agent', dependsOn: ['t1'] },
  ], [
    { type: 'authority_requested', payload: { requestId: 'a1', personId: 'owner', changeKinds: ['human_commitment'], text: '가용 시간 변경' } },
    { type: 'authority_requested', payload: { requestId: 'a2', personId: 'designer', changeKinds: ['goal_change'], text: '목표 변경' } },
    {
      type: 'decision_requested', actor: { kind: 'pm', id: 'pm' },
      payload: {
        requestId: 'd1', kind: 'plan_change', targetMemberId: 'owner', question: '이 작업을 취소할까요?', sourceMessageIds: [], editable: ['title'],
        options: [
          { optionId: 'a', label: '취소', effects: [{ type: 'plan_ops', ops: [{ type: 'cancel_task', taskId: 't2', reason: '중복', sourceMessageIds: [] }] }], tradeoff: '' },
          { optionId: 'hold', label: '보류', effects: [{ type: 'none' }], tradeoff: '' },
        ],
        recommendation: { optionId: 'a', rationale: '중복', evidence: [] }, impact: { taskIds: ['t2'], blockedTaskIds: [] },
      },
    },
  ]));
  const owner = inboxOf(events);
  assert.deepEqual(owner.pendingAuthority, [{ requestId: 'a1', changeKinds: ['human_commitment'], text: '가용 시간 변경' }]);
  assert.deepEqual(inboxOf(events, [], 'designer').pendingAuthority.map((a) => a.requestId), ['a2']);
  assert.equal(owner.decisions.length, 1);
  const cancel = owner.decisions[0]!.options.find((o) => o.optionId === 'a')!;
  assert.deepEqual([cancel.effectTypes, cancel.planOpTypes, cancel.planOpTaskIds, cancel.planOpTaskTitles], [['plan_ops'], ['cancel_task'], ['t2'], ['[B-02] 액션아이템 파싱']]);
  assert.deepEqual(owner.decisions[0]!.editable, ['title']);
  assert.equal(owner.isDecider, true);
  assert.equal(inboxOf(events, [], 'designer').isDecider, false);
  // 백로그: 이번 반복 항목만, 제목과 완료 조건이 나뉘고, 보드 올림 여부가 표시된다.
  assert.deepEqual(owner.backlog.map((b) => b.id), ['B-01', 'B-02', 'B-03', 'B-04']);
  assert.equal(owner.backlog.find((b) => b.id === 'B-02')!.onBoard, true);
  assert.equal(owner.backlog.find((b) => b.id === 'B-01')!.title, '결정 줄 파싱');
  assert.match(owner.backlog.find((b) => b.id === 'B-01')!.acceptance ?? '', /결정:/);
});

test('buildInbox: 멈춘 작업의 hasResult·blockCount(재시도 뒤만, 인프라 제외)·infra', async () => {
  const head = base([{ id: 'w', title: '인터뷰 정리', assignee: 'owner' }], [reserved('w'), started('w'), submitted('w', 'r1')]);
  const reset = (taskId: string): Seed => ({
    type: 'pm_considered', actor: { kind: 'system', id: 'pm' }, key: `resolve:retry:${taskId}:m1:reset`,
    payload: { considerationId: `resolve:retry:${taskId}:m1:reset`, triggerId: 'm1', whoseAction: 'owner', alreadyKnows: 'no', evidence: ['m1'], decision: 'silent', reason: '재시도', openTopics: [] },
  });
  const normal = await ledger([...head, blocked('w', '세션 오류로 멈춤'), reset('w'), blocked('w', '제한 시간을 넘김'), blocked('w', 'Claude AI usage limit reached|resets 5pm')]);
  const a = inboxOf(normal).stopped;
  assert.equal(a.length, 1);
  // 재시도 앞의 막힘 1회는 세지 않고, 뒤의 2회 중 인프라 사유 1회를 뺀다.
  assert.deepEqual([a[0]!.taskId, a[0]!.hasResult, a[0]!.blockCount, a[0]!.infra], ['w', true, 1, true]);
  assert.deepEqual(a[0]!.actions, ['accept', 'retry']);
  const plain = await ledger([...head, blocked('w', '세션 오류'), blocked('w', '결과를 받지 못했습니다')]);
  const b = inboxOf(plain).stopped[0]!;
  assert.deepEqual([b.blockCount, b.infra], [2, false]);
  // 결정권자가 아닌 멤버(designer)는 담당자도 아니므로 처리할 수 있는 행동이 없다.
  assert.deepEqual(inboxOf(plain, [], 'designer').stopped, []);
  // 처리할 결과가 없는 작업에는 accept가 없다.
  const noResult = await ledger([...base([{ id: 'w', title: '인터뷰 정리', assignee: 'owner' }], [reserved('w'), started('w'), blocked('w', '세션 오류')])]);
  const c = inboxOf(noResult).stopped[0]!;
  assert.deepEqual([c.hasResult, c.actions], [false, ['retry']]);
});

test('buildInbox: idle — 진행 중 작업·열린 결정·대기 계획이 없고, ready는 상한에 닿았을 때만 허용된다', async () => {
  const tasks: TaskSeed[] = [{ id: 't1', title: '조사', assignee: 'research-agent' }];
  const readyOnly = await ledger(base(tasks));
  assert.equal(inboxOf(readyOnly).idle, false, 'ready만 있고 상한 미도달이면 유휴가 아니다');
  assert.equal(inboxOf(readyOnly).automationLimitReached, false);
  const limited = await ledger(base(tasks, [{ type: 'action_limit_reached', actor: { kind: 'pm', id: 'pm' }, payload: { count: 12, limit: 12 } }]));
  assert.equal(inboxOf(limited).automationLimitReached, true);
  assert.equal(inboxOf(limited).idle, true, '상한에 닿아 ready만 남으면 유휴다');
  const running = await ledger(base(tasks, [reserved('t1'), started('t1'), { type: 'action_limit_reached', actor: { kind: 'pm', id: 'pm' }, payload: { count: 12, limit: 12 } }]));
  assert.equal(inboxOf(running).idle, false, '진행 중 작업이 있으면 유휴가 아니다');
  const done = await ledger(base(tasks, [reserved('t1'), started('t1'), submitted('t1', 'r1', 'research-agent'), { type: 'task_checked', actor: { kind: 'pm', id: 'pm' }, payload: { taskId: 't1', resultId: 'r1', reason: '충분' } }]));
  assert.equal(inboxOf(done).idle, true, '모두 끝났으면 유휴다');
  const pendingPlan = await ledger(base(tasks, [{ type: 'plan_proposed', payload: { proposalId: 'pp', version: 2, tasks: [spec({ id: 'x', title: 'x', assignee: 'owner' })], estimates: [], reason: '초안', forMemberId: 'owner' } }, reserved('t1'), started('t1'), submitted('t1', 'r1', 'research-agent'), { type: 'task_checked', actor: { kind: 'pm', id: 'pm' }, payload: { taskId: 't1', resultId: 'r1', reason: '충분' } }]));
  assert.equal(inboxOf(pendingPlan).idle, false, '대기 중인 계획이 있으면 유휴가 아니다');
  assert.equal(inboxOf(pendingPlan).pendingPlans.length, 1);
});

// ---- ruleDecide

test('ruleDecide: 계획 카드 승인, 권한 카드(goal_change·deadline_change 거절), 담당자 편집 분기 없음', () => {
  const inbox = mk({
    pendingPlans: [{ proposalId: 'p1', version: 1, taskTitles: ['a'], reason: '초안' }],
    pendingAuthority: [
      { requestId: 'c1', changeKinds: ['human_commitment'], text: '가용 시간' },
      { requestId: 'c2', changeKinds: ['goal_change'], text: '목표 변경' },
      { requestId: 'c3', changeKinds: ['human_commitment', 'deadline_change'], text: '기한 변경' },
    ],
    decisions: [decision({ kind: 'choice', requestId: 'r9', editable: ['assignee', 'title'] })],
  });
  const { actions, notes } = ruleDecide(inbox);
  assert.deepEqual(only(actions, 'approve_plan').map((a) => [a.proposalId, a.approve]), [['p1', true]]);
  assert.deepEqual(only(actions, 'answer_authority').map((a) => [a.requestId, a.approve]), [['c1', true], ['c2', false], ['c3', false]]);
  assert.equal(notes.filter((n) => n.kind === 'dissent').length, 2);
  // 어떤 행동에도 편집(edits)이 없다. editable에 assignee가 있어도 고치지 않는다.
  assert.ok(actions.every((a) => !('edits' in a)));
  assert.deepEqual(only(actions, 'answer_decision').map((a) => [a.requestId, a.answer]), [['r9', 'approve']]);
});

test('ruleDecide: missing_info는 승인 또는 기본 답, stuck_work는 처음이면 cancel·두 번째면 accept', () => {
  const answerOption = (answerText?: string) => ({ optionId: 'ans', label: '답하기', effectTypes: ['answer'], planOpTypes: [], planOpTaskIds: [], planOpTaskTitles: [], resolveActions: [], tradeoff: '', ...(answerText === undefined ? {} : { answerText }) });
  const hold = { optionId: 'hold', label: '보류', effectTypes: ['none'], planOpTypes: [], planOpTaskIds: [], planOpTaskTitles: [], resolveActions: [], tradeoff: '' };
  const noText = ruleDecide(mk({ decisions: [decision({ kind: 'missing_info', recommendation: { optionId: 'ans', rationale: '답' }, options: [answerOption(), hold] })] })).actions[0]!;
  assert.equal(noText.type, 'answer_decision');
  assert.deepEqual([(noText as Extract<ProxyAction, { type: 'answer_decision' }>).answer, Boolean((noText as { text?: string }).text?.trim())], ['answer', true]);
  const withText = ruleDecide(mk({ decisions: [decision({ kind: 'missing_info', recommendation: { optionId: 'ans', rationale: '답' }, options: [answerOption('이메일만'), hold] })] })).actions[0]!;
  assert.equal((withText as Extract<ProxyAction, { type: 'answer_decision' }>).answer, 'approve');

  const stuckOptions = [
    { optionId: 'retry', label: '다시', effectTypes: ['resolve_task'], planOpTypes: [], planOpTaskIds: [], planOpTaskTitles: [], resolveActions: ['retry'], tradeoff: '' },
    { optionId: 'accept', label: '지금 결과', effectTypes: ['resolve_task'], planOpTypes: [], planOpTaskIds: [], planOpTaskTitles: [], resolveActions: ['accept'], tradeoff: '' },
    { optionId: 'cancel', label: '취소', effectTypes: ['plan_ops'], planOpTypes: ['cancel_task'], planOpTaskIds: ['t1'], planOpTaskTitles: [], resolveActions: [], tradeoff: '' },
    hold,
  ];
  const stuck = (previous: PreviousAction[]) => ruleDecide(mk({ previous, decisions: [decision({ kind: 'stuck_work', recommendation: { optionId: 'retry', rationale: '재시도' }, options: stuckOptions })] })).actions[0] as Extract<ProxyAction, { type: 'answer_decision' }>;
  assert.deepEqual([stuck([]).answer, stuck([]).optionId], ['choose', 'cancel']);
  const again = stuck([{ cycle: 1, type: 'resolve_task', target: 't1', verb: 'retry', taskIds: ['t1'], ok: true }]);
  assert.deepEqual([again.answer, again.optionId], ['choose', 'accept']);
  // 원하는 선택지가 없으면 추천을 따른다.
  const lacking = ruleDecide(mk({ decisions: [decision({ kind: 'stuck_work', options: [stuckOptions[0]!, hold], recommendation: { optionId: 'retry', rationale: '재시도' } })] })).actions[0] as Extract<ProxyAction, { type: 'answer_decision' }>;
  assert.equal(lacking.answer, 'approve');
});

test('ruleDecide: plan_change·assignment는 이번 반복의 보드 미완료 B-id 작업을 지우는 추천만 거절한다', () => {
  const erase = (title: string, planOpTypes = ['cancel_task']) => decision({
    kind: 'plan_change', recommendation: { optionId: 'rec', rationale: '정리' },
    options: [
      { optionId: 'rec', label: '취소', effectTypes: ['plan_ops'], planOpTypes, planOpTaskIds: ['t1'], planOpTaskTitles: [title], resolveActions: [], tradeoff: '' },
      { optionId: 'hold', label: '보류', effectTypes: ['none'], planOpTypes: [], planOpTaskIds: [], planOpTaskTitles: [], resolveActions: [], tradeoff: '' },
    ],
  });
  const verb = (inbox: MemberInbox) => (ruleDecide(inbox).actions[0] as Extract<ProxyAction, { type: 'answer_decision' }>).answer;
  const backlog = [item('B-02', { boardDone: false }), item('B-03', { boardDone: true })];
  assert.equal(verb(mk({ backlog, decisions: [erase('[B-02] 액션아이템 파싱')] })), 'reject');
  assert.equal(verb(mk({ backlog, decisions: [erase('[B-02] 액션아이템 파싱', ['exclude_scope'])] })), 'reject');
  assert.equal(verb(mk({ backlog, decisions: [erase('[B-03] 이미 끝난 항목')] })), 'approve');
  assert.equal(verb(mk({ backlog, decisions: [erase('B 항목이 아닌 작업')] })), 'approve');
  assert.equal(verb(mk({ backlog, decisions: [erase('[B-02] 액션아이템 파싱', ['create_task'])] })), 'approve');
  const rejected = ruleDecide(mk({ backlog, decisions: [erase('[B-02] 액션아이템 파싱')] }));
  assert.deepEqual(rejected.notes.map((n) => [n.kind, n.gapHint]), [['dissent', 'G5']]);
  assert.equal(verb(mk({ backlog, decisions: [{ ...erase('[B-02] x'), kind: 'assignment' }] })), 'reject');
  assert.equal(verb(mk({ backlog, decisions: [{ ...erase('[B-02] x'), kind: 'choice' }] })), 'approve');
});

test('ruleDecide: 멈춘 작업 — 인프라 건너뜀, accept·retry 조건, 결정이 이미 다루는 작업은 건너뜀', () => {
  const pick = (s: InboxStopped) => ruleDecide(mk({ stopped: [s] }));
  assert.deepEqual(pick(stoppedTask({ infra: true })).actions, []);
  assert.deepEqual(pick(stoppedTask({ reason: '보완 요청이 2회를 넘어 멈춤', blockCount: 0 })).actions.map((a) => (a as { action?: string }).action), ['accept']);
  assert.deepEqual(pick(stoppedTask({ actions: ['accept', 'retry', 'recheck'], reason: '세션 오류' })).actions.map((a) => (a as { action?: string }).action), ['accept']);
  assert.deepEqual(pick(stoppedTask({ blockCount: 2 })).actions.map((a) => (a as { action?: string }).action), ['accept']);
  assert.deepEqual(pick(stoppedTask({ blockCount: 0 })).actions.map((a) => (a as { action?: string }).action), ['retry']);
  // 결과가 없으면 accept가 없고, 막힘이 2회 이상이면 retry도 하지 않는다. 노트만 남긴다.
  const stuck = pick(stoppedTask({ hasResult: false, actions: ['retry'], blockCount: 2 }));
  assert.deepEqual(stuck.actions, []);
  assert.deepEqual(stuck.notes.map((n) => n.kind), ['info']);
  const covered = ruleDecide(mk({ stopped: [stoppedTask()], decisions: [decision({ kind: 'stuck_work', taskIds: ['s1'] })] }));
  assert.deepEqual(covered.actions.map((a) => a.type), ['answer_decision']);
});

// ---- validateActions

test('validateActions: 인박스에 없는 대상, editable 밖·title/priority 밖의 edit, 답 문구가 필요한 선택지를 거절한다', () => {
  const inbox = mk({
    pendingPlans: [{ proposalId: 'p1', version: 1, taskTitles: [], reason: '' }],
    pendingAuthority: [{ requestId: 'c1', changeKinds: ['human_commitment'], text: '' }],
    decisions: [
      decision({ kind: 'plan_change', requestId: 'd1', editable: ['title', 'priority', 'assignee', 'include'] }),
      decision({ kind: 'plan_change', requestId: 'd2', editable: ['priority'] }),
      decision({
        kind: 'missing_info', requestId: 'd3', recommendation: { optionId: 'ans', rationale: '' },
        options: [
          { optionId: 'ans', label: '답하기', effectTypes: ['answer'], planOpTypes: [], planOpTaskIds: [], planOpTaskTitles: [], resolveActions: [], tradeoff: '' },
          { optionId: 'hold', label: '보류', effectTypes: ['none'], planOpTypes: [], planOpTaskIds: [], planOpTaskTitles: [], resolveActions: [], tradeoff: '' },
        ],
      }),
    ],
    stopped: [stoppedTask({ taskId: 's1' }), stoppedTask({ taskId: 's2', infra: true }), stoppedTask({ taskId: 's3', actions: ['retry'] })],
  });
  const result = validateActions([
    { type: 'approve_plan', proposalId: 'p1', approve: true, rationale: '좋음' },
    { type: 'approve_plan', proposalId: 'p1', approve: false },
    { type: 'approve_plan', proposalId: 'nope', approve: true },
    { type: 'answer_authority', requestId: 'missing', approve: true },
    { type: 'answer_authority', requestId: 'c1', approve: false },
    { type: 'answer_decision', requestId: 'zzz', answer: 'approve' },
    { type: 'answer_decision', requestId: 'd1', answer: 'edit', edits: { assignee: 'designer' } },
    { type: 'answer_decision', requestId: 'd1', answer: 'edit', edits: { include: ['t1'] } },
    { type: 'answer_decision', requestId: 'd2', answer: 'edit', edits: { title: '새 제목' } },
    { type: 'answer_decision', requestId: 'd1', answer: 'edit', edits: { title: '새 제목', priority: 'high' } },
    { type: 'answer_decision', requestId: 'd3', answer: 'approve' },
    { type: 'answer_decision', requestId: 'd3', answer: 'choose', optionId: 'ans' },
    { type: 'answer_decision', requestId: 'd3', answer: 'answer', text: '이메일만' },
    { type: 'resolve_task', taskId: 's1', action: 'recheck' },
    { type: 'resolve_task', taskId: 's2', action: 'retry' },
    { type: 'resolve_task', taskId: 's3', action: 'accept' },
    { type: 'resolve_task', taskId: 's3', action: 'retry' },
    { type: 'post_message', text: '[B-05] 필터를 만들어 주세요' },
    { type: 'post_message', text: '진행 상황 확인했습니다' },
    { type: 'unknown_thing' },
    'not an object',
  ], inbox);
  assert.deepEqual(result.actions.map((a) => `${a.type}:${(a as { requestId?: string }).requestId ?? (a as { proposalId?: string }).proposalId ?? (a as { taskId?: string }).taskId ?? ''}`), [
    'approve_plan:p1', 'answer_authority:c1', 'answer_decision:d1', 'answer_decision:d3', 'resolve_task:s3', 'post_message:',
  ]);
  const reasons = result.rejected.map((r) => r.reason);
  assert.equal(reasons.length, 15);
  assert.ok(reasons.some((r) => /대기 중인 계획 카드가 아닙니다/.test(r)));
  assert.ok(reasons.some((r) => /인박스에 없는 권한 카드/.test(r)), 'answer_authority의 requestId가 인박스에 없으면 거절');
  assert.ok(reasons.some((r) => /인박스에 없는 결정 요청/.test(r)));
  assert.ok(reasons.some((r) => /title·priority만 허용: assignee|title·priority만 허용합니다: assignee/.test(r)), 'assignee 편집은 editable에 있어도 거절');
  assert.ok(reasons.some((r) => /title·priority만 허용합니다: include/.test(r)));
  assert.ok(reasons.some((r) => /편집할 수 없는 필드입니다: title/.test(r)), 'editable 밖의 edit 거절');
  assert.ok(reasons.some((r) => /답 문구가 필요합니다/.test(r)));
  assert.ok(reasons.some((r) => /허용되지 않은 처리입니다: recheck/.test(r)));
  assert.ok(reasons.some((r) => /인프라 사유/.test(r)));
  assert.ok(reasons.some((r) => /새 작업 요청 문구/.test(r)));
  assert.ok(reasons.some((r) => /같은 패스에서 같은 대상\(p1\)/.test(r)), '같은 패스에서 같은 대상 중복 거절');
  assert.ok(reasons.some((r) => /알 수 없는 행동 유형/.test(r)));
  assert.ok(reasons.some((r) => /객체가 아닙니다/.test(r)));
  // 통과한 edit은 title·priority만 담는다.
  const edit = result.actions.find((a) => a.type === 'answer_decision' && a.answer === 'edit') as Extract<ProxyAction, { type: 'answer_decision' }>;
  assert.deepEqual(edit.edits, { title: '새 제목', priority: 'high' });
  assert.deepEqual(edit.taskIds, ['t1']);
  assert.deepEqual(validateActions('x', inbox).actions, []);
});

test('validateActions: 같은 대상에 같은 행동 2회까지, 한 패스 6개까지', () => {
  const previous: PreviousAction[] = [
    { cycle: 1, type: 'resolve_task', target: 's1', verb: 'retry', taskIds: ['s1'], ok: false },
    { cycle: 2, type: 'resolve_task', target: 's1', verb: 'retry', taskIds: ['s1'], ok: true },
  ];
  const inbox = mk({ previous, stopped: [stoppedTask({ taskId: 's1' })] });
  const retry = validateActions([{ type: 'resolve_task', taskId: 's1', action: 'retry' }], inbox);
  assert.deepEqual(retry.actions, []);
  assert.match(retry.rejected[0]!.reason, /2회 했습니다/);
  assert.equal(validateActions([{ type: 'resolve_task', taskId: 's1', action: 'accept' }], inbox).actions.length, 1, '다른 행동은 막지 않는다');
  const many = validateActions(Array.from({ length: 8 }, (_, i) => ({ type: 'post_message', text: `메시지 ${i}` })), mk());
  assert.equal(many.actions.length, 6);
  assert.equal(many.rejected.length, 2);
  assert.match(many.rejected[0]!.reason, /6개까지/);
});

test('PROXY_SCHEMA는 claude 인자 상한(6000자) 안이다', () => {
  assert.ok(JSON.stringify(PROXY_SCHEMA).length < ARG_LIMIT_CHARS);
});

// ---- classifyIntervention

test('classifyIntervention 표', () => {
  const inbox = mk({ decisions: [decision({ kind: 'plan_change', requestId: 'd1' }), decision({ kind: 'missing_info', requestId: 'm1' })] });
  const c = (action: Parameters<typeof classifyIntervention>[0]) => classifyIntervention(action, inbox);
  const row = (action: Parameters<typeof classifyIntervention>[0]) => { const r = c(action); return [r.interventionType, r.counted]; };
  assert.deepEqual(row({ type: 'approve_plan', proposalId: 'p', approve: true, rationale: '' }), ['rubber_stamp', false]);
  assert.deepEqual(row({ type: 'approve_plan', proposalId: 'p', approve: false, rationale: '' }), ['override', true]);
  assert.deepEqual(row({ type: 'answer_authority', requestId: 'a', approve: true, rationale: '' }), ['rubber_stamp', false]);
  assert.deepEqual(row({ type: 'answer_authority', requestId: 'a', approve: false, rationale: '' }), ['override', true]);
  assert.deepEqual(row({ type: 'answer_decision', requestId: 'd1', answer: 'approve', rationale: '' }), ['rubber_stamp', false]);
  assert.deepEqual(row({ type: 'answer_decision', requestId: 'd1', answer: 'choose', optionId: 'rec', rationale: '' }), ['rubber_stamp', false], '추천 choose는 승인과 같다');
  assert.deepEqual(row({ type: 'answer_decision', requestId: 'd1', answer: 'choose', optionId: 'hold', rationale: '' }), ['override', true], '추천 외 choose');
  assert.deepEqual(row({ type: 'answer_decision', requestId: 'd1', answer: 'edit', edits: { title: 'x' }, rationale: '' }), ['override', true]);
  assert.deepEqual(row({ type: 'answer_decision', requestId: 'd1', answer: 'reject', rationale: '' }), ['override', true]);
  assert.deepEqual(row({ type: 'answer_decision', requestId: 'm1', answer: 'approve', rationale: '' }), ['answer', true], 'missing_info 승인은 답이다');
  assert.deepEqual(row({ type: 'answer_decision', requestId: 'm1', answer: 'choose', optionId: 'rec', rationale: '' }), ['answer', true]);
  assert.deepEqual(row({ type: 'answer_decision', requestId: 'm1', answer: 'answer', text: '답', rationale: '' }), ['answer', true]);
  assert.deepEqual(row({ type: 'resolve_task', taskId: 't', action: 'retry', rationale: '' }), ['recover', true]);
  assert.deepEqual(row({ type: 'next_step_request', items: ['B-01'], text: 't', planVersionBefore: 1 }), ['initiate', true]);
  assert.deepEqual(row({ type: 'post_message', text: '확인', rationale: '' }), ['answer', true]);
  assert.deepEqual(row({ type: 'owner_code_redirect', taskId: 't' }), ['override', true]);
  assert.deepEqual(row({ type: 'plan_retry' }), ['override', true]);
});

// ---- 다음 단계

test('다음 단계 후보는 보드 진척만 보고 seenInSpace와 하네스 검증(verified)은 무시한다', async () => {
  const seeds = base([
    { id: 't1', title: '[B-01] 결정 줄 파싱', assignee: 'prototype-agent' },
    { id: 't2', title: '[B-02] 액션아이템 파싱', assignee: 'prototype-agent', dependsOn: ['t1'] },
  ], [
    reserved('t1'), started('t1'), submitted('t1', 'r1', 'prototype-agent'),
    { type: 'task_checked', actor: { kind: 'pm', id: 'pm' }, payload: { taskId: 't1', resultId: 'r1', reason: '충분' } },
    { type: 'space_post_recorded', payload: { postId: 'sp1', participantId: 'teammate-b', kind: 'result', text: '[B-03] 로컬에서 구현했습니다', clientPostId: 'c1', source: { tool: 'claude', workspaceRoot: '/x', via: 'space_http' } } },
  ]);
  const events = await ledger(seeds);
  const harness = await ledger([{ type: 'dogfood_backlog_progress', payload: { itemId: 'B-04', status: 'done', by: 'teammate-a', evidence: 'abc' } }]);
  const inbox = inboxOf(events, harness);
  const b = (id: string) => inbox.backlog.find((x) => x.id === id)!;
  assert.deepEqual([b('B-01').boardDone, b('B-02').onBoard, b('B-03').seenInSpace, b('B-03').onBoard], [true, true, true, false]);
  // B-01 보드 완료, B-02 보드 위 -> 남는 것은 B-03(Space에 글이 있음)과 B-04(팀원이 보드 밖에서 검증 완료)다. 결정권자는 하네스 진척을 보지 못한다.
  assert.deepEqual(nextStepCandidates(inbox).map((i) => i.id), ['B-03', 'B-04']);
  const fresh = inboxOf(await ledger(base([{ id: 't1', title: '조사', assignee: 'research-agent' }])));
  assert.deepEqual(nextStepCandidates(fresh).map((i) => i.id), ['B-01', 'B-02', 'B-03', 'B-04'], 'BACKLOG 순서');
});

test('다음 단계 문구는 FAKE_NEW_WORK에 매칭되고 항목 id를 제목 앞에 둔다', () => {
  const items = SEED_BACKLOG.slice(0, 2).map((b): InboxBacklogItem => ({ ...item(b.id), ...splitBacklogTitle(b) }));
  const one = nextStepText([items[0]!], 'pm');
  assert.ok(FAKE_NEW_WORK.test(one));
  assert.ok(FAKE_NEW_WORK.exec(one)![1]!.startsWith('[B-01] 결정 줄 파싱'));
  assert.equal(FAKE_NEW_WORK.exec(one)![1], '[B-01] 결정 줄 파싱');
  assert.match(one, /완료 조건: .*결정:/);
  assert.match(one, /작업 제목 앞에 항목 id를 붙여 주세요\.$/);
  const two = nextStepText(items, 'pm');
  assert.equal(FAKE_NEW_WORK.exec(two)![1], '[B-01] 결정 줄 파싱, [B-02] 액션아이템 파싱');
  assert.match(two, /\[B-02\] /);
  assert.ok(!/디자이너/.test(one));
  assert.match(nextStepText([items[0]!], 'designer'), /대상 레포 코드 작업이라 디자이너에게 맡겨 주세요\.$/);
  assert.deepEqual(splitBacklogTitle({ title: '키워드 검색 함수 — 결과를 돌려준다 — 대소문자 무시' }), { title: '키워드 검색 함수', acceptance: '결과를 돌려준다 — 대소문자 무시' });
  assert.deepEqual(splitBacklogTitle({ title: '조건 없는 항목' }), { title: '조건 없는 항목' });
});

/** runNextStep용 가짜 ctx. 제품은 만들지 않고 이벤트 목록과 message 호출만 흉내 낸다. */
async function nextStepCtx(events: LedgerEvent[], over: { cycle?: number; mode?: 'rule' | 'live'; assignee?: 'pm' | 'designer'; harness?: Seed[] } = {}) {
  const store = new MemoryLedgerStore();
  if (over.harness?.length) await store.append(over.harness.map((s) => ({ ...CTX, type: s.type, actor: { kind: 'system' as const, id: 'dogfood-harness' }, payload: s.payload })));
  const sent: { author: string; text: string }[] = [];
  const ctx = {
    config: { iteration: 1, mode: over.mode ?? 'rule', nextStepAssignee: over.assignee ?? 'pm' } as unknown as DogfoodConfig,
    host: { events: async () => events, runtime: { message: async (author: string, text: string) => { sent.push({ author, text }); return { accepted: true, messageId: `msg-${sent.length}` }; } } },
    ledger: {
      read: () => store.read({ projectId: 'p' }),
      record: async (type: string, payload: unknown) => { const [e] = await store.append([{ ...CTX, type, actor: { kind: 'system', id: 'dogfood-harness' }, payload }]); return e!; },
    },
    backlog: SEED_BACKLOG, goal: '목표', cycle: over.cycle ?? 1, signal: new AbortController().signal,
  } as unknown as RoleContext;
  return { ctx, sent, store };
}

test('runNextStep: 유휴일 때만 보내고, 사이클당 1회, 효과가 없으면 2사이클 기다린 뒤 다시 보내고, 3회 실패하면 멈춘다', async () => {
  const limit: Seed = { type: 'action_limit_reached', actor: { kind: 'pm', id: 'pm' }, payload: { count: 12, limit: 12 } };
  const idleEvents = await ledger(base([{ id: 't1', title: '조사', assignee: 'research-agent' }], [reserved('t1'), started('t1'), submitted('t1', 'r1', 'research-agent'), { type: 'task_checked', actor: { kind: 'pm', id: 'pm' }, payload: { taskId: 't1', resultId: 'r1', reason: '충분' } }]));
  // 진행 중 작업이 있으면 움직이지 않는다.
  const busy = await ledger(base([{ id: 't1', title: '조사', assignee: 'research-agent' }], [reserved('t1'), started('t1')]));
  const b = await nextStepCtx(busy);
  assert.equal(await runNextStep(b.ctx), 'none');
  assert.equal(b.sent.length, 0);

  const first = await nextStepCtx(idleEvents, { cycle: 1 });
  assert.equal(await runNextStep(first.ctx), 'sent');
  assert.equal(first.sent.length, 1);
  assert.equal(first.sent[0]!.author, 'owner');
  assert.ok(first.sent[0]!.text.startsWith('[B-01] 결정 줄 파싱을 만들어 주세요.'));
  const recorded = (await first.store.read({ projectId: 'p' })).filter((e) => e.type === 'dogfood_proxy_action');
  const p = recorded[0]!.payload as { interventionType: string; counted: boolean; messageId: string; ok: boolean; action: { type: string; items: string[]; planVersionBefore: number; limitRelease?: boolean } };
  assert.deepEqual([p.interventionType, p.counted, p.ok, p.messageId, p.action.type, p.action.items, p.action.planVersionBefore, p.action.limitRelease], ['initiate', true, true, 'msg-1', 'next_step_request', ['B-01'], 1, undefined]);
  // 같은 사이클에는 한 번 더 보내지 않는다.
  assert.equal(await runNextStep(first.ctx), 'none');
  assert.equal(first.sent.length, 1);
  // 효과(plan 버전 상승)가 없으면 2사이클 기다리고, 3사이클째에 다시 보낸다.
  const cycles = async (cycle: number) => { first.ctx.cycle = cycle; return runNextStep(first.ctx); };
  assert.equal(await cycles(2), 'none');
  assert.equal(await cycles(3), 'none');
  assert.equal(await cycles(4), 'sent');
  assert.equal(await cycles(7), 'sent');
  assert.equal(first.sent.length, 3);
  // 효과 없이 3번 보냈으면 그 뒤로는 보내지 않는다.
  assert.equal(await cycles(10), 'none');
  assert.equal(first.sent.length, 3);

  // 상한에 닿은 채 보내면 limitRelease가 붙는다. 후보가 없는데 상한이면 limit_stall이다.
  const limited = await ledger(base([{ id: 't1', title: '조사', assignee: 'research-agent' }], [limit]));
  const lim = await nextStepCtx(limited);
  assert.equal(await runNextStep(lim.ctx), 'sent');
  const limAction = ((await lim.store.read({ projectId: 'p' })).find((e) => e.type === 'dogfood_proxy_action')!.payload as { action: { limitRelease?: boolean } }).action;
  assert.equal(limAction.limitRelease, true);
  // 이번 반복의 항목이 모두 보드에서 끝났으면 후보가 없다. 상한이면 limit_stall, 아니면 none이다.
  const allBoard = ['B-01', 'B-02', 'B-03', 'B-04'].map((b, i) => ({ id: `b${i + 1}`, title: `[${b}] 항목`, assignee: 'prototype-agent' }));
  const doneAll = allBoard.flatMap((t): Seed[] => [reserved(t.id), started(t.id), submitted(t.id, `r-${t.id}`, 'prototype-agent'), { type: 'task_checked', actor: { kind: 'pm', id: 'pm' }, payload: { taskId: t.id, resultId: `r-${t.id}`, reason: '충분' } }]);
  const stall = await nextStepCtx(await ledger(base(allBoard, [...doneAll, limit])));
  assert.equal(await runNextStep(stall.ctx), 'limit_stall');
  const calm = await nextStepCtx(await ledger(base(allBoard, doneAll)));
  assert.equal(await runNextStep(calm.ctx), 'none', '후보가 없어도 상한이 아니면 limit_stall이 아니다');
  // live는 최대 2개, designer 모드는 담당자 문구를 덧붙인다.
  const liveCtx = await nextStepCtx(idleEvents, { mode: 'live', assignee: 'designer' });
  assert.equal(await runNextStep(liveCtx.ctx), 'sent');
  assert.match(liveCtx.sent[0]!.text, /^\[B-01\] 결정 줄 파싱, \[B-02\] 액션아이템 파싱을 만들어 주세요\./);
  assert.match(liveCtx.sent[0]!.text, /디자이너에게 맡겨 주세요\.$/);
});

// ---- 사람 결과 판정

test('judgeSubmission: 대기, 미인식, 인식, 오라우팅(결과·재검토), 처리 증거(processed·superseded)', async () => {
  const considered = (triggerId: string, key?: string, considerationId = `c-${triggerId}`): Seed => ({
    type: 'pm_considered', actor: { kind: 'system', id: 'pm' }, ...(key === undefined ? {} : { key }),
    payload: { considerationId, triggerId, whoseAction: null, alreadyKnows: 'unknown', evidence: [triggerId], decision: 'silent', reason: '조용히', openTopics: [] },
  });
  const message = (messageId: string): Seed => ({ type: 'message_recorded', actor: { kind: 'human', id: 'owner' }, payload: { messageId, authorId: 'owner', text: '결과를 올립니다', attachmentIds: [] } });
  const events = await ledger(base([
    { id: 'mine', title: '고객 인터뷰', assignee: 'owner' },
    { id: 'other', title: '다른 사람 일', assignee: 'owner' },
    { id: 'agent-task', title: '조사', assignee: 'research-agent' },
  ], [
    message('m-wait'),
    message('m-considered'), considered('m-considered'),
    message('m-processed'), considered('x', 'processed:m-processed'),
    message('m-superseded'), considered('y', undefined, 'superseded:m-superseded'),
    message('m-ok'), submitted('mine', 'result:m-ok'),
    message('m-wrong'), submitted('other', 'result:m-wrong'),
    message('m-recheck'), submitted('agent-task', 'result:m-recheck'),
  ]));
  const judge = (id: string) => judgeSubmission(events, id, 'mine');
  assert.deepEqual(judge('m-wait'), { state: 'waiting' });
  assert.deepEqual(judge('m-considered'), { state: 'unrecognized' });
  assert.deepEqual(judge('m-processed'), { state: 'unrecognized' }, 'processed:<id> 키가 처리 증거다');
  assert.deepEqual(judge('m-superseded'), { state: 'unrecognized' }, 'superseded:<id>도 처리 증거다');
  assert.deepEqual(judge('m-ok'), { state: 'recognized', resultId: 'result:m-ok' });
  assert.deepEqual(judge('m-wrong'), { state: 'misrouted', to: 'other', kind: 'result' });
  assert.deepEqual(judge('m-recheck'), { state: 'misrouted', to: 'agent-task', kind: 'recheck' });
  assert.deepEqual(judge('m-nothing'), { state: 'waiting' });
});

test('judgeSubmission: 다른 작업의 handoff_reviewed가 그 메시지를 근거로 하면 misrouted(recheck)', async () => {
  const events = await ledger(base([{ id: 'mine', title: '인터뷰', assignee: 'owner' }, { id: 'agent-task', title: '조사', assignee: 'research-agent' }], [
    { type: 'message_recorded', actor: { kind: 'human', id: 'owner' }, payload: { messageId: 'm1', authorId: 'owner', text: '파일', attachmentIds: [] } },
    { type: 'handoff_reviewed', actor: { kind: 'pm', id: 'pm' }, payload: { taskId: 'agent-task', resultId: 'result:other', verdict: 'insufficient', met: [], missing: ['x'], evidence: ['m1'] } },
  ]));
  assert.deepEqual(judgeSubmission(events, 'm1', 'mine'), { state: 'misrouted', to: 'agent-task', kind: 'recheck' });
});

// ---- 사람 몫 작업 내용

test('ruleWorkerOutput: 합성 표시가 첫 줄, 인계 조건마다 절, 보완 지적 조건이 앞, 요청 문구 없음', () => {
  const out = ruleWorkerOutput('고객 인터뷰', ['인터뷰 대상과 질문 목록', '인터뷰에서 들은 반응 요약'], ['인터뷰에서 들은 반응 요약 부족']);
  const lines = out.content.split('\n');
  assert.match(lines[0]!, /^합성 자료입니다\./);
  assert.ok(out.content.includes('### 1. 인터뷰에서 들은 반응 요약'));
  assert.ok(out.content.includes('### 2. 인터뷰 대상과 질문 목록'));
  assert.match(out.fileName, /\.md$/);
  assert.ok(!FAKE_NEW_WORK.test(out.summary));
  assert.equal(cleanSummary('결과를 만들어 주세요', 'x').includes('만들어 주세요'), false);
  assert.equal(cleanSummary('   ', '대체 문구'), '대체 문구');
});

// ---- 인프라 막힘: 대기가 끝난 뒤 retry(정책 4)

test('buildInbox: infraRetryReady는 infra이고 인프라 대기가 끝났을 때만 true', async () => {
  const head = base([{ id: 'w', title: '인터뷰 정리', assignee: 'owner' }], [reserved('w'), started('w'), submitted('w', 'r1')]);
  const events = await ledger([...head, blocked('w', 'Claude AI usage limit reached|resets 5pm')]);
  const pause = (until: string) =>
    ({ id: 'h1', seq: 1, type: 'dogfood_infra_pause', projectId: 'run', targetProductId: 'dogfood', actor: { kind: 'system', id: 'dogfood-harness' }, at: '2026-10-19T00:00:00.000Z', payload: { from: '2026-10-19T00:00:00.000Z', until, reason: 'usage limit', source: 'ensemble-agent' } }) as LedgerEvent;
  const at = (harness: LedgerEvent[], now: number) => buildInbox({ events, harness, memberId: 'owner', backlog: SEED_BACKLOG, goal: '회의록 검색 도구', cycle: 1, iteration: 1, now }).stopped[0]!;
  const until = '2026-10-19T08:00:00.000Z';
  const during = at([pause(until)], Date.parse('2026-10-19T07:00:00.000Z'));
  assert.deepEqual([during.infra, during.infraRetryReady], [true, false]);
  const after = at([pause(until)], Date.parse('2026-10-19T08:00:01.000Z'));
  assert.deepEqual([after.infra, after.infraRetryReady, after.blockCount], [true, true, 0]);
  // 일반 막힘은 infra가 아니므로 infraRetryReady도 false다.
  const plain = await ledger([...head, blocked('w', '세션 오류')]);
  assert.equal(inboxOf(plain).stopped[0]!.infraRetryReady, false);
});

test('ruleDecide·validateActions: infra 막힘은 대기 중이면 건너뛰고, 대기가 끝나면 retry', () => {
  const waiting = stoppedTask({ infra: true, infraRetryReady: false, blockCount: 0 });
  const ready = stoppedTask({ infra: true, infraRetryReady: true, blockCount: 0, hasResult: false, actions: ['retry'] });
  assert.deepEqual(ruleDecide(mk({ stopped: [waiting] })).actions, []);
  assert.deepEqual(ruleDecide(mk({ stopped: [ready] })).actions.map((a) => (a as { action?: string }).action), ['retry']);
  const act = [{ type: 'resolve_task', taskId: 's1', action: 'retry' }];
  assert.equal(validateActions(act, mk({ stopped: [waiting] })).actions.length, 0);
  assert.match(validateActions(act, mk({ stopped: [waiting] })).rejected[0]!.reason, /인프라/);
  assert.equal(validateActions(act, mk({ stopped: [ready] })).actions.length, 1);
});

test('recordProductInfraPauses: 실행 Agent의 인프라 막힘만 infra_pause로 한 번 남긴다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dogfood-infra-'));
  const dbLedger = new DogfoodLedger(join(dir, 'dogfood.db'), 'run');
  try {
    const block = (id: string, seq: number, reason: string, at = '2026-10-19T01:00:00.000Z') =>
      ({ id, seq, type: 'task_blocked', projectId: 'p', targetProductId: 'dogfood-test', actor: { kind: 'system', id: 'pm' }, at, payload: { taskId: 'w', reason } }) as LedgerEvent;
    const product = [block('b1', 1, 'Claude AI usage limit reached|resets 5pm'), block('b2', 2, '세션 오류로 멈춤'), block('b3', 3, 'Claude AI usage limit reached|resets 5pm')];
    const ctx = { ledger: dbLedger } as unknown as RoleContext;
    assert.equal(await recordProductInfraPauses(ctx, product, 0), 2);
    assert.equal(await recordProductInfraPauses(ctx, product, 0), 0, '같은 막힘은 다시 기록하지 않는다');
    assert.equal(await recordProductInfraPauses(ctx, product, 2), 0, 'afterSeq 이전은 보지 않는다');
    const pauses = (await dbLedger.read()).filter((e) => e.type === 'dogfood_infra_pause');
    assert.equal(pauses.length, 2);
    const p = pauses[0]!.payload as { source: string; from: string; until: string };
    assert.equal(p.source, 'ensemble-agent');
    assert.ok(Date.parse(p.until) > Date.parse(p.from));
  } finally {
    dbLedger.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
