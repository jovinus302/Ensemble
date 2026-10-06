import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PAGES_IDS, PAGES_MEMBERS } from '@ensemble/scenarios';
import { ContextMessageCard } from '../components/context/ContextMessageCard';
import { ContextPane } from '../components/context/ContextPane';
import { PreviewPane } from '../components/context/PreviewPane';
import { buildMockViewModel } from '../lib/mock-view-model';
import { pagesViewModel } from './fixtures/pages-v25';

describe('WORK CONTEXT view model (foundation contract)', () => {
  it('stays absent for projects without a Work Context', () => {
    expect(buildMockViewModel('owner').workContext).toBeUndefined();
  });

  it('scene 03: shows the detected issues, the channel name and no preview yet', () => {
    const vm = pagesViewModel('s03_detected');
    const wc = vm.workContext!;
    expect(wc.channelName).toBe('pages-general');
    expect(wc.versionLabel).toBe('v0.3');
    expect(wc.summary.map(s => `${s.label} ${s.count}`)).toEqual(['연결 3', '충돌 1', '위반 1', '미정 1', '누락 4']);
    expect(wc.preview).toBeUndefined();
    expect(vm.messages.filter(m => m.kind === 'agent').map(m => m.authorId)).toEqual([PAGES_MEMBERS.storyAgent, PAGES_MEMBERS.uiAgent]);
  });

  it('scene 04: attaches cards to PM messages and compares the A preview with Proposal v1', () => {
    const vm = pagesViewModel('s04_preview_a');
    const cards = vm.messages.flatMap(m => m.contextCard ? [m.contextCard.kind] : []);
    expect(cards).toEqual(['branch_options', 'pm_steps', 'pm_steps', 'branch_preview']);
    const pool = vm.messages.find(m => m.contextCard?.kind === 'pm_steps')!.contextCard;
    expect(pool?.kind === 'pm_steps' && pool.candidates?.map(c => [c.name, c.joined])).toEqual([['한지우', true], ['정유나', true]]);
    expect(vm.members.filter(m => m.pool).map(m => m.displayName)).toEqual(['한지우', '정유나']);
    expect(vm.workContext!.preview?.label).toBe('Proposal v1 GENERATED');
    expect(vm.workContext!.comparePreview?.spec.hero.badge?.text).toBe('실명');
  });

  it('scene 05–06: resolves handoff progress in place and offers the change card to the decider only', () => {
    const built = pagesViewModel('s05_built').workContext!;
    expect(built.handoffs.map(h => h.statusLabel)).toEqual(['제작 완료', '제작 완료', '빌드 완료']);
    expect(built.preview?.label).toBe('v1.0 빌드');
    const change = (me: string) => pagesViewModel('s06_change_proposed', me).messages.find(m => m.contextCard?.kind === 'change_set')!.contextCard;
    expect(change(PAGES_MEMBERS.planner)).toMatchObject({ changeSet: { id: PAGES_IDS.changeSet, canResolve: true } });
    expect(change(PAGES_MEMBERS.ux)).toMatchObject({ changeSet: { canResolve: false } });
    expect(pagesViewModel('s06_change_proposed').workContext!.versionLabel).toBe('v1.0 → v1.1');
  });

  it('renders the three panes and every card kind without throwing', () => {
    for (const checkpoint of ['s03_detected', 's04_preview_a', 's05_built', 's06_built'] as const) {
      const vm = pagesViewModel(checkpoint);
      expect(renderToStaticMarkup(createElement(ContextPane, { context: vm.workContext! }))).toContain('WORK CONTEXT');
      renderToStaticMarkup(createElement(PreviewPane, { context: vm.workContext! }));
      for (const m of vm.messages) if (m.contextCard) renderToStaticMarkup(createElement(ContextMessageCard, { card: m.contextCard, onResolveChange: () => {} }));
    }
    const html = renderToStaticMarkup(createElement(PreviewPane, { context: pagesViewModel('s06_built').workContext! }));
    expect(html).toContain('v1.1 빌드');
    expect(html).not.toContain('노래');
  });
});
