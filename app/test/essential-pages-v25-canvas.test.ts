// Pages v2.5 WORK CONTEXT canvas + LOG (workstream B): what the canvas draws at each golden checkpoint.
import assert from 'node:assert/strict';
import test from 'node:test';
import { PAGES_IDS, PAGES_ITEMS as I, PAGES_MEMBERS, PAGES_NOW, PAGES_POOL, type PagesCheckpoint } from '@ensemble/scenarios';
import { canvasLayout } from '../apps/web/components/context/canvas/layout.ts';
import { formatTime } from '../apps/web/components/format.ts';
import { buildViewModel } from '../apps/web/lib/build-view-model.ts';
import { pagesEvents, pagesViewModel } from './pages-v25-fixture.ts';

const view = (checkpoint: PagesCheckpoint) => {
  const wc = pagesViewModel(checkpoint).workContext!;
  return { wc, layout: canvasLayout(wc) };
};
const columns = (layout: ReturnType<typeof canvasLayout>) => layout.columns.map(c => `${c.label} ${c.nodes.length}`);
const chips = (wc: ReturnType<typeof view>['wc']) => wc.summary.map(s => s.count === undefined ? s.label : `${s.label} ${s.count}`);
const logLine = (l: { at: string; kindLabel: string; text: string }) => `${formatTime(l.at)} ${l.kindLabel} · ${l.text}`;
const itemNodes = (layout: ReturnType<typeof canvasLayout>) => layout.columns.flatMap(c => c.nodes.flatMap(n => n.kind === 'item' ? [n] : []));

test('the canvas draws the deck columns, nodes, edges and status chips at each checkpoint', () => {
  // 03: what people said, plus what the PM detected (one conflict, one violation, one undecided, four missing).
  let { wc, layout } = view('s03_detected');
  assert.equal(layout.mode, 'context');
  assert.deepEqual(columns(layout), ['의도 2', '결정 4', '기능 · 화면 4', '지표 1']);
  // 연결 counts solid links (not the conflict line), as the deck's "연결 2".
  assert.deepEqual(chips(wc), ['연결 2', '충돌 1', '위반 1', '미정 1', '누락 4']);
  assert.equal(layout.edges.length, 3);
  assert.deepEqual(layout.edges.filter(e => e.kind === 'conflicts').map(e => [e.from, e.to]), [[I.d1, I.d2Manual]]);
  assert.equal(wc.stageLabel, undefined);

  // 04: organized — every detection absorbed, one open branch with A/B.
  ({ wc, layout } = view('s04_aligned'));
  assert.deepEqual(columns(layout), ['의도 3', '결정 2', '참여 3', '지표 1']);
  assert.deepEqual(chips(wc), ['연결 7', '분기 1']);
  const open = itemNodes(layout).find(n => n.id === I.d2)!;
  assert.deepEqual(open.branch?.options.map(o => [o.optionId, o.chosen, o.previewing]), [['A', false, false], ['B', false, false]]);

  // 04 end: pool experts joined, B chosen by a person, A previewed as the predicted path.
  ({ wc, layout } = view('s04_preview_a'));
  assert.deepEqual(columns(layout), ['의도 3', '결정 2', '참여 5', '지표 1']);
  // Deck: "연결 14 · 분기 1 (B 선택) · pool 2 합류 · Proposal v1" (+ the Proposal's 5 composition links), then 예상 (A).
  assert.deepEqual(chips(wc), ['연결 14', '분기 1 (B 선택)', 'pool 2 합류', 'Proposal v1', '예상 (A)']);
  const branch = itemNodes(layout).find(n => n.id === I.d2)!.branch!;
  assert.deepEqual(branch.options.map(o => [o.optionId, o.chosen, o.previewing]), [['A', false, true], ['B', true, false]]);
  assert.equal(branch.previewEffects?.length, 3);
  assert.deepEqual(itemNodes(layout).filter(n => n.item.source.kind === 'pool').map(n => n.item.source.name), ['한지우', '정유나']);

  // 05: confirmed and expanded — the flow D → F → S → tools → V; the rest folds away.
  ({ wc, layout } = view('s05_built'));
  assert.equal(layout.mode, 'flow');
  assert.deepEqual(columns(layout), ['결정 2', '기능 4', '화면 2', '제작 도구 3', '지표 2']);
  assert.equal(layout.folded.length, 9);
  assert.equal(wc.stageLabel, 'Proposal v1 · 확정 → 제작 도구 전달 → 제작 완료');
  assert.deepEqual(chips(wc), ['연결 29', '확정 8', '검증 예정 2']);
  const tools = layout.columns.find(c => c.id === 'tools')!.nodes.flatMap(n => n.kind === 'tool' ? [n.tool] : []);
  assert.deepEqual(tools.map(t => [t.name, t.statusLabel, t.resent]), [['Figma', '제작 완료', false], ['프롬프트 스튜디오', '제작 완료', false], ['개발 도구', '빌드 완료', false]]);
  assert.ok(layout.edges.some(e => e.to === 'tool:dev-tools') && layout.edges.every(e => !layout.folded.some(i => i.id === e.from || i.id === e.to)));

  // 06: the change set — F5 added, F2 excluded, S1·S2 stale, D1·D2 kept; then rebuilt v1.1.
  ({ wc, layout } = view('s06_change_proposed'));
  assert.equal(wc.versionLabel, 'v1.0 → v1.1');
  assert.equal(wc.stageLabel, 'Pages v1.0 · 상세 조율');
  assert.deepEqual(columns(layout), ['결정 2', '기능 5', '화면 2', '제작 도구 3', '지표 2']);
  const status = (id: string) => itemNodes(layout).find(n => n.id === id)?.item.statusLabel;
  assert.deepEqual([I.d1, I.d2, I.f2, I.f5, I.s1, I.s2].map(status), ['유지', '유지', '제외', '추가', '낡음', '낡음']);
  assert.equal(layout.edges.filter(e => e.stale).length, 2);
  ({ wc, layout } = view('s06_built'));
  assert.deepEqual([wc.versionLabel, wc.stageLabel], ['v1.1', 'Pages v1.1 · 상세 조율']);
  assert.deepEqual([I.s1, I.s2].map(id => itemNodes(layout).find(n => n.id === id)?.item.statusLabel), ['갱신', '갱신']);
  const resent = layout.columns.find(c => c.id === 'tools')!.nodes.flatMap(n => n.kind === 'tool' ? [n.tool] : []);
  assert.deepEqual(resent.map(t => [t.resent, t.done, t.note]), [[true, true, 'S1 · S2 변경 2건 → 개발 도구'], [true, true, '노래 템플릿 제외 → 개발 도구'], [true, true, '통합 빌드 v1.1']]);
  // Mid-round (between golden checkpoints): the integration build shows as working, its memo not repeated.
  const all = pagesEvents('s06_built');
  const cut = all.findIndex(e => e.type === 'tool_progress_reported' && (e.payload as { handoffId: string; status: string }).handoffId === PAGES_IDS.handoffs.dev2) + 1;
  const mid = canvasLayout(buildViewModel(all.slice(0, cut), { me: PAGES_MEMBERS.planner, mode: 'scenario', busy: false, now: PAGES_NOW }).workContext!);
  const dev = mid.columns.find(c => c.id === 'tools')!.nodes.flatMap(n => n.kind === 'tool' && n.tool.toolId === 'dev-tools' ? [n.tool] : [])[0]!;
  assert.deepEqual([dev.statusLabel, dev.working, dev.done, dev.resent, dev.note], ['통합 빌드 중', true, false, true, undefined]);
});

