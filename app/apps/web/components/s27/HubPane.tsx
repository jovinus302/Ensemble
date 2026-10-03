'use client';

import { EDGE_RELATION_LABEL, NODE_KIND_LABEL, type ContextNode, type S27View, type Surface, type Trace } from '../../lib/s27';
import { ArtifactViewer } from './ArtifactViewer';
import { ContextMap } from './ContextMap';
import { actorById, nodeTitle, useS27 } from './shared';

const SURFACE_LABEL: Record<Surface, string> = { meeting: '화상 미팅', slack: '팀 메신저', hub: 'Ensemble 허브' };

export function HubPane({ view, artifactVersionId }: { view: S27View; artifactVersionId: string | null }) {
  const fresh = new Set(view.freshNodeIds);
  const selected = view.selected;
  // An explicitly chosen version wins; otherwise a selected artifact node; otherwise the latest revealed version.
  const artifact: ContextNode | null = artifactVersionId
    ? view.artifact
    : selected?.node.kind === 'artifact' ? selected.node : view.artifact;

  return (
    <section className="s27-hub" aria-label="Ensemble 허브">
      <header className="s27-pane-head s27-hub-head">
        <span className="s27-hub-mark" aria-hidden="true">E</span>
        <div>
          <div className="s27-pane-title">Ensemble 허브 · 컨텍스트 맵</div>
          <div className="s27-pane-sub">항목 {view.nodes.length}개 · 연결 {view.edges.length}개 · 카드를 누르면 근거를 거슬러 올라갑니다</div>
        </div>
      </header>
      {view.nodes.length === 0 ? (
        <p className="s27-empty s27-hub-empty">아직 허브에 연결된 항목이 없습니다.</p>
      ) : (
        <ContextMap nodes={view.nodes} edges={view.edges} fresh={fresh} trace={selected} />
      )}
      <div className="s27-hub-details">
        <Inspector trace={selected} />
        {artifact && <ArtifactViewer artifact={artifact} versions={view.artifactVersions} />}
      </div>
    </section>
  );
}

function Inspector({ trace }: { trace: Trace | null }) {
  const { dispatch } = useS27();
  if (!trace) {
    return (
      <div className="s27-card s27-inspector">
        <div className="s27-card-label">항목 상세</div>
        <p className="s27-muted">맵이나 채널의 칩을 선택하면 출처와 근거 연결을 보여줍니다.</p>
      </div>
    );
  }
  const { node, upstream, downstream } = trace;
  const actor = actorById.get(node.actorId);
  const depths = Array.from(new Set(upstream.map((u) => u.depth))).sort((a, b) => a - b);
  const item = (n: ContextNode, relation: keyof typeof EDGE_RELATION_LABEL) => (
    <li key={n.id}>
      <button type="button" className={`s27-trace-item s27-kind-${n.kind}`} onClick={() => dispatch({ type: 'select_node', id: n.id })}>
        <span className="s27-rel">{EDGE_RELATION_LABEL[relation]}</span>
        <span className="s27-chip-kind">{NODE_KIND_LABEL[n.kind]}</span>
        <span className="s27-trace-title">{nodeTitle(n)}</span>
      </button>
    </li>
  );
  return (
    <div className="s27-card s27-inspector" aria-live="polite">
      <div className="s27-card-label">항목 상세</div>
      <div className={`s27-kind-tag s27-kind-${node.kind}`}>{NODE_KIND_LABEL[node.kind]}{node.version ? ` · ${node.version}` : ''}</div>
      <h3 className="s27-inspector-title">{node.title}</h3>
      <p className="s27-inspector-summary">{node.summary}</p>
      <dl className="s27-meta">
        <dt>위치</dt><dd>{node.place}</dd>
        <dt>출처</dt><dd>{SURFACE_LABEL[node.origin]}</dd>
        <dt>작성</dt><dd>{actor ? `${actor.name} · ${actor.role}` : node.actorId}</dd>
        <dt>시각</dt><dd>{node.at}</dd>
      </dl>
      <div className="s27-trace-block">
        <div className="s27-trace-head">상류 근거 {upstream.length}건</div>
        {upstream.length === 0 && <p className="s27-muted s27-small">이 항목은 다른 항목에 기대지 않는 출발점입니다.</p>}
        {depths.map((d) => (
          <div key={d} className="s27-depth">
            <div className="s27-depth-label">{d}단계 위</div>
            <ul className="s27-trace-list">
              {upstream.filter((u) => u.depth === d).map((u) => item(u.node, u.relation))}
            </ul>
          </div>
        ))}
      </div>
      <div className="s27-trace-block">
        <div className="s27-trace-head">이 항목을 쓰는 곳 {downstream.length}건</div>
        {downstream.length === 0
          ? <p className="s27-muted s27-small">아직 이 항목을 이어받은 항목이 없습니다.</p>
          : <ul className="s27-trace-list">{downstream.map((d) => item(d.node, d.relation))}</ul>}
      </div>
    </div>
  );
}
