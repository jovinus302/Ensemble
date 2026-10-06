// Stable ids of the Pages v2.5 scenario (docs/design/pages-v25-runtime-demo.md). The fake PM, the golden ledger,
// the script and the UI tests all use these, so a scene always reproduces the same records.

export const PAGES_SCENARIO_KEY = 'pages-v25';
export const PAGES_CONTEXT_ID = 'PRJ-0518';

export const PAGES_MEMBERS = {
  planner: 'seoyeon',
  ux: 'doyun',
  dev: 'hajun',
  storyAgent: 'story-agent',
  uiAgent: 'ui-agent',
  /** Pool experts: member ids after they join. */
  policy: 'jiwoo',
  narrative: 'yuna',
} as const;

export const PAGES_POOL = { policy: 'pool-jiwoo', narrative: 'pool-yuna', backend: 'pool-minseo', growth: 'pool-taeho' } as const;

/** Work Context item ids. Keys (I1, D2 …) are the visible labels; ids never change when a title does. */
export const PAGES_ITEMS = {
  // Scene 03: read out of the conversation
  i1: 'i1', i2: 'i2', d1: 'd1', d2Manual: 'd2-manual',
  fictionLevel: 'd-fiction-level', sharePrivacy: 'd-share-privacy',
  fourDaily: 'f-four-daily', dataFiction: 'f-data-fiction',
  threeTabs: 's-three-tabs', onboarding9: 's-onboarding-9', metricMissing: 'v-what',
  // Scene 04: organized
  i3: 'i3', d2: 'd2-fiction',
  storyTemplates: 'c-story', uiGuide: 'c-ui', uxOnboarding: 'c-doyun', policyInput: 'c-jiwoo', narrativeInput: 'c-yuna',
  // Scene 05: Proposal v1 expanded
  f1: 'f1', f2: 'f2', f3: 'f3', f4: 'f4', s1: 's1', s2: 's2', v1: 'v1', v2: 'v2',
  // Scene 06: v1.1 change
  f5: 'f5',
} as const;

export const PAGES_IDS = {
  search: 'pool-search-d2',
  proposal: 'proposal-v1',
  build10: 'build-v1.0',
  build11: 'build-v1.1',
  changeSet: 'change-v1.1',
  handoffs: { figma: 'handoff-figma-1', prompt: 'handoff-prompt-1', dev: 'handoff-dev-1', figma2: 'handoff-figma-2', prompt2: 'handoff-prompt-2', dev2: 'handoff-dev-2' },
  previews: { proposal: 'preview-proposal-v1', branchA: 'preview-branch-a', design: 'preview-design-s1s2', build10: 'preview-build-v1.0', build11: 'preview-build-v1.1' },
} as const;

/** Points in the golden ledger a UI test can render (pagesV25Ledger().checkpoints). */
export type PagesCheckpoint =
  | 'seeded' | 's03_detected' | 's04_aligned' | 's04_pool_invited' | 's04_pool_joined' | 's04_proposal' | 's04_preview_a'
  | 's05_confirmed' | 's05_handoff' | 's05_built' | 's06_change_proposed' | 's06_built';
