'use client';

import { useEffect, useRef, useState } from 'react';
import { S27, type ChatLine } from '.';
import { ChatLineView } from './ChatLine';

const channels = Array.from(new Set(S27.lines.filter((l) => l.surface === 'slack').map((l) => l.place)));
const VISIBLE = 4;

export function MessengerPane({ lines, fresh }: { lines: ChatLine[]; fresh: Set<string> }) {
  // The beat's first new line names the channel it is about; later lines elsewhere show as unread.
  const firstFresh = lines.find((l) => fresh.has(l.id));
  const [channel, setChannel] = useState(() => firstFresh?.place ?? lines.at(-1)?.place ?? channels[0] ?? '');
  const freshKey = lines.filter((l) => fresh.has(l.id)).map((l) => l.id).join(',');

  useEffect(() => {
    if (firstFresh) setChannel(firstFresh.place);
  }, [freshKey]);

  const inChannel = lines.filter((l) => l.place === channel);
  // A full artifact attachment takes the room of a couple of messages.
  const shown = inChannel.slice(inChannel.at(-1)?.kind === 'artifact' ? -2 : -VISIBLE);
  const hidden = inChannel.length - shown.length;
  const lastArtifact = [...shown].reverse().find((l) => l.kind === 'artifact')?.id;
  const listRef = useRef<HTMLOListElement>(null);
  const shownKey = shown.map((l) => l.id).join(',');
  // Keep the newest message in view when the feed is height-bound.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shownKey]);

  return (
    <section className="s27-messenger" aria-label="팀 메신저 (시뮬레이션)">
      <nav className="s27-channels" aria-label="채널">
        {channels.map((c) => {
          const unread = c !== channel && lines.some((l) => l.place === c && fresh.has(l.id));
          return (
            <button
              key={c}
              type="button"
              className={`s27-channel${c === channel ? ' is-active' : ''}`}
              aria-current={c === channel ? 'true' : undefined}
              onClick={() => setChannel(c)}
            >
              <span className="s27-channel-name">{c}</span>
              {unread && <span className="s27-unread">새 글</span>}
            </button>
          );
        })}
        <span className="s27-sim-note">메신저 · 시뮬레이션 화면</span>
      </nav>
      <ol className="s27-lines" aria-live="polite" ref={listRef}>
        {hidden > 0 && <li className="s27-earlier">이전 메시지 {hidden}개</li>}
        {shown.length === 0 && <li className="s27-empty">이 채널에는 아직 메시지가 없습니다.</li>}
        {shown.map((l) => <ChatLineView key={l.id} line={l} fresh={fresh.has(l.id)} fullArtifact={l.id === lastArtifact} />)}
      </ol>
    </section>
  );
}
