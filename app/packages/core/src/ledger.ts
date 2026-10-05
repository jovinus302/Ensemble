// Domain core: event ledger types, projections, computeGap, task state machine.
// No external dependencies. Rules are defined in docs/work-model.md.

export type Id = string;

export type ActorKind = "human" | "agent" | "pm" | "system";

export interface Actor {
  kind: ActorKind;
  id: Id;
}

/** Every write goes through the ledger as one of these envelopes. */
export interface LedgerEvent<TType extends string = string, TPayload = unknown> {
  id: Id;
  /** Monotonic position in the ledger, assigned by the store. */
  seq: number;
  type: TType;
  projectId: Id;
  targetProductId: Id;
  actor: Actor;
  /** ISO-8601 timestamp. */
  at: string;
  /** Guards against applying the same trigger twice (e.g. one start per `checked`). */
  idempotencyKey?: string;
  payload: TPayload;
}

export type NewLedgerEvent = Omit<LedgerEvent, "id" | "seq" | "at"> & { at?: string };
