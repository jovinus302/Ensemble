// Pages v2.5 workstream C: chat cards, pool members and the mobile preview, rendered from the golden checkpoints.
// Tests the pure builders the components draw from (card-view.ts, build-context-cards.ts); no snapshots.
import assert from 'node:assert/strict';
import test from 'node:test';
import type { ContextCard, LedgerEvent } from '@ensemble/core';
import { PAGES_IDS as X, PAGES_ITEMS as I, PAGES_LINES, PAGES_MEMBERS as M, PAGES_POOL as P, type PagesCheckpoint } from '@ensemble/scenarios';
import { buildViewModel } from '../apps/web/lib/build-view-model.ts';
import type { ViewModel } from '../apps/web/lib/view-model.ts';
import type { VmContextCard } from '../apps/web/lib/work-context-view-model.ts';
import { cardTexts, changeSetView, handoffRow, memberSummary, poolRow } from '../apps/web/components/context/cards/card-view.ts';
import { pagesEvents, pagesViewModel } from './pages-v25-fixture.ts';

const CHECKPOINTS: PagesCheckpoint[] = ['seeded', 's03_detected', 's04_aligned', 's04_pool_invited', 's04_pool_joined', 's04_proposal', 's04_preview_a',
  's05_confirmed', 's05_handoff', 's05_built', 's06_change_proposed', 's06_built'];
const cardsOf = (vm: ViewModel) => vm.messages.flatMap(m => (m.contextCard ? [{ messageId: m.id, card: m.contextCard }] : []));
const cardOn = (vm: ViewModel, kind: VmContextCard['kind'], nth = 0) => cardsOf(vm).filter(c => c.card.kind === kind)[nth];

/** The golden ledger never posts `pool_candidates` or `proposal` cards; post them (plus one dangling card) on human lines. */
function withExtraCards(cards: ContextCard[]): ViewModel {
  const events = pagesEvents('s06_built');
  const last = events.at(-1)!;
  const extra: LedgerEvent[] = cards.map((card, i) => ({ ...last, id: `x${i}`, seq: events.length + i + 1, actor: { kind: 'pm', id: 'pm' },
    type: 'context_card_posted', payload: { messageId: PAGES_LINES[6 + i]!.messageId, card } }) as LedgerEvent);
  return buildViewModel([...events, ...extra], { me: M.planner, mode: 'scenario', busy: false });
}

test('all nine chat card kinds resolve from ledger ids, and a dangling reference draws no card', () => {
  const golden = cardsOf(pagesViewModel('s06_built')).map(c => c.card.kind);
  assert.deepEqual(golden, ['branch_options', 'pm_steps', 'pm_steps', 'branch_preview', 'expansion', 'tool_handoffs', 'build', 'change_set', 'tool_handoffs', 'build']);
  const vm = withExtraCards([{ kind: 'pool_candidates', searchId: X.search }, { kind: 'proposal', proposalId: X.proposal }, { kind: 'proposal', proposalId: 'missing-proposal' }]);
  const kinds = new Set(cardsOf(vm).map(c => c.card.kind));
  assert.equal(kinds.size, 9, [...kinds].join(','));
  assert.equal(vm.messages.find(m => m.id === PAGES_LINES[8]!.messageId)!.contextCard, undefined, 'a card whose record is missing is dropped');
  const pool = cardOn(vm, 'pool_candidates')!.card;
  assert.ok(pool.kind === 'pool_candidates');
  assert.deepEqual(pool.candidates.map(c => [c.name, poolRow(c).status.text]), [['한지우', '합류'], ['정유나', '합류']]);
  const proposal = cardOn(vm, 'proposal')!.card;
  assert.ok(proposal.kind === 'proposal');
  assert.deepEqual(cardTexts(proposal).slice(0, 2), ['Proposal v1', '확정']);
  // The Proposal card shows the chosen branch while the item is still a branch (deck: "… (B) 확정").
  const generated = cardOn(pagesViewModel('s04_proposal'), 'pm_steps', 1)!.card;
  assert.ok(generated.kind === 'pm_steps' && generated.proposal);
  assert.deepEqual(generated.proposal.decisions.map(d => [d.key, d.statusLabel]), [['D1', '통합'], ['D2', '확정']]);
  assert.match(generated.proposal.decisions[1]!.title, /가명화.*\(B\)$/);
});