test('absorbed items leave the canvas but stay in the LOG, and no internal id is shown', () => {
  const absorbed = [I.d2Manual, I.fourDaily, I.dataFiction, I.threeTabs, I.fictionLevel, I.sharePrivacy, I.onboarding9];
  for (const checkpoint of ['s04_aligned', 's05_built', 's06_built'] as const) {
    const { wc, layout } = view(checkpoint);
    const drawn = new Set([...layout.columns.flatMap(c => c.nodes.map(n => n.id)), ...layout.folded.map(i => i.id)]);
    for (const id of absorbed) {
      assert.ok(!wc.items.some(i => i.id === id) && !drawn.has(id), `${id} hidden at ${checkpoint}`);
      assert.ok(!wc.edges.some(e => e.from === id || e.to === id), `no edge to ${id} at ${checkpoint}`);
    }
  }
  const log = view('s04_aligned').wc.log.map(l => l.text).join('\n');
  for (const title of ['생성 = 버튼으로 수동', '4종 매일 동시 생성', 'data + fiction 섞어 생성', 'home · 채팅 · feed 3탭', 'fiction 수위 기준', 'feed 공유 시 개인정보 기준', '온보딩 · 9시 자동 설정']) assert.ok(log.includes(title), title);

  const ids = [...Object.values(I), ...Object.values(PAGES_POOL), ...Object.values(PAGES_MEMBERS),
    ...Object.values(PAGES_IDS).flatMap(v => typeof v === 'string' ? [v] : Object.values(v))].filter(id => id.length > 2); // "v1"·"s1" are also version/key text
  const leaks = new RegExp(`(^|[^A-Za-z0-9-])(${ids.map(id => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})($|[^A-Za-z0-9-])|tool:|pv25:`);
  for (const checkpoint of ['s03_detected', 's04_preview_a', 's05_built', 's06_change_proposed', 's06_built'] as const) {
    const { wc, layout } = view(checkpoint);
    const shown = [wc.versionLabel, wc.stageLabel ?? '', ...wc.summary.map(s => s.label), ...wc.log.flatMap(l => [l.kindLabel, l.text]),
      ...wc.items.flatMap(i => [i.key ?? '', i.layerLabel, i.title, i.statusLabel ?? '', i.note ?? '', i.source.name, i.source.initial]),
      ...wc.branches.flatMap(b => [b.question, ...b.options.flatMap(o => [o.optionId, o.title, ...o.gains, ...o.risks]), ...(b.previewEffects ?? []), ...b.evidenceNames, b.decidedByName ?? '']),
      ...layout.columns.flatMap(c => [c.label, ...c.nodes.flatMap(n => n.kind === 'tool' ? [n.tool.name, n.tool.title ?? '', n.tool.statusLabel ?? ''] : [])])];
    for (const text of shown) assert.doesNotMatch(text, leaks, `${checkpoint}: ${text}`);
  }
});

