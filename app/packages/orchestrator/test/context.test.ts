import { expect, it } from 'vitest';
import { project, type LedgerEvent } from '@ensemble/core';
import type { ResultReport } from '@ensemble/agents';
import { buildTaskContext, CONVERSATION_CHAR_LIMIT, fileOwnerFor, humanizeRefs, plainAgentText, relevantDecisions, revisionCount, revisionUpdate, startNotice, summarizeForHuman, taskInputFiles } from '../src/context.ts';

const ctx = { projectId: 'context-tests', targetProductId: 'product' };
function ledger(extra: { type: string; payload: unknown; kind?: 'human' | 'agent' | 'pm' }[] = []): LedgerEvent[] {
  const base: { type: string; payload: unknown; kind?: 'human' | 'agent' | 'pm' }[] = [
    { type: 'member_joined', payload: { memberId: 'lead', kind: 'human', displayName: '리드' } },
    { type: 'member_joined', payload: { memberId: 'proto', kind: 'agent', displayName: '프로토타입 Agent' } },
    { type: 'goal_set', payload: { text: '고객 반응 확인', deadline: '2026-10-12', decider: 'lead', delegation: { pmMayApply: [] } } },
    { type: 'plan_committed', payload: { version: 1, basedOn: null, reason: 'r', approvedBy: 'lead', sourceMessageIds: [], tasks: [
      { id: 'T1', title: '조사', assignee: 'proto', dependsOn: [], handoffConditions: [] },
      { id: 'T4', title: '프로토타입', assignee: 'proto', dependsOn: ['T1'], handoffConditions: ['D1 반영'] },
      { id: 'T5', title: '사용성 테스트', assignee: 'lead', dependsOn: ['T4'], handoffConditions: [] },
    ] } },
    { type: 'decision_recorded', payload: { decisionId: 'D1', summary: '가입 이탈 우선', sourceMessageIds: [], approvedBy: 'lead', changeKinds: [] } },
    { type: 'decision_recorded', payload: { decisionId: 'D2', summary: '결제는 뺀다', sourceMessageIds: [], approvedBy: 'lead', changeKinds: ['scope_reduce'] } },
    { type: 'decision_recorded', payload: { decisionId: 'D3', summary: '워크숍은 다음 달', sourceMessageIds: [], approvedBy: 'lead', changeKinds: [] } },
    { type: 'authority_requested', payload: { requestId: 'A1', personId: 'lead', changeKinds: ['scope_add'], text: 'T4에 알림 기능 추가?' } },
    { type: 'result_submitted', payload: { taskId: 'T1', resultId: 'r-t1', planVersion: 1, summary: '인터뷰 5건', artifactIds: ['notes.md'] }, kind: 'agent' },
    { type: 'task_checked', payload: { taskId: 'T1', resultId: 'r-t1', reason: 'ok' }, kind: 'pm' },
    ...extra,
  ];
  return base.map((e, i) => ({ ...ctx, id: `e${i + 1}`, seq: i + 1, at: '', type: e.type, actor: { kind: e.kind ?? 'human', id: 'x' }, payload: e.payload }));
}
const message = (messageId: string, text: string, threadId?: string) =>
  ({ type: 'message_recorded', payload: { messageId, authorId: 'lead', text, attachmentIds: [], ...(threadId ? { threadId } : {}) } });

it('fills the six slots with source IDs and leaves out unrelated talk and unconfirmed candidates', () => {
  const events = ledger([message('m1', 'T4는 모바일 우선'), message('m2', '맞아요', 'm1'), message('m3', 'T40 일정은?'), message('m4', '점심?')]);
  const input = buildTaskContext(project(events), 'T4', events);
  expect(input).toMatchObject({
    taskId: 'T4', planVersion: 1,
    goalSummary: { text: '고객 반응 확인 (기한 2026-10-12)', sourceId: 'e3' },
    taskTitle: { text: '프로토타입', sourceId: 'e4#v1' },
    handoffConditions: [{ text: 'D1 반영', sourceId: 'e4#v1:T4.handoff[0]' }],
    decisions: [{ text: '가입 이탈 우선', sourceId: 'D1' }, { text: '결제는 뺀다', sourceId: 'D2' }],
    openQuestions: [],
  });
  expect(input.inputs).toEqual([
    { text: '선행 작업 "조사" 결과 (프로토타입 Agent 제출, PM 확인 완료) 요약: 인터뷰 5건', sourceId: 'r-t1' },
    { text: '결과 파일: notes.md (올린 사람: 프로토타입 Agent, 선행 작업: 조사) — 파일 기록을 찾지 못해 작업 폴더에 복사하지 않았습니다', sourceId: 'r-t1:notes.md' },
    { text: '[대화] 리드: T4는 모바일 우선', sourceId: 'm1' },
    { text: '[대화] 리드: 맞아요', sourceId: 'm2' },
  ]);
  expect(JSON.stringify(input)).not.toMatch(/알림 기능|워크숍|점심|T40/);
  expect(relevantDecisions(project(events), 'T1').map((d) => d.decisionId)).toEqual(['D2']);
});