test('a card keeps its place while its progress label follows the ledger', () => {
  // Pool call: 호출 중 → 합류, on the same PM message.
  const invited = cardOn(pagesViewModel('s04_pool_invited'), 'pm_steps')!, joined = cardOn(pagesViewModel('s04_pool_joined'), 'pm_steps')!;
  assert.equal(invited.messageId, joined.messageId);
  const statuses = (c: VmContextCard) => (c.kind === 'pm_steps' ? c.candidates ?? [] : []).map(x => poolRow(x).status.text);
  assert.deepEqual([statuses(invited.card), statuses(joined.card)], [['호출 중', '호출 중'], ['합류', '합류']]);
  // Tool handoffs: 전달됨 → 제작 완료 / 빌드 완료, on the same message; round 2 starts as 재전달.
  const labels = (checkpoint: PagesCheckpoint, nth = 0) => {
    const c = cardOn(pagesViewModel(checkpoint), 'tool_handoffs', nth)!;
    assert.ok(c.card.kind === 'tool_handoffs');
    return { messageId: c.messageId, labels: c.card.handoffs.map(h => `${h.toolName}:${h.statusLabel}`) };
  };
  const sent = labels('s05_handoff'), built = labels('s05_built');
  assert.equal(sent.messageId, built.messageId);
  assert.deepEqual(sent.labels, ['Figma:전달됨', '프롬프트 스튜디오:전달됨', '개발 도구:전달됨']);
  assert.deepEqual(built.labels, ['Figma:제작 완료', '프롬프트 스튜디오:제작 완료', '개발 도구:빌드 완료']);
  const events = pagesEvents('s06_built');
  const resent = events.slice(0, events.findIndex(e => e.type === 'message_recorded' && (e.payload as { messageId: string }).messageId === PAGES_LINES[16]!.messageId));
  const round2 = cardOn(buildViewModel(resent, { me: M.planner, mode: 'scenario', busy: false }), 'tool_handoffs', 1)!.card;
  assert.ok(round2.kind === 'tool_handoffs');
  assert.deepEqual(round2.handoffs.map(h => h.statusLabel), ['재전달', '재전달', '재전달']);
  // Mid-build (both rounds): design tools done with a memo, dev tools building; the memo equal to the label shows once.
  const devBuilding = (round: 0 | 1) => {
    const at = events.flatMap((e, i) => e.type === 'tool_progress_reported' && (e.payload as { status: string; note?: string }).note === '통합 빌드 중' ? [i] : [])[round]!;
    const c = cardOn(buildViewModel(events.slice(0, at + 1), { me: M.planner, mode: 'scenario', busy: false }), 'tool_handoffs', round)!;
    assert.ok(c.card.kind === 'tool_handoffs');
    return { messageId: c.messageId, rows: c.card.handoffs.map(h => { const r = handoffRow(h, 'handoff'); return [r.status.text, r.memo ?? '', r.working]; }) };
  };
  assert.equal(devBuilding(0).messageId, sent.messageId);
  assert.deepEqual(devBuilding(0).rows, [['제작 완료', '결과 → 개발 도구', false], ['제작 완료', '결과 → 개발 도구', false], ['통합 빌드 중', '', true]]);
  assert.deepEqual(devBuilding(1).rows, [['제작 완료', '결과 → 개발 도구', false], ['제작 완료', '결과 → 개발 도구', false], ['통합 빌드 중', '', true]]);
  const final = cardOn(pagesViewModel('s06_built'), 'build', 1)!.card;
  assert.ok(final.kind === 'build');
  assert.deepEqual(final.handoffs.map(h => handoffRow(h, 'build').text), ['S1 · S2 변경 2건 → 개발 도구', '노래 템플릿 제외 → 개발 도구', '통합 빌드 v1.1']);
});