test('the LOG reads newest first in the deck sentence format', () => {
  // The deck's scene-03 LOG, word for word: detections at the PM's detection moment, short names, no 미정 line.
  assert.deepEqual(view('s03_detected').wc.log.map(logLine), [
    '10:45 누락 · 대화에는 없지만 이 맥락에 꼭 필요한 항목 4 — fiction 수위 기준 · feed 공유 개인정보 기준 · 9시 설정 화면 · 지표',
    '10:45 충돌 · D1 9시 자동 ↔ D2 버튼 수동 — 같은 결정 단계에 서로 다른 전제',
    '10:40 위반 · [기능] 4종 매일 동시 생성 → 생성 비용·시간 한도 초과',
  ]);
  // The pool line gains "합류" in place once the invited experts join.
  assert.match(view('s04_pool_invited').wc.log[0]!.text, /한지우\(정책\) · 정유나\(내러티브\) 호출$/);
  assert.deepEqual(view('s04_preview_a').wc.log.slice(0, 4).map(logLine), [
    // The deck's scene-04 LOG, word for word.
    '11:22 검토 · A(실명 그대로) 적용 시 예상 — 생성 템플릿 · 마스킹 기준 변경 · 공유 전 검수 · B 유지 시 변경 없음',
    '11:13 생성 · B 확정 → 제안 가능 · Proposal v1 ← D1 · D2 + 구성 5개 연결',
    // A person's choice is logged at the time they said it.
    '11:12 선택 · D2 = B(자동 가명화 · 3단계) — 근거: 한지우 · 정유나 · 확정: 김서연',
    '11:07 호출 · D2 결정 근거 부족 → 인력 pool 한지우(정책) · 정유나(내러티브) 호출 · 합류',
  ]);
  assert.deepEqual(view('s05_built').wc.log.slice(0, 3).map(logLine), [
    '15:40 빌드 완료 · Figma · 프롬프트 스튜디오 결과 → 개발 도구에서 통합 — Pages v1.0',
    // The deck's scene-05 LOG, word for word.
    '11:25 전달 · S1 S2 → Figma · 생성 템플릿 → 프롬프트 스튜디오 · 구현·통합 → 개발 도구',
    '11:24 확정 · B 유지 · A 예상 경로 제거 · Proposal v1 → D1 D2 · F1–F4 · S1 S2 · V1 V2 로 펼침',
  ]);
  const final = view('s06_built').wc.log;
  assert.deepEqual(final.slice(0, 5).map(logLine), [
    '16:14 갱신 · S1 [화면] home · 생성물 · S2 [화면] 채팅 · feed',
    '16:14 빌드 완료 · Figma · 프롬프트 스튜디오 결과 → 개발 도구에서 통합 — Pages v1.1',
    '16:13 재전달 · S1 · S2 변경 2건 → Figma · 노래 템플릿 제외 → 프롬프트 스튜디오 · F5 구현 · 재빌드 → 개발 도구',
    '16:13 적용 · v1.0 → v1.1 변경 적용 — 김서연',
    // Scene 06 keeps the ledger's own lines (the deck summarizes them differently); the change line matches the deck.
    '16:12 추가 · 제외 · F5 fiction 포함 라벨(new), F2 노래 생성(off) → 연결 2개 낡음',
  ]);
  assert.ok(final.every((l, i) => i === 0 || l.at <= final[i - 1]!.at), 'newest first');
  assert.equal(new Set(final.map(l => l.id)).size, final.length);
});
