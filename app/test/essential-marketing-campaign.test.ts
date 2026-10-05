import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { S27, initialS27, reduceS27, traceNode, viewS27, type S27Scenario } from '../demo/scripted/marketing-campaign/index.ts';

const at = (beat: number) => reduceS27(initialS27(), { type: 'goto', beat });
const unique = (ids: string[]) => assert.equal(new Set(ids).size, ids.length);

test('S27 references exist and every node and line has exactly one reveal', () => {
  const nodeIds = new Set(S27.nodes.map(n => n.id));
  const lineIds = new Set(S27.lines.map(n => n.id));
  const actors = new Set(S27.actors.map(n => n.id));
  const capabilities = new Set(S27.capabilities.map(n => n.id));
  for (const collection of [S27.nodes, S27.lines, S27.beats, S27.actors, S27.capabilities, S27.metrics]) unique(collection.map(n => n.id));
  assert.equal(actors.size, 6);
  for (const edge of S27.edges) {
    assert.ok(nodeIds.has(edge.from), edge.from);
    assert.ok(nodeIds.has(edge.to), edge.to);
  }
  for (const node of S27.nodes) {
    assert.ok(actors.has(node.actorId));
    if (node.supersedes) assert.ok(nodeIds.has(node.supersedes));
    for (const section of node.sections ?? []) {
      assert.ok(section.grounds.length);
      section.grounds.forEach(id => assert.ok(nodeIds.has(id), id));
    }
  }
  const revealed = new Set<string>();
  for (const beat of S27.beats) {
    beat.nodes.forEach(id => { assert.ok(nodeIds.has(id), id); revealed.add(id); });
    beat.lines.forEach(id => {
      assert.ok(lineIds.has(id), id);
      const line = S27.lines.find(n => n.id === id)!;
      assert.ok(actors.has(line.actorId));
      line.refs?.forEach(ref => assert.ok(revealed.has(ref), `${id} cites unrevealed ${ref}`));
    });
    if (beat.highlight) assert.ok(revealed.has(beat.highlight));
    assert.ok(beat.capabilities.length);
    beat.capabilities.forEach(id => assert.ok(capabilities.has(id), id));
  }
  assert.deepEqual(S27.beats.flatMap(b => b.nodes).sort(), [...nodeIds].sort());
  assert.deepEqual(S27.beats.flatMap(b => b.lines).sort(), [...lineIds].sort());
  assert.equal(capabilities.size, 10);
  for (const capability of S27.capabilities.filter(c => c.availability === 'implemented')) {
    assert.ok(capability.evidence?.length);
    capability.evidence!.forEach(path => assert.ok(existsSync(new URL(`../../${path}`, import.meta.url)), path));
  }
  assert.deepEqual(S27.metrics.map(m => m.id), ['m-reexplain', 'm-search', 'm-rework', 'm-trace']);
});

test('S27 follows all five stages and preserves the revision story', () => {
  const stages = S27.beats.map(b => b.stage);
  assert.deepEqual(stages, [...stages].sort());
  assert.deepEqual([...new Set(stages)], [1, 2, 3, 4, 5]);
  assert.ok(S27.beats.length >= 10 && S27.beats.length <= 14);
  for (const beat of S27.beats.filter(b => b.stage < 5)) {
    assert.equal(beat.focus, beat.stage === 1 ? 'meeting' : beat.stage === 4 ? 'hub' : 'slack');
  }
  assert.equal(S27.beats.at(-1)!.focus, 'hub');
  assert.equal(S27.beats.at(-1)!.highlight, 'art-v11');
  const old = S27.nodes.find(n => n.id === 'art-v1')!;
  const revised = S27.nodes.find(n => n.id === 'art-v11')!;
  assert.equal(old.version, 'v1.0');
  assert.equal(revised.version, 'v1.1');
  assert.equal(revised.supersedes, old.id);
  assert.ok(revised.changes!.length >= 4);
  assert.match(old.sections!.map(s => s.body).join('\n'), /압도적/);
  assert.doesNotMatch(revised.sections!.map(s => s.body).join('\n'), /압도적/);
  const oldB = old.sections!.find(s => s.label === '메타 피드 B')!;
  assert.match(oldB.body, /하루 종일 가는 배터리/);
  assert.doesNotMatch(oldB.body, /측정 조건|\*/);
  assert.match(revised.sections!.find(s => s.label === '메타 피드 B')!.body, /\* 측정 조건:/);
  assert.match(revised.sections!.find(s => s.label.includes('숏폼'))!.body, /^0–3초: 인물 클로즈업/);
  for (const section of revised.sections!) {
    for (const id of ['d-message', 'd-target', 'd-constraint']) assert.ok(section.grounds.includes(id));
    assert.ok(section.grounds.includes('fb-brand'));
  }
  assert.ok(S27.lines.some(l => l.place === '#s27-launch' && l.actorId === 'ensemble' && l.text.includes('준호') && l.refs?.includes('art-v11')));
  for (const text of [...S27.lines.map(l => l.text), ...S27.nodes.flatMap(n => n.sections?.map(s => s.body) ?? [])]) assert.doesNotMatch(text, /\d[\d,]*\s*원/);
});

