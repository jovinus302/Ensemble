import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { SessionConnector } from '@ensemble/agents';
import { applyWorkContextOutput, project, type LedgerEvent, type WorkContextState } from '@ensemble/core';
import { PAGES_IDS as X, PAGES_ITEMS as I, PAGES_MEMBERS as M } from '@ensemble/scenarios';
import { MemoryLedgerStore } from '@ensemble/store';
import { FakePmLlm } from '../apps/web/lib/fake-connector.ts';
import { RuntimeError, WebRuntime } from '../apps/web/lib/runtime.ts';
import { sceneLabel } from '../apps/web/components/format.ts';
import { pagesEvents } from './pages-v25-fixture.ts';

// No agent sessions run in the Pages scenario; the transport only has to exist.
const transport: SessionConnector = {
  async startSession(agentId, projectId) { return { threadId: `${projectId}:${agentId}`, workspace: process.cwd() }; },
  async startTask() { return 'turn'; }, async sendUpdate() { return { sent: true as const }; },
  onEvent() { return () => {}; }, async stop() {},
};

/** The Work Context with message ids replaced by what they are (a person's line, or the n-th PM message) and ledger positions dropped. */
function normalized(events: readonly LedgerEvent[]) {
  const state = project(events), wc = state.workContext as WorkContextState;
  const names = new Map<string, string>();
  let pm = 0;
  for (const m of state.messages) names.set(m.messageId, m.authorId === 'pm' ? `pm#${pm++}` : `said:${m.authorId}:${m.text}`);
  const n = (ids: string[]) => ids.map(id => names.get(id) ?? `unknown:${id}`);
  return {
    ...wc,
    items: new Map([...wc.items].map(([id, item]) => [id, { ...item, sourceMessageIds: n(item.sourceMessageIds) }])),
    branches: new Map([...wc.branches].map(([id, b]) => [id, { ...b, ...(b.resolved ? { resolved: { ...b.resolved, sourceMessageIds: n(b.resolved.sourceMessageIds) } } : {}) }])),
    proposals: new Map([...wc.proposals].map(([id, p]) => [id, { ...p, proposal: { ...p.proposal, sourceMessageIds: n(p.proposal.sourceMessageIds) }, ...(p.confirmed ? { confirmed: { ...p.confirmed, sourceMessageIds: n(p.confirmed.sourceMessageIds) } } : {}) }])),
    changeSets: new Map([...wc.changeSets].map(([id, c]) => [id, { ...c, change: { ...c.change, sourceMessageIds: n(c.change.sourceMessageIds) } }])),
    previews: new Map([...wc.previews].map(([id, p]) => [id, { preview: p.preview, withdrawn: p.withdrawn }])),
    cards: new Map([...wc.cards].map(([id, card]) => [n([id])[0]!, card])),
  };
}

test('the fake runtime replays pages-v25 to the end and leaves the golden Work Context; the change card answers the decider once', async t => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'ensemble-pages-'));
  const rt = new WebRuntime({ dataDir, store: new MemoryLedgerStore(), llm: new FakePmLlm(), connector: transport, timers: false, integrationDelayMs: 5 });
  t.after(async () => { await rt.stop(); rmSync(dataDir, { recursive: true, force: true }); });
  await rt.run(() => rt.startScenario('pages-v25'));
  const scenes: string[] = [];
  for (let i = 0; i < 30; i++) {
    const vm = await rt.state();
    if (vm.scenario?.done) break;
    const label = sceneLabel(vm.scenario!.name);
    if (scenes.at(-1) !== label) scenes.push(label);
    await rt.scenarioNext();
  }
  const vm = await rt.state();
  assert.equal(vm.scenario?.done, true, vm.activity?.stalled?.reason ?? 'not done');
  assert.deepEqual(scenes, ['장면 03', '장면 04', '장면 05', '장면 06']);
  assert.equal(vm.me, M.planner, 'an unknown viewer falls back to the decider');
  const events = await rt.store.read({ projectId: rt.meta.projectId });
  assert.deepStrictEqual(normalized(events), normalized(pagesEvents('s06_built')));

  // 변경 적용 / 되돌리기: only the decider, and only while the change is open.
  await assert.rejects(rt.resolveContextChange(X.changeSet, M.ux, 'reverted'), (e: unknown) => e instanceof RuntimeError && e.status === 403);
  await assert.rejects(rt.resolveContextChange(X.changeSet, M.planner, 'reverted'), (e: unknown) => e instanceof RuntimeError && e.status === 409);
  await assert.rejects(rt.resolveContextChange('missing', M.planner, 'applied'), (e: unknown) => e instanceof RuntimeError && e.status === 404);

  // The existing scene 1–3 script still starts through the same entrypoint.
  await rt.run(() => rt.startScenario('scene-1-3-continuous', true));
  const continuous = await rt.state();
  assert.equal(continuous.workContext, undefined);
  assert.match(continuous.scenario!.name, /scene-1-3-continuous · 장면 1/);
});

