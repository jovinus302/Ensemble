// The golden ledger: every record the Pages v2.5 scenario should leave when the fake PM runs it
// (ENSEMBLE_PM_RUNTIME=fake). UI workstreams render its checkpoints before the runtime exists; the runtime
// workstream's acceptance test compares its projected Work Context with this one. Ids come from ids.ts.
import type { Actor, ContextCard, ContextEdge, ContextItem, EventContext, EventPayloads, NewLedgerEvent } from '@ensemble/core';
import { PAGES_IDS as X, PAGES_ITEMS as I, PAGES_MEMBERS as M, PAGES_POOL as P, type PagesCheckpoint } from './ids.ts';
import { PAGES_POOL_MEMBERS, PREVIEW_A, PREVIEW_B, PREVIEW_V11, pagesAt, pagesSeedEvents } from './fixtures.ts';
import { PAGES_LINES } from './lines.ts';

type Payload<K extends keyof EventPayloads> = EventPayloads[K];
const pm: Actor = { kind: 'pm', id: 'pm' }, tools: Actor = { kind: 'system', id: 'tools' }, pool: Actor = { kind: 'system', id: 'pool' };

const item = (itemId: string, layer: ContextItem['layer'], title: string, status: ContextItem['status'], sourceMemberId: string, sourceMessageIds: string[], extra: Partial<ContextItem> = {}): ContextItem =>
  ({ itemId, layer, title, status, sourceMemberId, sourceMessageIds, ...extra });
const edge = (from: string, to: string, kind: ContextEdge['kind'] = 'supports', extra: Partial<ContextEdge> = {}): ContextEdge => ({ edgeId: `${from}->${to}`, from, to, kind, ...extra });

