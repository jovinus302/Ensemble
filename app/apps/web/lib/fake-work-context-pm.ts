// Deterministic demo PM for the Pages v2.5 Work Context (ENSEMBLE_PM_RUNTIME=fake; docs/pages-v25-runtime-demo.md §4).
// It sees only the facts a model would see and answers `update_work_context` by fixed rules (state + short patterns),
// so the scenario always leaves the records of the golden ledger. Validation and authority stay in core.
import type { ContextEdge, ContextItem, WorkContextFacts, WorkContextOp, WorkContextSpeech, WorkContextToolOutput } from '@ensemble/core';
import { PAGES_IDS as X, PAGES_ITEMS as I, PREVIEW_A, PREVIEW_B, PREVIEW_V11 } from '@ensemble/scenarios';

const ISSUES = ['conflict', 'violation', 'undecided', 'missing'];
const CHOICE = /([AB])로?\s*확정/;
const SILENT: WorkContextToolOutput = { ops: [], speech: [], reason: '말할 필요가 없다' };

const item = (itemId: string, layer: ContextItem['layer'], title: string, status: ContextItem['status'], sourceMemberId: string, sourceMessageIds: string[], extra: Partial<ContextItem> = {}): ContextItem =>
  ({ itemId, layer, title, status, sourceMemberId, sourceMessageIds, ...extra });
const edge = (from: string, to: string, kind: ContextEdge['kind'] = 'supports', extra: Partial<ContextEdge> = {}): ContextEdge => ({ edgeId: `${from}->${to}`, from, to, kind, ...extra });
const upsert = (...items: ContextItem[]): WorkContextOp[] => items.map(i => ({ type: 'upsert_item', item: i }));
const link = (...edges: ContextEdge[]): WorkContextOp[] => edges.map(e => ({ type: 'upsert_edge', edge: e }));
const say = (text: string, kind: WorkContextSpeech['kind'], card?: WorkContextSpeech['card']): WorkContextSpeech => ({ text, kind, ...(card ? { card } : {}) });
const withoutNote = ({ note: _note, ...rest }: ContextItem): ContextItem => rest;
const turn = (ops: WorkContextOp[], speech: WorkContextSpeech[], reason: string): WorkContextToolOutput => ({ ops, speech, reason });

