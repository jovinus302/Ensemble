"use client";

import { useState } from "react";
import type { VmMember, VmMessage } from "../lib/view-model";
import { formatTime, initial } from "./format";

// Agent voice는 1~8 중 id 해시로 고른다(그린은 PM 전용).
function voiceOf(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (h % 8) + 1;
}

export function Avatar({ member, size = 36 }: { member: VmMember | undefined; size?: number }) {
  const kind = member?.kind ?? "human";
  const name = member?.displayName ?? "?";
  const style = kind === "agent" ? { ["--voice" as string]: `var(--ens-voice-${voiceOf(member?.id ?? name)})` } : undefined;
  return (
    <span className={`avatar avatar-${kind}`} style={{ width: size, height: size, ...style }} aria-hidden>
      <span className="avatar-inner">{kind === "pm" ? "PM" : initial(name)}</span>
    </span>
  );
}

const PM_KIND: Record<string, string> = { fact: "사실", summary: "요약", ask: "질문", answer: "답변", nudge: "알림" };

export function MessageItem({ message, author, grouped }: { message: VmMessage; author: VmMember | undefined; grouped: boolean }) {
  const [showWhy, setShowWhy] = useState(false);

  if (message.kind === "system") {
    return <div className="msg-system" role="note">{message.text}</div>;
  }

  const voice = message.kind === "agent" ? voiceOf(author?.id ?? message.authorId) : null;
  const bubbleStyle = voice ? { ["--voice-c" as string]: `var(--ens-voice-${voice}-container)`, ["--voice-on" as string]: `var(--ens-voice-${voice}-on)`, ["--voice" as string]: `var(--ens-voice-${voice})` } : undefined;

  return (
    <article className={`msg msg-${message.kind}${grouped ? " msg-grouped" : ""}`} style={bubbleStyle}>
      <div className="msg-avatar">{!grouped && <Avatar member={author} size={message.kind === "pm" ? 40 : 36} />}</div>
      <div className="msg-main">
        {!grouped && (
          <header className="msg-head">
            <span className="msg-name">{author?.displayName ?? message.authorId}</span>
            {message.kind === "agent" && <span className="badge badge-ai">AI</span>}
            {message.kind === "pm" && <span className="badge badge-pm">PM</span>}
            {author?.role && <span className="msg-role">{author.role}</span>}
            <time className="msg-time" dateTime={message.at}>{formatTime(message.at)}</time>
          </header>
        )}
        <div className="msg-body">
          {message.pm && <span className="pm-kind">{PM_KIND[message.pm.kind] ?? message.pm.kind}</span>}
          {message.text}
        </div>
        {message.attachments.length > 0 && (
          <ul className="attachments">
            {message.attachments.map(a => (
              <li key={a.id}>
                <a className="attachment" href={a.url} target="_blank" rel="noreferrer">
                  <span className="attachment-icon" aria-hidden>📄</span>
                  <span className="attachment-name">{a.name}</span>
                  <span className="attachment-open">열기</span>
                </a>
              </li>
            ))}
          </ul>
        )}
        {message.pm && (
          <div className="why">
            <button type="button" className="btn-text btn-small" aria-expanded={showWhy} onClick={() => setShowWhy(v => !v)}>
              {showWhy ? "근거 닫기" : "근거"}
            </button>
            {showWhy && (
              <div className="why-body">
                <p><strong>이유</strong> {message.pm.reason}</p>
                {message.pm.evidence.length > 0 && (
                  <ul>{message.pm.evidence.map((e, i) => <li key={i}><code>{e}</code></li>)}</ul>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
