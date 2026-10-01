import type { AnyEvent, DecisionOutcome, EventPayloads } from "./events.ts";
import type { ProjectState } from "./projection.ts";

export type DecisionRequestStatus = "open" | DecisionOutcome;
export interface DecisionRequestState {
  request: EventPayloads["decision_requested"];
  status: DecisionRequestStatus;
  /** Ledger seq of the `decision_requested` event. */
  requestedSeq: number;
  resolution?: EventPayloads["decision_resolved"];
}
export type DecisionEvent = Extract<AnyEvent, { type: "decision_requested" | "decision_resolved" }>;

/**
 * Decision-request reducer for `state.decisionRequests`. `project()` calls it for both events.
 * M0 stub: no-op (milestone MB implements).
 */
export function applyDecisionEvent(_state: ProjectState, _event: DecisionEvent): void {}

/**
 * True when the target person answered their own open request (anything but rejected/withdrawn/expired).
 * `project()` evaluates it before the reducer runs and resets the automation counter like an approved card.
 * M0 stub: always false (milestone MB implements).
 */
export function decisionApproved(_state: ProjectState, _event: AnyEvent): boolean { return false; }
