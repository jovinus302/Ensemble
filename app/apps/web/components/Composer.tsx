"use client";

import { useRef, useState, type KeyboardEvent } from "react";

export function Composer({ busy, meName, onSend }: { busy: boolean; meName: string; onSend: (text: string, files: File[]) => Promise<void> }) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const canSend = !sending && (text.trim().length > 0 || files.length > 0);

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      await onSend(text.trim(), files);
      setText("");
      setFiles([]);
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // 한글 조합 중 Enter는 글자 확정이므로 전송하지 않는다.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="composer-wrap">
      {busy && (
        <div className="busy" role="status">
          <span className="shimmer" aria-hidden /> PM·Agent가 처리 중…
        </div>
      )}
      {files.length > 0 && (
        <ul className="file-chips">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="chip chip-plain">
              <span aria-hidden>📎</span> {f.name}
              <button type="button" className="chip-x" aria-label={`${f.name} 빼기`} onClick={() => setFiles(fs => fs.filter((_, j) => j !== i))}>×</button>
            </li>
          ))}
        </ul>
      )}
      <div className="composer">
        <button type="button" className="icon-btn" aria-label="파일 첨부" onClick={() => fileRef.current?.click()}>＋</button>
        <input
          ref={fileRef} type="file" multiple hidden
          onChange={e => {
            const picked = Array.from(e.target.files ?? []);
            setFiles(fs => [...fs, ...picked]);
            e.target.value = "";
          }}
        />
        <textarea
          className="composer-input" rows={1} value={text}
          placeholder={`${meName}(으)로 메시지 보내기 — Enter 전송, Shift+Enter 줄바꿈`}
          aria-label="메시지 입력"
          onChange={e => setText(e.target.value)} onKeyDown={onKeyDown}
        />
        <button type="button" className="send-btn" aria-label="전송" disabled={!canSend} onClick={() => void send()}>↑</button>
      </div>
    </div>
  );
}
