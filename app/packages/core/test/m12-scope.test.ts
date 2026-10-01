import { expect, it } from 'vitest';
import { applyOps, project, type LedgerEvent } from '../src/index.ts';

it.each([
  // QA5 Codex C4 and Opus N6 titles, plus a separator variant.
  '클릭 가능한 로컬 HTML 프로토타입 구현 (가입·오류·예약·모의결제 포함)',
  '로컬 클릭 가능 HTML 프로토타입 구현 (가입·예약·모의 결제 포함)',
  '요가 예약 프로토타입 (가입, 예약 확인, 모의 결제 포함)',
  '클릭형 HTML (가입·모의결제·오류 포함)',
])('W6 preserves the original title and removes excluded included items: %s', title => {
  const task = { id: 'prototype', title, assignee: 'agent', dependsOn: [], handoffConditions: ['모의 결제 포함', '외부 호출 없음'] };
  const [result] = applyOps([task], [{ type: 'exclude_scope', taskId: task.id, item: '결제', sourceMessageIds: ['m'] }]);
  expect(result!.baseTitle).toBe(title);
  expect(result!.title).not.toContain('모의');
  expect(result!.title).toContain('결제 제외');
  expect(result!.title).toContain('가입');
  expect(result!.handoffConditions).toEqual(task.handoffConditions);
});

it('scope metadata keeps checked evidence until explicit reopen, while substantive changes invalidate it', () => {
  const task = { id: 'prototype', title: '프로토타입', assignee: 'agent', dependsOn: [], handoffConditions: ['결제 포함'] };
  const events = [
    { type: 'plan_committed', payload: { version: 1, tasks: [task] } },
    { type: 'result_submitted', payload: { taskId: task.id, resultId: 'r', planVersion: 1 } },
    { type: 'task_checked', payload: { taskId: task.id, resultId: 'r' } },
    { type: 'plan_committed', payload: { version: 2, tasks: applyOps([task], [{ type: 'exclude_scope', taskId: task.id, item: '결제', sourceMessageIds: [] }]) } },
  ].map((e, i) => ({ ...e, seq: i + 1, actor: { kind: 'system', id: 'pm' } })) as LedgerEvent[];
  expect(project(events).tasks.get(task.id)).toMatchObject({ status: 'checked', checkedResultId: 'r', spec: { exclusions: ['결제'] } });
  const changed = structuredClone(events);
  (changed.at(-1)!.payload as { tasks: typeof task[] }).tasks[0]!.handoffConditions.push('캘린더 버튼');
  expect(project(changed).tasks.get(task.id)?.status).toBe('ready');
});
