import { describe, expect, it } from "vitest";
import { agentCapabilities, HUMAN_ASSIGNMENT_NEEDS_ACCEPTANCE, project, routeTask, routingProblems } from "../src/index.ts";
import type { ProjectState } from "../src/index.ts";

function state(): ProjectState {
  const s = project([]);
  const join = (memberId: string, kind: "human" | "agent", role?: string) => s.members.set(memberId, { memberId, kind, displayName: memberId, ...(role ? { role } : {}) });
  join("owner", "human"); join("designer", "human");
  join("research-agent", "agent");
  join("prototype-agent", "agent");
  join("proto-2", "agent", "prototype-agent");
  s.goal = { text: "목표", decider: "owner", delegation: { pmMayApply: [] } };
  return s;
}

describe("routing (§2.5)", () => {
  it("reads agent capabilities from one place", () => {
    expect(agentCapabilities(state())).toEqual([
      { memberId: "research-agent", roles: ["research-agent"] },
      { memberId: "prototype-agent", roles: ["prototype-agent"] },
      { memberId: "proto-2", roles: ["prototype-agent", "proto-2"] },
    ]);
  });

  it("(6) picks an agent whose role matches: an idle one first, then join order", () => {
    const s = state();
    const proposal = { executor: "agent" as const, reason: "agent_capable", note: "프로토타입은 Agent가 할 수 있어요", role: "prototype-agent" };
    expect(routeTask(s, proposal)).toEqual({ ok: true, assignee: "prototype-agent", routing: { executor: "agent", reason: "agent_capable", note: proposal.note } });
    s.activeTurn.set("prototype-agent", "busy");
    expect(routeTask(s, proposal)).toMatchObject({ ok: true, assignee: "proto-2" });
    s.activeTurn.set("proto-2", "busy2");
    expect(routeTask(s, proposal)).toMatchObject({ ok: true, assignee: "prototype-agent" });
    // No role given: the proposed agent's own role decides, and the rules still choose.
    expect(routeTask(state(), { executor: "agent", reason: "agent_capable", note: "", assignee: "proto-2" })).toMatchObject({ ok: true, assignee: "prototype-agent" });
    // The model's reason does not matter for agents: code records agent_capable.
    expect(routeTask(state(), { ...proposal, reason: "whatever" })).toMatchObject({ ok: true, routing: { reason: "agent_capable" } });
  });

  it("(6) without a capable agent, drops to a person with no_capable_agent", () => {
    const routed = routeTask(state(), { executor: "agent", reason: "agent_capable", note: "디자인 Agent 없음", role: "design-agent" });
    expect(routed).toEqual({ ok: true, assignee: "owner", routing: { executor: "human", reason: "no_capable_agent", note: "디자인 Agent 없음" }, needsAcceptance: HUMAN_ASSIGNMENT_NEEDS_ACCEPTANCE });
    expect(routeTask(state(), { executor: "agent", reason: "agent_capable", note: "", role: "design-agent", assignee: "designer" })).toMatchObject({ assignee: "designer" });
    expect(routeTask(state(), { executor: "agent", reason: "agent_capable", note: "" })).toMatchObject({ routing: { executor: "human", reason: "no_capable_agent" } });
  });

  it("(6) a person is assigned only for a reason from the closed enum", () => {
    const s = state();
    for (const reason of ["agent_capable", "seems_hard", ""]) expect(routeTask(s, { executor: "human", reason, note: "", assignee: "designer" })).toMatchObject({ ok: false });
    expect(routeTask(s, { executor: "human", reason: "needs_human_judgement", note: "디자인 판단", assignee: "designer" }))
      .toEqual({ ok: true, assignee: "designer", routing: { executor: "human", reason: "needs_human_judgement", note: "디자인 판단" }, needsAcceptance: true });
    // Q2 switch: assign and notify instead of an acceptance card.
    expect(routeTask(s, { executor: "human", reason: "needs_decision", note: "" }, { needsAcceptance: false })).toMatchObject({ ok: true, assignee: "owner", needsAcceptance: false });
    // An agent proposed as a human assignee is not kept.
    expect(routeTask(s, { executor: "human", reason: "needs_human_access", note: "", assignee: "proto-2" })).toMatchObject({ assignee: "owner" });
  });

  it("checks a recorded routing against the assignee", () => {
    const s = state();
    expect(routingProblems(s, "proto-2", { executor: "agent", reason: "agent_capable", note: "" })).toEqual([]);
    expect(routingProblems(s, "designer", { executor: "human", reason: "needs_human_access", note: "" })).toEqual([]);
    expect(routingProblems(s, "designer", { executor: "agent", reason: "agent_capable", note: "" })).toHaveLength(1);
    expect(routingProblems(s, "proto-2", { executor: "human", reason: "needs_decision", note: "" })).toHaveLength(1);
    expect(routingProblems(s, "designer", { executor: "human", reason: "agent_capable", note: "" })).toHaveLength(1);
    expect(routingProblems(s, "proto-2", { executor: "agent", reason: "no_capable_agent", note: "" })).toHaveLength(1);
    expect(routingProblems(s, "designer", { executor: "human", reason: "bogus" as never, note: "" })).toHaveLength(1);
  });
});
