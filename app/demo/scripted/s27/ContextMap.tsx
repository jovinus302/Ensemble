'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { EDGE_RELATION_LABEL, NODE_KIND_LABEL, type ContextEdge, type ContextNode, type Trace } from '.';
import { KIND_ORDER, nodeShort, useS27 } from './shared';

const COL_GAP = 28;

interface Box { x: number; y: number; w: number; h: number }
interface Geometry { width: number; height: number; boxes: Record<string, Box> }

function edgePath(a: Box, b: Box, colA: number, colB: number) {
  let x1: number, x2: number, c1: number, c2: number;
  const y1 = a.y + a.h / 2;
  const y2 = b.y + b.h / 2;
  if (colA < colB) {
    x1 = a.x + a.w; x2 = b.x;
    const d = Math.max(28, (x2 - x1) / 2);
    c1 = x1 + d; c2 = x2 - d;
  } else if (colA > colB) {
    x1 = a.x; x2 = b.x + b.w;
    const d = Math.max(28, (x1 - x2) / 2);
    c1 = x1 - d; c2 = x2 + d;
  } else {
    x1 = a.x + a.w; x2 = b.x + b.w;
    c1 = x1 + 34; c2 = x2 + 34;
  }
  return `M ${x1} ${y1} C ${c1} ${y1}, ${c2} ${y2}, ${x2} ${y2}`;
}

/** Label sits in the column gap beside one end of the edge, so it never covers a card. */
function labelPos(a: Box, b: Box, colA: number, colB: number, at: 'from' | 'to', gap: number) {
  const half = gap / 2;
  if (at === 'from') {
    const x = colA > colB ? a.x - half : a.x + a.w + half;
    return { x, y: a.y + a.h / 2 };
  }
  const x = colA < colB ? b.x - half : b.x + b.w + half;
  return { x, y: b.y + b.h / 2 };
}

