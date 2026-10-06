// Pages v2.5 script: only people's lines (plus the two agent premises of scene 03). Never PM output.
import { PAGES_ITEMS as I, PAGES_IDS as X, PAGES_MEMBERS as M } from './ids.ts';

export type PagesScene = 3 | 4 | 5 | 6;

/**
 * Wait conditions over the Work Context, data only. The runtime workstream evaluates them next to the existing
 * `Condition` kinds of script.ts (`pmSpokeAfter` counts steps of `PAGES_STEPS`).
 */
export type WorkContextCondition = (
  | { kind: 'pmSpokeAfter'; stepIndex: number }
  | { kind: 'memberJoined'; memberId: string }
  | { kind: 'branchOpen'; itemId: string }
  | { kind: 'branchPreviewed'; itemId: string; optionId: string }
  | { kind: 'proposalStatus'; proposalId: string; status: 'generated' | 'confirmed' }
  | { kind: 'buildProduced'; version: string }
  | { kind: 'changeSetProposed'; changeSetId: string }
  | { kind: 'all'; conditions: WorkContextCondition[] }
) & { timeoutMs?: number };

export interface PagesLine {
  /** Golden message id (`pv25:m:<n>`); the live runtime mints its own ids. */
  messageId: string;
  as: string;
  text: string;
  /** Scenario clock (KST) in the deck, for the golden ledger and the scenario bar. */
  clock: string;
  scene: PagesScene;
}
export interface PagesStep {
  scene: PagesScene;
  /** `say`: post line `line` (agents through the scripted-agent path); `applyChange`: the decider presses 변경 적용 on the change card. */
  action: 'say' | 'applyChange';
  line?: number;
  as: string;
  /** Shown as "다음 발언" in the scenario bar. */
  text: string;
  changeSetId?: string;
  waitFor?: WorkContextCondition;
}

const line = (n: number, as: string, clock: string, scene: PagesScene, text: string): PagesLine => ({ messageId: `pv25:m:${n}`, as, text, clock, scene });
export const PAGES_LINES: PagesLine[] = [
  line(0, M.planner, '10:02', 3, '하루 동안 쌓인 내 data로 저녁 9시에 자동으로 한 편이 도착하는 게 Pages의 핵심이에요.'),
  line(1, M.ux, '10:31', 3, '자동 말고, 생성 버튼으로 내가 원할 때 만드는 게 먼저 아닌가요?'),
  line(2, M.dev, '10:40', 3, '숏폼·동화·노래·에세이 4종을 매일 다 생성하면 비용과 시간이 감당이 안 됩니다.'),
  line(3, M.storyAgent, '10:41', 3, '하루 data에 fiction을 섞어 숏폼·동화·노래·에세이 템플릿으로 생성하겠습니다.'),
  line(4, M.uiAgent, '10:44', 3, 'home · 채팅 · feed 3탭 구성을 제안합니다. (생성 버튼 위치는 미정)'),
  // Not in the deck: the decider's answer to the PM's 10:45 question, which the 11:02 summary presupposes.
  line(5, M.planner, '11:01', 4, '네, 채워 넣고 순서대로 정리해 주세요.'),
  line(6, M.planner, '11:05', 4, '몰입은 A가 좋은데, feed 공유를 생각하면 B 같기도 하고… 판단이 안 서네요.'),
  line(7, M.ux, '11:06', 4, '가명화하면 이야기 재미가 죽는지, 저도 근거가 없어요.'),
  line(8, M.dev, '11:06', 4, '어디까지 가려야 안전한지는 저희가 정할 수 있는 문제가 아닌 것 같습니다.'),
  line(9, M.policy, '11:10', 4, '합류했습니다. 실명·실제 장소가 feed로 나가면 제3자 개인정보 문제가 됩니다. A는 공유 기능과 같이 갈 수 없어요. B입니다.'),
  line(10, M.narrative, '11:11', 4, '가명화해도 이야기는 살아요. 수위를 3단계로 나누면 오히려 취향을 맞추기 좋습니다. 저도 B.'),
  line(11, M.planner, '11:12', 4, '근거가 분명하네요. B로 확정합니다.'),
  line(12, M.planner, '11:22', 4, '가만, A로 가면 어떻게 되는 거지?'),
  line(13, M.planner, '11:24', 5, 'B 유지할게요. Proposal v1 이대로 확정, 진행해줘.'),
  line(14, M.policy, '16:10', 6, 'v1.0을 써보니 feed에 올라갈 때 fiction이 섞였다는 표시가 없어요. 사실로 오해받을 수 있습니다.'),
  line(15, M.planner, '16:12', 6, "'fiction 포함' 라벨 추가하죠. 그리고 노래 포맷은 v1에서 빼요."),
  line(16, M.narrative, '16:13', 6, "라벨 문구는 'fiction이 섞인 이야기예요'로 가이드에 넣을게요."),
];

const say = (n: number, waitFor?: WorkContextCondition): PagesStep => {
  const l = PAGES_LINES[n]!;
  return { scene: l.scene, action: 'say', line: n, as: l.as, text: l.text, ...(waitFor ? { waitFor } : {}) };
};
export const PAGES_STEPS: PagesStep[] = [
  say(0), say(1), say(2), say(3), say(4),
  say(5, { kind: 'pmSpokeAfter', stepIndex: 4 }),
  say(6, { kind: 'all', conditions: [{ kind: 'pmSpokeAfter', stepIndex: 5 }, { kind: 'branchOpen', itemId: I.d2 }] }),
  say(7), say(8),
  say(9, { kind: 'memberJoined', memberId: M.policy }),
  say(10, { kind: 'memberJoined', memberId: M.narrative }),
  say(11),
  say(12, { kind: 'proposalStatus', proposalId: X.proposal, status: 'generated' }),
  say(13, { kind: 'branchPreviewed', itemId: I.d2, optionId: 'A' }),
  say(14, { kind: 'buildProduced', version: '1.0' }),
  say(15),
  { scene: 6, action: 'applyChange', as: M.planner, text: '변경 적용 · v1.1', changeSetId: X.changeSet, waitFor: { kind: 'changeSetProposed', changeSetId: X.changeSet } },
  say(16, { kind: 'pmSpokeAfter', stepIndex: 16 }),
];
/** The scenario is done when v1.1 is built. */
export const PAGES_COMPLETION: WorkContextCondition = { kind: 'buildProduced', version: '1.1' };
