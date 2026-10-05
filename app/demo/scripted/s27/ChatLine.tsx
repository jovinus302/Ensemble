'use client';

import type { ChatLine } from '.';
import { ArtifactCarousel } from './AdVisuals';
import { Avatar, RefChips, actorById, nodeById, voiceOf } from './shared';

/** Messenger line. Only the newest artifact line in view renders the full visual strip. */
export function ChatLineView({ line, fresh, fullArtifact }: { line: ChatLine; fresh: boolean; fullArtifact: boolean }) {
  const actor = actorById.get(line.actorId);
  const agent = actor?.kind === 'agent';
  const refs = line.refs ?? [];
  // A line may cite several versions; the attachment is the newest one it cites.
  const cited = line.kind === 'artifact' ? refs.flatMap((id) => {
    const node = nodeById.get(id);
    return node?.kind === 'artifact' ? [node] : [];
  }) : [];
  const artifact = cited.find((a) => !cited.some((b) => b.supersedes === a.id)) ?? cited.at(-1);
  // The attachment's 근거 보기 replaces chips on artifact lines.
  const chipRefs = artifact ? [] : refs;
  return (
    <li className={`s27-line${agent ? ' is-agent' : ''}${fresh ? ' is-fresh' : ''}`} data-line={line.id}>
      <Avatar actorId={line.actorId} />
      <div className="s27-line-main">
        <div className="s27-line-head">
          <span className={`s27-line-name s27-voice-text-${voiceOf(line.actorId)}`}>{actor?.name ?? line.actorId}</span>
          {agent && <span className="s27-agent-tag">에이전트</span>}
          <time className="s27-line-time">{line.at}</time>
        </div>
        <p className="s27-line-text">{line.text}</p>
        {artifact && <ArtifactCarousel artifact={artifact} compact={!fullArtifact} />}
        <RefChips refs={chipRefs} />
      </div>
    </li>
  );
}
