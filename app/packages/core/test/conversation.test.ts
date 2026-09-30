import { expect, it } from "vitest";
import { project, wasNotified } from "../src/index.ts";
import type { ActorKind, EventPayloads, EventType, LedgerEvent } from "../src/index.ts";

function ledger() {
  const events: LedgerEvent[] = [];
  const emit = <K extends EventType>(type: K, payload: EventPayloads[K], actor: { kind: ActorKind; id: string } = { kind: "human", id: "u" }) =>
    events.push({ id: `${events.length}`, seq: events.length + 1, at: "fixed", projectId: "p", targetProductId: "p", actor, type, payload });
  return { events, emit };
}
const pm = { kind: "pm", id: "pm" } as const;

it("projects messages in order, with PM speech attributed to the PM and duplicates ignored", () => {
  const { events, emit } = ledger();
  emit("message_recorded", { messageId: "m1", authorId: "u", text: "Can we ship Friday?", threadId: "t", attachmentIds: ["a1"] });
  emit("attachment_recorded", { attachmentId: "a1", name: "spec.pdf", mimeType: "application/pdf", uri: "file://spec.pdf" });
  emit("pm_considered", { considerationId: "c1", triggerId: "m1", whoseAction: "u", alreadyKnows: "no", evidence: ["T blocked"], decision: "speak", reason: "Deadline question", openTopics: ["deadline"] }, pm);
  emit("pm_spoke", { considerationId: "c1", messageId: "m2", text: "T is blocked on review.", kind: "fact" }, pm);
  emit("message_recorded", { messageId: "m2", authorId: "pm", text: "duplicate", attachmentIds: [] });
  const state = project(events);
  expect(state.messages).toEqual([
    { messageId: "m1", authorId: "u", text: "Can we ship Friday?", threadId: "t", seq: 1 },
    { messageId: "m2", authorId: "pm", text: "T is blocked on review.", seq: 4 },
  ]);
  expect(state.openTopics).toEqual(["deadline"]);
  emit("pm_considered", { considerationId: "c2", triggerId: "m2", whoseAction: null, alreadyKnows: "yes", evidence: [], decision: "silent", reason: "Already known", openTopics: [] }, pm);
  expect(project(events).openTopics).toEqual([]);
});

it("ignores malformed message payloads", () => {
  const { events, emit } = ledger();
  emit("message_recorded", { messageId: "m1", authorId: "u", text: "ok", attachmentIds: [] });
  const bad: LedgerEvent = { ...events[0]!, seq: 2, payload: { text: "Hello" } };
  expect(project([...events, bad]).messages).toHaveLength(1);
});

it("records decisions and clears authority requests once answered", () => {
  const { events, emit } = ledger();
  emit("decision_recorded", { decisionId: "d1", summary: "Drop export", sourceMessageIds: ["m1"], approvedBy: "u", changeKinds: ["scope_reduce"] }, pm);
  emit("authority_requested", { requestId: "r1", decisionId: "d1", personId: "u", changeKinds: ["deadline_change"], text: "Move deadline?" }, pm);
  emit("authority_requested", { requestId: "r2", personId: "v", changeKinds: ["human_commitment"], text: "Take review?" }, pm);
  let state = project(events);
  expect(state.decisions.get("d1")?.changeKinds).toEqual(["scope_reduce"]);
  expect([...state.pendingAuthority.keys()]).toEqual(["r1", "r2"]);
  emit("authority_granted", { requestId: "r1", personId: "u", granted: false });
  state = project(events);
  expect([...state.pendingAuthority.keys()]).toEqual(["r2"]);
});

it("tracks per-recipient change notifications so a change is not sent twice", () => {
  const { events, emit } = ledger();
  emit("change_notified", { changeId: "ch1", planVersion: 2, recipientId: "a", text: "T changed", via: "steer" }, pm);
  emit("change_notified", { changeId: "ch1", planVersion: 2, recipientId: "a", text: "T changed", via: "steer" }, pm);
  const state = project(events);
  expect(state.notified.size).toBe(1);
  expect(wasNotified(state, "ch1", "a")).toBe(true);
  expect(wasNotified(state, "ch1", "b")).toBe(false);
  expect(wasNotified(state, "ch2", "a")).toBe(false);
});