export function fakeWorkContextTurn(facts: WorkContextFacts): WorkContextToolOutput {
  const has = (id: string) => facts.items.some(i => i.itemId === id);
  const itemOf = (id: string) => facts.items.find(i => i.itemId === id);
  const src = (id: string) => itemOf(id)?.sourceMessageIds ?? [];
  const member = (id: string) => facts.members.find(m => m.memberId === id);
  const branch = facts.branches.find(b => b.itemId === I.d2);
  const proposal = facts.proposals.find(p => p.proposalId === X.proposal);
  const decider = facts.decider;

  if (facts.trigger.kind === 'event') {
    const { eventType, refId } = facts.trigger;
    if (eventType === 'build_produced') return buildTurn(facts, refId);
    if (eventType === 'context_change_resolved' && facts.changeSets.find(c => c.changeSetId === refId)?.status === 'applied') return rehandoffTurn();
    return SILENT;
  }
  const messageId = facts.trigger.messageId;
  const message = facts.messages.find(m => m.messageId === messageId);
  if (!message) return SILENT;
  const { authorId, text } = message;
  const author = member(authorId);
  const pool = author?.source === 'pool';

  // ── Scene 03: read the context out of the conversation; ask once everything is on the table.
  if (authorId === decider && !facts.items.length && /9시|자동/.test(text))
    return turn([...upsert(item(I.i1, 'intent', '저녁 9시 자동 도착', 'stated', authorId, [messageId], { key: 'I1' }), item(I.d1, 'decision', '생성 = 9시 자동', 'stated', authorId, [messageId], { key: 'D1' })), ...link(edge(I.i1, I.d1))], [], '의도와 결정을 항목으로 올린다');
  if (has(I.d1) && !has(I.i2) && /버튼|원할 때/.test(text))
    return turn([...upsert(item(I.i2, 'intent', '원할 때 만드는 생성 버튼', 'stated', authorId, [messageId], { key: 'I2' }), item(I.d2Manual, 'decision', '생성 = 버튼으로 수동', 'conflict', authorId, [messageId], { key: 'D2', note: 'D1과 충돌' })),
      ...link(edge(I.i2, I.d2Manual), edge(I.d1, I.d2Manual, 'conflicts'))], [], '같은 결정 단계에 다른 전제가 나왔다');
  if (has(I.d1) && !has(I.fourDaily) && /4종|매일|비용/.test(text))
    return turn(upsert(item(I.fourDaily, 'feature', '4종 매일 동시 생성', 'violation', authorId, [messageId], { note: '비용 한도' })), [], '기능이 비용 한도를 넘는다');
  if (author?.kind === 'agent' && /fiction/.test(text) && !has(I.dataFiction))
    return turn(upsert(item(I.dataFiction, 'feature', 'data + fiction 섞어 생성', 'stated', authorId, [messageId])), [], 'Agent의 생성 방식을 기능으로 올린다');
  if (author?.kind === 'agent' && /미정/.test(text) && !has(I.threeTabs))
    return turn(upsert(
      item(I.threeTabs, 'screen', 'home · 채팅 · feed 3탭', 'undecided', authorId, [messageId], { note: '생성 버튼 위치' }),
      item(I.fictionLevel, 'decision', 'fiction 수위 기준', 'missing', 'pm', []),
      item(I.sharePrivacy, 'decision', 'feed 공유 시 개인정보 기준', 'missing', 'pm', []),
      item(I.onboarding9, 'screen', '온보딩 · 9시 자동 설정', 'missing', 'pm', []),
      item(I.metricMissing, 'metric', '무엇으로 확인하나?', 'missing', 'pm', []),
    ), [say('지금 이 방에는 생성 방식이 자동과 수동으로 갈라져 있습니다. 그리고 아무도 말하지 않았지만, 이 구성이라면 꼭 있어야 할 항목 4개가 빠져 있습니다 — fiction 수위 기준, feed 공유 시 개인정보 기준, 9시 설정 화면, 검증 지표. 채워 넣고 순서대로 정리할까요?', 'ask')],
    '충돌·위반·미정·누락을 아무도 모른 채 진행되고 있다');

  // ── Scene 04: organize, branch, pool, decision, Proposal, "A로 가면?".
  if (authorId === decider && !branch && /네|정리/.test(text) && facts.items.some(i => !i.supersededBy && ISSUES.includes(i.status)))
    return turn([
      ...upsert(
        item(I.i2, 'intent', '원할 때 생성 → home 버튼', 'stated', itemOf(I.i2)!.sourceMemberId, src(I.i2), { key: 'I2' }),
        item(I.i3, 'intent', 'fiction 수위 · 공유 기준', 'filled', 'pm', [messageId], { key: 'I3' }),
        item(I.d1, 'decision', '9시 자동(추천 1종) + 생성 버튼', 'merged', itemOf(I.d1)!.sourceMemberId, [...src(I.d1), ...src(I.i2), ...src(I.fourDaily), messageId], { key: 'D1', derivedFrom: [I.d1, I.d2Manual, I.fourDaily] }),
        withoutNote({ ...itemOf(I.d2Manual)!, status: 'merged', supersededBy: I.d1 }),
        { ...itemOf(I.fourDaily)!, status: 'merged', note: '추천 1종으로 해소', supersededBy: I.d1 },
        item(I.d2, 'decision', 'fiction · 공유', 'branch', 'pm', [messageId], { key: 'D2', derivedFrom: [I.fictionLevel, I.sharePrivacy] }),
        { ...itemOf(I.fictionLevel)!, status: 'filled', sourceMessageIds: [messageId], supersededBy: I.d2 },
        { ...itemOf(I.sharePrivacy)!, status: 'filled', sourceMessageIds: [messageId], supersededBy: I.d2 },
        item(I.storyTemplates, 'contribution', 'Story Agent 포맷별 생성 템플릿', 'stated', itemOf(I.dataFiction)!.sourceMemberId, [], { derivedFrom: [I.dataFiction] }),
        { ...itemOf(I.dataFiction)!, status: 'merged', sourceMessageIds: [], supersededBy: I.storyTemplates },
        item(I.uiGuide, 'contribution', 'UI Agent home · 생성 플로우 가이드', 'stated', itemOf(I.threeTabs)!.sourceMemberId, [], { derivedFrom: [I.threeTabs] }),
        { ...itemOf(I.threeTabs)!, status: 'merged', sourceMessageIds: [], note: '생성 버튼은 home', supersededBy: I.uiGuide },
        item(I.uxOnboarding, 'contribution', '박도윤 · UX 온보딩 9시 설정 플로우', 'filled', itemOf(I.i2)!.sourceMemberId, [messageId], { derivedFrom: [I.onboarding9] }),
        { ...itemOf(I.onboarding9)!, status: 'filled', sourceMessageIds: [messageId], supersededBy: I.uxOnboarding },
        { ...itemOf(I.metricMissing)!, title: '검증 지표', status: 'filled', sourceMessageIds: [messageId] },
      ),
      ...link(edge(I.i2, I.d1), edge(I.i3, I.d2), edge(I.d1, I.storyTemplates, 'derives'), edge(I.d1, I.uiGuide, 'derives'), edge(I.d1, I.uxOnboarding, 'derives'), edge(I.d2, I.storyTemplates, 'derives')),
      { type: 'open_branch', itemId: I.d2, question: 'fiction · 공유 기준을 어떻게 할까요?', sourceMessageIds: [messageId], options: [
        { optionId: 'A', title: '실명·실제 장소 그대로 + fiction 자유', gains: ['몰입 ↑'], risks: ['feed 공유 시 제3자 개인정보 노출 위험'] },
        { optionId: 'B', title: '인물·장소 자동 가명화 + fiction 수위 3단계', gains: ['공유 안전'], risks: ['수위는 사용자가 선택'] },
      ] },
    ], [say('정리했습니다. 9시 자동 생성은 온보딩에서 설정하고 그날 data에 맞는 1종만 추천 생성, 생성 버튼은 home에 상시 둡니다. 빠져 있던 9시 설정 화면과 지표는 항목으로 채웠고, 남은 갈림길은 fiction · 공유 기준 하나입니다.', 'summary', { kind: 'branch_options', itemId: I.d2 })],
    '정리 요청을 받아 통합하고 남은 분기를 보여 준다');

  if (branch && !branch.resolvedOptionId) {
    if (pool && /\b[AB]\b/.test(text)) {
      const policy = /정책/.test(author?.role ?? '');
      const id = policy ? I.policyInput : I.narrativeInput;
      const title = policy ? `${author!.displayName} · 정책 분기 판단 참여 → B 가명화·마스킹 기준` : `${author!.displayName} · 내러티브 분기 판단 참여 → B fiction 수위 3단계`;
      return turn([...upsert(item(id, 'contribution', title, 'stated', authorId, [messageId])), ...link(edge(id, I.d2))], [], 'pool 전문가의 판단 근거를 분기에 잇는다');
    }
    const choice = authorId === decider ? CHOICE.exec(text)?.[1] : undefined;
    if (choice && branch.options.some(o => o.optionId === choice)) {
      const experts = facts.items.filter(i => i.layer === 'contribution' && member(i.sourceMemberId)?.source === 'pool');
      return turn([
        { type: 'resolve_branch', itemId: I.d2, optionId: choice, decidedBy: authorId, evidenceMemberIds: experts.map(i => i.sourceMemberId), sourceMessageIds: [messageId, ...experts.flatMap(i => i.sourceMessageIds)] },
        { type: 'generate_proposal', proposalId: X.proposal, version: 1, title: facts.context.title, decisionItemIds: [I.d1, I.d2], filledItemIds: [I.i3, I.uxOnboarding, I.metricMissing],
          inputItemIds: [I.i1, I.i2, I.i3, ...experts.map(i => i.itemId)], screens: ['home', '생성 플로우', 'feed 공유'], sourceMessageIds: [messageId],
          preview: { previewId: X.previews.proposal, source: 'proposal', label: 'Proposal v1 GENERATED', caption: 'home · 생성 플로우 · feed 공유 · 5 inputs · 3 screens', refId: X.proposal, spec: PREVIEW_B } },
      ], [say(`${choice} 확정으로 남은 갈림길이 없습니다. 이제 제안이 가능해져 Proposal v1을 생성했습니다.`, 'summary', { kind: 'pm_steps', label: '생성 중', steps: ['결정 D1 · D2 확인', '누락 보완 확인', 'Proposal 구성'], proposalId: X.proposal })],
      '분기가 사람의 결정으로 닫혀 제안할 수 있다');
    }
    // Every person on the team (not the pool) has spoken since the branch opened and nobody chose: evidence is missing.
    const lastPm = facts.messages.findLastIndex(m => m.authorId === 'pm');
    const team = facts.members.filter(m => m.kind === 'human' && m.source !== 'pool').map(m => m.memberId);
    const since = facts.messages.slice(lastPm + 1);
    if (!facts.pool.invitedCandidateIds.length && team.every(id => since.some(m => m.authorId === id)) && !since.some(m => CHOICE.test(m.text))) {
      const topics = ['개인정보', 'fiction'];
      const candidates = facts.pool.candidates.filter(c => c.availability === 'available' && c.expertise.some(e => topics.some(t => e.includes(t))));
      const steps = ['결정 근거 확인', '멤버 역량 확인', '가능 인력 검색'];
      return turn([{ type: 'search_pool', searchId: X.search, forItemId: I.d2, reason: '지금 멤버로는 D2 분기를 결정할 근거가 부족하다', steps, candidateIds: candidates.map(c => c.candidateId) }],
        [say(`지금 멤버로는 이 분기를 결정할 근거가 부족합니다. 인력 pool에서 필요한 전문가 ${candidates.length === 2 ? '두' : candidates.length} 분을 찾아 호출했습니다.`, 'fact', { kind: 'pm_steps', label: '판단 중', steps, searchId: X.search })],
        '사람 셋 모두 근거가 없다고 했고 팀에 정책·내러티브 역량이 없다');
    }
    return SILENT;
  }
  if (branch?.resolvedOptionId && authorId === decider) {
    const other = /([AB])로 가면/.exec(text)?.[1];
    if (other && other !== branch.resolvedOptionId && !branch.previewOptionId)
      return turn([{ type: 'preview_branch', itemId: I.d2, optionId: other, effects: ['생성 템플릿 → 실명 기반', '가명화·마스킹 기준 → 공유 전 수동 검수 플로우', `${branch.resolvedOptionId} 유지 시 변경 없음`], sourceMessageIds: [messageId],
        preview: { previewId: X.previews.branchA, source: 'branch', label: `예상 · ${other} 적용 시 PREVIEW`, refId: I.d2, spec: PREVIEW_A } }],
      [say(`${other}로 바꾸면 생성 템플릿은 실명 기반으로, 가명화·마스킹 기준은 공유 전 수동 검수 플로우로 바뀝니다. 캔버스에 예상 경로를 올렸어요 — ${branch.resolvedOptionId}를 유지하면 바뀌는 건 없습니다.`, 'answer', { kind: 'branch_preview', itemId: I.d2, optionId: other })],
      '결정권자가 다른 선택지의 결과를 물었다');

    // ── Scene 05: confirm v1.0, expand, hand off to the linked tools.
    if (proposal?.status === 'generated' && /유지|확정|진행/.test(text)) return confirmTurn(facts, messageId);

    // ── Scene 06: a change after the build.
    if (facts.builds.length && !facts.changeSets.some(c => c.status === 'proposed') && /라벨|빼|제외/.test(text)) {
      const kept = (id: string) => ({ ...itemOf(id)!, status: 'kept' as const });
      return turn([
        ...upsert(
          item(I.f5, 'feature', 'fiction 포함 라벨', 'added', authorId, [messageId], { key: 'F5' }),
          { ...itemOf(I.f2)!, status: 'excluded', sourceMemberId: authorId, sourceMessageIds: [messageId] },
          { ...itemOf(I.s1)!, title: '[화면] home · 생성물', status: 'stale', sourceMessageIds: [messageId] },
          { ...itemOf(I.s2)!, title: '[화면] 채팅 · feed', status: 'stale', sourceMessageIds: [messageId] },
          kept(I.d1), kept(I.d2),
        ),
        ...link(edge(I.f5, I.s2, 'derives'), edge(I.f2, I.s2, 'derives', { stale: true }), edge(I.f1, I.s1, 'derives', { stale: true })),
        { type: 'propose_change', changeSetId: X.changeSet, fromVersion: facts.context.version, toVersion: '1.1', changes: [{ itemId: I.f5, change: 'added' }, { itemId: I.f2, change: 'excluded' }],
          staleItemIds: [I.s1, I.s2, I.storyTemplates], unaffectedItemIds: [I.d1, I.d2], sourceMessageIds: [messageId] },
      ], [say('F5 fiction 포함 라벨 → 추가, F2 노래 생성 → 제외(off). 하류에서 S1 · S2 화면과 생성 템플릿이 갱신 대상입니다. 맥락(9시 자동 + 버튼 · 가명화 B)은 그대로입니다.', 'summary', { kind: 'change_set', changeSetId: X.changeSet })],
      '결정권자가 기능을 바꿨고 하류 영향이 있다');
    }
  }
  return SILENT;
}