it('keeps the most recent conversation within the budget and marks what it left out', () => {
  const long = (n: number) => message(`m${n}`, `T4 메모 ${n} ${'가'.repeat(CONVERSATION_CHAR_LIMIT / 3)}`);
  const events = ledger([long(1), long(2), long(3), long(4)]);
  const talk = buildTaskContext(project(events), 'T4', events).inputs.filter((item) => !item.sourceId.startsWith('r-t1'));
  expect(talk.map((item) => item.sourceId)).toEqual(['m1..m2', 'm3', 'm4']);
  expect(talk[0]!.text).toBe('(이전 대화 2건 생략)');
});

it('summarizes an agent result for people: what got done, what to do, where to look', () => {
  const report: ResultReport = { type: 'result_report', taskId: 'T4', planVersion: 1, summary: '클릭 가능한 3개 화면', files: [{ path: 'proto/index.html', description: '' }], limitations: ['태블릿 미확인'] };
  const checked = ledger([
    { type: 'result_submitted', payload: { taskId: 'T4', resultId: 'r4', planVersion: 1, summary: 's', artifactIds: ['proto/index.html'] }, kind: 'agent' },
    { type: 'task_checked', payload: { taskId: 'T4', resultId: 'r4', reason: 'ok' }, kind: 'pm' },
  ]);
  const reserved = [...checked, { ...checked.at(-1)!, id: 'e-res', seq: checked.length + 1, type: 'task_start_reserved', payload: { taskId: 'T5', specVersion: 1, trigger: 'r4' } }] as LedgerEvent[];
  expect(summarizeForHuman(project(reserved), 'T4', report)).toContain('할 일: @리드 사용성 테스트를 곧 시작합니다.');
  // QA3 N9: "예약되었습니다. 지금 시작해 주세요." said two things at once.
  expect(startNotice(project(reserved), 'T5')).toBe('@리드 사용성 테스트를 곧 시작합니다.');
  expect(summarizeForHuman(project(checked), 'T4', report)).toBe([
    '[프로토타입] 프로토타입 Agent 결과',
    '무엇이 됐나: 클릭 가능한 3개 화면',
    '할 일: @리드 사용성 테스트를 시작할 수 있습니다.',
    '확인하지 못한 점: 태블릿 미확인',
    '확인할 곳: proto/index.html',
  ].join('\n'));
  const revising = ledger([
    { type: 'result_submitted', payload: { taskId: 'T4', resultId: 'r4', planVersion: 1, summary: 's', artifactIds: [] }, kind: 'agent' },
    { type: 'revision_requested', payload: { taskId: 'T4', resultId: 'r4', missing: ['x'] }, kind: 'pm' },
  ]);
  expect(summarizeForHuman(project(revising), 'T4', { ...report, limitations: [] })).toContain('할 일: PM이 보완을 요청했습니다.');
});

