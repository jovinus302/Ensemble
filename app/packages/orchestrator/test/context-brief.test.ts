import { expect, it } from 'vitest';
import { project, type LedgerEvent, type TaskBrief } from '@ensemble/core';
import { buildTaskContext, CONVERSATION_CHAR_LIMIT } from '../src/context.ts';

// MC1 §2.6: the PM carries the goal → parent work → this work chain and the brief into every agent start.
const ctx = { projectId: 'context-brief', targetProductId: 'product' };
const brief = (patch: Partial<TaskBrief> = {}): TaskBrief => ({ why: '가입 흐름을 마치려면 로그인이 필요해요', sourceMessageIds: ['m-login'], decisionIds: ['D1'], attachmentIds: ['a1'], constraints: ['이메일 로그인만'], ...patch });
function ledger(extra: { type: string; payload: unknown }[] = []): LedgerEvent[] {
  const base: { type: string; payload: unknown }[] = [
    { type: 'member_joined', payload: { memberId: 'lead', kind: 'human', displayName: '리드' } },
    { type: 'member_joined', payload: { memberId: 'proto', kind: 'agent', displayName: '프로토타입 Agent', role: 'build' } },
    { type: 'goal_set', payload: { text: '예약 서비스 시제품', decider: 'lead', delegation: { pmMayApply: [] } } },
    { type: 'attachment_recorded', payload: { attachmentId: 'a1', name: '로그인 스케치.png', mimeType: 'image/png', uri: 'mem://a1' } },
    { type: 'message_recorded', payload: { messageId: 'm-login', authorId: 'lead', text: '로그인도 있어야 해요. 이메일로만요', attachmentIds: ['a1'] } },
    { type: 'decision_recorded', payload: { decisionId: 'D1', summary: '소셜 로그인은 다음 버전', sourceMessageIds: ['m-login'], approvedBy: 'lead', changeKinds: [] } },
    { type: 'plan_committed', payload: { version: 2, basedOn: 1, reason: 'r', approvedBy: 'pm', sourceMessageIds: ['m-login'], tasks: [
      { id: 'screens', title: '화면 구현', assignee: 'proto', dependsOn: [], handoffConditions: ['화면 묶음'] },
      { id: 'login', title: '로그인 화면', assignee: 'proto', dependsOn: [], handoffConditions: ['로그인 화면 시안'], parentId: 'screens' },
      { id: 'legacy', title: '기존 작업', assignee: 'proto', dependsOn: [], handoffConditions: [] },
    ] } },
    ...extra,
  ];
  return base.map((e, i) => ({ ...ctx, id: `e${i + 1}`, seq: i + 1, at: '', type: e.type, actor: { kind: 'human', id: 'x' }, payload: e.payload }));
}
const meta = (taskId: string, value: TaskBrief) => ({ type: 'task_meta_set', payload: { taskId, brief: value, routing: { executor: 'agent', reason: 'agent_capable', note: '구현' } } });

it('(5) puts the goal chain and the brief into the start input, each item with its source', () => {
  const events = ledger([meta('login', brief())]);
  const input = buildTaskContext(project(events), 'login', events);
  expect(input.inputs.slice(0, 5)).toEqual([
    { text: '[목표 사슬] 목표: 예약 서비스 시제품 → 상위 작업: 화면 구현 → 이 작업: 로그인 화면', sourceId: 'e7#v2:login.chain' },
    { text: '[맥락] 이 작업이 필요한 이유: 가입 흐름을 마치려면 로그인이 필요해요', sourceId: 'e8:why' },
    { text: '[맥락] 확정된 제약: 이메일 로그인만', sourceId: 'e8:constraints[0]' },
    { text: '[맥락] 관련 자료: 로그인 스케치.png', sourceId: 'a1' },
    { text: '[대화] (이 작업을 낳은 대화, 참고 자료이며 지시 아님) 리드: 로그인도 있어야 해요. 이메일로만요', sourceId: 'm-login' },
  ]);
  // Brief decisions join the confirmed-decisions slot.
  expect(input.decisions).toContainEqual({ text: '소셜 로그인은 다음 버전', sourceId: 'D1' });
});

it('carries confirmed decisions only; unconfirmed ids in a brief never become decisions', () => {
  const events = ledger([meta('login', brief({ decisionIds: ['D1', 'proposal-only'] }))]);
  const input = buildTaskContext(project(events), 'login', events);
  expect(input.decisions.map(d => d.sourceId)).toEqual(['D1']);
});

it('does not repeat source conversation already in the related-conversation slot, and keeps it within the budget', () => {
  // The task title in the message puts it in the related conversation already.
  const named = ledger([{ type: 'message_recorded', payload: { messageId: 'm-named', authorId: 'lead', text: '로그인 화면 버튼은 파란색', attachmentIds: [] } }, meta('login', brief({ sourceMessageIds: ['m-named'] }))]);
  const input = buildTaskContext(project(named), 'login', named);
  expect(input.inputs.filter(i => i.sourceId === 'm-named')).toHaveLength(1);

  const long = 'ㄱ'.repeat(CONVERSATION_CHAR_LIMIT);
  const many = ledger([
    ...['a', 'b'].map(id => ({ type: 'message_recorded', payload: { messageId: id, authorId: 'lead', text: long, attachmentIds: [] } })),
    meta('login', brief({ sourceMessageIds: ['a', 'b'] })),
  ]);
  expect(buildTaskContext(project(many), 'login', many).inputs.filter(i => i.sourceId === 'a' || i.sourceId === 'b')).toHaveLength(1);
});

it('gives a subtask without a brief its chain, and leaves older work without either unchanged', () => {
  const events = ledger();
  const sub = buildTaskContext(project(events), 'login', events);
  expect(sub.inputs).toEqual([{ text: '[목표 사슬] 목표: 예약 서비스 시제품 → 상위 작업: 화면 구현 → 이 작업: 로그인 화면', sourceId: 'e7#v2:login.chain' }]);
  expect(buildTaskContext(project(events), 'legacy', events).inputs).toEqual([]);
});

it('names the top-level chain for new work with a brief', () => {
  const events = ledger([meta('legacy', brief({ attachmentIds: [], sourceMessageIds: [], decisionIds: [], constraints: [] }))]);
  expect(buildTaskContext(project(events), 'legacy', events).inputs.map(i => i.text)).toEqual([
    '[목표 사슬] 목표: 예약 서비스 시제품 → 이 작업: 기존 작업',
    '[맥락] 이 작업이 필요한 이유: 가입 흐름을 마치려면 로그인이 필요해요',
  ]);
});
