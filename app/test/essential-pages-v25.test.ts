import assert from 'node:assert/strict';
import test from 'node:test';
import { project, workContextFacts, type ContextCard, type EventPayloads, type EventType, type LedgerEvent } from '@ensemble/core';
import { PAGES_COMPLETION, PAGES_IDS, PAGES_ITEMS as I, PAGES_LINES, PAGES_MEMBERS as M, PAGES_STEPS, PAGES_TEAM } from '@ensemble/scenarios';
import { buildViewModel } from '../apps/web/lib/build-view-model.ts';
import { pagesEvents, pagesViewModel } from './pages-v25-fixture.ts';

const issues = ['conflict', 'violation', 'undecided', 'missing'];
const state = (checkpoint: Parameters<typeof pagesEvents>[0]) => project(pagesEvents(checkpoint));

test('only a human settles a Work Context branch, proposal or change set', () => {
  const events: LedgerEvent[] = [];
  const emit = <K extends EventType>(type: K, payload: EventPayloads[K], actor: LedgerEvent['actor'] = { kind: 'pm', id: 'pm' }) =>
    events.push({ id: `e${events.length}`, seq: events.length + 1, at: '2026-10-02T01:00:00Z', projectId: 'p', targetProductId: 'p', actor, type, payload });
  const human = { kind: 'human', id: 'planner' } as const;
  emit('context_item_upserted', { item: { itemId: 'early', layer: 'intent', title: 'x', status: 'stated', sourceMemberId: 'pm', sourceMessageIds: [] } });
  emit('member_joined', { memberId: 'planner', kind: 'human', displayName: '기획자' }, human);
  emit('member_joined', { memberId: 'agent', kind: 'agent', displayName: 'Story Agent' }, human);
  emit('context_session_started', { contextId: 'C', code: 'C', title: 'T', channelName: 'c', version: '0.3' });
  emit('context_item_upserted', { item: { itemId: 'd2', layer: 'decision', title: 'fiction · 공유', status: 'branch', sourceMemberId: 'pm', sourceMessageIds: [] } });
  emit('context_branch_opened', { itemId: 'd2', question: '?', sourceMessageIds: [], options: [{ optionId: 'A', title: 'A', gains: [], risks: [] }, { optionId: 'B', title: 'B', gains: [], risks: [] }] });
  emit('proposal_generated', { proposalId: 'p1', version: 1, title: 'v1', decisionItemIds: ['d2'], filledItemIds: [], inputItemIds: [], screens: [], sourceMessageIds: [] });
  emit('context_change_proposed', { changeSetId: 'c1', fromVersion: '1.0', toVersion: '1.1', changes: [], staleItemIds: [], unaffectedItemIds: [], sourceMessageIds: [] });
  // Neither an agent nor an unlisted option may decide.
  emit('context_branch_resolved', { itemId: 'd2', optionId: 'B', decidedBy: 'agent', evidenceMemberIds: [], sourceMessageIds: [] });
  emit('context_branch_resolved', { itemId: 'd2', optionId: 'C', decidedBy: 'planner', evidenceMemberIds: [], sourceMessageIds: [] });
  emit('proposal_confirmed', { proposalId: 'p1', contextVersion: '1.0', confirmedBy: 'agent', sourceMessageIds: [] });
  emit('context_change_resolved', { changeSetId: 'c1', outcome: 'applied', by: 'agent' });
  let wc = project(events).workContext!;
  assert.equal(wc.items.has('early'), false, 'events before the session are ignored');
  assert.equal(wc.branches.get('d2')!.resolved, undefined);
  assert.equal(wc.proposals.get('p1')!.status, 'generated');
  assert.equal(wc.changeSets.get('c1')!.status, 'proposed');
  assert.equal(wc.version, '0.3');
  emit('context_branch_resolved', { itemId: 'd2', optionId: 'B', decidedBy: 'planner', evidenceMemberIds: [], sourceMessageIds: [] }, human);
  emit('proposal_confirmed', { proposalId: 'p1', contextVersion: '1.0', confirmedBy: 'planner', sourceMessageIds: [] }, human);
  emit('context_change_resolved', { changeSetId: 'c1', outcome: 'applied', by: 'planner' }, human);
  emit('context_change_resolved', { changeSetId: 'c1', outcome: 'reverted', by: 'planner' }, human);
  wc = project(events).workContext!;
  assert.equal(wc.branches.get('d2')!.resolved?.optionId, 'B');
  assert.equal(wc.changeSets.get('c1')!.status, 'applied', 'a change set closes once');
  assert.equal(wc.version, '1.1');
});

