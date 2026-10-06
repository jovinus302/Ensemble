// 작업 흐름 B 소유: WORK CONTEXT 캔버스의 열 배치(순수 함수). 화면과 핵심 회귀 검사가 같이 쓴다.
// 두 모양을 그린다(덱 장면 03·04 / 05·06):
// - 맥락: 의도 | 결정 | 기능·화면 | 참여 | (제작 도구) | 지표 — 대화에서 읽어 낸 항목과 정리 결과.
// - 흐름: Proposal이 확정되면 결정 → 기능 → 화면 → 제작 도구 → 지표로 펼친 항목만 열에 두고, 나머지(의도·참여·보완)는 접는다.
import type { ContextItemStatus, ContextLayer, ProductionToolId } from "@ensemble/core";
import type { VmContextBranch, VmContextEdge, VmContextItem, VmToolHandoff, VmWorkContext } from "../../../lib/work-context-view-model";

export type CanvasMode = "context" | "flow";
export interface CanvasToolNode { id: string; toolId: string; name: string; title?: string; statusLabel?: string; note?: string; ownerName?: string; ownerInitial?: string; resent: boolean; working: boolean; done: boolean }
export type CanvasNode =
  | { kind: "item"; id: string; item: VmContextItem; branch?: VmContextBranch }
  | { kind: "tool"; id: string; tool: CanvasToolNode };
export interface CanvasColumn { id: string; label: string; nodes: CanvasNode[] }
export interface CanvasLayout {
  mode: CanvasMode;
  columns: CanvasColumn[];
  /** 흐름 모드에서 접어 두는 항목(의도·참여·누락 보완 …). */
  folded: VmContextItem[];
  /** 양 끝이 열에 그려진 연결만. */
  edges: VmContextEdge[];
}

const FLOW_STATUSES = new Set<ContextItemStatus>(["confirmed", "verify_pending", "kept", "added", "updated", "stale", "excluded"]);
const FLOW_LAYERS = new Set<ContextLayer>(["decision", "feature", "screen", "metric"]);
const TOOL_NAMES: Record<ProductionToolId, string> = { figma: "Figma", "prompt-studio": "프롬프트 스튜디오", "dev-tools": "개발 도구" };
const TOOL_PREFIX = "tool:";

/** 같은 도구의 가장 최근 전달(round가 큰 것)을 노드 하나로. 연결선의 끝점 `tool:<id>`와 같은 id를 쓴다. */
function toolNodes(context: VmWorkContext, edges: VmContextEdge[]): CanvasToolNode[] {
  const latest = new Map<string, VmToolHandoff>();
  for (const h of context.handoffs) { const prev = latest.get(h.toolId); if (!prev || h.round >= prev.round) latest.set(h.toolId, h); }
  const ids = new Set<string>([...latest.keys()]);
  for (const e of edges) for (const end of [e.from, e.to]) if (end.startsWith(TOOL_PREFIX)) ids.add(end.slice(TOOL_PREFIX.length));
  return [...ids].map(toolId => {
    const h = latest.get(toolId);
    return { id: `${TOOL_PREFIX}${toolId}`, toolId, name: h?.toolName ?? TOOL_NAMES[toolId as ProductionToolId] ?? "제작 도구", resent: (h?.round ?? 1) > 1, working: h?.status === "in_progress", done: h?.status === "done",
      ...(h ? { title: h.title, statusLabel: h.statusLabel, ownerName: h.ownerName, ownerInitial: h.ownerInitial } : {}),
      // 진행 메모("통합 빌드 v1.1"). 상태 라벨과 같으면 한 번만 보인다.
      ...(h?.note && h.note !== h.statusLabel ? { note: h.note } : {}) };
  });
}

export function canvasLayout(context: VmWorkContext): CanvasLayout {
  const branches = new Map(context.branches.map(b => [b.itemId, b]));
  const node = (item: VmContextItem): CanvasNode => {
    const branch = branches.get(item.id);
    return { kind: "item", id: item.id, item, ...(branch ? { branch } : {}) };
  };
  const column = (id: string, label: string, items: VmContextItem[]): CanvasColumn => ({ id, label, nodes: items.map(node) });
  const of = (items: VmContextItem[], ...layers: ContextLayer[]) => items.filter(i => layers.includes(i.layer));

  const flowItems = context.items.filter(i => FLOW_LAYERS.has(i.layer) && FLOW_STATUSES.has(i.status));
  const mode: CanvasMode = context.proposal?.status === "confirmed" && flowItems.length ? "flow" : "context";
  const tools = toolNodes(context, context.edges);
  const toolColumn: CanvasColumn = { id: "tools", label: "제작 도구", nodes: tools.map(tool => ({ kind: "tool", id: tool.id, tool })) };

  let columns: CanvasColumn[], folded: VmContextItem[];
  if (mode === "flow") {
    const inFlow = new Set(flowItems.map(i => i.id));
    columns = [column("decision", "결정", of(flowItems, "decision")), column("feature", "기능", of(flowItems, "feature")), column("screen", "화면", of(flowItems, "screen")),
      toolColumn, column("metric", "지표", of(flowItems, "metric"))];
    folded = context.items.filter(i => !inFlow.has(i.id));
  } else {
    const product = of(context.items, "feature", "screen");
    const productLabel = [product.some(i => i.layer === "feature") && "기능", product.some(i => i.layer === "screen") && "화면"].filter(Boolean).join(" · ");
    columns = [column("intent", "의도", of(context.items, "intent")), column("decision", "결정", of(context.items, "decision")), column("product", productLabel, product),
      column("contribution", "참여", of(context.items, "contribution")), toolColumn, column("metric", "지표", of(context.items, "metric"))];
    folded = [];
  }
  columns = columns.filter(c => c.nodes.length);
  const drawn = new Set(columns.flatMap(c => c.nodes.map(n => n.id)));
  return { mode, columns, folded, edges: context.edges.filter(e => drawn.has(e.from) && drawn.has(e.to)) };
}
