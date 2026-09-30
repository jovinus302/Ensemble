import { expect, it } from 'vitest';
import { project, type LedgerEvent } from '@ensemble/core';
import type { ResultReport } from '@ensemble/agents';
import { buildTaskContext, CONVERSATION_CHAR_LIMIT, relevantDecisions, summarizeForHuman } from '../src/context.ts';

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
    { text: 'T1 "조사" 결과 요약: 인터뷰 5건', sourceId: 'r-t1' },
    { text: 'T1 결과 파일: notes.md', sourceId: 'r-t1:notes.md' },
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
  expect(summarizeForHuman(project(checked), 'T4', report)).toBe([
    '[T4 프로토타입] 프로토타입 Agent 결과',
    '무엇이 됐나: 클릭 가능한 3개 화면',
    '할 일: @리드 T5 "사용성 테스트"을(를) 시작할 수 있습니다. 확인하지 못한 점: 태블릿 미확인',
    '확인할 곳: proto/index.html',
  ].join('\n'));
  const revising = ledger([
    { type: 'result_submitted', payload: { taskId: 'T4', resultId: 'r4', planVersion: 1, summary: 's', artifactIds: [] }, kind: 'agent' },
    { type: 'revision_requested', payload: { taskId: 'T4', resultId: 'r4', missing: ['x'] }, kind: 'pm' },
  ]);
  expect(summarizeForHuman(project(revising), 'T4', { ...report, limitations: [] })).toContain('할 일: PM이 보완을 요청했습니다.');
});
