"use client";

import { useState } from "react";
import type { ViewModel, VmMember, VmWorkItem, VmWorkStatus } from "../lib/view-model";
import { DecisionCard } from "./Cards";
import type { DecideRequest } from "./DecisionRequestCard";
import { formatDate } from "./format";
import { Avatar } from "./Message";
import { RoadmapCard } from "./Roadmap";
import { SpacePanel } from "./SpacePanel";
import type { ResolveTask } from "./TaskResolution";
import type { ActionResult, ConfirmLinkResult } from "./use-view-model";
import { WORK_STATUS_LABEL, decisionTotal, WORK_STATUS_TONE, groupWorkItems, teamLines, waitingLabel, type WorkGroup, type WorkRow } from "./work-view";

export type PanelTab = "work" | "team" | "decisions" | "schedule" | "space";
const TABS: { key: PanelTab; label: string }[] = [
  { key: "work", label: "작업" }, { key: "team", label: "팀" }, { key: "decisions", label: "내 결정" }, { key: "schedule", label: "일정" }, { key: "space", label: "개인 Agent" },
];
const KIND_LABEL = { human: "사람", agent: "Agent", pm: "PM" } as const;

export function WorkStatusChip({ status }: { status: VmWorkStatus }) {
  return <span className={`chip chip-${WORK_STATUS_TONE[status]}`}>{WORK_STATUS_LABEL[status]}</span>;
}

function WorkLine({ item, members, me, parentTitle, childCount, onOpen, nested }: {
  item: VmWorkItem; members: VmMember[]; me: string; parentTitle?: string; childCount?: number; nested?: boolean; onOpen: (id: string) => void;
}) {
  const owner = members.find(m => m.id === item.ownerId);
  const waiting = item.status === "waiting_human" ? waitingLabel(item, members, me) : undefined;
  return (
    <button type="button" className={`work-line${nested ? " work-line-child" : ""}`} onClick={() => onOpen(item.id)}>
      <Avatar member={owner ?? { id: item.ownerId, kind: item.ownerKind, displayName: "?" }} size={24} />
      <span className="work-line-main">
        <span className="work-line-title">
          {parentTitle && <span className="muted">{parentTitle} › </span>}
          {item.title}
          {item.priority === "high" && <span className="priority-high" title="우선순위 높음">높음</span>}
        </span>
        <span className="work-line-meta small muted">
          {owner?.displayName ?? (item.ownerKind === "agent" ? "Agent" : "담당자")}
          {childCount ? ` · 하위 작업 ${childCount}개` : ""}
        </span>
      </span>
      {waiting ? <span className="chip chip-needs">{waiting}</span> : <WorkStatusChip status={item.status} />}
    </button>
  );
}

function GroupSection({ group, members, me, onOpen }: { group: WorkGroup; members: VmMember[]; me: string; onOpen: (id: string) => void }) {
  const [open, setOpen] = useState(!group.collapsed);
  const rows = (row: WorkRow) => (
    <li key={row.item.id}>
      <WorkLine item={row.item} members={members} me={me} parentTitle={row.parentTitle} childCount={row.childCount} onOpen={onOpen} />
      {row.children.length > 0 && (
        <ul className="work-children">
          {row.children.map(c => <li key={c.id}><WorkLine item={c} members={members} me={me} nested onOpen={onOpen} /></li>)}
        </ul>
      )}
    </li>
  );
  return (
    <section className={`work-group work-group-${group.key}`} aria-label={group.label}>
      <button type="button" className="work-group-head" aria-expanded={open} onClick={() => setOpen(v => !v)}>
        <span>{group.label} <span className="num muted">{group.count}</span></span>
        <span className="muted small" aria-hidden>{open ? "▾" : "▸"}</span>
      </button>
      {open && <ul className="work-tree">{group.rows.map(rows)}</ul>}
    </section>
  );
}

/** 작업 탭: 목표(기한·예상 완료) 아래 묶음별 작업 트리. 작업 생성 양식·드래그 칸반은 두지 않는다. */
export function WorkTree({ vm, onOpen }: { vm: ViewModel; onOpen: (id: string) => void }) {
  const f = vm.roadmap.forecast;
  const groups = groupWorkItems(vm.work?.items ?? []);
  return (
    <div className="work-tab">
      <div className="work-goal">
        <span className="section-label">목표</span>
        <strong className="work-goal-text">{vm.project.goal ?? "목표 미정"}</strong>
        <span className="small muted">
          {vm.project.deadline ? `기한 ${formatDate(vm.project.deadline)}` : "기한 없음"}
          {f?.ok ? ` · 예상 완료 ${formatDate(f.finishMin)}${formatDate(f.finishMax) !== formatDate(f.finishMin) ? `–${formatDate(f.finishMax)}` : ""}` : ""}
        </span>
      </div>
      {groups.length === 0
        ? <p className="muted">{vm.work
          ? "아직 작업 항목이 없어요. PM이 대화에서 작업을 정리하면 여기에 보여요."
          : vm.cards.some(c => c.kind === "plan_approval")
            ? "계획이 승인되면 작업이 여기에 보여요. 내 결정 탭에서 계획을 확인해 주세요."
            : "아직 승인된 계획이 없어요. PM이 계획을 제안하고 승인되면 작업이 여기에 보여요."}</p>
        : groups.map(g => <GroupSection key={g.key} group={g} members={vm.members} me={vm.me} onOpen={onOpen} />)}
    </div>
  );
}

