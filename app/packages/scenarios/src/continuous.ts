import { readFileSync } from 'node:fs';
import type { ScriptedStep } from './index.ts';
import type { Condition } from './script.ts';
import { scene2, scene3 } from './scene-fixtures.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
// Synthetic human inputs only; never supply or repair PM/agent output.
const demoGoal = '시연용 가상 자료입니다. 2주 안에 소규모 제품팀을 위한 고객 인터뷰 예약 서비스 Interview Loop의 고객 반응을 확인하자. 한국의 2~5명 제품팀이 대상이고, 고객이 가입 후 가능한 시간을 골라 인터뷰를 예약하는 서비스야. 나와 디자이너는 각각 주 10시간 참여해. 조사 Agent는 Calendly, Cal.com, Google Calendar 예약 기능 등 실제 대안의 공개 자료를 조사하고 출처와 확인 한계를 보고서로 남겨줘. 나는 가상의 고객 5명 인터뷰 노트를 제출할게. 디자이너는 그 근거로 가입 정상 흐름과 오류·재입력 흐름, 시간 선택·예약 확인, 결제 모형을 포함한 화면 목록과 상호작용을 설계해줘. 최초 프로토타입 범위에는 결제 화면과 모의 결제 버튼도 포함해. 최종물은 외부 서비스 연결이나 공개 배포 없이 로컬에서 여는 클릭 가능한 HTML 파일이면 돼. 실제 개인정보 수집·실제 결제는 하지 않아.';

export const continuousSteps: ScriptedStep[] = [
  { scene: 1, as: 'owner', text: '저는 주 10시간 참여할 수 있어요.', action: 'availability', weeklyHours: 10 },
  { scene: 1, as: 'designer', text: '저도 주 10시간 참여할 수 있어요.', action: 'availability', weeklyHours: 10 },
  { scene: 1, as: 'owner', text: demoGoal, action: 'goal' },
  { scene: 1, as: 'owner', text: '이 계획으로 진행해 주세요.', action: 'approvePlan', waitFor: { kind: 'any', conditions: [{ kind: 'planApprovalPending' }, { kind: 'planVersionAtLeast', version: 1 }] } },
  { scene: 1, as: 'owner', text: '고객 인터뷰 결과를 올렸어요.', target: { assignee: 'owner' }, waitFor: { kind: 'taskOf', assignee: 'owner', status: ['ready', 'reserved', 'running', 'revising'] }, attachments: [{ name: 'interviews.txt', mimeType: 'text/plain', content: readFileSync(new URL('./fixtures/interviews.txt', import.meta.url), 'utf8') }] },
  { scene: 1, as: 'owner', text: 'PM 요청이 있으면 인터뷰 자료를 보완합니다.', action: 'respondToRevision', target: { assignee: 'owner' }, waitFor: { kind: 'taskOf', assignee: 'owner', status: ['revising', 'checked'] } },
  { ...scene2[0]!, scene: 2, target: { assignee: 'designer' }, waitFor: { kind: 'taskOf', assignee: 'designer', status: ['ready', 'reserved', 'running', 'revising'] }, attachments: [{ name: 'flow.md', mimeType: 'text/markdown', content: fixture('flow.md') }] },
  { ...scene2[1]!, action: 'respondToRevision', scene: 2, target: { assignee: 'designer' }, waitFor: { kind: 'taskOf', assignee: 'designer', status: ['revising', 'checked'] }, attachments: [{ name: 'flow-v2.md', mimeType: 'text/markdown', content: fixture('flow-v2.md') }] },
  { ...scene3[0]!, scene: 3, waitFor: { kind: 'agentTurnRunning', agentId: 'prototype-agent' } },
  ...scene3.slice(1).map(step => ({ ...step, scene: 3 as const })),
  { scene: 3, as: 'owner', action: 'clarifyScopeIfAsked', text: '프로토타입 제작 작업에서 결제 화면과 모의 결제 버튼을 이번 범위에서 제외해 주세요. 가입, 시간 선택, 예약 확인 흐름은 유지합니다.' },
];
export const continuousCompletion: Condition = { kind: 'all', conditions: [
  { kind: 'planVersionAtLeast', version: 2 },
  { kind: 'agentUpdated', agentId: 'prototype-agent', afterStep: 8 },
] };
export const continuousScenario = { key: 'scene-1-3-continuous', steps: continuousSteps, completion: continuousCompletion };