test('the Pages v2.5 golden ledger reproduces scenes 03–06 from people-only input', () => {
  const s03 = state('s03_detected').workContext!;
  assert.deepEqual([...s03.items.values()].map(i => i.status).filter(s => issues.includes(s)).sort(), ['conflict', 'missing', 'missing', 'missing', 'missing', 'undecided', 'violation']);
  const aligned = state('s04_aligned').workContext!;
  assert.equal([...aligned.items.values()].some(i => !i.supersededBy && issues.includes(i.status)), false, 'organizing absorbs every detected issue');
  const joined = state('s04_pool_joined');
  assert.deepEqual([...joined.members.values()].filter(m => m.source === 'pool').map(m => m.memberId), [M.policy, M.narrative]);
  const previewA = state('s04_preview_a').workContext!;
  assert.equal(previewA.branches.get(I.d2)!.resolved?.decidedBy, M.planner);
  assert.equal(previewA.branches.get(I.d2)!.preview?.optionId, 'A');
  const built = state('s05_built').workContext!;
  assert.equal(built.version, '1.0');
  assert.deepEqual([...built.proposals.values()][0]!.expandedItemIds.map(id => built.items.get(id)!.key), ['D1', 'D2', 'F1', 'F2', 'F3', 'F4', 'S1', 'S2', 'V1', 'V2']);
  assert.deepEqual([...built.handoffs.values()].map(h => [h.handoff.toolId, h.status]), [['figma', 'done'], ['prompt-studio', 'done'], ['dev-tools', 'done']]);
  const final = state('s06_built'), wc = final.workContext!;
  assert.equal(wc.version, '1.1');
  assert.deepEqual([wc.items.get(I.f5)!.status, wc.items.get(I.f2)!.status], ['added', 'excluded']);

  // Script: people only, plus the two scene-03 agent premises written by the scenario runner (documented exception).
  const team = new Set([...PAGES_TEAM.map(m => m.memberId), M.policy, M.narrative]);
  assert.ok(PAGES_LINES.every(l => team.has(l.as)));
  assert.deepEqual(PAGES_STEPS.filter(s => s.action === 'say').map(s => s.line), PAGES_LINES.map((_, i) => i));
  assert.deepEqual(PAGES_COMPLETION, { kind: 'buildProduced', version: '1.1' });
  const recorded = pagesEvents('s06_built').filter(e => e.type === 'message_recorded');
  assert.deepEqual(recorded.map(e => (e.payload as EventPayloads['message_recorded']).text), PAGES_LINES.map(l => l.text));
  assert.deepEqual(recorded.filter(e => e.actor.kind !== 'human').map(e => e.actor), [{ kind: 'system', id: 'scenario' }, { kind: 'system', id: 'scenario' }]);

  // Every chat card and reference points at a record that exists.
  const exists = (card: ContextCard) => {
    switch (card.kind) {
      case 'branch_options': return wc.branches.has(card.itemId);
      case 'branch_preview': return !!wc.branches.get(card.itemId)?.options.some(o => o.optionId === card.optionId);
      case 'pm_steps': return (!card.searchId || wc.pool.searches.has(card.searchId)) && (!card.proposalId || wc.proposals.has(card.proposalId));
      case 'pool_candidates': return wc.pool.searches.has(card.searchId);
      case 'proposal': case 'expansion': return wc.proposals.has(card.proposalId);
      case 'tool_handoffs': return card.handoffIds.every(id => wc.handoffs.has(id));
      case 'build': return wc.builds.has(card.buildId);
      case 'change_set': return wc.changeSets.has(card.changeSetId);
    }
  };
  const messageIds = new Set(final.messages.map(m => m.messageId));
  assert.equal(wc.cards.size, 12);
  for (const [messageId, card] of wc.cards) assert.ok(messageIds.has(messageId) && exists(card), `${card.kind} on ${messageId}`);
  for (const item of wc.items.values()) for (const id of [...(item.derivedFrom ?? []), ...(item.supersededBy ? [item.supersededBy] : [])]) assert.ok(wc.items.has(id), id);
  for (const e of wc.edges.values()) for (const end of [e.from, e.to]) assert.ok(wc.items.has(end) || end.startsWith('tool:'), end);
  assert.equal(workContextFacts(final, { kind: 'message', messageId: 'pv25:m:15' })!.decider, M.planner);
});