test('Work Context validation drops answers that decide for people, use pool or tools that are not there, or repeat a round', () => {
  const context = { projectId: 'pages', targetProductId: 'pages' };
  const at = (checkpoint: Parameters<typeof pagesEvents>[0]) => pagesEvents(checkpoint);
  const run = (events: LedgerEvent[], ops: unknown[]) => applyWorkContextOutput(events, { ops, speech: [], reason: 'test' }, { context, trigger: { kind: 'message', messageId: 'x' }, considerationId: 'c' });
  const joined = at('s04_pool_joined');
  const agentLine = project(joined).messages.find(m => m.authorId === M.storyAgent)!.messageId;
  const plannerLine = project(joined).messages.find(m => m.authorId === M.planner)!.messageId;
  const cases: [LedgerEvent[], unknown][] = [
    [joined, { type: 'resolve_branch', itemId: I.d2, optionId: 'B', decidedBy: M.storyAgent, evidenceMemberIds: [], sourceMessageIds: [agentLine] }],
    [joined, { type: 'resolve_branch', itemId: I.d2, optionId: 'B', decidedBy: M.ux, evidenceMemberIds: [], sourceMessageIds: [plannerLine] }],
    [joined, { type: 'generate_proposal', proposalId: 'p2', version: 1, title: 't', decisionItemIds: [], filledItemIds: [], inputItemIds: [], screens: ['home'], sourceMessageIds: [] }],
    [at('s04_aligned'), { type: 'search_pool', searchId: 's2', forItemId: I.d2, reason: 'r', steps: ['s'], candidateIds: ['pool-minseo'] }],
    [at('s04_aligned'), { type: 'search_pool', searchId: 's2', forItemId: I.d2, reason: 'r', steps: ['s'], candidateIds: ['someone-else'] }],
    [at('s04_preview_a'), { type: 'confirm_proposal', proposalId: X.proposal, contextVersion: '1.0', confirmedBy: M.ux, sourceMessageIds: [plannerLine] }],
    [at('s05_handoff'), { type: 'handoff_tools', handoffs: [{ handoffId: 'h9', toolId: 'jira', itemIds: [I.s1], title: 't', round: 3 }] }],
    [at('s05_handoff'), { type: 'handoff_tools', handoffs: [{ handoffId: 'h9', toolId: 'figma', itemIds: [I.s1], title: 't', round: 1 }] }],
  ];
  for (const [events, op] of cases) {
    const result = run(events, [op]);
    assert.equal(result.problems.length, 1, JSON.stringify(op));
    assert.deepEqual(result.append.map(e => e.type), ['pm_considered'], JSON.stringify(op));
  }
  // A valid op in the same answer still applies.
  const mixed = run(joined, [cases[0]![1], { type: 'upsert_item', item: { itemId: 'extra', layer: 'metric', title: '지표', status: 'missing', sourceMemberId: 'pm', sourceMessageIds: [] } }]);
  assert.deepEqual(mixed.append.map(e => e.type), ['context_item_upserted', 'pm_considered']);
});
