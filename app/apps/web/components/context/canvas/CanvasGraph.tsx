"use client";
// 작업 흐름 B 소유: 레이어 열과 연결선. 노드는 CSS 격자로 놓고, 연결선은 그려진 노드의 위치를 재서 SVG로 잇는다.
// 좁은 칸에서는 열이 세로로 쌓이고 연결선은 숨는다(work-context.css의 container query).
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { VmContextEdge } from "../../../lib/work-context-view-model";
import { CanvasNodeView } from "./CanvasNode";
import type { CanvasColumn } from "./layout";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

interface EdgePath { id: string; d: string; kind: VmContextEdge["kind"]; stale: boolean }
interface Box { left: number; top: number; right: number; bottom: number; cy: number }

/** container 기준 위치. offset*는 변형(transform) 전 배치라 등장 애니메이션 중에도 흔들리지 않는다. */
function boxOf(el: HTMLElement, container: HTMLElement): Box {
  let left = 0, top = 0, node: HTMLElement | null = el;
  while (node && node !== container) { left += node.offsetLeft; top += node.offsetTop; node = node.offsetParent as HTMLElement | null; }
  return { left, top, right: left + el.offsetWidth, bottom: top + el.offsetHeight, cy: top + Math.min(el.offsetHeight / 2, 18) };
}

function pathBetween(a: Box, b: Box): string {
  if (b.left >= a.right - 1) {
    const c = Math.max(12, (b.left - a.right) / 2);
    return `M${a.right} ${a.cy} C${a.right + c} ${a.cy} ${b.left - c} ${b.cy} ${b.left} ${b.cy}`;
  }
  if (a.left >= b.right - 1) {
    const c = Math.max(12, (a.left - b.right) / 2);
    return `M${a.left} ${a.cy} C${a.left - c} ${a.cy} ${b.right + c} ${b.cy} ${b.right} ${b.cy}`;
  }
  // 같은 열(충돌 등): 오른쪽으로 둥글게 잇는다.
  const x1 = a.right, x2 = b.right, bulge = Math.max(x1, x2) + 14;
  return `M${x1} ${a.cy} C${bulge} ${a.cy} ${bulge} ${b.cy} ${x2} ${b.cy}`;
}

export function CanvasGraph({ columns, edges }: { columns: CanvasColumn[]; edges: VmContextEdge[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<EdgePath[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useIsoLayoutEffect(() => {
    const container = ref.current;
    if (!container) return;
    const measure = () => {
      const nodes = new Map<string, HTMLElement>();
      container.querySelectorAll<HTMLElement>("[data-node]").forEach(el => nodes.set(el.dataset.node!, el));
      const next: EdgePath[] = [];
      for (const e of edges) {
        const a = nodes.get(e.from), b = nodes.get(e.to);
        if (a && b) next.push({ id: e.id, d: pathBetween(boxOf(a, container), boxOf(b, container)), kind: e.kind, stale: !!e.stale });
      }
      setPaths(prev => prev.length === next.length && prev.every((p, i) => p.id === next[i]!.id && p.d === next[i]!.d && p.stale === next[i]!.stale) ? prev : next);
      setSize(prev => prev.w === container.scrollWidth && prev.h === container.scrollHeight ? prev : { w: container.scrollWidth, h: container.scrollHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    container.querySelectorAll("[data-node]").forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, [columns, edges]);

  return (
    <div className="cv-graph" ref={ref}>
      <svg className="cv-edges" width={size.w} height={size.h} viewBox={`0 0 ${size.w || 1} ${size.h || 1}`} aria-hidden="true">
        {paths.map(p => <path key={p.id} d={p.d} pathLength={1} className="cv-edge" data-kind={p.kind} data-stale={p.stale || undefined} />)}
      </svg>
      <div className="cv-columns" style={{ ["--cv-cols" as string]: columns.length }}>
        {columns.map(col => (
          <section key={col.id} className="cv-col" aria-label={col.label}>
            <h3 className="cv-col-title">{col.label}</h3>
            <ul className="cv-col-nodes">
              {col.nodes.map(node => <li key={node.id}><CanvasNodeView node={node} /></li>)}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