test('S27 copy stays at presentation density', () => {
  const len = (s: string) => [...s].length;
  const fits = (s: string, max: number, what: string) => assert.ok(s.length > 0 && len(s) <= max, `${what} (${len(s)}/${max}): ${s}`);
  const image = /^\/s27\/[a-z0-9-]+\.jpg$/;
  for (const beat of S27.beats) {
    fits(beat.headline, 15, `${beat.id} headline`);
    fits(beat.caption, 60, `${beat.id} caption`);
  }
  unique(S27.beats.map(b => b.headline));
  for (const beat of S27.beats.filter(b => b.stage === 1)) assert.equal(beat.capabilities[0], 'cap-meeting', beat.id);
  for (const beat of S27.beats.filter(b => (b.stage === 2 || b.stage === 5) && b.focus === 'slack')) assert.equal(beat.capabilities[0], 'cap-slack', beat.id);
  assert.ok(S27.beats.find(b => b.id === 'beat-03')!.capabilities.includes('cap-meeting'));
  for (const node of S27.nodes) {
    fits(node.short, 10, `${node.id} short`);
    fits(node.summary, 45, `${node.id} summary`);
  }
  for (const line of S27.lines) {
    fits(line.text, 45, `${line.id} text`);
    assert.ok((line.refs?.length ?? 0) <= 4, `${line.id} refs`);
  }
  for (const c of S27.capabilities) {
    fits(c.label, 14, `${c.id} label`);
    fits(c.note, 50, `${c.id} note`);
  }
  for (const m of S27.metrics) {
    fits(m.legacy, 14, `${m.id} legacy`);
    fits(m.ensemble, 14, `${m.id} ensemble`);
  }
  for (const art of S27.nodes.filter(n => n.kind === 'artifact')) {
    assert.deepEqual(art.sections!.map(s => s.label), ['메타 피드 A', '메타 피드 B', '메타 피드 C', '숏폼 15초 스크립트']);
    for (const section of art.sections!) {
      assert.match(section.image ?? '', image, `${art.id} ${section.label} image`);
      const [head, body, ...rest] = section.body.split('\n');
      if (section.label.startsWith('메타 피드')) {
        fits(head!, 14, `${art.id} ${section.label} headline`);
        fits(body!, 30, `${art.id} ${section.label} body`);
        const footnote = art.id === 'art-v11' && section.label === '메타 피드 B';
        assert.equal(rest.length, footnote ? 1 : 0, `${art.id} ${section.label} lines`);
        if (footnote) { assert.match(rest[0]!, /^\* 측정 조건: /); fits(rest[0]!, 40, 'footnote'); }
      } else {
        const cuts = section.body.split('\n');
        assert.equal(cuts.length, 4);
        cuts.forEach(cut => fits(cut, 22, `${art.id} cut`));
      }
    }
  }
  assert.deepEqual(S27.nodes.filter(n => n.kind === 'artifact').map(n => n.sections!.map(s => s.image)), [
    ['/s27/ad-a.jpg', '/s27/ad-b.jpg', '/s27/ad-c.jpg', '/s27/short-v10.jpg'],
    ['/s27/ad-a.jpg', '/s27/ad-b.jpg', '/s27/ad-c.jpg', '/s27/short-v11.jpg'],
  ]);
  const changes = S27.nodes.find(n => n.id === 'art-v11')!.changes!;
  assert.ok(changes.length >= 4 && changes.length <= 5);
  changes.forEach(c => fits(c, 16, 'change'));
  for (const actor of S27.actors) {
    if (actor.kind === 'agent') assert.equal(actor.avatar, undefined, actor.id);
    else assert.equal(actor.avatar, `/s27/avatar-${actor.id}.jpg`);
    if (actor.avatar) assert.match(actor.avatar, image);
  }
});

