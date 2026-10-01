import type { Id } from "./ledger.ts";
import type { RoutingReason, TaskRouting } from "./events.ts";
import type { ProjectState } from "./projection.ts";

/**
 * Who does a piece of work. The LLM proposes an executor and a reason; this code decides.
 * Capability is read from one place (`agentCapabilities`) so #23's per-role skill/tool sets
 * can replace the role-key table without touching the rules.
 */
export const ROUTING_REASONS: readonly RoutingReason[] = ["agent_capable", "needs_decision", "needs_human_access", "needs_human_judgement", "no_capable_agent"];
/** The only reasons that may put work on a person. */
export const HUMAN_ROUTING_REASONS: readonly RoutingReason[] = ["needs_decision", "needs_human_access", "needs_human_judgement", "no_capable_agent"];
/**
 * Q2 default: a person accepts work assigned to them (an `assignment` decision request) rather than
 * being assigned and notified. One switch; `opAuthority` keeps human assignment a `human_commitment`.
 */
export const HUMAN_ASSIGNMENT_NEEDS_ACCEPTANCE = true;

export interface AgentCapability { memberId: Id; roles: string[] }
/**
 * Agent members and the role keys they can take, in join order. For now an agent's roles are its
 * `role` and its member id (built-in agents are addressed by role key, e.g. "research-agent").
 */
export function agentCapabilities(state: Pick<ProjectState, "members">): AgentCapability[] {
  return [...state.members.values()].filter((member) => member.kind === "agent")
    .map((member) => ({ memberId: member.memberId, roles: [...new Set([member.role, member.memberId].filter((role): role is string => typeof role === "string" && role.length > 0))] }));
}

export interface RoutingProposal {
  executor: "agent" | "human";
  /** Unvalidated: the model may send anything. */
  reason: string;
  note: string;
  /** The role the work needs (a role key). Falls back to the proposed agent's own roles. */
  role?: string;
  /** The member the model suggested. Agents are re-chosen by the rules; a human is kept if valid. */
  assignee?: Id;
}
export type RoutingDecision =
  | { ok: true; assignee: Id; routing: TaskRouting & { executor: "agent" } }
  /** `assignee` is a candidate; when `needsAcceptance` the PM asks them with an `assignment` request. */
  | { ok: true; assignee?: Id; routing: TaskRouting & { executor: "human" }; needsAcceptance: boolean }
  | { ok: false; reason: string };

/**
 * §2.5. An agent executor must be an agent member whose role matches; among several, an agent with
 * no active turn wins, then join order. No match drops to a person with `no_capable_agent`.
 * A human executor needs a reason from the closed enum; the candidate is the proposed person,
 * else the decider.
 */
export function routeTask(state: Pick<ProjectState, "members" | "activeTurn" | "goal">, proposal: RoutingProposal, options: { needsAcceptance?: boolean } = {}): RoutingDecision {
  const needsAcceptance = options.needsAcceptance ?? HUMAN_ASSIGNMENT_NEEDS_ACCEPTANCE;
  const human = (id: Id | undefined) => id !== undefined && state.members.get(id)?.kind === "human";
  const candidate = human(proposal.assignee) ? proposal.assignee : state.goal?.decider;
  const toHuman = (reason: RoutingReason, note: string): RoutingDecision =>
    ({ ok: true, ...(candidate !== undefined ? { assignee: candidate } : {}), routing: { executor: "human", reason, note }, needsAcceptance });
  if (proposal.executor === "human") {
    if (!(HUMAN_ROUTING_REASONS as readonly string[]).includes(proposal.reason)) return { ok: false, reason: `Routing reason ${String(proposal.reason)} cannot assign work to a person` };
    return toHuman(proposal.reason as RoutingReason, proposal.note);
  }
  if (proposal.executor !== "agent") return { ok: false, reason: `Unknown executor ${String(proposal.executor)}` };
  const agents = agentCapabilities(state);
  const role = proposal.role ?? agents.find((agent) => agent.memberId === proposal.assignee)?.roles[0];
  const capable = role === undefined ? [] : agents.filter((agent) => agent.roles.includes(role));
  const chosen = capable.find((agent) => !state.activeTurn.has(agent.memberId)) ?? capable[0];
  if (!chosen) return toHuman("no_capable_agent", proposal.note);
  return { ok: true, assignee: chosen.memberId, routing: { executor: "agent", reason: "agent_capable", note: proposal.note } };
}

/** Whether a recorded routing agrees with the assignee: used to validate drafted work. */
export function routingProblems(state: Pick<ProjectState, "members">, assignee: Id, routing: TaskRouting): string[] {
  const member = state.members.get(assignee);
  if (!(ROUTING_REASONS as readonly string[]).includes(routing.reason)) return [`Unknown routing reason ${String(routing.reason)}`];
  if (routing.executor === "agent") {
    if (member?.kind !== "agent") return [`Agent routing needs an agent assignee, not ${assignee}`];
    return routing.reason === "agent_capable" ? [] : [`Agent routing must be agent_capable, not ${routing.reason}`];
  }
  if (routing.executor !== "human") return [`Unknown executor ${String(routing.executor)}`];
  if (member?.kind !== "human") return [`Human routing needs a human assignee, not ${assignee}`];
  return HUMAN_ROUTING_REASONS.includes(routing.reason) ? [] : [`Routing reason ${routing.reason} cannot assign work to a person`];
}