test('the change card offers apply / revert to the decision owner only, and only while it is open', () => {
  const view = (checkpoint: PagesCheckpoint, me: string) => {
    const c = cardOn(pagesViewModel(checkpoint, me), 'change_set')!.card;
    assert.ok(c.kind === 'change_set');
    return changeSetView(c.changeSet);
  };
  const owner = view('s06_change_proposed', M.planner);
  assert.deepEqual(owner.actions.map(a => a.label), ['변경 적용 · v1.1', '되돌리기']);
  assert.deepEqual(owner.chips.map(c => c.text), ['F5 fiction 포함 라벨 추가', 'F2 노래 생성 제외', 'D1 유지', 'D2 유지']);
  for (const other of [M.ux, M.dev, M.policy]) assert.deepEqual(view('s06_change_proposed', other).actions, [], other);
  const applied = view('s06_built', M.planner);
  assert.deepEqual([applied.actions, applied.status.text], [[], '적용됨 · v1.1']);
});

test('pool members carry the POOL flag and the member header counts them as "+N POOL"', () => {
  const before = memberSummary(pagesViewModel('s04_pool_invited').members), after = pagesViewModel('s04_pool_joined').members;
  assert.equal(before.pool, undefined);
  assert.deepEqual(after.filter(m => m.pool).map(m => m.displayName), ['한지우', '정유나']);
  assert.deepEqual(memberSummary(after), { total: '멤버 8명', breakdown: '사람 3 · Agent 2 · PM 1', pool: '+2 POOL' });
});

test('previews come from data: A beside B with real-name marks, and v1.1 drops 노래 and adds the fiction label', () => {
  const s04 = pagesViewModel('s04_preview_a').workContext!;
  assert.deepEqual([s04.comparePreview?.spec.hero.badge?.text, s04.comparePreview?.spec.notice?.text, s04.preview?.spec.hero.badge?.text],
    ['실명', 'feed 공유 · 검수 대기 2건', 'fiction 포함']);
  assert.equal(pagesViewModel('s05_confirmed').workContext!.comparePreview, undefined, 'the A path is withdrawn once B is kept');
  const v10 = pagesViewModel('s05_built').workContext!.preview!, v11 = pagesViewModel('s06_built').workContext!.preview!;
  assert.deepEqual([v10.spec.activeVersion, v10.spec.formats.includes('노래'), v10.spec.annotations ?? []], ['v1.0', true, []]);
  assert.deepEqual([v11.spec.activeVersion, v11.spec.formats.includes('노래'), v11.spec.annotations?.map(a => a.text)], ['v1.1', false, ['fiction이 섞인 이야기예요']]);
});

test('no internal id leaks into card, member or preview text at any checkpoint', () => {
  const ids = [...Object.values(I), ...Object.values(P), ...Object.values(M), X.search, X.proposal, X.build10, X.build11, X.changeSet,
    ...Object.values(X.handoffs), ...Object.values(X.previews), 'pv25:'].filter(id => id.length >= 4);
  for (const checkpoint of CHECKPOINTS) {
    for (const me of [M.planner, M.ux]) {
      const vm = pagesViewModel(checkpoint, me);
      const wc = vm.workContext!;
      const texts = [
        ...cardsOf(vm).flatMap(c => cardTexts(c.card)),
        ...Object.values(memberSummary(vm.members)), ...vm.members.map(m => m.displayName),
        ...[wc.preview, wc.comparePreview].flatMap(p => (p ? [p.label, p.caption ?? '', JSON.stringify(p.spec)] : [])),
      ];
      for (const text of texts) for (const id of ids) assert.ok(!text.includes(id), `${checkpoint}: "${id}" in "${text}"`);
    }
  }
});
