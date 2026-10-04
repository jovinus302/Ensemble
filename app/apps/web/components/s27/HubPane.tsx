'use client';

import { useEffect, useState } from 'react';
import { NODE_KIND_LABEL, type ContextNode, type NodeKind, type S27View, type Trace } from '../../lib/s27';
import { ArtifactViewer } from './ArtifactViewer';
import { ContextMap } from './ContextMap';
import { KIND_ORDER, KIND_SHORT, NodeChip, actorById, nodeShort } from './shared';

export function HubPane({ view, artifactVersionId }: { view: S27View; artifactVersionId: string | null }) {
  const fresh = new Set(view.freshNodeIds);
  const selected = view.selected;
  // An explicitly chosen version wins; otherwise a selected artifact node; otherwise the latest revealed version.
  const artifact: ContextNode | null = artifactVersionId
    ? view.artifact
    : selected?.node.kind === 'artifact' ? selected.node : view.artifact;

  return (
    <section className={`s27-hub${artifact ? ' has-artifact' : ''}`} aria-label="앙상블 허브">
      <div className="s27-hub-top">
        <div className="s27-hub-map">
          {view.nodes.length === 0 ? (
            <p className="s27-empty">아직 허브에 연결된 항목이 없습니다.</p>
          ) : (
            <ContextMap nodes={view.nodes} edges={view.edges} fresh={fresh} trace={selected} />
          )}
        </div>
        <Inspector trace={selected} />
      </div>
      {artifact && <ArtifactViewer artifact={artifact} versions={view.artifactVersions} />}
    </section>
  );
}

function Inspector({ trace }: { trace: Trace | null }) {
  const [openKind, setOpenKind] = useState<NodeKind | null>(null);
  const nodeId = trace?.node.id;
  useEffect(() => { setOpenKind(null); }, [nodeId]);

  if (!trace) return <p className="s27-inspector is-empty">맵에서 항목을 고르면 근거 연결을 보여줍니다.</p>;

  const { node, upstream, downstream } = trace;
  const actor = actorById.get(node.actorId);
  const groups = KIND_ORDER
    .map((kind) => ({ kind, nodes: upstream.filter((u) => u.node.kind === kind).map((u) => u.node) }))
    .filter((g) => g.nodes.length > 0);
  const open = groups.find((g) => g.kind === openKind);

  return (
    <div className="s27-inspector" aria-live="polite">
      <div className="s27-insp-head">
        <span className={`s27-kind-tag s27-kind-${node.kind}`}>{NODE_KIND_LABEL[node.kind]}</span>
        <h3 className="s27-insp-title" title={node.summary}>{nodeShort(node)}</h3>
        <span className="s27-insp-meta">{actor?.name ?? node.actorId} · {node.at}</span>
      </div>
      {groups.length === 0 ? (
        <p className="s27-insp-none">출발점 — 다른 항목에 기대지 않는 자료입니다.</p>
      ) : (
        <ol className="s27-chain" aria-label="근거 연결">
          {groups.map((g) => (
            <li key={g.kind} className="s27-chain-step">
              <button
                type="button"
                className={`s27-chain-group s27-kind-${g.kind}${openKind === g.kind ? ' is-open' : ''}`}
                aria-expanded={openKind === g.kind}
                onClick={() => setOpenKind(openKind === g.kind ? null : g.kind)}
              >
                {KIND_SHORT[g.kind]} <strong className="num">{g.nodes.length}</strong>
              </button>
              <span className="s27-chain-arrow" aria-hidden="true">→</span>
            </li>
          ))}
          <li className="s27-chain-step">
            <span className={`s27-chain-self s27-kind-${node.kind}`}>{nodeShort(node)}</span>
          </li>
        </ol>
      )}
      {open && (
        <div className="s27-chips s27-chain-detail" role="group" aria-label={`${NODE_KIND_LABEL[open.kind]} ${open.nodes.length}건`}>
          {open.nodes.map((n) => <NodeChip key={n.id} id={n.id} />)}
        </div>
      )}
      {downstream.length > 0 && (
        <div className="s27-insp-down">
          <span className="s27-insp-down-label">이어받은 곳</span>
          {downstream.slice(0, 3).map((d) => <NodeChip key={d.node.id} id={d.node.id} />)}
          {downstream.length > 3 && <span className="s27-insp-down-label">외 {downstream.length - 3}건</span>}
        </div>
      )}
    </div>
  );
}
