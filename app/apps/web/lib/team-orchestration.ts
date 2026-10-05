import { DEFAULT_PM_MAY_APPLY, type EventContext, type NewLedgerEvent, type ProjectState } from '@ensemble/core';
import { TEAM_ORCHESTRATION_PLAN as PLAN } from './fake-connector';

/**
 * Team-orchestration demo: a team that mixes people and agents. The PM's plan gives T-1 to a person (김상성), who works with
 * their own coding agent outside Ensemble and sends the result through `POST /api/tasks/:id/result`; once the PM checks it,
 * T-2 goes to the UX Agent on its own. The plan is fixed (no model), and the decider still approves it through the real
 * plan card, so the start notice and the handoff run the ordinary PM code.
 */
export const TEAM_SCENARIO = 'team-orchestration';
export const TEAM_PROPOSAL_ID = 'team-orchestration-plan-v1';
export const TEAM_MEMBERS = PLAN.members;

/** Where a result came from (W1 contract): `via` on the submission and on the projected result. */
export type ResultChannel = 'ide' | 'slack' | 'knox' | 'cli' | 'ensemble';
export interface ResultVia { channel: ResultChannel; agent?: string }
const CHANNEL_LABEL: Record<ResultChannel, string> = { ide: 'IDE', slack: 'Slack', knox: 'Knox', cli: 'CLI', ensemble: 'Ensemble' };

/** Reads an optional `via` from a value whose type may not carry it yet; anything malformed is treated as absent. */
export function readVia(value: unknown): ResultVia | undefined {
  const via = value && typeof value === 'object' ? (value as { via?: unknown }).via : undefined;
  if (!via || typeof via !== 'object') return undefined;
  const { channel, agent } = via as { channel?: unknown; agent?: unknown };
  if (typeof channel !== 'string' || !(channel in CHANNEL_LABEL)) return undefined;
  return { channel: channel as ResultChannel, ...(typeof agent === 'string' && agent.trim() ? { agent: agent.trim() } : {}) };
}
/** "IDE · 김상성의 Coding Agent" */
export function viaLabel(via: ResultVia): string {
  return via.agent ? `${CHANNEL_LABEL[via.channel]} · ${via.agent}` : CHANNEL_LABEL[via.channel];
}

/** The seeded project: members, the decider's goal message, and the PM's plan proposal with its notice (as `planningNotice` records it). */
export function teamOrchestrationSeed(context: EventContext): NewLedgerEvent[] {
  const pm = { kind: 'system' as const, id: 'pm' };
  const decider = PLAN.members.decider.memberId;
  const goalMessageId = `${TEAM_SCENARIO}:goal`;
  return [
    ...Object.values(PLAN.members).map((m): NewLedgerEvent => ({ ...context, actor: { kind: 'human', id: decider }, type: 'member_joined', payload: { ...m } })),
    { ...context, actor: { kind: 'human', id: decider }, type: 'goal_set', payload: { text: PLAN.goal, decider, delegation: { pmMayApply: [...DEFAULT_PM_MAY_APPLY] } } },
    // Forecasts need people's hours; agents need none.
    ...[PLAN.members.builder, PLAN.members.decider].map((m): NewLedgerEvent => ({ ...context, actor: { kind: 'human', id: m.memberId }, type: 'availability_updated', payload: { memberId: m.memberId, weeklyHours: 20 } })),
    { ...context, actor: { kind: 'human', id: decider }, type: 'message_recorded', idempotencyKey: goalMessageId, payload: { messageId: goalMessageId, authorId: decider, text: PLAN.goal, attachmentIds: [] } },
    { ...context, actor: pm, type: 'plan_proposed', payload: {
      proposalId: TEAM_PROPOSAL_ID, version: 1, forMemberId: decider, reason: PLAN.reason, sourceMessageIds: [goalMessageId],
      tasks: PLAN.tasks.map(t => ({ id: t.id, title: t.title, baseTitle: t.title, assignee: t.assignee, dependsOn: [...t.dependsOn], handoffConditions: [...t.handoffConditions], exclusions: [], limits: [] })),
      estimates: PLAN.tasks.map(t => ({ taskId: t.id, hours: { ...t.hours } })),
    } },
    { ...context, actor: pm, type: 'pm_considered', idempotencyKey: `${TEAM_PROPOSAL_ID}:considered`, payload: { considerationId: TEAM_PROPOSAL_ID, triggerId: TEAM_PROPOSAL_ID, whoseAction: decider, alreadyKnows: 'no', evidence: [TEAM_PROPOSAL_ID], decision: 'speak', reason: '계획 초안에 대한 결정권자 승인이 필요하다', openTopics: [] } },
    { ...context, actor: pm, type: 'pm_spoke', idempotencyKey: `${TEAM_PROPOSAL_ID}:speech`, payload: { considerationId: TEAM_PROPOSAL_ID, messageId: `${TEAM_PROPOSAL_ID}:speech`, text: '계획 v1 초안을 확인하고 승인해 주세요. 로그인 API는 김상성님이, 화면 검토는 UX Agent가 맡아요.', kind: 'ask' } },
  ];
}

/** The submit command a presenter runs for 김상성's coding agent (also shown in the scenario bar). */
export const SUBMIT_COMMAND = `node scripts/personal-agent-submit.mjs --task T-1 --member ${PLAN.members.builder.memberId} --pr https://github.com/example/ensemble/pull/1 --summary "로그인 API 구현"`;

/** The scenario bar for this demo: what happens next and whether the "다음" button can do it. */
export function teamScenarioStatus(state: ProjectState): { name: string; done: boolean; nextLine?: { authorName: string; text: string; hasAttachment: boolean; external?: boolean } } {
  const name = '팀 오케스트레이션';
  const t1 = state.tasks.get('T-1'), t2 = state.tasks.get('T-2');
  if (!state.plan) return { name, done: false, nextLine: { authorName: PLAN.members.decider.displayName, text: 'PM의 계획 v1을 승인합니다', hasAttachment: false } };
  if (t1 && !['submitted', 'checked'].includes(t1.status)) return { name, done: false, nextLine: { authorName: `${PLAN.members.builder.displayName}의 Coding Agent (Ensemble 밖)`, text: `터미널에서 실행: ${SUBMIT_COMMAND}`, hasAttachment: false, external: true } };
  if (t2?.status === 'checked') return { name, done: true };
  return { name, done: false, nextLine: { authorName: 'PM', text: 'T-1 결과를 확인하고 T-2를 UX Agent에게 자동으로 맡깁니다', hasAttachment: false, external: true } };
}
