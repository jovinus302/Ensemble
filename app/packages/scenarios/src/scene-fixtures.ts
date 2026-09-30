import type { EventContext, NewLedgerEvent, TaskSpec } from '@ensemble/core';
import type { ScriptedStep } from './index.ts';

export const SCENE_NOW = new Date('2026-09-28T00:00:00Z');
export const sceneTasks: TaskSpec[] = [
  { id: 'design', title: '흐름 초안', assignee: 'designer', dependsOn: [], handoffConditions: ['가입 흐름', '오류 흐름'] },
  { id: 'prototype', title: '프로토타입', assignee: 'prototype-agent', dependsOn: ['design'], handoffConditions: ['가입', '결제'] },
  { id: 'review', title: '사용자 검토', assignee: 'reviewer', dependsOn: ['prototype'], handoffConditions: ['가입', '결제'] },
  { id: 'detail', title: '상세 설계', assignee: 'designer', dependsOn: [], handoffConditions: ['화면 상세'] },
];
export const scene1: ScriptedStep[] = [{ as: 'owner', text: '2주 안에 고객 반응을 확인하고 싶어요. 지금 합의한 계획으로 시작해 주세요.' }];
export const scene2: ScriptedStep[] = [
  { as: 'designer', text: '흐름 초안 올렸어요.', attachments: [{ name: 'flow.md', mimeType: 'text/markdown', content: '가입 흐름: 입력 → 확인' }] },
  { as: 'designer', text: '오류 흐름도 보완했어요.', attachments: [{ name: 'flow-v2.md', mimeType: 'text/markdown', content: '가입 흐름: 입력 → 확인\n오류 흐름: 오류 안내 → 재입력' }] },
];
export const scene3: ScriptedStep[] = [
  { as: 'designer', text: '목요일에 휴가라 이번 주 가용 시간이 10시간에서 5시간으로 줄어요. 상세 설계는 다음 주에 드려도 될까요?' },
  { as: 'owner', text: '그럼 프로토타입이 밀리나?' },
  { as: 'designer', text: '초안으로 먼저 가주세요. 결제 쪽은 아직 애매해서 빼면 좋겠어요.' },
  { as: 'owner', text: 'ㅇㅋ 결제는 이번엔 빼자' },
];

/** Initial facts only; no scripted PM answer or intervention timing. */
export function sceneEvents(scene: 1 | 2 | 3, context: EventContext): NewLedgerEvent[] {
  const actor = { kind: 'human' as const, id: 'owner' };
  const event = (type: string, payload: unknown): NewLedgerEvent => ({ ...context, actor, type, payload, at: SCENE_NOW.toISOString() });
  const events = [
    ...[['owner', 'human', '사용자'], ['designer', 'human', '디자이너'], ['reviewer', 'human', '검토자'], ['prototype-agent', 'agent', '프로토타입 Agent'], ['research-agent', 'agent', '조사 Agent']].map(([memberId, kind, displayName]) => event('member_joined', { memberId, kind, displayName })),
    event('goal_set', { text: '2주 안에 고객 반응 확인', deadline: '2026-10-12T00:00:00Z', decider: 'owner', delegation: { pmMayApply: ['scope_reduce', 'reorder', 'reassign_agent'] } }),
    event('plan_committed', { version: 1, basedOn: null, tasks: sceneTasks, reason: '팀이 확인한 초기 계획', approvedBy: 'owner', sourceMessageIds: [] }),
    event('availability_updated', { memberId: 'designer', weeklyHours: 10 }),
    event('availability_updated', { memberId: 'reviewer', weeklyHours: 7 }),
    ...sceneTasks.map(t => event('estimate_updated', { taskId: t.id, hours: { min: t.id === 'prototype' ? 24 : 10, max: t.id === 'prototype' ? 48 : 10 }, source: 'human' })),
  ];
  if (scene === 3) events.push(
    event('result_submitted', { taskId: 'design', resultId: 'initial-draft', planVersion: 1, summary: '가입 및 오류 흐름 초안', artifactIds: ['initial-flow.md'] }),
    event('task_checked', { taskId: 'design', resultId: 'initial-draft', reason: '가입 및 오류 흐름 확인' }),
  );
  return events;
}