/** A designer's flow attachment and a research agent's report, both checked, ahead of a prototype task. */
function handoffLedger(flow = '# 흐름\n가입 → 요금제 → 완료'): LedgerEvent[] {
  const b64 = (text: string) => Buffer.from(text).toString('base64');
  const raw: { type: string; payload: unknown; actor: [kind: 'human' | 'agent' | 'pm', id: string] }[] = [
    { type: 'member_joined', payload: { memberId: 'lead', kind: 'human', displayName: '사용자' }, actor: ['human', 'lead'] },
    { type: 'member_joined', payload: { memberId: 'designer', kind: 'human', displayName: '디자이너' }, actor: ['human', 'lead'] },
    { type: 'member_joined', payload: { memberId: 'research', kind: 'agent', displayName: '조사 Agent' }, actor: ['human', 'lead'] },
    { type: 'member_joined', payload: { memberId: 'proto', kind: 'agent', displayName: '프로토타입 Agent' }, actor: ['human', 'lead'] },
    { type: 'goal_set', payload: { text: 'PT 예약 프로토타입', decider: 'lead', delegation: { pmMayApply: [] } }, actor: ['human', 'lead'] },
    { type: 'plan_committed', payload: { version: 1, basedOn: null, reason: 'r', approvedBy: 'lead', sourceMessageIds: [], tasks: [
      { id: 'research', title: '경쟁 서비스 조사', assignee: 'research', dependsOn: [], handoffConditions: ['대안 2개 비교'] },
      { id: 'design', title: '흐름: 설계/초안', assignee: 'designer', dependsOn: [], handoffConditions: ['가입부터 요금제까지 3화면'] },
      { id: 'prototype', title: '프로토타입', assignee: 'proto', dependsOn: ['research', 'design'], handoffConditions: ['흐름 설계대로 클릭 가능'] },
    ] }, actor: ['human', 'lead'] },
    { type: 'attachment_recorded', payload: { attachmentId: 'report-md-abc123', name: 'report.md', mimeType: 'text/markdown', uri: `data:text/markdown;base64,${b64('# 조사')}`, taskId: 'research' }, actor: ['agent', 'research'] },
    { type: 'result_submitted', payload: { taskId: 'research', resultId: 'result:turn-1:0', planVersion: 1, summary: '대안 2개', artifactIds: ['report-md-abc123'] }, actor: ['agent', 'research'] },
    { type: 'task_checked', payload: { taskId: 'research', resultId: 'result:turn-1:0', reason: 'ok' }, actor: ['pm', 'pm'] },
    { type: 'attachment_recorded', payload: { attachmentId: '0aae9b7c-1111-4222-8333-444455556666', name: 'flow.md', mimeType: 'text/markdown', uri: `data:text/markdown;base64,${b64(flow)}`, taskId: 'design' }, actor: ['human', 'designer'] },
    { type: 'attachment_recorded', payload: { attachmentId: '1bbe9b7c-1111-4222-8333-444455556666', name: '../flow.md', mimeType: 'text/markdown', uri: `data:text/markdown;base64,${b64('second')}`, taskId: 'design' }, actor: ['human', 'designer'] },
    { type: 'result_submitted', payload: { taskId: 'design', resultId: 'result:m9', planVersion: 1, summary: '흐름 초안', artifactIds: ['0aae9b7c-1111-4222-8333-444455556666', '1bbe9b7c-1111-4222-8333-444455556666'] }, actor: ['human', 'designer'] },
    { type: 'task_checked', payload: { taskId: 'design', resultId: 'result:m9', reason: 'ok' }, actor: ['pm', 'pm'] },
  ];
  return raw.map((e, i) => ({ ...ctx, id: `h${i + 1}`, seq: i + 1, at: '', type: e.type, actor: { kind: e.actor[0], id: e.actor[1] }, payload: e.payload }) as LedgerEvent);
}

it('hands predecessor result files over by workspace path, original name and uploader — never by bare ID', () => {
  const events = handoffLedger();
  const input = buildTaskContext(project(events), 'prototype', events);
  expect(input.files).toEqual([
    { path: 'inputs/경쟁 서비스 조사/report.md', data: Buffer.from('# 조사').toString('base64') },
    { path: 'inputs/흐름 설계 초안/flow.md', data: Buffer.from('# 흐름\n가입 → 요금제 → 완료').toString('base64') },
    // A second file with the same name never overwrites the first, and "../" cannot leave the folder.
    { path: 'inputs/흐름 설계 초안/flow-2.md', data: Buffer.from('second').toString('base64') },
  ]);
  const text = input.inputs.map((item) => item.text).join('\n');
  expect(text).toContain('결과 파일: inputs/흐름 설계 초안/flow.md (원래 이름: flow.md, 올린 사람: 디자이너, 선행 작업: 흐름: 설계/초안)');
  expect(text).toContain('결과 파일: inputs/경쟁 서비스 조사/report.md (원래 이름: report.md, 올린 사람: 조사 Agent, 선행 작업: 경쟁 서비스 조사)');
  expect(text).toContain('선행 작업 "흐름: 설계/초안"에서 확인된 인계 조건: 가입부터 요금제까지 3화면');
  expect(JSON.stringify(input.inputs)).not.toMatch(/0aae9b7c|1bbe9b7c/);
  // Same ledger, same paths: a restart or retry copies to the same places.
  expect(taskInputFiles(project(events), events, 'prototype').map((f) => f.path)).toEqual(input.files!.map((f) => f.path));
});

it('does not copy a file over the size cap and says so in the instructions', () => {
  const events = handoffLedger('x'.repeat(2 * 1024 * 1024 + 1));
  const input = buildTaskContext(project(events), 'prototype', events);
  expect(input.files!.map((f) => f.path)).not.toContain('inputs/흐름 설계 초안/flow.md');
  expect(input.inputs.map((item) => item.text)).toContainEqual('결과 파일: flow.md (올린 사람: 디자이너, 선행 작업: 흐름: 설계/초안) — 파일이 2MB를 넘어 작업 폴더에 복사하지 않았습니다');
});

