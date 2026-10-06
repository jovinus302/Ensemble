import { DEFAULT_PM_MAY_APPLY, type AppPreviewSpec, type EventContext, type EventPayloads, type NewLedgerEvent, type PoolCandidate } from '@ensemble/core';
import { PAGES_CONTEXT_ID, PAGES_MEMBERS as M, PAGES_POOL as P } from './ids.ts';

/** Scenario clock: Friday 2026-10-02 (Asia/Seoul) — the date the Pages preview shows. */
export const PAGES_DAY = '2026-10-02';
/** "10:02" (KST) → ISO instant on the scenario day. */
export const pagesAt = (hhmm: string) => new Date(`${PAGES_DAY}T${hhmm}:00+09:00`).toISOString();
export const PAGES_NOW = new Date(pagesAt('10:00'));

export const PAGES_TEAM: EventPayloads['member_joined'][] = [
  { memberId: M.planner, kind: 'human', displayName: '김서연', role: '기획자' },
  { memberId: M.ux, kind: 'human', displayName: '박도윤', role: 'UX 디자이너' },
  { memberId: M.dev, kind: 'human', displayName: '이하준', role: '개발자' },
  { memberId: M.storyAgent, kind: 'agent', displayName: 'Story Agent', role: '생성 포맷/톤' },
  { memberId: M.uiAgent, kind: 'agent', displayName: 'UI Agent', role: '화면 가이드' },
];

/** The simulated pool. Two fit the D2 branch; two are there so the search is a real choice. */
export const PAGES_POOL_CANDIDATES: PoolCandidate[] = [
  { candidateId: P.policy, displayName: '한지우', role: '개인정보·AI 정책', expertise: ['개인정보', 'AI 정책', '공유 기준'], availability: 'available', note: '유사 과제 3건' },
  { candidateId: P.narrative, displayName: '정유나', role: '내러티브 디자이너', expertise: ['내러티브', 'fiction 수위', '숏폼·동화'], availability: 'available', note: '숏폼·동화 경험' },
  { candidateId: P.backend, displayName: '백민서', role: '백엔드 개발자', expertise: ['생성 파이프라인', '비용 최적화'], availability: 'busy', note: '다른 프로젝트 배정 중' },
  { candidateId: P.growth, displayName: '오태호', role: '그로스 마케터', expertise: ['지표', '리텐션'], availability: 'available', note: '지표 설계 경험' },
];
/** candidateId → the member that joins. */
export const PAGES_POOL_MEMBERS: Record<string, EventPayloads['member_joined']> = {
  [P.policy]: { memberId: M.policy, kind: 'human', displayName: '한지우', role: '개인정보·AI 정책', source: 'pool', candidateId: P.policy },
  [P.narrative]: { memberId: M.narrative, kind: 'human', displayName: '정유나', role: '내러티브 디자이너', source: 'pool', candidateId: P.narrative },
};

export const PAGES_TOOLS: EventPayloads['production_tool_linked'][] = [
  { toolId: 'figma', name: 'Figma', ownerMemberId: M.ux, accepts: ['screen'] },
  { toolId: 'prompt-studio', name: '프롬프트 스튜디오', ownerMemberId: M.storyAgent, accepts: ['feature', 'contribution'] },
  { toolId: 'dev-tools', name: '개발 도구', ownerMemberId: M.dev, accepts: ['feature', 'screen'] },
];

/** Initial facts only: team, decider, Work Context session, pool and linked tools. No PM output. */
export function pagesSeedEvents(context: EventContext): NewLedgerEvent[] {
  const at = PAGES_NOW.toISOString();
  const human = { kind: 'human' as const, id: M.planner }, system = { kind: 'system' as const, id: 'pages-seed' };
  return [
    ...PAGES_TEAM.map(payload => ({ ...context, actor: human, type: 'member_joined', payload, at })),
    { ...context, actor: human, type: 'goal_set', at, payload: { text: '시연용 가상 자료입니다. Pages · 모바일 App. v1', decider: M.planner, delegation: { pmMayApply: [...DEFAULT_PM_MAY_APPLY] } } },
    { ...context, actor: system, type: 'context_session_started', at, payload: { contextId: PAGES_CONTEXT_ID, code: PAGES_CONTEXT_ID, title: 'Pages · 모바일 App. v1', channelName: 'pages-general', version: '0.3' } },
    { ...context, actor: system, type: 'member_pool_listed', at, payload: { candidates: PAGES_POOL_CANDIDATES } },
    ...PAGES_TOOLS.map(payload => ({ ...context, actor: system, type: 'production_tool_linked', payload, at })),
  ];
}

const history = [{ date: '10.1', title: '회의 세 번, 커피 네 잔', format: '에세이' }, { date: '9.30', title: '한강 러닝 12초', format: '숏폼' }];
const base = {
  appName: 'Pages', dateLabel: '10월 2일 금요일', versions: ['v1.0', 'v1.1'], primaryAction: '지금 만들기', formatAction: '생성', history, tabs: ['home', '채팅', 'feed'],
};
/** B: automatic pseudonyms + fiction in three levels (Proposal v1, the S1·S2 design and build v1.0). */
export const PREVIEW_B: AppPreviewSpec = {
  ...base, activeVersion: 'v1.0', formats: ['숏폼', '동화', '노래', '에세이'],
  hero: { kicker: '오늘의 Page · 21:00 도착', format: '동화', badge: { text: 'fiction 포함', tone: 'fiction' }, title: '퇴근길, 비를 피한 고양이', meta: '3분 · 오늘의 data로 만든 이야기', sources: '걸음 8,214 · 사진 3장 · 일정 2건에서' },
};
/** A: real names and places — the predicted path the PM puts on the canvas for "A로 가면?". */
export const PREVIEW_A: AppPreviewSpec = {
  ...PREVIEW_B,
  hero: { ...PREVIEW_B.hero, badge: { text: '실명', tone: 'real' }, title: '퇴근길, 민수와 비를 피한 날' },
  notice: { text: 'feed 공유 · 검수 대기 2건', tone: 'warn' },
  annotations: [{ text: '실명 그대로 · 공유 전 검수', tone: 'warn' }, { text: '검수 대기 · 제3자 노출 위험', tone: 'warn' }],
};
/** v1.1: the "fiction 포함" label on feed cards (F5) and no song format (F2 off). */
export const PREVIEW_V11: AppPreviewSpec = {
  ...PREVIEW_B, activeVersion: 'v1.1', formats: ['숏폼', '동화', '에세이'],
  annotations: [{ text: 'fiction이 섞인 이야기예요', tone: 'info' }],
};
