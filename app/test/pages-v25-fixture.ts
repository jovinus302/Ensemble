// Pages v2.5: golden ledger checkpoints as stamped ledger events and as the real web view model.
// Shared by the essential test and by the UI workstreams' checks (not a test file itself).
import type { LedgerEvent } from '@ensemble/core';
import { PAGES_MEMBERS, PAGES_NOW, pagesV25Ledger, type PagesCheckpoint } from '@ensemble/scenarios';
import { buildViewModel } from '../apps/web/lib/build-view-model.ts';
import type { ViewModel } from '../apps/web/lib/view-model.ts';

const ctx = { projectId: 'pages', targetProductId: 'pages' };

export function pagesEvents(checkpoint: PagesCheckpoint): LedgerEvent[] {
  const golden = pagesV25Ledger(ctx);
  return golden.events.slice(0, golden.checkpoints[checkpoint]).map((e, i) => ({ ...e, id: `e${i}`, seq: i + 1, at: e.at ?? PAGES_NOW.toISOString() }));
}

export function pagesViewModel(checkpoint: PagesCheckpoint, me: string = PAGES_MEMBERS.planner): ViewModel {
  return buildViewModel(pagesEvents(checkpoint), { me, mode: 'scenario', busy: false, now: PAGES_NOW });
}