function confirmTurn(facts: WorkContextFacts, messageId: string): WorkContextToolOutput {
  const itemOf = (id: string) => facts.items.find(i => i.itemId === id)!;
  const branch = facts.branches.find(b => b.itemId === I.d2)!;
  const chosen = branch.resolvedOptionId!;
  const preview = facts.basePreview?.source === 'branch' ? facts.basePreview : undefined;
  const pm = (itemId: string, layer: ContextItem['layer'], title: string, key: string, derivedFrom: string[], status: ContextItem['status'] = 'confirmed') => item(itemId, layer, title, status, 'pm', [messageId], { key, derivedFrom });
  const d2Source = facts.messages.find(m => m.authorId === facts.decider && CHOICE.test(m.text))?.messageId;
  const expanded = [
    { ...itemOf(I.d1), status: 'confirmed' as const },
    item(I.d2, 'decision', `자동 가명화 · fiction 3단계 (${chosen})`, 'confirmed', facts.decider, d2Source ? [d2Source] : [], { key: 'D2', derivedFrom: [I.fictionLevel, I.sharePrivacy] }),
    pm(I.f1, 'feature', '숏폼 · 동화 · 에세이 생성', 'F1', [I.d1]),
    pm(I.f2, 'feature', '노래 생성', 'F2', [I.d1]),
    pm(I.f3, 'feature', '9시 자동 생성 설정', 'F3', [I.d1, I.uxOnboarding]),
    pm(I.f4, 'feature', 'feed 공유 · 가명화', 'F4', [I.d2]),
    pm(I.s1, 'screen', '[화면] home · 최근 / 지난 생성물', 'S1', [I.f1, I.f3]),
    pm(I.s2, 'screen', '[화면] 생성 · 채팅 · feed', 'S2', [I.f1, I.f2, I.f4]),
    pm(I.v1, 'metric', '[지표] 9시 생성물 열람률', 'V1', [I.metricMissing], 'verify_pending'),
    pm(I.v2, 'metric', '[지표] feed 공유율', 'V2', [I.metricMissing], 'verify_pending'),
  ];
  return turn([
    ...(branch.previewOptionId ? [{ type: 'clear_branch_preview' as const, itemId: I.d2, optionId: branch.previewOptionId }] : []),
    ...(preview ? [{ type: 'withdraw_preview' as const, previewId: preview.previewId }] : []),
    { type: 'confirm_proposal', proposalId: X.proposal, contextVersion: '1.0', confirmedBy: facts.decider, sourceMessageIds: [messageId] },
    { type: 'expand_proposal', proposalId: X.proposal, items: expanded, edges: [edge(I.d1, I.f1, 'derives'), edge(I.d1, I.f2, 'derives'), edge(I.d1, I.f3, 'derives'), edge(I.d2, I.f4, 'derives'),
      edge(I.f1, I.s1, 'derives'), edge(I.f3, I.s1, 'derives'), edge(I.f2, I.s2, 'derives'), edge(I.f4, I.s2, 'derives'), edge(I.s1, I.v1, 'derives'), edge(I.s2, I.v2, 'derives')] },
    { type: 'handoff_tools', preview: { previewId: X.previews.design, source: 'design', label: 'PAGES · HOME · 예상 화면', refId: I.s1, spec: PREVIEW_B }, handoffs: [
      { handoffId: X.handoffs.figma, toolId: 'figma', itemIds: [I.s1, I.s2], title: '화면 S1 · S2', round: 1 },
      { handoffId: X.handoffs.prompt, toolId: 'prompt-studio', itemIds: [I.f1, I.f2, I.storyTemplates], title: '생성 템플릿', round: 1 },
      { handoffId: X.handoffs.dev, toolId: 'dev-tools', itemIds: [I.f1, I.f2, I.f3, I.f4, I.s1, I.s2], title: '구현 · 통합 빌드', round: 1 },
    ] },
    ...link(edge(I.s1, 'tool:figma', 'feeds'), edge(I.s2, 'tool:figma', 'feeds'), edge(I.storyTemplates, 'tool:prompt-studio', 'feeds'), edge('tool:figma', 'tool:dev-tools', 'feeds'), edge('tool:prompt-studio', 'tool:dev-tools', 'feeds')),
  ], [
    say(`${chosen} 유지 — ${preview ? 'A 예상 경로는 걷었습니다. ' : ''}맥락 v1.0 확정: 9시 자동(추천 1종) + 생성 버튼 · 자동 가명화 · fiction 3단계. Proposal v1을 결정 → 기능 → 화면 → 지표로 펼쳤습니다.`, 'summary', { kind: 'expansion', proposalId: X.proposal }),
    say('화면 S1 · S2로 예상 화면을 만들고, 확정된 구성을 참여자가 연결해 둔 제작 도구로 넘깁니다. 결과는 개발 도구에서 하나로 합쳐집니다.', 'fact', { kind: 'tool_handoffs', handoffIds: [X.handoffs.figma, X.handoffs.prompt, X.handoffs.dev] }),
  ], '결정권자가 v1을 확정했고 확정된 구성을 연결된 제작 도구로 넘긴다');
}

