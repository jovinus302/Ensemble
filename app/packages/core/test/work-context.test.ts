import { describe, expect, it } from "vitest";
import { contextIssueCount, contextStatusCounts, currentPreview, project, workContextFacts } from "../src/index.ts";
import type { AppPreviewSpec, EventPayloads, EventType, LedgerEvent } from "../src/index.ts";

type Emit = <K extends EventType>(type: K, payload: EventPayloads[K], actor?: LedgerEvent["actor"]) => void;
function ledger() {
  const events: LedgerEvent[] = [];
  const emit: Emit = (type, payload, actor = { kind: "pm", id: "pm" }) =>
    events.push({ id: `e${events.length}`, seq: events.length + 1, at: "2026-10-02T01:00:00Z", projectId: "p", targetProductId: "p", actor, type, payload });
  return { events, emit };
}
const human = { kind: "human", id: "planner" } as const;
const spec: AppPreviewSpec = { appName: "Pages", dateLabel: "10월 2일", versions: ["v1.0"], activeVersion: "v1.0", hero: { kicker: "k", format: "동화", title: "t", meta: "m", sources: "s" }, primaryAction: "지금 만들기", formats: ["동화"], formatAction: "생성", history: [], tabs: ["home"] };
function seeded() {
  const l = ledger();
  l.emit("member_joined", { memberId: "planner", kind: "human", displayName: "기획자" }, human);
  l.emit("member_joined", { memberId: "agent", kind: "agent", displayName: "Story Agent" }, human);
  l.emit("goal_set", { text: "Pages", decider: "planner", delegation: { pmMayApply: [] } }, human);
  l.emit("context_session_started", { contextId: "C", code: "C", title: "Pages", channelName: "general", version: "0.3" }, { kind: "system", id: "seed" });
  l.emit("context_item_upserted", { item: { itemId: "d2", key: "D2", layer: "decision", title: "fiction · 공유", status: "branch", sourceMemberId: "pm", sourceMessageIds: [] } });
  l.emit("context_branch_opened", { itemId: "d2", question: "어떻게?", sourceMessageIds: [], options: [{ optionId: "A", title: "실명", gains: [], risks: [] }, { optionId: "B", title: "가명", gains: [], risks: [] }] });
  return l;
}

