// Pages v2.5 화면 테스트용: golden ledger의 체크포인트를 실제 buildViewModel로 그린 화면 모델.
import type { LedgerEvent } from '@ensemble/core';
import { PAGES_MEMBERS, PAGES_NOW, pagesV25Ledger, type PagesCheckpoint } from '@ensemble/scenarios';
import { buildViewModel } from '../../lib/build-view-model';
import type { ViewModel } from '../../lib/view-model';

const ctx = { projectId: 'pages', targetProductId: 'pages' };

export function pagesEvents(checkpoint: PagesCheckpoint): LedgerEvent[] {
  const golden = pagesV25Ledger(ctx);
  return golden.events.slice(0, golden.checkpoints[checkpoint]).map((e, i) => ({ ...e, id: `e${i}`, seq: i + 1, at: e.at ?? PAGES_NOW.toISOString() }));
}

export function pagesViewModel(checkpoint: PagesCheckpoint, me: string = PAGES_MEMBERS.planner): ViewModel {
  return buildViewModel(pagesEvents(checkpoint), { me, mode: 'scenario', busy: false, now: PAGES_NOW });
}
