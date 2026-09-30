import { readFileSync } from 'node:fs';
import type { ScriptedStep } from './index.ts';
import type { Condition } from './script.ts';
import { scene2, scene3 } from './scene-fixtures.ts';

export const continuousSteps: ScriptedStep[] = [
  { scene: 1, as: 'owner', text: '저는 주 10시간 참여할 수 있어요.', action: 'availability', weeklyHours: 10 },
  { scene: 1, as: 'designer', text: '저도 주 10시간 참여할 수 있어요.', action: 'availability', weeklyHours: 10 },
  { scene: 1, as: 'owner', text: '2주 안에 이 아이디어의 고객 반응을 확인하자. 나와 디자이너 한 명이 참여할 거야.', action: 'goal' },
  { scene: 1, as: 'owner', text: '이 계획으로 진행해 주세요.', action: 'approvePlan', waitFor: { kind: 'any', conditions: [{ kind: 'planApprovalPending' }, { kind: 'planVersionAtLeast', version: 1 }] } },
  { scene: 1, as: 'owner', text: '고객 인터뷰 결과를 올렸어요.', target: { assignee: 'owner' }, waitFor: { kind: 'taskOf', assignee: 'owner', status: 'reserved' }, attachments: [{ name: 'interviews.txt', mimeType: 'text/plain', content: readFileSync(new URL('./fixtures/interviews.txt', import.meta.url), 'utf8') }] },
  { scene: 1, as: 'owner', text: '첫 번째 선택지로 진행해 주세요.', action: 'answerIfAsked' },
  { ...scene2[0]!, scene: 2, target: { assignee: 'designer' }, waitFor: { kind: 'taskOf', assignee: 'designer', status: 'reserved' } },
  { ...scene2[1]!, scene: 2, target: { assignee: 'designer' }, waitFor: { kind: 'taskOf', assignee: 'designer', status: 'revising' } },
  { ...scene3[0]!, scene: 3, waitFor: { kind: 'agentTurnRunning', agentId: 'prototype-agent' } },
  ...scene3.slice(1).map(step => ({ ...step, scene: 3 as const })),
];
export const continuousCompletion: Condition = { kind: 'all', conditions: [
  { kind: 'planVersionAtLeast', version: 2 },
  { kind: 'agentUpdated', agentId: 'prototype-agent', afterStep: 8 },
] };
export const continuousScenario = { key: 'scene-1-3-continuous', steps: continuousSteps, completion: continuousCompletion };
