"use client";

import type { VmSpace } from "../lib/view-model";
import { formatTime } from "./format";

// #81: 사람의 기존 개인 Agent가 Space에 남긴 글과, PM이 그 작업 폴더로 보낸 요청의 상태.
// 전달(폴더에 도착)·확인(Space에서 봄)·답(Space에 답글)을 따로 보여 준다.
const REQUEST_STATUS = {
  pending: { label: "전달 대기", tone: "needs" },
  delivered: { label: "폴더에 도착", tone: "working" },
  seen: { label: "Space에서 확인", tone: "working" },
  answered: { label: "답 받음", tone: "done" },
} as const;
const POST_KIND = { result: "결과", question: "질문", blocked: "막힘", note: "메모" } as const;

export function SpacePanel({ space }: { space?: VmSpace }) {
  if (!space || space.participants.length === 0) return <p className="muted">연결된 개인 Agent가 없어요. 연결 방법은 문서(docs/experiments/issue-81-personal-agent-space.md)를 참고하세요.</p>;
  const name = (id: string) => space.participants.find(p => p.id === id)?.displayName ?? id;
  return (
    <div className="space-panel">
      <ul className="team-list">
        {space.participants.map(p => (
          <li key={p.id}>
            <strong>{p.displayName}</strong> <span className="muted small">{p.tool} · {p.workspaceRoot}</span>
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