export function ContextMap({ nodes, edges, fresh, trace }: {
  nodes: ContextNode[];
  edges: ContextEdge[];
  fresh: Set<string>;
  trace: Trace | null;
}) {
  const { dispatch } = useS27();
  const canvasRef = useRef<HTMLDivElement>(null);
  const [geo, setGeo] = useState<Geometry>({ width: 0, height: 0, boxes: {} });
  const [hoverEdge, setHoverEdge] = useState<number | null>(null);
  const [hoverNode, setHoverNode] = useState<string | null>(null);

  const nodeKey = nodes.map((n) => n.id).join(',');
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const measure = () => {
      const base = canvas.getBoundingClientRect();
      const boxes: Record<string, Box> = {};
      canvas.querySelectorAll<HTMLElement>('[data-node]').forEach((el) => {
        const r = el.getBoundingClientRect();
        boxes[el.dataset.node!] = { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height };
      });
      setGeo({ width: canvas.scrollWidth, height: canvas.scrollHeight, boxes });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [nodeKey]);

  const kinds = KIND_ORDER.filter((kind) => nodes.some((n) => n.kind === kind));
  const selectedId = trace?.node.id ?? null;
  const upstreamIds = new Set(trace?.upstream.map((u) => u.node.id) ?? []);
  const downstreamIds = new Set(trace?.downstream.map((d) => d.node.id) ?? []);
  const traceIds = new Set(selectedId ? [selectedId, ...upstreamIds] : []);
  const colOf = (id: string) => {
    const kind = nodes.find((n) => n.id === id)?.kind;
    return kind ? KIND_ORDER.indexOf(kind) : 0;
  };

  const edgeState = (e: ContextEdge) => {
    if (!selectedId) return 'normal';
    if (traceIds.has(e.from) && traceIds.has(e.to)) return 'trace';
    if (e.from === selectedId && downstreamIds.has(e.to)) return 'down';
    return 'dim';
  };

  return (
    <div className="s27-map-scroll">
      <div className={`s27-map${selectedId ? ' has-selection' : ''}`} ref={canvasRef} style={{ columnGap: COL_GAP, gridTemplateColumns: `repeat(${kinds.length}, minmax(84px, 1fr))`, minWidth: kinds.length * 84 + (kinds.length - 1) * COL_GAP }}>
        <svg className="s27-edges" width={geo.width} height={geo.height} aria-hidden="true">
          <defs>
            {['normal', 'trace', 'down', 'dim'].map((s) => (
              <marker key={s} id={`s27-arrow-${s}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L8,4 L0,8 z" className={`s27-arrow s27-arrow-${s}`} />
              </marker>
            ))}
          </defs>
          {edges.map((e, i) => {
            const a = geo.boxes[e.from];
            const b = geo.boxes[e.to];
            if (!a || !b) return null;
            const d = edgePath(a, b, colOf(e.from), colOf(e.to));
            const s = edgeState(e);
            const fresh2 = fresh.has(e.from) || fresh.has(e.to);
            return (
              <g key={`${e.from}-${e.to}-${e.relation}`} className={`s27-edge s27-edge-${s} s27-rel-${e.relation}${fresh2 ? ' is-fresh' : ''}${hoverEdge === i ? ' is-hover' : ''}`}>
                <path d={d} className="s27-edge-line" markerEnd={`url(#s27-arrow-${s})`} />
                <path d={d} className="s27-edge-hit" onMouseEnter={() => setHoverEdge(i)} onMouseLeave={() => setHoverEdge(null)} />
              </g>
            );
          })}
        </svg>
        {edges.map((e, i) => {
          const a = geo.boxes[e.from];
          const b = geo.boxes[e.to];
          if (!a || !b) return null;
          // Relation labels only on hover, so the resting map stays quiet.
          let at: 'from' | 'to' | null = null;
          if (hoverNode !== null && e.to === hoverNode) at = 'from';
          else if (hoverNode !== null && e.from === hoverNode) at = 'to';
          else if (hoverEdge === i) at = 'from';
          if (at === null) return null;
          const pos = labelPos(a, b, colOf(e.from), colOf(e.to), at, COL_GAP);
          return (
            <span key={`l-${e.from}-${e.to}-${e.relation}`} className={`s27-edge-label s27-edge-label-${edgeState(e)}`} style={{ left: pos.x, top: pos.y }}>
              {EDGE_RELATION_LABEL[e.relation]}
            </span>
          );
        })}
        {kinds.map((kind) => {
          const col = nodes.filter((n) => n.kind === kind);
          return (
            <div key={kind} className={`s27-map-col s27-kind-${kind}`}>
              <div className="s27-map-col-head">{NODE_KIND_LABEL[kind]}{col.length > 0 && <span className="s27-map-count">{col.length}</span>}</div>
              {col.map((n) => {
                const role = n.id === selectedId ? 'selected' : upstreamIds.has(n.id) ? 'upstream' : downstreamIds.has(n.id) ? 'downstream' : selectedId ? 'dim' : 'normal';
                return (
                  <button
                    key={n.id}
                    type="button"
                    data-node={n.id}
                    className={`s27-node s27-kind-${n.kind} is-${role}${fresh.has(n.id) ? ' is-fresh' : ''}`}
                    aria-pressed={n.id === selectedId}
                    aria-label={`${NODE_KIND_LABEL[n.kind]}: ${n.title}`}
                    title={n.title}
                    onClick={() => dispatch({ type: 'select_node', id: n.id === selectedId ? null : n.id })}
                    onMouseEnter={() => setHoverNode(n.id)}
                    onMouseLeave={() => setHoverNode(null)}
                    onFocus={() => setHoverNode(n.id)}
                    onBlur={() => setHoverNode(null)}
                  >
                    <span className="s27-node-title">{nodeShort(n)}</span>
                    {role === 'upstream' && <span className="s27-sr">선택 항목의 근거</span>}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
