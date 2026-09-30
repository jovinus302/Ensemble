"use client";

import { useState } from "react";
import type { VmMember } from "../lib/view-model";
import { Avatar } from "./Message";

const KIND_LABEL = { human: "사람", agent: "Agent", pm: "PM" } as const;

/** 채널 멤버 수와 목록. 사람·Agent·PM을 모두 세어 합이 맞게 보인다. */
export function MemberList({ members, me }: { members: VmMember[]; me: string }) {
  const [open, setOpen] = useState(false);
  const count = (kind: VmMember["kind"]) => members.filter(m => m.kind === kind).length;
  const summary = (["human", "agent", "pm"] as const).map(k => `${KIND_LABEL[k]} ${count(k)}`).join(" · ");

  return (
    <div className="members">
      <button type="button" className="btn-text btn-small members-toggle" aria-expanded={open} onClick={() => setOpen(v => !v)}>
        멤버 {members.length}명 <span className="muted">({summary})</span>
      </button>
      {open && (
        <ul className="member-list" aria-label="멤버 목록">
          {members.map(m => (
            <li key={m.id}>
              <Avatar member={m} size={28} />
              <span className="member-name">{m.displayName}{m.id === me && <span className="me-tag">나</span>}</span>
              <span className="muted small">{m.role ?? KIND_LABEL[m.kind]}{m.busy ? " · 작업 중" : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
