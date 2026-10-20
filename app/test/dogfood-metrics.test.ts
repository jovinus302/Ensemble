import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { LedgerEvent } from '@ensemble/core';
import { computeMetrics, median, percentile } from '../dogfood/metrics.ts';
import { renderReport, writeReport } from '../dogfood/report.ts';

let seq = 0;
let clock = Date.parse('2026-10-19T00:00:00.000Z');
function ev(type: string, payload: Record<string, unknown>, o: { kind?: 'human' | 'pm' | 'system' | 'agent'; id?: string; key?: string; at?: string } = {}): LedgerEvent {
  seq += 1;
  clock += 1000;
  return {
    id: `e${seq}`, seq, type, projectId: 'p', targetProductId: 't', actor: { kind: o.kind ?? 'system', id: o.id ?? 'x' },
    at: o.at ?? new Date(clock).toISOString(), ...(o.key === undefined ? {} : { idempotencyKey: o.key }), payload,
  };
}
const pm = (type: string, payload: Record<string, unknown>, key?: string) => ev(type, payload, { kind: 'pm', id: 'pm', ...(key ? { key } : {}) });
const human = (type: string, payload: Record<string, unknown>, id = 'owner', key?: string) => ev(type, payload, { kind: 'human', id, ...(key ? { key } : {}) });
const harness = (type: string, payload: Record<string, unknown>) => ev(type, payload, { id: 'dogfood-harness' });

const spec = (id: string, title: string, o: { assignee?: string; dependsOn?: string[]; parentId?: string } = {}) => ({
  id, title, assignee: o.assignee ?? 'research-agent', dependsOn: o.dependsOn ?? [], handoffConditions: ['조건 하나'], ...(o.parentId ? { parentId: o.parentId } : {}),
});
const commit = (version: number, tasks: ReturnType<typeof spec>[], sourceMessageIds: string[] = []) =>
  pm('plan_committed', { version, basedOn: version === 1 ? null : version - 1, tasks, reason: '테스트', approvedBy: 'owner', sourceMessageIds });
const reserve = (taskId: string, trigger: string) => pm('task_start_reserved', { taskId, specVersion: 1, trigger });
const checked = (taskId: string, resultId = `r-${taskId}`) => [
  pm('result_submitted', { taskId, resultId, planVersion: 1, summary: '결과', artifactIds: [] }),
  pm('task_checked', { taskId, resultId, reason: '충족' }),
];
const origin = (taskId: string, o: Record<string, unknown>) => pm('task_meta_set', { taskId, origin: { createdBy: 'pm', planVersion: 2, sourceMessageIds: [], ...o } });
const message = (messageId: string, authorId = 'owner', attachmentIds: string[] = []) =>
  human('message_recorded', { messageId, authorId, text: '내용', attachmentIds }, authorId);
const nextStep = (messageId: string) =>
  harness('dogfood_proxy_action', { role: 'decision-proxy', memberId: 'owner', cycle: 1, action: { type: 'next_step_request', items: ['B-01'], text: '요청', planVersionBefore: 1 }, interventionType: 'initiate', counted: true, ok: true, messageId, via: 'rule', harnessNoise: false });