describe("Work Context projection", () => {
  it("stays off until the session starts and ignores earlier context events", () => {
    const l = ledger();
    l.emit("context_item_upserted", { item: { itemId: "x", layer: "intent", title: "x", status: "stated", sourceMemberId: "pm", sourceMessageIds: [] } });
    expect(project(l.events).workContext).toBeUndefined();
    l.emit("context_session_started", { contextId: "C", code: "C", title: "T", channelName: "c", version: "0.3" });
    const wc = project(l.events).workContext!;
    expect(wc.version).toBe("0.3");
    expect(wc.items.size).toBe(0);
  });

  it("lets only a human settle a branch, and only on a listed option", () => {
    const l = seeded();
    l.emit("context_branch_resolved", { itemId: "d2", optionId: "B", decidedBy: "agent", evidenceMemberIds: [], sourceMessageIds: [] });
    l.emit("context_branch_resolved", { itemId: "d2", optionId: "C", decidedBy: "planner", evidenceMemberIds: [], sourceMessageIds: [] });
    expect(project(l.events).workContext!.branches.get("d2")!.resolved).toBeUndefined();
    l.emit("context_branch_resolved", { itemId: "d2", optionId: "B", decidedBy: "planner", evidenceMemberIds: [], sourceMessageIds: [] });
    expect(project(l.events).workContext!.branches.get("d2")!.resolved?.optionId).toBe("B");
  });

  it("keeps a branch preview until it is cleared, and the newest live preview wins", () => {
    const l = seeded();
    l.emit("preview_rendered", { previewId: "pb", source: "proposal", label: "Proposal v1", spec });
    l.emit("preview_rendered", { previewId: "pa", source: "branch", label: "A 예상", spec });
    l.emit("context_branch_previewed", { itemId: "d2", optionId: "A", effects: ["실명 기반"], previewId: "pa", sourceMessageIds: [] });
    let wc = project(l.events).workContext!;
    expect(wc.branches.get("d2")!.preview).toEqual({ optionId: "A", effects: ["실명 기반"], previewId: "pa" });
    expect(currentPreview(wc)?.preview.previewId).toBe("pa");
    l.emit("context_branch_preview_cleared", { itemId: "d2", optionId: "A" });
    l.emit("preview_withdrawn", { previewId: "pa" });
    wc = project(l.events).workContext!;
    expect(wc.branches.get("d2")!.preview).toBeUndefined();
    expect(currentPreview(wc)?.preview.previewId).toBe("pb");
    expect(currentPreview(wc, "branch")).toBeUndefined();
  });

  it("moves the context version on a human confirmation and on an applied change set", () => {
    const l = seeded();
    l.emit("proposal_generated", { proposalId: "p1", version: 1, title: "v1", decisionItemIds: ["d2"], filledItemIds: [], inputItemIds: [], screens: ["home"], sourceMessageIds: [] });
    l.emit("proposal_confirmed", { proposalId: "p1", contextVersion: "1.0", confirmedBy: "agent", sourceMessageIds: [] });
    expect(project(l.events).workContext!.version).toBe("0.3");
    l.emit("proposal_confirmed", { proposalId: "p1", contextVersion: "1.0", confirmedBy: "planner", sourceMessageIds: [] }, human);
    expect(project(l.events).workContext!.proposals.get("p1")!.status).toBe("confirmed");
    l.emit("context_change_proposed", { changeSetId: "c1", fromVersion: "1.0", toVersion: "1.1", changes: [], staleItemIds: [], unaffectedItemIds: [], sourceMessageIds: [] });
    l.emit("context_change_resolved", { changeSetId: "c1", outcome: "applied", by: "planner" }, human);
    l.emit("context_change_resolved", { changeSetId: "c1", outcome: "reverted", by: "planner" }, human);
    const wc = project(l.events).workContext!;
    expect(wc.version).toBe("1.1");
    expect(wc.changeSets.get("c1")!.status).toBe("applied");
  });

  it("tracks handoffs only to linked tools and their latest progress", () => {
    const l = seeded();
    l.emit("tool_handoff_sent", { handoffId: "h0", toolId: "figma", itemIds: [], title: "S1", round: 1 });
    l.emit("production_tool_linked", { toolId: "figma", name: "Figma", ownerMemberId: "planner", accepts: ["screen"] }, { kind: "system", id: "seed" });
    l.emit("tool_handoff_sent", { handoffId: "h1", toolId: "figma", itemIds: [], title: "S1", round: 1 });
    l.emit("tool_progress_reported", { handoffId: "h1", status: "in_progress", note: "제작 중" }, { kind: "system", id: "tools" });
    l.emit("tool_progress_reported", { handoffId: "h1", status: "done" }, { kind: "system", id: "tools" });
    const wc = project(l.events).workContext!;
    expect([...wc.handoffs.keys()]).toEqual(["h1"]);
    expect(wc.handoffs.get("h1")).toMatchObject({ status: "done" });
    expect(wc.handoffs.get("h1")!.note).toBeUndefined();
  });

  it("counts issues and hands the PM facts without internal state", () => {
    const l = seeded();
    l.emit("context_item_upserted", { item: { itemId: "m", layer: "metric", title: "지표", status: "missing", sourceMemberId: "pm", sourceMessageIds: [] } });
    const state = project(l.events);
    expect(contextIssueCount(state.workContext!)).toBe(1);
    expect(contextStatusCounts(state.workContext!).get("branch")).toBe(1);
    const facts = workContextFacts(state, { kind: "message", messageId: "m1" })!;
    expect(facts.decider).toBe("planner");
    expect(facts.branches).toEqual([{ itemId: "d2", question: "어떻게?", options: expect.any(Array) }]);
    expect(JSON.stringify(facts)).not.toContain("seq");
    expect(workContextFacts(project([]), { kind: "message", messageId: "m1" })).toBeUndefined();
  });
});
