'use client';

import type { ContextNode, NodeKind } from '.';
import { KIND_SHORT, useS27 } from './shared';

const RAIL_KINDS: NodeKind[] = ['source', 'decision', 'artifact', 'feedback'];

/** Slim "connected to Ensemble" strip: counts per kind, pulsing where this beat added nodes. Opens the hub. */
export function ConnectedRail({ nodes, fresh, active }: { nodes: ContextNode[]; fresh: Set<string>; active: boolean }) {
  const { dispatch } = useS27();
  const items = RAIL_KINDS.flatMap((kind) => {
    const of = nodes.filter((n) => n.kind === kind);
    if (of.length === 0) return [];
    const value = kind === 'artifact' ? of.at(-1)?.version ?? String(of.length) : String(of.length);
    return [{ kind, value, isFresh: of.some((n) => fresh.has(n.id)) }];
  });
  const summary = items.map((i) => `${KIND_SHORT[i.kind]} ${i.value}`).join(', ');
  return (
    <button
      type="button"
      className={`s27-rail${active ? ' is-active' : ''}${fresh.size > 0 ? ' is-fresh' : ''}`}
      onClick={() => dispatch({ type: 'show_surface', surface: 'hub' })}
      aria-label={`앙상블에 연결됨${summary ? `: ${summary}` : ''} — 허브 열기`}
    >
      <span className="s27-rail-mark" aria-hidden="true">E</span>
      <span className="s27-rail-label">앙상블에 연결됨</span>
      {items.length === 0 && <span className="s27-rail-empty">대기 중</span>}
      {items.map((i) => (
        <span key={i.kind} className={`s27-rail-item s27-kind-${i.kind}${i.isFresh ? ' is-fresh' : ''}`} aria-hidden="true">
          <span className="s27-rail-dot" />
          {KIND_SHORT[i.kind]} <strong className="num">{i.value}</strong>
        </span>
      ))}
    </button>
  );
}
