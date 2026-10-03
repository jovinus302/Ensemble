'use client';

import type { ChatLine } from '../../lib/s27';
import { Avatar, NodeChip, actorById, nodeById, useS27, voiceOf } from './shared';

export function ChatLineView({ line, fresh }: { line: ChatLine; fresh: boolean }) {
  const actor = actorById.get(line.actorId);
  const agent = actor?.kind === 'agent';
  const refs = line.refs ?? [];
  return (
    <li className={`s27-line s27-line-${line.kind}${agent ? ' is-agent' : ''}${fresh ? ' is-fresh' : ''}`} data-line={line.id}>
      <Avatar actorId={line.actorId} />
      <div className="s27-line-main">
        <div className="s27-line-head">
          <span className={`s27-line-name s27-voice-text-${voiceOf(line.actorId)}`}>{actor?.name ?? line.actorId}</span>
          {agent && <span className="s27-agent-tag">에이전트</span>}
          {actor && <span className="s27-line-role">{actor.role}</span>}
          <time className="s27-line-time">{line.at}</time>
        </div>
        {line.kind === 'capture' ? (
          <CaptureCard text={line.text} refs={refs} />
        ) : line.kind === 'artifact' ? (
          <>
            {line.text && <p className="s27-line-text">{line.text}</p>}
            <ArtifactCards refs={refs} />
          </>
        ) : (
          <>
            <p className="s27-line-text">{line.text}</p>
            {refs.length > 0 && <RefChips refs={refs} />}
          </>
        )}
      </div>
    </li>
  );
}

function RefChips({ refs }: { refs: string[] }) {
  return (
    <div className="s27-chips" aria-label="연결된 허브 항목">
      {refs.map((id) => <NodeChip key={id} id={id} />)}
    </div>
  );
}

function CaptureCard({ text, refs }: { text: string; refs: string[] }) {
  return (
    <div className="s27-capture">
      <div className="s27-capture-head">
        <span className="s27-capture-mark" aria-hidden="true">✓</span>
        <strong>앙상블에 기록됨</strong>
      </div>
      <p className="s27-line-text">{text}</p>
      {refs.length > 0 && <RefChips refs={refs} />}
    </div>
  );
}

function ArtifactCards({ refs }: { refs: string[] }) {
  const { dispatch, openNode } = useS27();
  const artifacts = refs.map((id) => nodeById.get(id)).filter((n) => n?.kind === 'artifact');
  const others = refs.filter((id) => nodeById.get(id)?.kind !== 'artifact');
  return (
    <>
      {artifacts.map((a) => a && (
        <div key={a.id} className="s27-artifact-card">
          <div className="s27-artifact-card-head">
            <span className="s27-artifact-icon" aria-hidden="true">▤</span>
            <div>
              <div className="s27-artifact-title">{a.title}</div>
              <div className="s27-artifact-meta">
                {a.version && <span className="s27-version">{a.version}</span>}
                <span>섹션 {a.sections?.length ?? 0}개</span>
                {a.supersedes && <span>· {nodeById.get(a.supersedes)?.version ?? '이전 버전'} 수정본</span>}
              </div>
            </div>
          </div>
          {a.sections && (
            <ul className="s27-artifact-sections">
              {a.sections.map((s) => <li key={s.label}>{s.label}</li>)}
            </ul>
          )}
          <button
            type="button"
            className="s27-btn s27-btn-tonal s27-btn-sm"
            onClick={() => { openNode(a.id); dispatch({ type: 'view_artifact', id: a.id }); }}
          >
            허브에서 보기 →
          </button>
        </div>
      ))}
      {others.length > 0 && <RefChips refs={others} />}
    </>
  );
}
