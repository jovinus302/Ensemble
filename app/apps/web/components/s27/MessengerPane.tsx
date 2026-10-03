'use client';

import { useEffect, useRef, useState } from 'react';
import { S27, type ChatLine } from '../../lib/s27';
import { ChatLineView } from './ChatLine';

const channels = Array.from(new Set(S27.lines.filter((l) => l.surface === 'slack').map((l) => l.place)));

export function MessengerPane({ lines, fresh }: { lines: ChatLine[]; fresh: Set<string> }) {
  const [channel, setChannel] = useState(channels[0] ?? '');
  const listRef = useRef<HTMLOListElement>(null);
  const freshKey = lines.filter((l) => fresh.has(l.id)).map((l) => l.id).join(',');

  // Follow the channel where the newest lines landed.
  useEffect(() => {
    const latest = [...lines].reverse().find((l) => fresh.has(l.id));
    if (latest) setChannel(latest.place);
  }, [freshKey]);

  const shown = lines.filter((l) => l.place === channel);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [channel, shown.length]);

  return (
    <section className="s27-messenger" aria-label="팀 메신저 (시뮬레이션)">
      <nav className="s27-channels" aria-label="채널">
        <div className="s27-channels-head">S27 런칭</div>
        {channels.map((c) => {
          const unread = c !== channel && lines.some((l) => l.place === c && fresh.has(l.id));
          const count = lines.filter((l) => l.place === c).length;
          return (
            <button
              key={c}
              type="button"
              className={`s27-channel${c === channel ? ' is-active' : ''}`}
              aria-current={c === channel ? 'true' : undefined}
              onClick={() => setChannel(c)}
            >
              <span className="s27-channel-name">{c}</span>
              {unread ? <span className="s27-unread">새 글</span> : count > 0 ? <span className="s27-count">{count}</span> : null}
            </button>
          );
        })}
      </nav>
      <div className="s27-channel-body">
        <header className="s27-pane-head">
          <div>
            <div className="s27-pane-title">{channel}</div>
            <div className="s27-pane-sub">팀 메신저 · 시뮬레이션 화면</div>
          </div>
        </header>
        <ol className="s27-lines s27-feed" ref={listRef} aria-live="polite">
          {shown.length === 0 && <li className="s27-empty">이 채널에는 아직 메시지가 없습니다.</li>}
          {shown.map((l) => <ChatLineView key={l.id} line={l} fresh={fresh.has(l.id)} />)}
        </ol>
        <div className="s27-composer" aria-hidden="true">{channel}에 메시지 보내기 · 시연용 화면이라 입력은 비활성</div>
      </div>
    </section>
  );
}