it('addresses a file question to its uploader and replaces internal IDs with file names', () => {
  const events = handoffLedger();
  const state = project(events);
  const question = '작업 폴더가 비어 있어 흐름 설계 결과 파일(0aae9b7c-1111-4222-8333-444455556666)을 확인할 수 없습니다 [출처: result:m9:0aae9b7c-1111-4222-8333-444455556666]';
  expect(fileOwnerFor(state, events, 'prototype', question)).toBe('designer');
  expect(fileOwnerFor(state, events, 'prototype', 'flow.md의 3번째 화면은 무엇인가요?')).toBe('designer');
  expect(fileOwnerFor(state, events, 'prototype', '색상은 무엇으로 할까요?')).toBeUndefined();
  expect(humanizeRefs(question, events)).toBe('작업 폴더가 비어 있어 흐름 설계 결과 파일("flow.md")을 확인할 수 없습니다');
  expect(humanizeRefs('question:prototype:1 에 답해 주세요 (9f0e1d2c-1111-4222-8333-444455556666)', events)).toBe('질문 에 답해 주세요');
});

// QA3 N9 (L2): the agent progress messages recorded in the Opus run (ledger seq 38, 126, 138).
it('drops review-verdict sentences from agent progress text and glosses labels inside other sentences', () => {
  expect(plainAgentText('바디코디·스튜디오메이트·Mindbody·ClassPass 4개 비교와, 예약 후 외부 결제를 거치는 국내 센터 사례를 확보했습니다. 문서 작성 전 검토 결과는 `SOUND`입니다. 공식 가이드의 절차와 가격 조건을 근거로 정리하겠습니다.'))
    .toBe('바디코디·스튜디오메이트·Mindbody·ClassPass 4개 비교와, 예약 후 외부 결제를 거치는 국내 센터 사례를 확보했습니다. 공식 가이드의 절차와 가격 조건을 근거로 정리하겠습니다.');
  expect(plainAgentText('HTML은 가입 → 시간 선택 → 예약 확인 → 모의 결제 순서의 4화면으로 구성하겠습니다.\n\n확정 요구사항을 그대로 구현하는 `COMMITTED CHANGE`이며, 사전 검토는 `SOUND`입니다. 더미 이름과 예약 정보는 메모리에만 둡니다.'))
    .toBe('HTML은 가입 → 시간 선택 → 예약 확인 → 모의 결제 순서의 4화면으로 구성하겠습니다.\n\n더미 이름과 예약 정보는 메모리에만 둡니다.');
  expect(plainAgentText('기존 4화면 파일은 폐기하고, 3화면으로 한정한 새 파일을 만들겠습니다. 사용자 지시에 따른 `PROPOSITION CHANGE`를 반영해 예약 확정 시 같은 화면에서 완료를 안내하겠습니다.\n'))
    .toBe('기존 4화면 파일은 폐기하고, 3화면으로 한정한 새 파일을 만들겠습니다. 사용자 지시에 따른 요구 변경을 반영해 예약 확정 시 같은 화면에서 완료를 안내하겠습니다.');
  // Plain English words are left alone; only labels marked up as labels go.
  expect(plainAgentText('npm test: 12 PASS, 0 FAIL')).toBe('npm test: 12 PASS, 0 FAIL');
  expect(plainAgentText('문서 검토: **PASS** / COMMITTED CHANGE(조사 문서).')).toBe('');
});