test('the web view model shows the Work Context only where it exists and offers the change card to the decider only', () => {
  const plain = buildViewModel(pagesEvents('seeded').filter(e => e.type !== 'context_session_started'), { me: M.planner, mode: 'scenario', busy: false });
  assert.equal(plain.workContext, undefined);
  const s03 = pagesViewModel('s03_detected').workContext!;
  assert.deepEqual(s03.summary.map(s => `${s.label} ${s.count}`), ['연결 3', '충돌 1', '위반 1', '미정 1', '누락 4']);
  const s04 = pagesViewModel('s04_preview_a');
  assert.deepEqual(s04.messages.flatMap(m => m.contextCard ? [m.contextCard.kind] : []), ['branch_options', 'pm_steps', 'pool_candidates', 'pm_steps', 'proposal', 'branch_preview']);
  const card = <K extends string>(kind: K) => s04.messages.find(m => m.contextCard?.kind === kind)?.contextCard;
  const pool = card('pool_candidates'), proposal = card('proposal');
  assert.ok(pool?.kind === 'pool_candidates' && proposal?.kind === 'proposal');
  assert.deepEqual(pool.candidates.map(c => [c.name, c.role, c.note, c.available, c.joined]), [['한지우', '개인정보·AI 정책', '유사 과제 3건', true, true], ['정유나', '내러티브 디자이너', '숏폼·동화 경험', true, true]]);
  assert.deepEqual([proposal.proposal.decisions.map(d => d.key), proposal.proposal.screens.length, proposal.proposal.filledTitles.length], [['D1', 'D2'], 3, 3]);
  assert.deepEqual(s04.members.filter(m => m.pool).map(m => m.displayName), ['한지우', '정유나']);
  assert.equal(s04.workContext!.comparePreview?.spec.hero.badge?.text, '실명');
  assert.deepEqual(pagesViewModel('s05_built').workContext!.handoffs.map(h => h.statusLabel), ['제작 완료', '제작 완료', '빌드 완료']);
  const change = (me: string) => {
    const card = pagesViewModel('s06_change_proposed', me).messages.find(m => m.contextCard?.kind === 'change_set')?.contextCard;
    assert.ok(card?.kind === 'change_set');
    return card.changeSet;
  };
  assert.deepEqual([change(M.planner).id, change(M.planner).canResolve, change(M.ux).canResolve], [PAGES_IDS.changeSet, true, false]);
  const v11 = pagesViewModel('s06_built').workContext!.preview!;
  assert.equal(v11.label, 'v1.1 빌드');
  assert.equal(v11.spec.formats.includes('노래'), false);
  assert.equal(v11.spec.hero.badge?.text, 'fiction 포함', 'the deck shows the fiction badge from v1.1 on');
  assert.equal(pagesViewModel('s05_built').workContext!.preview!.spec.hero.badge, undefined);
});
