import { S27 } from './scenario';
import type { S27Action, S27Scenario, S27State, S27View, Trace } from './types';

export function initialS27(): S27State {
  return { beat: -1, surface: null, selectedNodeId: null, artifactVersionId: null };
}

export function reduceS27(state: S27State, action: S27Action): S27State {
  switch (action.type) {
    case 'reset': return initialS27();
    case 'next':
    case 'prev':
    case 'goto': {
      const target = action.type === 'goto' ? action.beat : state.beat + (action.type === 'next' ? 1 : -1);
      const beat = Number.isNaN(target) ? -1 : Math.max(-1, Math.min(S27.beats.length - 1, Math.trunc(target)));
      return { ...initialS27(), beat };
    }
    case 'show_surface': return { ...state, surface: action.surface };
    case 'select_node':
    case 'view_artifact': {
      const nodes = viewS27(state).nodes;
      if (action.id !== null && !nodes.some(node => node.id === action.id && (action.type === 'select_node' || node.kind === 'artifact'))) return state;
      return action.type === 'select_node'
        ? { ...state, selectedNodeId: action.id }
        : { ...state, artifactVersionId: action.id };
    }
  }
}

export function traceNode(id: string, revealedIds: Set<string>, scenario: S27Scenario = S27): Trace | null {
  const nodes = new Map(scenario.nodes.filter(node => revealedIds.has(node.id)).map(node => [node.id, node]));
  const node = nodes.get(id);
  if (!node) return null;
  const upstream: Trace['upstream'] = [];
  const visited = new Set([id]);
  const queue = [{ id, depth: 0 }];
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i]!;
    for (const edge of scenario.edges) {
      const parent = nodes.get(edge.from);
      if (edge.to !== current.id || !parent || visited.has(parent.id)) continue;
      visited.add(parent.id);
      upstream.push({ node: parent, relation: edge.relation, depth: current.depth + 1 });
      queue.push({ id: parent.id, depth: current.depth + 1 });
    }
  }
  const downstream: Trace['downstream'] = [];
  const seen = new Set<string>();
  for (const edge of scenario.edges) {
    const child = nodes.get(edge.to);
    if (edge.from === id && child && child.id !== id && !seen.has(child.id)) {
      seen.add(child.id);
      downstream.push({ node: child, relation: edge.relation });
    }
  }
  return { node, upstream, downstream };
}

export function viewS27(state: S27State, scenario: S27Scenario = S27): S27View {
  const beat = scenario.beats[state.beat] ?? null;
  const revealed = scenario.beats.slice(0, Math.max(0, state.beat + 1));
  const nodeIds = new Set(revealed.flatMap(item => item.nodes));
  const lineIds = new Set(revealed.flatMap(item => item.lines));
  const nodes = scenario.nodes.filter(node => nodeIds.has(node.id));
  const lines = scenario.lines.filter(line => lineIds.has(line.id));
  // Reveal order is the chronology of versions, independent of node storage order.
  const artifactVersions = [...nodeIds].flatMap(id => {
    const node = nodes.find(item => item.id === id && item.kind === 'artifact');
    return node ? [node] : [];
  });
  const selectedId = state.selectedNodeId ?? beat?.highlight;
  return {
    index: state.beat, total: scenario.beats.length, beat, stage: beat?.stage ?? null,
    surface: state.surface ?? beat?.focus ?? 'meeting',
    meeting: lines.filter(line => line.surface === 'meeting'),
    slack: lines.filter(line => line.surface === 'slack'),
    freshLineIds: [...(beat?.lines ?? [])], nodes,
    edges: scenario.edges.filter(edge => nodeIds.has(edge.from) && nodeIds.has(edge.to)),
    freshNodeIds: [...(beat?.nodes ?? [])],
    selected: selectedId ? traceNode(selectedId, nodeIds, scenario) : null,
    artifactVersions,
    artifact: artifactVersions.find(node => node.id === state.artifactVersionId) ?? artifactVersions.at(-1) ?? null,
    capabilities: (beat?.capabilities ?? []).flatMap(id => {
      const capability = scenario.capabilities.find(item => item.id === id);
      return capability ? [capability] : [];
    }),
    canPrev: state.beat > -1, canNext: state.beat < scenario.beats.length - 1,
  };
}