it('builds the revision update for an agent from the recorded request: at most three gaps and the file to fix', () => {
  const missing = ['인계 조건 "a"가 충족되지 않았습니다. A를 추가해 주세요.', '인계 조건 "b"의 근거를 결과에서 확인하지 못했습니다. 이 조건을 다루는 내용을 report-md-0123456789ab에 분명히 적어 주세요.', 'c', 'd'];
  const events = ledger([
    { type: 'task_start_reserved', payload: { taskId: 'T4', specVersion: 1, trigger: 'x' }, kind: 'pm' },
    { type: 'attachment_recorded', payload: { attachmentId: 'report-md-0123456789ab', name: 'report.md', mimeType: 'text/markdown', uri: 'data:text/markdown;base64,', taskId: 'T4' }, kind: 'agent' },
    { type: 'result_submitted', payload: { taskId: 'T4', resultId: 'r9', planVersion: 1, summary: 's', artifactIds: ['report-md-0123456789ab'] }, kind: 'agent' },
    { type: 'revision_requested', payload: { taskId: 'T4', resultId: 'r9', missing }, kind: 'pm' },
  ]);
  expect(revisionUpdate(events, 1, 'T4', 'r9')).toEqual({ updateId: 'revision:r9', fromVersion: 1, toVersion: 1, keep: [], drop: [],
    change: ['보완할 점: 인계 조건 "a"가 충족되지 않았습니다. A를 추가해 주세요.', '보완할 점: 인계 조건 "b"의 근거를 결과에서 확인하지 못했습니다. 이 조건을 다루는 내용을 "report.md"에 분명히 적어 주세요.', '보완할 점: c', '수정할 파일: report.md'],
    reason: expect.stringContaining('result_report로 다시 제출') });
  expect(revisionUpdate(events, 1, 'T4', 'other')).toBeUndefined();
  expect(revisionCount(events, 'T4')).toBe(1);
});

it('M11 T2: the agent context carries the scope cut apart from the conditions, which stay as written', () => {
  const events = ledger();
  const plan = events.find(e => e.type === 'plan_committed')!;
  const tasks = (plan.payload as { tasks: Record<string, unknown>[] }).tasks.map(t => t.id === 'T4' ? { ...t, handoffConditions: ['가입·시간 선택·예약 확인·결제 화면으로 이동 가능'], exclusions: ['결제'], limits: ['가입·시간 선택·예약 확인까지'] } : t);
  const scoped = events.map(e => e === plan ? { ...e, payload: { ...(plan.payload as object), tasks } } : e);
  const input = buildTaskContext(project(scoped), 'T4', scoped);
  expect(input.handoffConditions.map(c => c.text)).toEqual(['가입·시간 선택·예약 확인·결제 화면으로 이동 가능']);
  expect(input.exclusions).toEqual([{ text: '결제', sourceId: 'e4#v1:T4.exclusions[0]' }]);
  expect(input.limits).toEqual([{ text: '가입·시간 선택·예약 확인까지', sourceId: 'e4#v1:T4.limits[0]' }]);
  expect(buildTaskContext(project(events), 'T4', events)).not.toHaveProperty('exclusions');
});

it('M11 T1/T3: only PM revisions count toward the cap; a person\'s request or a hand-back starts it over', () => {
  const pmRevision = (resultId: string) => ({ type: 'revision_requested', payload: { taskId: 'T4', resultId, missing: ['x'] }, kind: 'pm' as const });
  const base = ledger([
    { type: 'result_submitted', payload: { taskId: 'T4', resultId: 'r1', planVersion: 1, summary: 's', artifactIds: [] }, kind: 'agent' },
    pmRevision('r1'), pmRevision('r1'), pmRevision('r1'),
  ]);
  expect(revisionCount(base, 'T4')).toBe(3);
  const asked = ledger([...base.slice(-4).map(e => ({ type: e.type, payload: e.payload, kind: e.actor.kind as 'agent' | 'pm' })),
    { type: 'revision_requested', payload: { taskId: 'T4', resultId: 'r1', missing: ['사용자 요청: 캘린더 버튼'] }, kind: 'human' }, pmRevision('r1')]);
  expect(revisionCount(asked, 'T4')).toBe(1);
  const handedBack = [...base, { ...base.at(-1)!, id: 'marker', seq: base.length + 1, type: 'pm_considered', idempotencyKey: 'resolve:retry:T4:m1', payload: {} }] as LedgerEvent[];
  expect(revisionCount(handedBack, 'T4')).toBe(0);
  // A person's request reaches the agent as that person's words, keyed by its own record.
  const update = revisionUpdate(asked.slice(0, -1), 1, 'T4', 'r1')!;
  expect(update.change[0]).toBe('사용자 요청: 캘린더 버튼');
  expect(update.updateId).toMatch(/^revision:r1:e\d+$/);
  expect(update.reason).toContain('다시 맡겼습니다');
});

it('U5: a limitation is its own line and an empty "할 일:" is never written (QA4 C6)', () => {
  const report: ResultReport = { type: 'result_report', taskId: 'T4', planVersion: 1, summary: '시연용 가상 자료', files: [{ path: 'research.md', description: '' }], limitations: ['시연용 가상 자료이며 실제 조사·고객 검증이 아닙니다.'] };
  const text = summarizeForHuman(project(ledger()), 'T4', report);
  expect(text).not.toContain('할 일:');
  expect(text).toContain('\n확인하지 못한 점: 시연용 가상 자료이며 실제 조사·고객 검증이 아닙니다.\n');
});
