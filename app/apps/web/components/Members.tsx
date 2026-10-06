"use client";

import { useState } from "react";
import type { VmMember } from "../lib/view-model";
import { memberRole, memberSummary } from "./context/cards/card-view";
import { Avatar } from "./Message";

/** 채널 멤버 수와 목록. 사람·Agent·PM을 모두 세어 합이 맞게 보인다. 인력 pool에서 합류한 멤버는 "+N POOL"로 따로 센다. */
export function MemberList({ members, me }: { members: VmMember[]; me: string }) {
  const [open, setOpen] = useState(false);
  const summary = memberSummary(members);

  return (
    <div className="members">
      <button type="button" className="btn-text btn-small members-toggle" aria-expanded={open} onClick={() => setOpen(v => !v)}>
        {summary.total} <span className="muted">({summary.breakdown})</span>
        {summary.pool && <span className="badge badge-pool num">{summary.pool}</span>}
      </button>
      {open && (
        <ul className="member-list" aria-label="멤버 목록">
          {members.map(m => (
            <li key={m.id} data-pool={m.pool || undefined}>
              <Avatar member={m} size={28} />
              <span className="member-name">
                {m.displayName}{m.id === me && <span className="me-tag">나</span>}
                {m.pool && <span className="badge badge-pool" title="인력 pool에서 합류">POOL</span>}
              </span>
              <span className="muted small">{memberRole(m)}{m.busy ? " · 작업 중" : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