export function pagesV25Ledger(context: EventContext): { events: NewLedgerEvent[]; checkpoints: Record<PagesCheckpoint, number> } {
  const events: NewLedgerEvent[] = [...pagesSeedEvents(context)];
  const checkpoints = {} as Record<PagesCheckpoint, number>;
  const mark = (name: PagesCheckpoint) => { checkpoints[name] = events.length; };
  let clock = '10:00';
  const emit = <K extends keyof EventPayloads>(type: K, payload: Payload<K>, actor: Actor = pm) => { events.push({ ...context, actor, type, payload, at: pagesAt(clock) }); };
  const upsert = (...items: ContextItem[]) => items.forEach(i => emit('context_item_upserted', { item: i }));
  const link = (...edges: ContextEdge[]) => edges.forEach(e => emit('context_edge_upserted', { edge: e }));
  /** A scripted line. The two scene-03 agent premises are written by the scenario runner (actor system), never by an agent. */
  const say = (index: number) => {
    const line = PAGES_LINES[index]!;
    clock = line.clock;
    const agent = line.as === M.storyAgent || line.as === M.uiAgent;
    emit('message_recorded', { messageId: line.messageId, authorId: line.as, text: line.text, attachmentIds: [] }, agent ? { kind: 'system', id: 'scenario' } : { kind: 'human', id: line.as });
    return line.messageId;
  };
  let speeches = 0;
  /** pm_considered + pm_spoke (+ card), like the PM's own write path. */
  let consideration = '', said = 0;
  const speak = (at: string, triggerId: string, text: string, kind: Payload<'pm_spoke'>['kind'], reason: string, card?: ContextCard) => {
    clock = at;
    consideration = `pv25:consider:${++speeches}`; said = 0;
    emit('pm_considered', { considerationId: consideration, triggerId, whoseAction: M.planner, alreadyKnows: 'no', evidence: [triggerId], decision: 'speak', reason, openTopics: [] });
    return speakMore(text, kind, card);
  };
  /** A second message of the same PM turn (the deck's card after the text). */
  const speakMore = (text: string, kind: Payload<'pm_spoke'>['kind'], card?: ContextCard) => {
    const messageId = `${consideration.replace('consider', 'pm')}:${said++}`;
    emit('pm_spoke', { considerationId: consideration, messageId, text, kind });
    if (card) emit('context_card_posted', { messageId, card });
    return messageId;
  };

  mark('seeded');
  // ── Scene 03: people and agents talk; the PM reads the Work Context out of it (silent until the last line).
  const m1 = say(0);
  upsert(item(I.i1, 'intent', '저녁 9시 자동 도착', 'stated', M.planner, [m1], { key: 'I1' }), item(I.d1, 'decision', '생성 = 9시 자동', 'stated', M.planner, [m1], { key: 'D1', short: '9시 자동' }));
  link(edge(I.i1, I.d1));
  const m2 = say(1);
  // The PM names the conflict only when it speaks (10:45, deck LOG), not at the utterance.
  upsert(item(I.i2, 'intent', '원할 때 만드는 생성 버튼', 'stated', M.ux, [m2], { key: 'I2' }), item(I.d2Manual, 'decision', '생성 = 버튼으로 수동', 'stated', M.ux, [m2], { key: 'D2', short: '버튼 수동' }));
  link(edge(I.i2, I.d2Manual));
  const m3 = say(2);
  upsert(item(I.fourDaily, 'feature', '4종 매일 동시 생성', 'violation', M.dev, [m3], { note: '비용 한도', detail: '생성 비용·시간 한도 초과' }));
  const m4 = say(3);
  upsert(item(I.dataFiction, 'feature', 'data + fiction 섞어 생성', 'stated', M.storyAgent, [m4]));
  const m5 = say(4);
  clock = '10:45';
  upsert(item(I.d2Manual, 'decision', '생성 = 버튼으로 수동', 'conflict', M.ux, [m2], { key: 'D2', short: '버튼 수동', note: 'D1과 충돌' }));
  link(edge(I.d1, I.d2Manual, 'conflicts'));
  upsert(
    item(I.threeTabs, 'screen', 'home · 채팅 · feed 3탭', 'undecided', M.uiAgent, [m5], { note: '생성 버튼 위치' }),
    item(I.fictionLevel, 'decision', 'fiction 수위 기준', 'missing', 'pm', [], { short: 'fiction 수위 기준' }),
    item(I.sharePrivacy, 'decision', 'feed 공유 시 개인정보 기준', 'missing', 'pm', [], { short: 'feed 공유 개인정보 기준' }),
    item(I.onboarding9, 'screen', '온보딩 · 9시 자동 설정', 'missing', 'pm', [], { short: '9시 설정 화면' }),
    item(I.metricMissing, 'metric', '무엇으로 확인하나?', 'missing', 'pm', [], { short: '지표' }),
  );
  speak('10:45', m1, '지금 이 방에는 생성 방식이 자동과 수동으로 갈라져 있습니다. 그리고 아무도 말하지 않았지만, 이 구성이라면 꼭 있어야 할 항목 4개가 빠져 있습니다 — fiction 수위 기준, feed 공유 시 개인정보 기준, 9시 설정 화면, 검증 지표. 채워 넣고 순서대로 정리할까요?',
    'ask', '충돌·위반·미정·누락을 아무도 모른 채 진행되고 있다');
  mark('s03_detected');

  // ── Scene 04: organize, branch, pool, Proposal v1, "A로 가면?".
  const m6 = say(5);
  clock = '11:02';
  upsert(
    item(I.i2, 'intent', '원할 때 생성 → home 버튼', 'stated', M.ux, [m2], { key: 'I2' }),
    item(I.i3, 'intent', 'fiction 수위 · 공유 기준', 'filled', 'pm', [m6], { key: 'I3' }),
    item(I.d1, 'decision', '9시 자동(추천 1종) + 생성 버튼', 'merged', M.planner, [m1, m2, m3, m6], { key: 'D1', derivedFrom: [I.d1, I.d2Manual, I.fourDaily] }),
    item(I.d2Manual, 'decision', '생성 = 버튼으로 수동', 'merged', M.ux, [m2], { key: 'D2', short: '버튼 수동', supersededBy: I.d1 }),
    item(I.fourDaily, 'feature', '4종 매일 동시 생성', 'merged', M.dev, [m3], { note: '추천 1종으로 해소', detail: '생성 비용·시간 한도 초과', supersededBy: I.d1 }),
    item(I.d2, 'decision', 'fiction · 공유', 'branch', 'pm', [m6], { key: 'D2', derivedFrom: [I.fictionLevel, I.sharePrivacy] }),
    item(I.fictionLevel, 'decision', 'fiction 수위 기준', 'filled', 'pm', [m6], { short: 'fiction 수위 기준', supersededBy: I.d2 }),
    item(I.sharePrivacy, 'decision', 'feed 공유 시 개인정보 기준', 'filled', 'pm', [m6], { short: 'feed 공유 개인정보 기준', supersededBy: I.d2 }),
    item(I.storyTemplates, 'contribution', 'Story Agent 포맷별 생성 템플릿', 'stated', M.storyAgent, [], { derivedFrom: [I.dataFiction] }),
    item(I.dataFiction, 'feature', 'data + fiction 섞어 생성', 'merged', M.storyAgent, [], { supersededBy: I.storyTemplates }),
    item(I.uiGuide, 'contribution', 'UI Agent home · 생성 플로우 가이드', 'stated', M.uiAgent, [], { derivedFrom: [I.threeTabs] }),
    item(I.threeTabs, 'screen', 'home · 채팅 · feed 3탭', 'merged', M.uiAgent, [], { note: '생성 버튼은 home', supersededBy: I.uiGuide }),
    item(I.uxOnboarding, 'contribution', '박도윤 · UX 온보딩 9시 설정 플로우', 'filled', M.ux, [m6], { short: '온보딩 9시 설정', derivedFrom: [I.onboarding9] }),
    item(I.onboarding9, 'screen', '온보딩 · 9시 자동 설정', 'filled', 'pm', [m6], { short: '9시 설정 화면', supersededBy: I.uxOnboarding }),
    item(I.metricMissing, 'metric', '검증 지표', 'filled', 'pm', [m6]),
  );
  link(edge(I.i2, I.d1), edge(I.i3, I.d2), edge(I.d1, I.storyTemplates, 'derives'), edge(I.d1, I.uiGuide, 'derives'), edge(I.d1, I.uxOnboarding, 'derives'), edge(I.d2, I.storyTemplates, 'derives'));
  emit('context_branch_opened', { itemId: I.d2, question: 'fiction · 공유 기준을 어떻게 할까요?', sourceMessageIds: [m6], options: [
    { optionId: 'A', title: '실명·실제 장소 그대로 + fiction 자유', short: '실명 그대로', gains: ['몰입 ↑'], risks: ['feed 공유 시 제3자 개인정보 노출 위험'] },
    { optionId: 'B', title: '인물·장소 자동 가명화 + fiction 수위 3단계', short: '자동 가명화 · 3단계', gains: ['공유 안전'], risks: ['수위는 사용자가 선택'] },
  ] });
  speak('11:02', m6, '정리했습니다. 9시 자동 생성은 온보딩에서 설정하고 그날 data에 맞는 1종만 추천 생성, 생성 버튼은 home에 상시 둡니다. 빠져 있던 9시 설정 화면과 지표는 항목으로 채웠고, 남은 갈림길은 fiction · 공유 기준 하나입니다.',
    'summary', '정리 요청을 받아 통합하고 남은 분기를 보여 준다', { kind: 'branch_options', itemId: I.d2 });
  mark('s04_aligned');

  say(6); say(7); const m9 = say(8);
  clock = '11:07';
  emit('pool_search_recorded', { searchId: X.search, forItemId: I.d2, reason: '지금 멤버로는 D2 분기를 결정할 근거가 부족하다', steps: ['결정 근거 확인', '멤버 역량 확인', '가능 인력 검색'], candidateIds: [P.policy, P.narrative] });
  emit('pool_member_invited', { searchId: X.search, candidateId: P.policy, memberId: M.policy });
  emit('pool_member_invited', { searchId: X.search, candidateId: P.narrative, memberId: M.narrative });
  speak('11:07', m9, '지금 멤버로는 이 분기를 결정할 근거가 부족합니다.',
    'fact', '사람 셋 모두 근거가 없다고 했고 팀에 정책·내러티브 역량이 없다', { kind: 'pm_steps', label: '판단 중', steps: ['결정 근거 확인', '멤버 역량 확인', '가능 인력 검색'] });
  speakMore('인력 pool에서 필요한 전문가 두 분을 찾아 호출했습니다.', 'fact', { kind: 'pool_candidates', searchId: X.search });
  mark('s04_pool_invited');

  clock = '11:09';
  emit('member_joined', PAGES_POOL_MEMBERS[P.policy]!, pool);
  emit('member_joined', PAGES_POOL_MEMBERS[P.narrative]!, pool);
  mark('s04_pool_joined');

  const m10 = say(9);
  upsert(item(I.policyInput, 'contribution', '한지우 · 정책 분기 판단 참여 → B 가명화·마스킹 기준', 'stated', M.policy, [m10]));
  link(edge(I.policyInput, I.d2));
  const m11 = say(10);
  upsert(item(I.narrativeInput, 'contribution', '정유나 · 내러티브 분기 판단 참여 → B fiction 수위 3단계', 'stated', M.narrative, [m11]));
  link(edge(I.narrativeInput, I.d2));
  const m12 = say(11);
  clock = '11:13';
  emit('context_branch_resolved', { itemId: I.d2, optionId: 'B', decidedBy: M.planner, evidenceMemberIds: [M.policy, M.narrative], sourceMessageIds: [m12, m10, m11] });
  emit('preview_rendered', { previewId: X.previews.proposal, source: 'proposal', label: 'Proposal v1 GENERATED', caption: 'home · 생성 플로우 · feed 공유 · 5 inputs · 3 screens', refId: X.proposal, spec: PREVIEW_B });
  emit('proposal_generated', { proposalId: X.proposal, version: 1, title: 'Pages · 모바일 App. v1', decisionItemIds: [I.d1, I.d2], filledItemIds: [I.uxOnboarding, I.metricMissing],
    inputItemIds: [I.i1, I.i2, I.i3, I.policyInput, I.narrativeInput], screens: ['home', '생성 플로우', 'feed 공유'], previewId: X.previews.proposal, sourceMessageIds: [m12] });
  speak('11:13', m12, 'B 확정으로 남은 갈림길이 없습니다.',
    'summary', '분기가 사람의 결정으로 닫혀 제안할 수 있다', { kind: 'pm_steps', label: '생성 중', steps: ['결정 D1 · D2 확인', '누락 보완 확인', 'Proposal 구성'] });
  speakMore('이제 제안이 가능해져 Proposal v1을 생성했습니다.', 'summary', { kind: 'proposal', proposalId: X.proposal });
  mark('s04_proposal');

  const m13 = say(12);
  clock = '11:22';
  emit('preview_rendered', { previewId: X.previews.branchA, source: 'branch', label: '예상 · A 적용 시 PREVIEW', refId: I.d2, spec: PREVIEW_A });
  emit('context_branch_previewed', { itemId: I.d2, optionId: 'A', effects: ['생성 템플릿 · 마스킹 기준 변경', '공유 전 검수', 'B 유지 시 변경 없음'], previewId: X.previews.branchA, sourceMessageIds: [m13] });
  speak('11:22', m13, 'A로 바꾸면 생성 템플릿은 실명 기반으로, 가명화·마스킹 기준은 공유 전 수동 검수 플로우로 바뀝니다. 캔버스에 예상 경로를 올렸어요 — B를 유지하면 바뀌는 건 없습니다.',
    'answer', '결정권자가 다른 선택지의 결과를 물었다', { kind: 'branch_preview', itemId: I.d2, optionId: 'A' });
  mark('s04_preview_a');

  // ── Scene 05: confirm v1.0, expand D → F → S → V, hand off to linked tools, build v1.0.
  const m14 = say(13);
  clock = '11:24';
  emit('context_branch_preview_cleared', { itemId: I.d2, optionId: 'A' });
  emit('preview_withdrawn', { previewId: X.previews.branchA });
  emit('proposal_confirmed', { proposalId: X.proposal, contextVersion: '1.0', confirmedBy: M.planner, sourceMessageIds: [m14] });
  const expanded = [
    item(I.d1, 'decision', '9시 자동(추천 1종) + 생성 버튼', 'confirmed', M.planner, [m1, m2, m3, m6], { key: 'D1', derivedFrom: [I.d1, I.d2Manual, I.fourDaily] }),
    item(I.d2, 'decision', '자동 가명화 · fiction 3단계 (B)', 'confirmed', M.planner, [m12], { key: 'D2', derivedFrom: [I.fictionLevel, I.sharePrivacy] }),
    item(I.f1, 'feature', '숏폼 · 동화 · 에세이 생성', 'confirmed', 'pm', [m14], { key: 'F1', derivedFrom: [I.d1] }),
    item(I.f2, 'feature', '노래 생성', 'confirmed', 'pm', [m14], { key: 'F2', derivedFrom: [I.d1] }),
    item(I.f3, 'feature', '9시 자동 생성 설정', 'confirmed', 'pm', [m14], { key: 'F3', derivedFrom: [I.d1, I.uxOnboarding] }),
    item(I.f4, 'feature', 'feed 공유 · 가명화', 'confirmed', 'pm', [m14], { key: 'F4', derivedFrom: [I.d2] }),
    item(I.s1, 'screen', '[화면] home · 최근 / 지난 생성물', 'confirmed', 'pm', [m14], { key: 'S1', derivedFrom: [I.f1, I.f3] }),
    item(I.s2, 'screen', '[화면] 생성 · 채팅 · feed', 'confirmed', 'pm', [m14], { key: 'S2', derivedFrom: [I.f1, I.f2, I.f4] }),
    item(I.v1, 'metric', '[지표] 9시 생성물 열람률', 'verify_pending', 'pm', [m14], { key: 'V1', derivedFrom: [I.metricMissing] }),
    item(I.v2, 'metric', '[지표] feed 공유율', 'verify_pending', 'pm', [m14], { key: 'V2', derivedFrom: [I.metricMissing] }),
  ];
  upsert(...expanded);
  link(edge(I.d1, I.f1, 'derives'), edge(I.d1, I.f2, 'derives'), edge(I.d1, I.f3, 'derives'), edge(I.d2, I.f4, 'derives'),
    edge(I.f1, I.s1, 'derives'), edge(I.f3, I.s1, 'derives'), edge(I.f2, I.s2, 'derives'), edge(I.f4, I.s2, 'derives'), edge(I.s1, I.v1, 'derives'), edge(I.s2, I.v2, 'derives'));
  emit('proposal_expanded', { proposalId: X.proposal, itemIds: expanded.map(i => i.itemId) });
  speak('11:24', m14, 'B 유지 — A 예상 경로는 걷었습니다. 맥락 v1.0 확정: 9시 자동(추천 1종) + 생성 버튼 · 자동 가명화 · fiction 3단계. Proposal v1을 결정 → 기능 → 화면 → 지표로 펼쳤습니다.',
    'summary', '결정권자가 v1을 확정했다', { kind: 'expansion', proposalId: X.proposal });
  mark('s05_confirmed');

  clock = '11:25';
  emit('preview_rendered', { previewId: X.previews.design, source: 'design', label: 'PAGES · HOME · 예상 화면', refId: I.s1, spec: PREVIEW_B });
  emit('tool_handoff_sent', { handoffId: X.handoffs.figma, toolId: 'figma', itemIds: [I.s1, I.s2], title: '화면 S1 · S2', round: 1, short: 'S1 S2' });
  emit('tool_handoff_sent', { handoffId: X.handoffs.prompt, toolId: 'prompt-studio', itemIds: [I.f1, I.f2, I.storyTemplates], title: '생성 템플릿', round: 1 });
  emit('tool_handoff_sent', { handoffId: X.handoffs.dev, toolId: 'dev-tools', itemIds: [I.f1, I.f2, I.f3, I.f4, I.s1, I.s2], title: '구현 · 통합 빌드', round: 1, short: '구현·통합' });
  link(edge(I.s1, 'tool:figma', 'feeds'), edge(I.s2, 'tool:figma', 'feeds'), edge(I.storyTemplates, 'tool:prompt-studio', 'feeds'), edge('tool:figma', 'tool:dev-tools', 'feeds'), edge('tool:prompt-studio', 'tool:dev-tools', 'feeds'));
  speak('11:25', m14, '화면 S1 · S2로 예상 화면을 만들고, 확정된 구성을 참여자가 연결해 둔 제작 도구로 넘깁니다. 결과는 개발 도구에서 하나로 합쳐집니다.',
    'fact', '확정된 구성을 연결된 제작 도구로 넘긴다', { kind: 'tool_handoffs', handoffIds: [X.handoffs.figma, X.handoffs.prompt, X.handoffs.dev] });
  mark('s05_handoff');

  clock = '11:26';
  emit('tool_progress_reported', { handoffId: X.handoffs.figma, status: 'in_progress' }, tools);
  emit('tool_progress_reported', { handoffId: X.handoffs.prompt, status: 'in_progress' }, tools);
  clock = '14:10';
  emit('tool_progress_reported', { handoffId: X.handoffs.figma, status: 'done', note: '화면 S1 · S2 → 개발 도구' }, tools);
  emit('tool_progress_reported', { handoffId: X.handoffs.prompt, status: 'done', note: '생성 템플릿 → 개발 도구' }, tools);
  emit('tool_progress_reported', { handoffId: X.handoffs.dev, status: 'in_progress', note: '통합 빌드 중' }, tools);
  clock = '15:40';
  emit('tool_progress_reported', { handoffId: X.handoffs.dev, status: 'done', note: '통합 빌드 v1.0' }, tools);
  emit('preview_rendered', { previewId: X.previews.build10, source: 'build', label: 'v1.0 빌드', refId: X.build10, spec: PREVIEW_B }, tools);
  emit('build_produced', { buildId: X.build10, version: '1.0', handoffIds: [X.handoffs.figma, X.handoffs.prompt, X.handoffs.dev], previewId: X.previews.build10 }, tools);
  speak('15:40', X.build10, 'Figma 화면과 생성 템플릿이 개발 도구에서 합쳐져 v1.0 빌드가 나왔습니다. 우측 화면이 그 빌드, Pages v1.0입니다. 직접 써보시고, 고칠 점이 있으면 여기서 바로 말씀해 주세요.',
    'fact', '빌드가 나와 사람이 직접 써 볼 수 있다', { kind: 'build', buildId: X.build10 });
  mark('s05_built');

  // ── Scene 06 (extension): v1.0 → v1.1, only the changed part goes back to the tools.
  say(14); const m16 = say(15);
  clock = '16:12';
  upsert(
    item(I.f5, 'feature', 'fiction 포함 라벨', 'added', M.planner, [m16], { key: 'F5' }),
    item(I.f2, 'feature', '노래 생성', 'excluded', M.planner, [m16], { key: 'F2', derivedFrom: [I.d1] }),
    item(I.s1, 'screen', '[화면] home · 생성물', 'stale', 'pm', [m16], { key: 'S1', derivedFrom: [I.f1, I.f3] }),
    item(I.s2, 'screen', '[화면] 채팅 · feed', 'stale', 'pm', [m16], { key: 'S2', derivedFrom: [I.f1, I.f2, I.f4] }),
    { ...expanded[0]!, status: 'kept' }, { ...expanded[1]!, status: 'kept' },
  );
  link(edge(I.f5, I.s2, 'derives'), edge(I.f2, I.s2, 'derives', { stale: true }), edge(I.f1, I.s1, 'derives', { stale: true }));
  emit('context_change_proposed', { changeSetId: X.changeSet, fromVersion: '1.0', toVersion: '1.1', changes: [{ itemId: I.f5, change: 'added' }, { itemId: I.f2, change: 'excluded' }],
    staleItemIds: [I.s1, I.s2, I.storyTemplates], unaffectedItemIds: [I.d1, I.d2], sourceMessageIds: [m16] });
  speak('16:12', m16, 'F5 fiction 포함 라벨 → 추가, F2 노래 생성 → 제외(off). 하류에서 S1 · S2 화면과 생성 템플릿이 갱신 대상입니다. 맥락(9시 자동 + 버튼 · 가명화 B)은 그대로입니다.',
    'summary', '결정권자가 기능을 바꿨고 하류 영향이 있다', { kind: 'change_set', changeSetId: X.changeSet });
  mark('s06_change_proposed');

  clock = '16:13';
  emit('context_change_resolved', { changeSetId: X.changeSet, outcome: 'applied', by: M.planner }, { kind: 'human', id: M.planner });
  emit('preview_rendered', { previewId: X.previews.design11, source: 'design', label: 'PAGES · HOME · 예상 화면 v1.1', refId: I.s1, spec: PREVIEW_V11 });
  emit('tool_handoff_sent', { handoffId: X.handoffs.figma2, toolId: 'figma', itemIds: [I.s1, I.s2], title: 'S1 · S2 변경 2건', round: 2 });
  emit('tool_handoff_sent', { handoffId: X.handoffs.prompt2, toolId: 'prompt-studio', itemIds: [I.f2], title: '노래 템플릿 제외', round: 2 });
  emit('tool_handoff_sent', { handoffId: X.handoffs.dev2, toolId: 'dev-tools', itemIds: [I.f5, I.s1, I.s2], title: 'F5 구현 · 재빌드', round: 2 });
  speak('16:13', X.changeSet, '변경분만 제작 도구로 다시 넘겼습니다.', 'fact', '적용된 변경분만 다시 넘긴다',
    { kind: 'tool_handoffs', handoffIds: [X.handoffs.figma2, X.handoffs.prompt2, X.handoffs.dev2] });
  say(16);
  clock = '16:14';
  // The simulated tools report every round the same way (apps/web/lib/fake-integrations.ts).
  emit('tool_progress_reported', { handoffId: X.handoffs.figma2, status: 'in_progress' }, tools);
  emit('tool_progress_reported', { handoffId: X.handoffs.prompt2, status: 'in_progress' }, tools);
  emit('tool_progress_reported', { handoffId: X.handoffs.figma2, status: 'done', note: 'S1 · S2 변경 2건 → 개발 도구' }, tools);
  emit('tool_progress_reported', { handoffId: X.handoffs.prompt2, status: 'done', note: '노래 템플릿 제외 → 개발 도구' }, tools);
  emit('tool_progress_reported', { handoffId: X.handoffs.dev2, status: 'in_progress', note: '통합 빌드 중' }, tools);
  emit('tool_progress_reported', { handoffId: X.handoffs.dev2, status: 'done', note: '통합 빌드 v1.1' }, tools);
  emit('preview_rendered', { previewId: X.previews.build11, source: 'build', label: 'v1.1 빌드', refId: X.build11, spec: PREVIEW_V11 }, tools);
  emit('build_produced', { buildId: X.build11, version: '1.1', handoffIds: [X.handoffs.figma2, X.handoffs.prompt2, X.handoffs.dev2], previewId: X.previews.build11 }, tools);
  // The PM's turn after the build: the screens are now updated (same order as the runtime: build, then the PM).
  upsert(item(I.s1, 'screen', '[화면] home · 생성물', 'updated', 'pm', [m16], { key: 'S1', derivedFrom: [I.f1, I.f3] }), item(I.s2, 'screen', '[화면] 채팅 · feed', 'updated', 'pm', [m16], { key: 'S2', derivedFrom: [I.f1, I.f4, I.f5] }));
  speak('16:14', X.build11, '후속 항목을 다시 이었습니다. 개발 도구에서 다시 빌드된 화면 v1.1 — 카드에 fiction 포함 라벨이 붙고, 포맷에서 노래가 빠졌습니다. 결정 D1·D2는 바뀌지 않았습니다.',
    'fact', '재빌드가 끝났다', { kind: 'build', buildId: X.build11 });
  mark('s06_built');
  return { events, checkpoints };
}