test('S27 reveals are cumulative with fresh IDs, resolved focus and bounded navigation', () => {
  assert.deepEqual(initialS27(), { beat: -1, surface: null, selectedNodeId: null, artifactVersionId: null });
  const intro = viewS27(initialS27());
  assert.equal(intro.beat, null);
  assert.equal(intro.surface, 'meeting');
  assert.equal(intro.canPrev, false);
  assert.deepEqual(intro.nodes, []);
  let state = initialS27();
  const revealed = new Set<string>();
  const lines = new Set<string>();
  for (const beat of S27.beats) {
    state = reduceS27(state, { type: 'next' });
    beat.nodes.forEach(id => revealed.add(id));
    beat.lines.forEach(id => lines.add(id));
    const view = viewS27(state);
    assert.deepEqual(view.nodes.map(n => n.id), S27.nodes.filter(n => revealed.has(n.id)).map(n => n.id));
    assert.deepEqual(view.meeting, S27.lines.filter(l => lines.has(l.id) && l.surface === 'meeting'));
    assert.deepEqual(view.slack, S27.lines.filter(l => lines.has(l.id) && l.surface === 'slack'));
    assert.deepEqual(view.freshNodeIds, beat.nodes);
    assert.deepEqual(view.freshLineIds, beat.lines);
    assert.equal(view.surface, beat.focus);
    assert.deepEqual(view.capabilities.map(c => c.id), beat.capabilities);
    assert.deepEqual(view.edges, S27.edges.filter(e => revealed.has(e.from) && revealed.has(e.to)));
    assert.equal(view.selected?.node.id ?? null, beat.highlight ?? null);
  }
  assert.equal(viewS27(state).canNext, false);
  assert.equal(reduceS27(state, { type: 'next' }).beat, S27.beats.length - 1);
  assert.equal(at(999).beat, S27.beats.length - 1);
  assert.equal(at(-999).beat, -1);
  assert.equal(reduceS27(initialS27(), { type: 'prev' }).beat, -1);
  assert.deepEqual(reduceS27(state, { type: 'reset' }), initialS27());
  const previous = viewS27(reduceS27(at(10), { type: 'prev' }));
  assert.ok(!previous.nodes.some(n => n.id === 'art-v11'));
  assert.equal(previous.artifact?.id, 'art-v1');
});

test('S27 selection and version overrides reject hidden IDs and clear on navigation', () => {
  const hidden = at(0);
  assert.strictEqual(reduceS27(hidden, { type: 'select_node', id: 'art-v11' }), hidden);
  assert.strictEqual(reduceS27(hidden, { type: 'view_artifact', id: 'art-v1' }), hidden);
  assert.strictEqual(reduceS27(hidden, { type: 'view_artifact', id: 'src-spec' }), hidden);
  assert.strictEqual(reduceS27(hidden, { type: 'select_node', id: 'missing' }), hidden);
  let state = at(11);
  assert.deepEqual(viewS27(state).artifactVersions.map(n => n.id), ['art-v1', 'art-v11']);
  assert.equal(viewS27(state).artifact?.id, 'art-v11');
  state = reduceS27(state, { type: 'show_surface', surface: 'meeting' });
  state = reduceS27(state, { type: 'select_node', id: 'src-guide' });
  state = reduceS27(state, { type: 'view_artifact', id: 'art-v1' });
  assert.equal(viewS27(state).surface, 'meeting');
  assert.equal(viewS27(state).selected?.node.id, 'src-guide');
  assert.equal(viewS27(state).artifact?.id, 'art-v1');
  assert.equal(viewS27(reduceS27(state, { type: 'view_artifact', id: null })).artifact?.id, 'art-v11');
  assert.equal(viewS27(reduceS27(state, { type: 'select_node', id: null })).selected?.node.id, 'art-v11');
  for (const action of [{ type: 'prev' }, { type: 'next' }, { type: 'goto', beat: 7 }, { type: 'reset' }] as const) {
    const next = reduceS27(state, action);
    assert.equal(next.surface, null);
    assert.equal(next.selectedNodeId, null);
    assert.equal(next.artifactVersionId, null);
  }
});

test('S27 upstream BFS includes prior version, feedback, decisions and sources without cycles', () => {
  const ids = new Set(S27.nodes.map(n => n.id));
  const trace = traceNode('art-v11', ids)!;
  const upstreamIds = trace.upstream.map(item => item.node.id);
  for (const id of ['art-v1', 'fb-legal', 'fb-brand', 'd-message', 'd-target', 'd-constraint', 'src-spec']) assert.ok(upstreamIds.includes(id), id);
  unique(upstreamIds);
  assert.ok(!upstreamIds.includes('art-v11'));
  assert.deepEqual(trace.upstream.map(n => n.depth), trace.upstream.map(n => n.depth).sort((a, b) => a - b));
  assert.equal(trace.upstream.find(n => n.node.id === 'src-spec')?.depth, 2);
  assert.equal(trace.upstream.find(n => n.node.id === 'art-v1')?.depth, 1);
  assert.deepEqual(trace.downstream.map(n => n.node.id), ['art-v1']);
  assert.equal(traceNode('art-v11', new Set(['art-v1'])), null);
  assert.equal(traceNode('missing', ids), null);
  const limited = traceNode('art-v11', new Set(['art-v11', 'd-message', 'src-spec']))!;
  assert.deepEqual(limited.upstream.map(n => [n.node.id, n.depth]), [['d-message', 1], ['src-spec', 2]]);
  assert.deepEqual(limited.downstream, []);
  const custom: S27Scenario = { ...S27, edges: [], beats: [{ ...S27.beats[0]!, nodes: ['art-v11'], highlight: 'art-v11', capabilities: ['cap-tools', 'cap-meeting'] }] };
  assert.deepEqual(traceNode('art-v11', ids, custom)!.upstream, []);
  const view = viewS27({ ...initialS27(), beat: 0 }, custom);
  assert.equal(view.artifact?.id, 'art-v11');
  assert.deepEqual(view.capabilities.map(c => c.id), ['cap-tools', 'cap-meeting']);
});
