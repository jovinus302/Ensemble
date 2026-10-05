'use client';

import { S27, type ChatLine, type ContextNode } from '.';
import { Img, actorById, nodeShort, useS27, voiceOf } from './shared';

const meetingLines = S27.lines.filter((l) => l.surface === 'meeting');
const roomName = meetingLines[0]?.place ?? '화상 미팅';
// People first in first-speaking order, the Ensemble agent last.
const participants = Array.from(new Set([...meetingLines.map((l) => l.actorId), 'ensemble']))
  .filter((id) => actorById.has(id))
  .sort((a, b) => Number(actorById.get(a)?.kind === 'agent') - Number(actorById.get(b)?.kind === 'agent'));

export function MeetingPane({ lines, fresh, nodes, freshNodes }: {
  lines: ChatLine[]; fresh: Set<string>; nodes: ContextNode[]; freshNodes: Set<string>;
}) {
  const { openNode } = useS27();
  const last = lines[lines.length - 1];
  const speaking = last && fresh.has(last.id) ? last.actorId : null;
  const subtitles = lines.slice(-2);
  const decisions = nodes.filter((n) => n.kind === 'decision' && n.origin === 'meeting');
  const sources = nodes.filter((n) => n.kind === 'source');
  const captured = lines.some((l) => l.kind === 'capture');

  return (
    <section className="s27-meeting" aria-label="화상 미팅 (시뮬레이션)">
      <div className="s27-call">
        <header className="s27-call-head">
          <span className="s27-live-dot" aria-hidden="true" />
          <span className="s27-call-title">{roomName}</span>
          <span className="s27-sim-note">화상 미팅 · 시뮬레이션 화면</span>
        </header>
        <ul className="s27-tiles" aria-label="참여자">
          {participants.map((id) => {
            const actor = actorById.get(id)!;
            const agent = actor.kind === 'agent';
            const alt = `${actor.name} 화면`;
            const fallback = (
              <span className={`s27-tile-fallback s27-voice-${voiceOf(id)}`} role="img" aria-label={alt}>
                <span className="s27-tile-initials">{actor.initials}</span>
              </span>
            );
            return (
              <li key={id} className={`s27-tile${agent ? ' is-agent' : ''}${speaking === id ? ' is-speaking' : ''}`}>
                {agent ? (
                  <span className="s27-tile-agent" role="img" aria-label={`${actor.name} 에이전트`}>
                    <span className="s27-tile-mark">{actor.initials}</span>
                    {captured && <span className="s27-tile-rec">● 기록 중</span>}
                  </span>
                ) : (
                  <Img src={actor.avatar} alt={alt} width={480} height={480} className="s27-tile-img" fallback={fallback} />
                )}
                <span className="s27-tile-name">
                  {actor.name}
                  {agent && <span className="s27-agent-tag">에이전트</span>}
                  {speaking === id && <span className="s27-speaking">말하는 중</span>}
                </span>
              </li>
            );
          })}
        </ul>
        <ol className="s27-subtitles" aria-live="polite" aria-label="실시간 자막">
          {subtitles.length === 0 && <li className="s27-subtitle is-empty">아직 발언이 없습니다.</li>}
          {subtitles.map((l) => (
            <li key={l.id} className={`s27-subtitle${l.id === last?.id ? ' is-latest' : ''}${l.kind === 'capture' ? ' is-capture' : ''}`}>
              <span className={`s27-subtitle-name s27-voice-text-${voiceOf(l.actorId)}`}>{actorById.get(l.actorId)?.name}</span>
              <span className="s27-subtitle-text">{l.text}</span>
            </li>
          ))}
        </ol>
      </div>

      <aside className="s27-captures" aria-label="앙상블에 기록된 항목">
        {decisions.length > 0 ? (
          <>
            <div className="s27-captures-head">결정 {decisions.length}건 기록</div>
            <ul className="s27-decisions">
              {decisions.map((d) => (
                <li key={d.id}>
                  <button type="button" className={`s27-decision${freshNodes.has(d.id) ? ' is-fresh' : ''}`} onClick={() => openNode(d.id)} title={d.title}>
                    <span className="s27-decision-tag">결정</span>
                    <span className="s27-decision-text">{nodeShort(d)}</span>
                  </button>
                </li>
              ))}
            </ul>
            {sources.length > 0 && <div className="s27-captures-foot">근거 자료 {sources.length}건과 연결</div>}
          </>
        ) : sources.length > 0 ? (
          <>
            <div className="s27-captures-head">팀 공유 자료 {sources.length}건</div>
            <ul className="s27-sources">
              {sources.map((s) => (
                <li key={s.id}>
                  <button type="button" className={`s27-source${freshNodes.has(s.id) ? ' is-fresh' : ''}`} onClick={() => openNode(s.id)} title={s.title}>
                    <span className="s27-source-icon" aria-hidden="true">▤</span>
                    {nodeShort(s)}
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </aside>
    </section>
  );
}