test('median·percentile', () => {
  assert.equal(median([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9), 9);
});

test('빈 입력이면 null이고 report는 빈 안내를 쓴다', () => {
  assert.equal(computeMetrics([], []), null);
  assert.match(renderReport(null), /기록이 없습니다/);
});

test('턴: 성공 1, turn-blocked 1, 미종료 1이면 successRate 0.5이고 infra 실패는 분모에서 빠진다', () => {
  const turn = (taskId: string, turnId: string, status: string | null) => [
    pm('task_started', { taskId, turnId }),
    pm('turn_observed', { agentId: 'research-agent', taskId, turnId, status: 'started' }),
    ...(status ? [pm('turn_observed', { agentId: 'research-agent', taskId, turnId, status })] : []),
  ];
  const product = [
    commit(1, [spec('a', '가'), spec('b', '나'), spec('c', '다'), spec('d', '라')]),
    ...turn('a', 'turn-a', 'completed'),
    ...turn('b', 'turn-b', 'completed'),
    pm('task_blocked', { taskId: 'b', reason: '결과를 받지 못했습니다' }, 'turn-blocked:turn-b'),
    ...turn('c', 'turn-c', null),
    ...turn('d', 'turn-d', 'failed'),
    pm('task_blocked', { taskId: 'd', reason: 'usage limit reached' }, 'turn-blocked:turn-d'),
    ...turn('a', 'turn-a2', 'completed'),
  ];
  const m = computeMetrics(product, [])!;
  assert.equal(m.runs.turns, 5);
  assert.equal(m.runs.succeeded, 2);
  assert.equal(m.runs.failed, 1);
  assert.equal(m.runs.infraFailed, 1);
  assert.equal(m.runs.unfinished, 1);
  assert.equal(m.runs.successRate, 2 / 3);
  assert.equal(m.runs.rerunRatio, 1 / 5);

  const three = computeMetrics(product.filter((e) => !['turn-d', 'turn-a2'].some((t) => JSON.stringify(e.payload).includes(t) || e.idempotencyKey?.includes(t))), [])!;
  assert.equal(three.runs.turns, 3);
  assert.equal(three.runs.successRate, 0.5);
});

test('턴: infra_pause 구간 안에서 시작한 실패는 infraFailed', () => {
  const product = [
    commit(1, [spec('a', '가')]),
    pm('task_started', { taskId: 'a', turnId: 'turn-a' }),
    pm('turn_observed', { agentId: 'research-agent', taskId: 'a', turnId: 'turn-a', status: 'failed' }),
  ];
  const startedAt = Date.parse(product[1]!.at);
  const pause = harness('dogfood_infra_pause', { from: new Date(startedAt - 1000).toISOString(), until: new Date(startedAt + 60_000).toISOString(), reason: 'x', source: 'decision-proxy' });
  const m = computeMetrics(product, [pause])!;
  assert.equal(m.runs.infraFailed, 1);
  assert.equal(m.runs.failed, 0);
  assert.equal(m.runs.successRate, null);
  assert.equal(m.infra.pauses, 1);
  assert.ok(m.infra.pausedMs > 0);
});

test('개입: counted·planned는 하네스 원장, ledgerHumanActs는 행위 단위 화이트리스트', () => {
  const submitted = (via: string, firstSubmission: boolean, taskId: string) =>
    harness('dogfood_human_task_submitted', { memberId: 'owner', actor: 'member-worker', taskId, cycle: 1, fileNames: [], via, httpMessageId: null, resultId: null, recognized: via === 'http', firstSubmission });
  const proxy = (interventionType: string, counted: boolean, action: Record<string, unknown> = {}, ok = true) =>
    harness('dogfood_proxy_action', { role: 'decision-proxy', memberId: 'owner', cycle: 1, action, interventionType, counted, ok, via: 'rule', harnessNoise: false });
  const h = [
    proxy('rubber_stamp', false),
    proxy('override', true, { type: 'resolve_task', taskId: 't1' }),
    proxy('override', true, {}, false),
    submitted('http', true, 't2'),
    submitted('fallback', true, 't3'),
    submitted('misrouted', false, 't4'),
    harness('dogfood_manual_integration', { by: 'teammate-a', branch: 'b', into: 'main', commit: 'c1', files: [], cycle: 1, backlogItems: [], taskIds: ['t3'] }),
    harness('dogfood_role_note', { role: 'harness', cycle: 1, kind: 'info', text: 'plan_retry: 재시도' }),
  ];
  const m = computeMetrics([commit(1, [spec('t1', '가'), spec('t2', '나')])], h)!;
  assert.equal(m.interventions.byType.rubber_stamp, 1);
  assert.equal(m.interventions.byType.override, 2, '실패한 대리 행동은 세지 않고 plan_retry 노트는 override');
  assert.equal(m.interventions.byType.human_result_fallback, 1);
  assert.equal(m.interventions.byType.human_result_misrouted, 1);
  assert.equal(m.interventions.byType.manual_merge, 1);
  assert.equal(m.interventions.counted, 5);
  assert.equal(m.interventions.planned, 2, 'rubber_stamp 1 + HTTP 첫 제출 1');
  assert.equal(m.interventions.rubberStamp, 1);
  assert.equal(m.interventions.perTask, 5 / 2);
  assert.equal(m.interventions.byTask.t1, 1);

  const goal = message('goal');
  const product = [
    human('participant_linked', { participantId: 'teammate-a' }),
    goal,
    pm('plan_proposed', { proposalId: 'pp', version: 1, tasks: [spec('t1', '가')], estimates: [], reason: '', forMemberId: 'owner', sourceMessageIds: ['goal'] }),
    message('m-attach', 'owner', ['att-1', 'att-2']),
    human('attachment_recorded', { attachmentId: 'att-1', name: 'a', mimeType: 'text/plain', uri: 'data:', taskId: 't1' }),
    human('attachment_recorded', { attachmentId: 'att-2', name: 'b', mimeType: 'text/plain', uri: 'data:', taskId: 't1' }),
    human('message_recorded', { messageId: 'decision-answer:r1', authorId: 'owner', text: '승인', attachmentIds: [] }, 'owner', 'decision-answer:r1:message'),
    message('pm-note-not-human'),
  ];
  const base = computeMetrics(product, [])!;
  assert.equal(base.interventions.ledgerHumanActs, 3, '연결 1 + 첨부 2개 메시지 1건 + 사람 메시지 1건(목표·decision-answer 제외)');
  const attachOnly = computeMetrics([goal, message('m-attach', 'owner', ['att-1', 'att-2'])], [])!;
  assert.equal(attachOnly.interventions.ledgerHumanActs, 1, '첨부 2개 메시지 1건 → 1');
  const accept = computeMetrics([
    human('task_resumed', { taskId: 't1' }, 'owner', 'resolve:accept:t1:trg:resume'),
    pm('result_submitted', { taskId: 't1', resultId: 'result:resolve:accept:t1:trg', planVersion: 1, summary: '', artifactIds: [] }, 'result:resolve:accept:t1:trg'),
    human('task_checked', { taskId: 't1', resultId: 'result:resolve:accept:t1:trg', reason: '확인' }, 'owner', 'resolve:accept:t1:trg'),
  ], [])!;
  assert.equal(accept.interventions.ledgerHumanActs, 1, 'accept 1회 → 처리 키 1건');
  const decided = computeMetrics([
    pm('plan_decided', { proposalId: 'pp', memberId: 'owner', approved: true }),
    human('decision_resolved', { requestId: 'r1', by: 'owner', outcome: 'approved' }),
    pm('decision_resolved', { requestId: 'r2', by: 'pm', outcome: 'expired' }),
    human('authority_granted', { requestId: 'a1', personId: 'owner', granted: true }),
  ], [])!;
  assert.equal(decided.interventions.ledgerHumanActs, 3);
});

test('PM 분해: 분모에 결정 요청 초안이 들어가고 비율은 1 이하', () => {
  const draft = (tempId: string) => ({ type: 'create_task', tempId, title: tempId, assignee: 'prototype-agent', handoffConditions: ['조건'], dependsOn: [], priority: 'normal', routing: {}, brief: {}, sourceMessageIds: [] });
  const request = (requestId: string, tempIds: string[], impact: string[]) => pm('decision_requested', {
    requestId, kind: 'plan_change', targetMemberId: 'owner', question: '?', options: [{ optionId: 'o1', label: '추가', effects: [{ type: 'plan_ops', ops: tempIds.map(draft) }], tradeoff: '' }, { optionId: 'o2', label: '보류', effects: [{ type: 'none' }], tradeoff: '' }],
    recommendation: { optionId: 'o1', rationale: '', evidence: [] }, impact: { taskIds: impact, blockedTaskIds: [] }, sourceMessageIds: [],
  });
  const product = [
    commit(1, [spec('p', '부모'), spec('p1', '자식1', { parentId: 'p' }), spec('p2', '자식2', { parentId: 'p' }), spec('keep', '유지'), spec('gone', '삭제')]),
    request('r1', ['d1', 'd2'], ['d1', 'p']),
    pm('decision_resolved', { requestId: 'r1', by: 'owner', outcome: 'edited' }),
    request('r2', ['d3'], ['d3']),
    pm('decision_resolved', { requestId: 'r2', by: 'owner', outcome: 'rejected' }),
    commit(2, [spec('p', '부모'), spec('p1', '자식1', { parentId: 'p' }), spec('p2', '자식2', { parentId: 'p' }), spec('keep', '유지')]),
  ];
  const m = computeMetrics(product, [
    harness('dogfood_role_note', { role: 'decision-proxy', cycle: 1, kind: 'dissent', text: '동의하지 않음' }),
    harness('dogfood_proxy_action', { role: 'decision-proxy', memberId: 'owner', cycle: 1, action: {}, interventionType: 'rubber_stamp', counted: false, ok: true, via: 'rule', harnessNoise: false }),
    harness('dogfood_proxy_action', { role: 'decision-proxy', memberId: 'owner', cycle: 1, action: {}, interventionType: 'rubber_stamp', counted: false, ok: true, via: 'rule', harnessNoise: false }),
  ])!;
  const d = m.pmDecomposition;
  // 분모: p1 p2 keep gone d1 d2 d3 (부모 p 제외)
  assert.equal(d.drafted, 7);
  // 분자: gone(취소), d1(edited), d3(rejected 초안). p는 부모라 제외
  assert.equal(d.corrected, 3);
  assert.deepEqual(d.byReason, { cancelled: 1, edited: 1, rejected_draft: 1 });
  assert.ok(d.rate! <= 1);
  assert.equal(d.rate, 3 / 7);
  assert.equal(d.proxyAgreement, 0.5);
});

test('고리: next_step 직접 → proxy, next_step 근거의 결정 요청 → proxy, 근거 없는 결정 요청 → pm, 형제 예약은 sequenced', () => {
  const request = (requestId: string, sources: string[]) => pm('decision_requested', {
    requestId, kind: 'plan_change', targetMemberId: 'owner', question: '?', options: [], recommendation: { optionId: 'o1', rationale: '', evidence: [] },
    impact: { taskIds: [], blockedTaskIds: [] }, sourceMessageIds: sources,
  });
  const product = [
    message('goal'),
    commit(1, [spec('a', '가'), spec('b', '나'), spec('c', '다', { dependsOn: ['a'] })]),
    reserve('a', 'plan-1'),
    reserve('b', 'plan-1'),
    ...checked('a'),
    reserve('c', 'r-a'),
    ...checked('b'),
    // (i) next_step 메시지로 직접 생긴 v2
    message('ns1'),
    commit(2, [spec('a', '가'), spec('b', '나'), spec('c', '다', { dependsOn: ['a'] }), spec('v2a', '[B-01] 새 작업', { dependsOn: ['b'] })], ['ns1']),
    origin('v2a', { sourceMessageIds: ['ns1'] }),
    reserve('v2a', 'r-b'),
    // (ii) next_step을 근거로 한 결정 요청을 거쳐 생긴 v2
    message('ns2'),
    request('r1', ['ns2']),
    human('message_recorded', { messageId: 'decision-answer:r1', authorId: 'owner', text: '승인', attachmentIds: [] }, 'owner', 'decision-answer:r1:message'),
    commit(3, [spec('a', '가'), spec('b', '나'), spec('c', '다', { dependsOn: ['a'] }), spec('v2a', '[B-01] 새 작업', { dependsOn: ['b'] }), spec('v3a', '[B-02] 요청 경유')], ['decision-answer:r1']),
    origin('v3a', { createdBy: 'owner', sourceMessageIds: ['decision-answer:r1'], decisionRequestId: 'r1' }),
    // (iii) 근거 메시지가 없는 PM 결정 요청을 거쳐 생긴 v2
    request('r2', []),
    commit(4, [spec('a', '가'), spec('b', '나'), spec('c', '다', { dependsOn: ['a'] }), spec('v2a', '[B-01] 새 작업', { dependsOn: ['b'] }), spec('v3a', '[B-02] 요청 경유'), spec('v4a', '[B-04] PM 스스로')], ['decision-answer:r2']),
    origin('v4a', { createdBy: 'owner', sourceMessageIds: ['decision-answer:r2'], decisionRequestId: 'r2' }),
    // 디자이너 근거
    message('dz', 'designer'),
    commit(5, [spec('a', '가'), spec('b', '나'), spec('c', '다', { dependsOn: ['a'] }), spec('v2a', '[B-01] 새 작업', { dependsOn: ['b'] }), spec('v3a', '[B-02] 요청 경유'), spec('v4a', '[B-04] PM 스스로'), spec('v5a', '디자이너 요청')], ['dz']),
    origin('v5a', { createdBy: 'designer', sourceMessageIds: ['dz'] }),
    commit(6, [spec('a', '가'), spec('b', '나'), spec('c', '다', { dependsOn: ['a'] }), spec('v2a', '[B-01] 새 작업', { dependsOn: ['b'] }), spec('v3a', '[B-02] 요청 경유'), spec('v4a', '[B-04] PM 스스로'), spec('v5a', '디자이너 요청'), spec('v6a', '근거 없음')]),
  ];
  const h = [nextStep('ns1'), nextStep('ns2')];
  const m = computeMetrics(product, h)!;
  const c = m.coordination;
  const by = (id: string) => c.loops.find((l) => l.taskId === id)!.initiator;
  assert.equal(by('v2a'), 'proxy');
  assert.equal(by('v3a'), 'proxy');
  assert.equal(by('v4a'), 'pm');
  assert.equal(by('v5a'), 'teammate');
  assert.equal(by('v6a'), 'unknown', 'origin이 없으면 unknown');
  assert.equal(c.beyondPlan, 5);
  assert.deepEqual(c.byInitiator, { proxy: 2, pm: 1, teammate: 1, unknown: 1 });
  assert.equal(c.beyondPlanByPm, 1);
  assert.equal(c.pmLoopRatio, 1 / 5);
  // c는 a의 후속(dependsOn a, trigger r-a) → inPlan. v2a는 beyond_plan 작업이라 제외 → sequenced. a·b는 plan 트리거 → sequenced.
  assert.equal(c.inPlan, 1);
  assert.equal(c.sequenced, 3);
  assert.ok(c.medianLoopLatencyMs !== null);
});

test('고리: 의존 없는 형제 작업 예약은 sequenced', () => {
  const product = [
    commit(1, [spec('a', '가'), spec('b', '나'), spec('s', '형제')]),
    reserve('a', 'x'),
    ...checked('a'),
    reserve('s', 'r-a'),
    reserve('b', 'r-a'),
  ];
  const c = computeMetrics(product, [])!.coordination;
  assert.equal(c.inPlan, 0);
  assert.equal(c.sequenced, 3);
  assert.equal(c.beyondPlan, 0);
  assert.equal(c.pmLoopRatio, null);
});

test('고리: 상한 도달 시점의 ready 작업 수', () => {
  const product = [
    commit(1, [spec('a', '가'), spec('b', '나')]),
    pm('action_limit_reached', { count: 12, limit: 12 }),
  ];
  assert.equal(computeMetrics(product, [])!.coordination.withheldReadyAtLimit, 2);
  assert.equal(computeMetrics([commit(1, [spec('a', '가')])], [])!.coordination.withheldReadyAtLimit, null);
});

test('중복: planted가 realized이고 같은 B-id에 후보가 있어도 total 1, selfRework는 따로 센다', () => {
  const run = harness('dogfood_run_started', { runId: 'r', iteration: 1, mode: 'rule', plantedSolo: ['B-03'], backlogIds: ['B-01', 'B-03'], productDirty: false, adapters: { pathPrepend: false, pmSchemaRef: false } });
  const session = (teammate: string, cycle: number, items: string[], commits = 1) =>
    harness('dogfood_teammate_session', { teammate, cycle, jobs: [], readyToMerge: true, backlogItems: items, commits: Array.from({ length: commits }, (_, i) => `c${i}`) });
  const product = [
    commit(1, [spec('t-b03', '[B-03] 결정 줄', { assignee: 'designer' }), spec('t-b01a', '[B-01] 파싱', { assignee: 'designer' }), spec('t-b01b', '[B-01] 파싱 다시', { assignee: 'designer' })]),
    reserve('t-b03', 'x'),
    reserve('t-b01a', 'x'),
    reserve('t-b01b', 'x'),
    ...checked('t-b01a'),
    ...checked('t-b01b'),
  ];
  const h = [
    run,
    session('teammate-b', 1, ['B-03']),
    session('teammate-a', 2, ['B-01']),
    harness('dogfood_overlap_candidate', { key: 'overlap:B-03:designer+teammate-b', backlogId: 'B-03', kind: 'overlap', units: [], cycle: 2 }),
    harness('dogfood_friction_recorded', { key: 'agent:dup:overlap:B-03:designer+teammate-b', recordedBy: 'agent', category: 'duplicate', gap: 'G10', severity: 'high', harnessNoise: false, summary: '중복', evidence: ['x'], cycle: 2, confirmsCandidate: 'overlap:B-03:designer+teammate-b' }),
  ];
  const m = computeMetrics(product, h)!;
  assert.deepEqual(m.duplicates.planted, { items: 1, realized: 1, avoided: 0, realizedIds: ['B-03'] });
  assert.equal(m.duplicates.natural.confirmed, 0);
  assert.equal(m.duplicates.total, 1);
  // B-01: designer 보드 작업 2개가 checked로 같은 행위자 재구현 1건. teammate-a 세션은 B-01을 일감 없이 해서 overlap 후보도 생긴다.
  assert.equal(m.duplicates.selfRework.candidates, 1);
  assert.equal(m.duplicates.natural.candidates, 0, 'designer와 teammate-a는 같은 사람이라 겹침이 아니다');
});

test('중복: 자연 발생 후보는 기록자가 확인한 것만 센다. 취소된 보드 작업이면 planted는 avoided', () => {
  const run = harness('dogfood_run_started', { runId: 'r', iteration: 1, mode: 'rule', plantedSolo: ['B-03'], backlogIds: [], productDirty: false });
  const session = harness('dogfood_teammate_session', { teammate: 'teammate-b', cycle: 1, jobs: [], readyToMerge: true, backlogItems: ['B-03', 'B-04'], commits: ['c'] });
  const product = [
    commit(1, [spec('t3', '[B-03] 결정 줄'), spec('t4', '[B-04] 검색', { assignee: 'owner' })]),
    reserve('t3', 'x'),
    reserve('t4', 'x'),
    commit(2, [spec('t4', '[B-04] 검색', { assignee: 'owner' })]),
  ];
  const confirm = harness('dogfood_friction_recorded', { key: 'agent:dup:overlap:B-04:owner+teammate-b', recordedBy: 'agent', category: 'duplicate', gap: 'G10', severity: 'high', harnessNoise: false, summary: '중복', evidence: ['x'], cycle: 1, confirmsCandidate: 'overlap:B-04:owner+teammate-b' });
  const before = computeMetrics(product, [run, session])!;
  assert.equal(before.duplicates.planted.realized, 0, '취소된 보드 작업은 realized가 아니다');
  assert.equal(before.duplicates.planted.avoided, 1);
  assert.equal(before.duplicates.natural.candidates, 1);
  assert.equal(before.duplicates.natural.confirmed, 0);
  assert.equal(before.duplicates.total, 0);
  const after = computeMetrics(product, [run, session, confirm])!;
  assert.equal(after.duplicates.natural.confirmed, 1);
  assert.equal(after.duplicates.total, 1);
});

test('통합: verifiedDone과 boardOnly 분리, checkedButRed, passRate', () => {
  const run = harness('dogfood_run_started', { runId: 'r', iteration: 1, mode: 'rule', plantedSolo: [], backlogIds: ['B-01', 'B-02', 'B-04'], productDirty: false });
  const product = [
    commit(1, [spec('t1', '[B-01] 가'), spec('t2', '[B-02] 나'), spec('t9', '[B-09] 이번 반복 아님')]),
    ...checked('t1'),
    ...checked('t2'),
    ...checked('t9'),
  ];
  const h = [
    run,
    harness('dogfood_backlog_progress', { itemId: 'B-01', status: 'done', by: 'teammate-a', evidence: 'c1' }),
    harness('dogfood_manual_integration', { by: 'teammate-a', branch: 'b', into: 'main', commit: 'c1', files: [], cycle: 1, backlogItems: ['B-01'], taskIds: ['t1'] }),
    harness('dogfood_manual_integration', { by: 'teammate-a', branch: 'b', into: 'main', commit: 'c2', files: [], cycle: 2, backlogItems: ['B-02'], taskIds: ['t2'], conflicts: ['x.md'] }),
    harness('dogfood_integration_test', { commit: 'c1', passed: true }),
    harness('dogfood_integration_test', { commit: 'c2', passed: false }),
  ];
  const g = computeMetrics(product, h)!.integration;
  assert.equal(g.verifiedDone, 1);
  assert.equal(g.boardDone, 2, '이번 반복 B-id만');
  assert.equal(g.boardOnly, 1);
  assert.deepEqual(g.boardOnlyIds, ['B-02']);
  assert.equal(g.merges, 1);
  assert.equal(g.conflicts, 1);
  assert.equal(g.tests, 2);
  assert.equal(g.passRate, 0.5);
  assert.equal(g.checkedButRed, 1);
});

test('개입: 팀원 연결 확인(teammate_linked)은 planned와 byType.link_confirm에 들고 counted에는 들지 않는다', () => {
  const h = [
    harness('dogfood_setup_step', { step: 'target_ready', head: 'h', source: 's' }),
    harness('dogfood_setup_step', { step: 'teammate_linked', participantId: 'teammate-a' }),
    harness('dogfood_setup_step', { step: 'teammate_linked', participantId: 'teammate-b' }),
  ];
  const m = computeMetrics([commit(1, [spec('t1', '가')])], h)!;
  assert.equal(m.interventions.planned, 2);
  assert.equal(m.interventions.byType.link_confirm, 2);
  assert.equal(m.interventions.counted, 0);
  assert.equal(m.interventions.harnessHumanActs, 2);
});

test('현황 파악: 실행 실패(failed) 프로브는 정확도·시간에서 빼고 failedProbes로 센다', () => {
  const probe = (cycle: number, correct: number, total: number, durationMs: number, extra: Record<string, unknown> = {}) =>
    harness('dogfood_status_probe', { cycle, via: 'live', durationMs, numTurns: null, correct, total, perQuestion: [], questions: [], answers: [], ...extra });
  const m = computeMetrics([], [probe(1, 2, 2, 1000), probe(2, 0, 2, 9000, { failed: true, error: '프로브 실패' })])!;
  assert.equal(m.statusLookup.probes, 1);
  assert.equal(m.statusLookup.failedProbes, 1);
  assert.equal(m.statusLookup.accuracy, 1);
  assert.equal(m.statusLookup.medianMs, 1000);
});

test('비용: 출처별 raw·weighted와 ensemble-agent 0건이면 측정 불가', () => {
  const usage = (source: string, role: string, i: number, o: number, read: number | null, create: number | null, extra: Record<string, unknown> = {}) =>
    harness('dogfood_usage_recorded', { source, role, inputTokens: i, outputTokens: o, cacheReadTokens: read, cacheCreationTokens: create, costUsd: null, ...extra });
  const h = [
    usage('pm', 'ensemble-pm', 1000, 100, null, null),
    usage('harness', 'decision-proxy', 1000, 100, 800, 100, { costUsd: 0.25 }),
    usage('harness', 'status-probe', 500, 50, 0, 0, { costUsd: 0.25 }),
  ];
  const m = computeMetrics([], h)!;
  assert.equal(m.cost.bySource.pm.weighted, 1100);
  assert.equal(m.cost.bySource.harness.raw, 1650);
  // decision-proxy: (1000-800-100)+100+80+125 = 405, status-probe: 500+50 = 550
  assert.equal(m.cost.bySource.harness.weighted, 955);
  assert.equal(m.cost.productWeighted, 1100);
  assert.equal(m.cost.totalWeighted, 2055);
  assert.equal(m.cost.costUsd, 0.5);
  assert.equal(m.statusLookup.tokens.weighted, 550);
  assert.equal(m.cost.agentTokensMeasured, false);
  assert.equal(m.cost.turnTokens, null);
});

test('비용: 턴 구간에 든 같은 agentId usage의 합과 리드타임', () => {
  const t0 = Date.parse('2026-10-19T01:00:00.000Z');
  const at = (sec: number) => new Date(t0 + sec * 1000).toISOString();
  const product = [
    commit(1, [spec('a', '가')]),
    ev('task_start_reserved', { taskId: 'a', specVersion: 1, trigger: 'x' }, { kind: 'pm', at: at(0) }),
    ev('task_started', { taskId: 'a', turnId: 'turn-a' }, { kind: 'pm', at: at(1) }),
    ev('turn_observed', { agentId: 'research-agent', taskId: 'a', turnId: 'turn-a', status: 'started' }, { kind: 'pm', at: at(1) }),
    ev('turn_observed', { agentId: 'research-agent', taskId: 'a', turnId: 'turn-a', status: 'completed' }, { kind: 'pm', at: at(11) }),
    ev('result_submitted', { taskId: 'a', resultId: 'r-a', planVersion: 1, summary: '', artifactIds: [] }, { kind: 'pm', at: at(12) }),
    ev('task_checked', { taskId: 'a', resultId: 'r-a', reason: '' }, { kind: 'pm', at: at(20) }),
  ];
  const usage = (sec: number, agentId: string) => ev('dogfood_usage_recorded', { source: 'ensemble-agent', role: 'ensemble-agent', agentId, inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: null }, { at: at(sec) });
  const m = computeMetrics(product, [usage(5, 'research-agent'), usage(6, 'research-agent'), usage(5, 'prototype-agent'), usage(30, 'research-agent')])!;
  assert.equal(m.cost.agentTokensMeasured, true);
  assert.equal(m.cost.turnRuns, 1);
  assert.equal(m.cost.medianTurnMs, 10_000);
  assert.deepEqual(m.cost.turnTokens, { median: 220, total: 220 });
  assert.deepEqual(m.cost.leadTimeMs, { median: 20_000, p90: 20_000, count: 1 });
});

test('마찰: 병합된 규칙 마찰과 잡음은 점수에서 빠진다', () => {
  const rule = (key: string, gap: string, severity: string, harnessNoise = false) =>
    harness('dogfood_friction_recorded', { key, recordedBy: 'rule', rule: key.split(':')[0], category: 'tooling', gap, severity, harnessNoise, summary: key, evidence: [], cycle: 1 });
  const h = [
    rule('R3:1', 'G4', 'high'),
    rule('R1:2', 'G7', 'medium'),
    rule('R7:3', 'UNMAPPED', 'low', true),
    harness('dogfood_friction_recorded', { key: 'agent:1:x', recordedBy: 'agent', category: 'handoff', gap: 'G4', severity: 'high', harnessNoise: false, summary: '대신함', evidence: ['e1'], cycle: 1, mergesKeys: ['R3:1'] }),
  ];
  const f = computeMetrics([], h)!.frictions;
  assert.equal(f.total, 3);
  assert.equal(f.noise, 1);
  assert.deepEqual(f.byGap, { G7: { count: 1, score: 2 }, G4: { count: 1, score: 3 } });
});

test('report.md: 절 1~10, 경고, compare 열, writeReport', async () => {
  const run = harness('dogfood_run_started', { runId: 'run-a', iteration: 1, mode: 'rule', plantedSolo: ['B-03'], backlogIds: ['B-01'], productDirty: true, ensembleCommit: 'abc123', adapters: { pathPrepend: true, pmSchemaRef: true } });
  const h = [
    run,
    harness('dogfood_backlog_progress', { itemId: 'B-09', status: 'done', by: 'x', evidence: 'c' }),
    harness('dogfood_run_stopped', { reason: 'stalled', cycle: 3, detail: 'board_only' }),
    harness('dogfood_friction_recorded', { key: 'R3:1', recordedBy: 'rule', rule: 'R3', category: 'tooling', gap: 'G4', severity: 'high', harnessNoise: false, summary: '대체 제출', evidence: [], cycle: 1 }),
  ];
  const product = [commit(1, [spec('t1', '[B-01] 가')]), ...checked('t1')];
  const m = computeMetrics(product, h)!;
  const other = computeMetrics(product, [harness('dogfood_run_started', { runId: 'run-b', iteration: 2, plantedSolo: [], backlogIds: [] })])!;
  const text = renderReport(m, other);
  for (let n = 1; n <= 10; n++) assert.match(text, new RegExp(`^## ${n}\\. `, 'm'), `절 ${n}`);
  assert.match(text, /stalled \(board_only\)/);
  assert.match(text, /productDirty/);
  assert.match(text, /기준선 차이: PM 스키마 \$ref 압축/);
  assert.match(text, /boardOnly|보드에서만 끝난 항목 1개/);
  assert.match(text, /비교\(run-b\)/);
  assert.match(text, /측정 불가/);
  assert.match(text, /재개를 지원하지 않는다/);

  const dir = mkdtempSync(join(tmpdir(), 'dogfood-report-'));
  try {
    const layout = { report: join(dir, 'report.md'), metrics: join(dir, 'metrics.json') };
    const written = await writeReport(layout, { product, harness: h });
    assert.equal(readFileSync(layout.report, 'utf8'), written.report);
    const json = JSON.parse(readFileSync(layout.metrics, 'utf8')) as { workflow: { planCommitted: boolean }; integration: { verifiedDone: number } };
    assert.equal(json.workflow.planCommitted, true);
    assert.equal(json.integration.verifiedDone, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
