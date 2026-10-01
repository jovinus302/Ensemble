"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import type { ActionResult } from "./use-view-model";

/** 보내는 즉시 입력창과 첨부를 비운다. 처리 중에도 다음 메시지를 쓸 수 있고, 실패하면 보낸 내용을 입력창에 되살린다. */
export function Composer({ meName, onSend }: { meName: string; onSend: (text: string, files: File[]) => Promise<ActionResult> }) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const draft = useRef({ text, files });
  draft.current = { text, files };
  const canSend = text.trim().length > 0 || files.length > 0;

  const send = async () => {
    const sentText = draft.current.text.trim(), sentFiles = draft.current.files;
    if (!sentText && !sentFiles.length) return;
    // Consume synchronously: two Enter/click events can arrive before React renders.
    draft.current = { text: '', files: [] };
    setText("");
    setFiles([]);
    const result = await onSend(sentText, sentFiles);
    if (result.ok) return;
    // 그사이 새로 쓴 글이 있으면 그 앞에 되살린다.
    setText(current => (current.trim() ? `${sentText}\n${current}` : sentText));
    setFiles(current => [...sentFiles, ...current]);
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
          placeholder={`${meName} 이름으로 보내기 — Enter 전송, Shift+Enter 줄바꿈`}
          aria-label="메시지 입력"
          onChange={e => setText(e.target.value)} onKeyDown={onKeyDown}
        />
        <button type="button" className="send-btn" aria-label="전송" disabled={!canSend} onClick={() => void send()}>↑</button>
      </div>
    </div>
  );
}
