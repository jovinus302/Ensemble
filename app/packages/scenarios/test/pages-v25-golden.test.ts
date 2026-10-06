import { describe, expect, it } from 'vitest';
import { project, type AnyEvent, type ContextCard, type LedgerEvent, type NewLedgerEvent, type WorkContextState } from '@ensemble/core';
import { PAGES_COMPLETION, PAGES_ITEMS as I, PAGES_LINES, PAGES_MEMBERS as M, PAGES_STEPS, PAGES_TEAM, pagesV25Ledger, type PagesCheckpoint } from '../src/index.ts';

const ctx = { projectId: 'pages', targetProductId: 'pages' };
const stamp = (events: NewLedgerEvent[]): LedgerEvent[] => events.map((e, i) => ({ ...e, id: `e${i}`, seq: i + 1, at: e.at ?? '2026-10-02T00:00:00Z' }));
const golden = pagesV25Ledger(ctx);
const at = (checkpoint: PagesCheckpoint) => project(stamp(golden.events.slice(0, golden.checkpoints[checkpoint])));
const visible = (wc: WorkContextState) => [...wc.items.values()].filter(i => !i.supersededBy);
const status = (wc: WorkContextState, id: string) => wc.items.get(id)?.status;

describe('Pages v2.5 golden ledger', () => {
  it('scene 03 detects one conflict, one violation, one undecided and four missing items', () => {
    const wc = at('s03_detected').workContext!;
    const issues = visible(wc).map(i => i.status).filter(s => ['conflict', 'violation', 'undecided', 'missing'].includes(s));
    expect(issues.sort()).toEqual(['conflict', 'missing', 'missing', 'missing', 'missing', 'undecided', 'violation']);
    expect(wc.version).toBe('0.3');
  });

  it('scene 04 merges D1, opens one branch, invites two pool experts and is decided by the planner', () => {
    const aligned = at('s04_aligned').workContext!;
    expect(status(aligned, I.d1)).toBe('merged');
    expect(aligned.items.get(I.d2Manual)!.supersededBy).toBe(I.d1);
    expect(visible(aligned).some(i => ['conflict', 'violation', 'undecided', 'missing'].includes(i.status))).toBe(false);
    expect(aligned.branches.get(I.d2)!.options.map(o => o.optionId)).toEqual(['A', 'B']);
    const joined = at('s04_pool_joined');
    expect([...joined.members.values()].filter(m => m.source === 'pool').map(m => m.memberId)).toEqual([M.policy, M.narrative]);
    const previewA = at('s04_preview_a').workContext!;
    expect(previewA.branches.get(I.d2)!.resolved).toMatchObject({ optionId: 'B', decidedBy: M.planner });
    expect(previewA.branches.get(I.d2)!.preview?.optionId).toBe('A');
    expect([...previewA.proposals.values()].map(p => p.status)).toEqual(['generated']);
  });

  it('scene 05 confirms v1.0, expands D/F/S/V, finishes three handoffs and builds v1.0', () => {
    const confirmed = at('s05_confirmed').workContext!;
    expect(confirmed.version).toBe('1.0');
    expect(confirmed.branches.get(I.d2)!.preview).toBeUndefined();
    const keys = [...confirmed.proposals.values()][0]!.expandedItemIds.map(id => confirmed.items.get(id)!.key);
    expect(keys).toEqual(['D1', 'D2', 'F1', 'F2', 'F3', 'F4', 'S1', 'S2', 'V1', 'V2']);
    const built = at('s05_built').workContext!;
    expect([...built.handoffs.values()].map(h => [h.handoff.toolId, h.status])).toEqual([['figma', 'done'], ['prompt-studio', 'done'], ['dev-tools', 'done']]);
    expect([...built.builds.values()].map(b => b.version)).toEqual(['1.0']);
  });

  it('scene 06 applies a v1.1 change set and rebuilds only the changed part', () => {
    const wc = at('s06_built').workContext!;
    expect(wc.version).toBe('1.1');
    expect(status(wc, I.f5)).toBe('added');
    expect(status(wc, I.f2)).toBe('excluded');
    expect([...wc.handoffs.values()].filter(h => h.handoff.round === 2)).toHaveLength(3);
    expect(golden.checkpoints.s06_built).toBe(golden.events.length);
  });

  it('every chat card and reference points at a record that exists', () => {
    const state = at('s06_built'), wc = state.workContext!;
    const messageIds = new Set(state.messages.map(m => m.messageId));
    const exists = (card: ContextCard) => {
      switch (card.kind) {
        case 'branch_options': return wc.branches.has(card.itemId);
        case 'branch_preview': return wc.branches.get(card.itemId)?.options.some(o => o.optionId === card.optionId);
        case 'pm_steps': return (!card.searchId || wc.pool.searches.has(card.searchId)) && (!card.proposalId || wc.proposals.has(card.proposalId));
        case 'pool_candidates': return wc.pool.searches.has(card.searchId);
        case 'proposal': case 'expansion': return wc.proposals.has(card.proposalId);
        case 'tool_handoffs': return card.handoffIds.every(id => wc.handoffs.has(id));
        case 'build': return wc.builds.has(card.buildId);
        case 'change_set': return wc.changeSets.has(card.changeSetId);
      }
    };
    expect(wc.cards.size).toBe(10);
    for (const [messageId, card] of wc.cards) {
      expect(messageIds.has(messageId)).toBe(true);
      expect(exists(card)).toBe(true);
    }
    for (const item of wc.items.values()) for (const id of [...(item.derivedFrom ?? []), ...(item.supersededBy ? [item.supersededBy] : [])]) expect(wc.items.has(id)).toBe(true);
    for (const e of wc.edges.values()) for (const end of [e.from, e.to]) expect(wc.items.has(end) || end.startsWith('tool:')).toBe(true);
  });
});

describe('Pages v2.5 script', () => {
  it('scripts people (and the two scene-03 agent premises) only, never the PM', () => {
    const team = new Set([...PAGES_TEAM.map(m => m.memberId), M.policy, M.narrative]);
    for (const l of PAGES_LINES) expect(team.has(l.as)).toBe(true);
    expect(PAGES_LINES.filter(l => l.as === M.storyAgent || l.as === M.uiAgent).map(l => l.scene)).toEqual([3, 3]);
    expect(PAGES_STEPS.filter(s => s.action === 'say').map(s => s.line)).toEqual(PAGES_LINES.map((_, i) => i));
    expect(PAGES_COMPLETION).toEqual({ kind: 'buildProduced', version: '1.1' });
  });

  it('records every scripted line in the golden ledger in script order', () => {
    const typed = stamp(golden.events) as AnyEvent[];
    const said = typed.flatMap(e => e.type === 'message_recorded' ? [e.payload.text] : e.type === 'reply_recorded' ? [e.payload.text] : []);
    expect(said).toEqual(PAGES_LINES.map(l => l.text));
  });
});
