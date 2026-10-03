'use client';

import { useEffect, useRef } from 'react';
import { S27, type ChatLine } from '../../lib/s27';
import { ChatLineView } from './ChatLine';
import { Avatar, actorById } from './shared';

const meetingLines = S27.lines.filter((l) => l.surface === 'meeting');
const roomName = meetingLines[0]?.place ?? '화상 미팅';
const participants = Array.from(new Set(['ensemble', ...meetingLines.map((l) => l.actorId)]))
  .filter((id) => actorById.has(id))
  .sort((a, b) => Number(actorById.get(a)?.kind === 'agent') - Number(actorById.get(b)?.kind === 'agent'));

export function MeetingPane({ lines, fresh }: { lines: ChatLine[]; fresh: Set<string> }) {
  const listRef = useRef<HTMLOListElement>(null);
  const last = lines[lines.length - 1];
  const speaking = last && fresh.has(last.id) ? last.actorId : null;

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  return (
    <section className="s27-meeting" aria-label="화상 미팅 (시뮬레이션)">
      <header className="s27-pane-head">
        <span className="s27-live-dot" aria-hidden="true" />
        <div>
          <div className="s27-pane-title">{roomName}</div>
          <div className="s27-pane-sub">화상 미팅 · 시뮬레이션 화면</div>
        </div>
      </header>
      <ul className="s27-tiles" aria-label="참여자">
        {participants.map((id) => {
          const actor = actorById.get(id);
          return (
            <li key={id} className={`s27-tile${actor?.kind === 'agent' ? ' is-agent' : ''}${speaking === id ? ' is-speaking' : ''}`}>
              <Avatar actorId={id} size="lg" />
              <span className="s27-tile-name">{actor?.name}</span>
              {actor?.kind === 'agent' && <span className="s27-agent-tag">에이전트</span>}
              {speaking === id && <span className="s27-sr">발언 중</span>}
            </li>
          );
        })}
      </ul>
      <div className="s27-transcript-head">실시간 자막</div>
      <ol className="s27-lines s27-transcript" ref={listRef} aria-live="polite">
        {lines.length === 0 && <li className="s27-empty">아직 발언이 없습니다.</li>}
        {lines.map((l) => <ChatLineView key={l.id} line={l} fresh={fresh.has(l.id)} />)}
      </ol>
    </section>
  );
}
