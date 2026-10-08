"use client";

import { useState } from "react";
import type { VmSpace } from "../lib/view-model";
import { formatTime } from "./format";
import type { ConfirmLinkResult } from "./use-view-model";

// #81: 사람의 기존 개인 Agent가 Space에 남긴 글과, PM이 그 작업 폴더로 보낸 요청의 상태.
// 전달(폴더에 도착)·확인(Space에서 봄)·답(Space에 답글)을 따로 보여 준다.
// 연결 요청은 사람이 이 화면에서 서버 콘솔의 확인 코드로 확인해야 효력이 생긴다. 토큰은 확인 직후 한 번만 보인다.
const REQUEST_STATUS = {
  pending: { label: "전달 대기", tone: "needs" },
  delivered: { label: "폴더에 도착", tone: "working" },
  seen: { label: "Space에서 확인", tone: "working" },
  answered: { label: "답 받음", tone: "done" },
} as const;
const POST_KIND = { result: "결과", question: "질문", blocked: "막힘", note: "메모" } as const;
const SCOPE_LABEL: Record<string, string> = { readSpace: "Space 읽기", post: "글 남기기", receiveRequests: "요청 받기", pmReadWorkspace: "PM 폴더 읽기" };
type ConfirmLink = (linkRequestId: string, code: string) => Promise<ConfirmLinkResult>;

/** What a confirmation hands the person once: the token, and this server's own URLs where the agent uses it. */
type Issued = { participantId: string; token: string; contextUrl?: string; postUrl?: string };

function PendingLink({ link, onConfirm, onIssued }: { link: VmSpace["pendingLinks"][number]; onConfirm?: ConfirmLink; onIssued: (issued: Issued) => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const confirm = async () => {
    if (!onConfirm || !code.trim()) return;
    setBusy(true); setMessage(null);
    try {
      const result = await onConfirm(link.id, code);
      if (result.ok) onIssued({ participantId: result.participantId, token: result.token, ...(result.contextUrl ? { contextUrl: result.contextUrl } : {}), ...(result.postUrl ? { postUrl: result.postUrl } : {}) });
      else setMessage(result.message);
    } finally { setBusy(false); }
  };
  return (
    <li>
      <span className="chip chip-needs">연결 확인 필요</span>{" "}
      <strong>{link.displayName}</strong> <span className="muted small">{link.tool} · {link.requestedBy} 요청 · {formatTime(link.at)}</span>
      <div className="muted small">폴더 {link.workspaceRoot} · 허용 경로 {link.allowedPaths.join(", ")}</div>
      <div className="muted small">권한 {Object.entries(link.scopes).filter(([, on]) => on).map(([k]) => SCOPE_LABEL[k] ?? k).join(", ") || "없음"} · {formatTime(link.expiresAt)}까지</div>
      <p className="muted small">직접 요청한 연결이면 서버 콘솔(터미널)에 표시된 확인 코드를 입력하세요. 모르는 요청이면 확인하지 마세요.</p>
      <label className="field">확인 코드 <input value={code} onChange={e => setCode(e.target.value)} placeholder="ABCD-EFGH" disabled={busy || !onConfirm} autoComplete="off" /></label>{" "}
      <button type="button" className="btn-tonal" onClick={() => void confirm()} disabled={busy || !onConfirm || !code.trim()}>연결 확인</button>
      {message && <p className="muted small" role="alert">{message}</p>}
    </li>
  );
}

export function SpacePanel({ space, onConfirmLink }: { space?: VmSpace; onConfirmLink?: ConfirmLink }) {
  const [issued, setIssued] = useState<Issued | null>(null);
  const tokenNotice = issued && (
    <div className="card" role="status">
      <p><strong>{issued.participantId}</strong> 연결을 확인했어요. 아래 토큰을 그 개인 Agent에게 전달하세요. 이 화면을 벗어나면 다시 볼 수 없어요(다시 연결하면 새 토큰이 나오고 이전 토큰은 막혀요).</p>
      <p><code>{issued.token}</code></p>
      <p className="muted small">개인 Agent는 Space를 읽고 글을 남길 때 <code>Authorization: Bearer &lt;토큰&gt;</code> 헤더로 보냅니다. 토큰은 아래 이 서버 주소로만 보내게 하세요.</p>
      {issued.contextUrl && <p className="muted small">맥락 읽기 <code>{issued.contextUrl}</code>{issued.postUrl && <> · 글 남기기 <code>{issued.postUrl}</code></>}</p>}
      <button type="button" className="btn-text" onClick={() => setIssued(null)}>전달했어요</button>
    </div>
  );
  if (!space || (space.participants.length === 0 && space.pendingLinks.length === 0)) {
    return <>{tokenNotice}<p className="muted">연결된 개인 Agent가 없어요. 연결 방법은 문서(docs/experiments/issue-81-personal-agent-space.md)를 참고하세요.</p></>;
  }
  const name = (id: string) => space.participants.find(p => p.id === id)?.displayName ?? id;
  return (
    <div className="space-panel">
      {tokenNotice}
      {space.pendingLinks.length > 0 && (
        <ul className="team-list">
          {space.pendingLinks.map(l => <PendingLink key={l.id} link={l} onConfirm={onConfirmLink} onIssued={setIssued} />)}
        </ul>
      )}
      <ul className="team-list">
        {space.participants.map(p => (
          <li key={p.id}>
            <strong>{p.displayName}</strong> <span className="muted small">{p.tool} · {p.workspaceRoot} · 허용 경로 {p.allowedPaths.join(", ")}</span>
            <div className="muted small">
              {p.lastReadAt ? `Space 확인 ${formatTime(p.lastReadAt)}` : "아직 Space를 읽지 않음"}
              {p.lastObservedAt && ` · PM이 폴더 확인 ${formatTime(p.lastObservedAt)}(파일 ${p.observedFiles ?? 0}개)`}
            </div>
          </li>
        ))}
      </ul>
      {space.needsHuman.length > 0 && <p className="chip chip-needs">사람 확인 필요: {space.needsHuman.map(n => n.reason).join(" / ")}</p>}
      <h3 className="small">PM 요청</h3>
      {space.requests.length === 0 ? <p className="muted small">보낸 요청이 없어요.</p> : (
        <ul className="team-list">
          {[...space.requests].reverse().map(r => (
            <li key={r.id}>
              <span className={`chip chip-${REQUEST_STATUS[r.status].tone}`}>{REQUEST_STATUS[r.status].label}</span>{" "}
              {!r.delivered && r.status !== "pending" && r.status !== "answered" && <span className="chip chip-needs">폴더 전달 대기</span>}{" "}
              <span className="muted small">{name(r.participantId)}에게 · {r.byPm ? "PM" : "사람"} · {formatTime(r.at)}</span>
              <p>{r.text}</p>
              {r.failure && <p className="muted small">마지막 전달 실패: {r.failure}(시도 {r.attempts}회). 다시 연결되면 재시도해요.</p>}
            </li>
          ))}
        </ul>
      )}
      <h3 className="small">개인 Agent 글</h3>
      {space.posts.length === 0 ? <p className="muted small">아직 남긴 글이 없어요.</p> : (
        <ul className="team-list">
          {[...space.posts].reverse().map(p => (
            <li key={p.id}>
              <span className="chip chip-plain">{POST_KIND[p.kind]}</span>{" "}
              <span className="muted small">{name(p.participantId)} · {formatTime(p.at)}{p.inReplyTo ? " · 요청에 대한 답" : ""}</span>
              <p>{p.text}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