function rehandoffTurn(): WorkContextToolOutput {
  return turn([{ type: 'handoff_tools', preview: { previewId: X.previews.design11, source: 'design', label: 'PAGES · HOME · 예상 화면 v1.1', refId: I.s1, spec: PREVIEW_V11 }, handoffs: [
    { handoffId: X.handoffs.figma2, toolId: 'figma', itemIds: [I.s1, I.s2], title: 'S1 · S2 변경 2건', round: 2 },
    { handoffId: X.handoffs.prompt2, toolId: 'prompt-studio', itemIds: [I.f2], title: '노래 템플릿 제외', round: 2 },
    { handoffId: X.handoffs.dev2, toolId: 'dev-tools', itemIds: [I.f5, I.s1, I.s2], title: 'F5 구현 · 재빌드', round: 2 },
  ] }], [say('변경분만 제작 도구로 다시 넘겼습니다.', 'fact', { kind: 'tool_handoffs', handoffIds: [X.handoffs.figma2, X.handoffs.prompt2, X.handoffs.dev2] })], '적용된 변경분만 다시 넘긴다');
}

function buildTurn(facts: WorkContextFacts, buildId: string): WorkContextToolOutput {
  const build = facts.builds.find(b => b.buildId === buildId);
  if (!build) return SILENT;
  if (build.version === '1.0') return turn([], [say('Figma 화면과 생성 템플릿이 개발 도구에서 합쳐져 v1.0 빌드가 나왔습니다. 우측 화면이 그 빌드, Pages v1.0입니다. 직접 써보시고, 고칠 점이 있으면 여기서 바로 말씀해 주세요.', 'fact', { kind: 'build', buildId })], '빌드가 나와 사람이 직접 써 볼 수 있다');
  const itemOf = (id: string) => facts.items.find(i => i.itemId === id)!;
  return turn(upsert(
    { ...itemOf(I.s1), status: 'updated' },
    { ...itemOf(I.s2), status: 'updated', derivedFrom: [I.f1, I.f4, I.f5] },
  ), [say(`후속 항목을 다시 이었습니다. 개발 도구에서 다시 빌드된 화면 v${build.version} — 카드에 fiction 포함 라벨이 붙고, 포맷에서 노래가 빠졌습니다. 결정 D1·D2는 바뀌지 않았습니다.`, 'fact', { kind: 'build', buildId })], '재빌드가 끝났다');
}
