import type { NewLedgerEvent } from "./ledger.ts";
import type { EventContext } from "./events.ts";
import type { ProjectState } from "./projection.ts";
export const AUTOMATION_LIMIT = 12;
export function automationGate(state: ProjectState): { allowed: boolean; remaining: number } {
  const remaining = state.automation.limitReached ? 0 : Math.max(0, AUTOMATION_LIMIT - state.automation.actionsSinceResume);
  return { allowed: remaining > 0, remaining };
}
export function limitReachedEvent(state: ProjectState, ctx: EventContext): NewLedgerEvent | null {
  if (state.automation.actionsSinceResume < AUTOMATION_LIMIT || state.automation.limitReached) return null;
  return { ...ctx, type: "action_limit_reached", actor: { kind: "pm", id: "pm" }, idempotencyKey: `limit:${state.lastSeq}`, payload: { count: state.automation.actionsSinceResume, limit: AUTOMATION_LIMIT } };
}