/** 팀 탭: 멤버마다 지금 하는 작업과 상태 한 줄. */
export function TeamList({ vm, onOpen }: { vm: ViewModel; onOpen: (id: string) => void }) {
  return (
    <ul className="team-list" aria-label="팀">
      {teamLines(vm.work, vm.members, vm).map(({ member, row, current }) => (
        <li key={member.id} className="team-row">
          <Avatar member={member} size={28} />
          <span className="team-main">
            <span className="member-name">{member.displayName}{member.id === vm.me && <span className="me-tag">나</span>} <span className="muted small">{KIND_LABEL[member.kind]}</span></span>
            <span className="small muted">
              {row.state}
              {current && <> · <button type="button" className="link-btn" onClick={() => onOpen(current.id)}>{current.title}</button></>}
            </span>
          </span>
          {row.openDecisions > 0 && <span className="chip chip-needs num">결정 {row.openDecisions}</span>}
        </li>
      ))}
    </ul>
  );
}

export function WorkPanel({ vm, tab, onTab, onOpenTask, onDecide, onDecideRequest, onSetAvailability, onResolve, onConfirmLink }: {
  vm: ViewModel; tab: PanelTab; onTab: (tab: PanelTab) => void; onOpenTask: (id: string) => void;
  onDecide: (cardId: string, approve: boolean) => Promise<unknown>; onDecideRequest: DecideRequest;
  onSetAvailability: (memberId: string, weeklyHours: number) => Promise<ActionResult>; onResolve?: ResolveTask;
  onConfirmLink?: (linkRequestId: string, code: string) => Promise<ConfirmLinkResult>;
}) {
  const decisions = [...(vm.decisionCards ?? []), ...vm.cards];
  return (
    <aside className="work-panel card" aria-label="작업 패널">
      <div className="panel-tabs" role="tablist" aria-label="작업 패널">
        {TABS.map(t => (
          <button key={t.key} type="button" role="tab" id={`panel-tab-${t.key}`} aria-selected={tab === t.key} aria-controls="panel-body" onClick={() => onTab(t.key)}>
            {t.label}{t.key === "decisions" && decisions.length > 0 && <span className="tab-count num">{decisionTotal(decisions)}</span>}
          </button>
        ))}
      </div>
      <div className="panel-body" id="panel-body" role="tabpanel" aria-labelledby={`panel-tab-${tab}`}>
        {/* 작업 항목(work)은 계획 승인 뒤에 생긴다. 그 전에는 일정 내용을 빌려 오지 않고 작업 탭의 빈 상태를 보인다.
            작업 항목 없이 계획 작업만 오는 경우(예전 서버)에만 일정 카드의 작업 목록으로 대신한다. */}
        {tab === "work" && (vm.work || vm.roadmap.tasks.length === 0 ? <WorkTree vm={vm} onOpen={onOpenTask} /> : (
          <RoadmapCard roadmap={vm.roadmap} deadline={vm.project.deadline} members={vm.members} me={vm.me}
            onSetAvailability={onSetAvailability} onResolve={onResolve} />
        ))}
        {tab === "team" && <TeamList vm={vm} onOpen={onOpenTask} />}
        {tab === "decisions" && (
          decisions.length === 0
            ? <p className="muted">나에게 열린 결정 요청이 없어요.</p>
            : <div className="decision-list">{decisions.map(c => <DecisionCard key={c.id} card={c} members={vm.members} onDecide={onDecide} onDecideRequest={onDecideRequest} />)}</div>
        )}
        {tab === "schedule" && (
          <RoadmapCard roadmap={vm.roadmap} deadline={vm.project.deadline} members={vm.members} me={vm.me}
            onSetAvailability={onSetAvailability} onResolve={onResolve} showTasks={!vm.work} />
        )}
        {tab === "space" && <SpacePanel space={vm.space} onConfirmLink={onConfirmLink} />}
      </div>
    </aside>
  );
}
