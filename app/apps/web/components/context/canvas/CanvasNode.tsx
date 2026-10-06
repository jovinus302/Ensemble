"use client";
// 작업 흐름 B 소유: 캔버스 노드 — 항목 칩(키·제목·상태 태그·출처), 분기 상자(A/B, 선택·예상), 제작 도구.
import type { VmContextBranch, VmContextItem } from "../../../lib/work-context-view-model";
import type { CanvasNode, CanvasToolNode } from "./layout";

/** "D1과 충돌", "비용 한도 위반", "생성 버튼 위치 미정", "누락": 상태 라벨은 늘 글자로도 보인다. */
export function statusTag(item: Pick<VmContextItem, "statusLabel" | "note">): string | undefined {
  const { statusLabel: label, note } = item;
  if (note && label) return note.endsWith(label) ? note : `${note} ${label}`;
  return label ?? note;
}

function Source({ item }: { item: VmContextItem }) {
  return <>
    {item.source.kind === "pool" && <span className="cv-pool">POOL</span>}
    <span className="cv-avatar" data-kind={item.source.kind} title={item.source.name} aria-label={`출처 ${item.source.name}`}>{item.source.initial}</span>
  </>;
}

function ItemChip({ item, branch, compact }: { item: VmContextItem; branch?: VmContextBranch; compact?: boolean }) {
  const tag = statusTag(item);
  const chosen = branch?.options.find(o => o.chosen);
  return (
    <div className="cv-node" data-node={compact ? undefined : item.id} data-tone={item.tone} data-status={item.status}>
      <span className="cv-node-label">
        <span className="cv-node-kind"><span className="cv-dot" aria-hidden="true" />{item.key ?? item.layerLabel}</span>
        <span className="cv-node-title">{item.title}</span>
      </span>
      {(tag || chosen) && <span className="cv-node-tags">
        {chosen && item.status !== "branch" && <span className="cv-tag" data-tone="ok">{chosen.optionId} 선택</span>}
        {tag && <span className="cv-tag" data-tone={item.tone}>{tag}</span>}
      </span>}
      <Source item={item} />
    </div>
  );
}

function BranchBox({ item, branch }: { item: VmContextItem; branch: VmContextBranch }) {
  const previewing = branch.options.find(o => o.previewing);
  return (
    <div className="cv-node cv-branch" data-node={item.id} data-tone="branch" data-status={item.status}>
      <div className="cv-branch-head">
        <span className="cv-node-label">
          <span className="cv-node-kind"><span className="cv-dot" aria-hidden="true" />{item.key ?? item.layerLabel}</span>
          <span className="cv-node-title">{item.title}</span>
        </span>
        <span className="cv-tag" data-tone="branch">{item.statusLabel ?? "분기"}</span>
        <Source item={item} />
      </div>
      <ul className="cv-branch-options" aria-label={branch.question}>
        {branch.options.map(o => (
          <li key={o.optionId} className="cv-option" data-chosen={o.chosen || undefined} data-previewing={o.previewing || undefined}>
            <span className="cv-option-id">{o.optionId}</span>
            <span className="cv-option-body">
              <span className="cv-option-title">{o.title}</span>
              {(o.gains.length > 0 || o.risks.length > 0) && <span className="cv-option-note">
                {o.gains.map(g => <span key={`g${g}`}>{g}</span>)}
                {o.risks.map(r => <span key={`r${r}`} className="cv-risk">{r}</span>)}
              </span>}
            </span>
            {o.chosen && <span className="cv-tag" data-tone="ok">선택</span>}
            {o.previewing && <span className="cv-tag" data-tone="info">예상</span>}
          </li>
        ))}
      </ul>
      {(branch.decidedByName || branch.evidenceNames.length > 0) && (
        <p className="cv-branch-by">
          {branch.evidenceNames.length > 0 && <>근거 {branch.evidenceNames.join(" · ")}</>}
          {branch.decidedByName && <>{branch.evidenceNames.length > 0 && " · "}확정 {branch.decidedByName}</>}
        </p>
      )}
      {previewing && branch.previewEffects && (
        <div className="cv-branch-preview">
          <span className="cv-branch-preview-title">예상 · {previewing.optionId} 적용 시</span>
          <ul>{branch.previewEffects.map(effect => <li key={effect}>{effect}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

function ToolChip({ tool }: { tool: CanvasToolNode }) {
  const status = [tool.statusLabel, tool.resent ? "재전달" : undefined].filter(Boolean).join(" · ");
  return (
    <div className="cv-node cv-tool" data-node={tool.id} data-tone={tool.done ? "ok" : "info"}>
      <span className="cv-node-label">
        <span className="cv-node-kind"><span className="cv-dot" aria-hidden="true" />{tool.name}</span>
        {tool.title && <span className="cv-node-title">{tool.title}</span>}
      </span>
      {status && <span className="cv-node-tags"><span className="cv-tag" data-tone={tool.done ? "ok" : "info"}>{status}</span></span>}
      {tool.ownerInitial && <span className="cv-avatar" data-kind="human" title={tool.ownerName} aria-label={`연결한 사람 ${tool.ownerName}`}>{tool.ownerInitial}</span>}
    </div>
  );
}

export function CanvasNodeView({ node }: { node: CanvasNode }) {
  if (node.kind === "tool") return <ToolChip tool={node.tool} />;
  if (node.branch && node.item.status === "branch") return <BranchBox item={node.item} branch={node.branch} />;
  return <ItemChip item={node.item} {...(node.branch ? { branch: node.branch } : {})} />;
}

/** 접어 둔 항목(연결선 없이). */
export function CompactItem({ item }: { item: VmContextItem }) {
  return <ItemChip item={item} compact />;
}
