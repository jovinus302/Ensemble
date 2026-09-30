// Persistence for the event ledger. SQLite (node:sqlite) and in-memory implementations
// live behind this interface so the rest of the app never touches storage directly.
// The ledger is append-only: there is no update or delete API.
import type { Id, LedgerEvent, NewLedgerEvent } from "@ensemble/core";

export interface LedgerFilter {
  projectId?: Id;
  afterSeq?: number;
}

export interface TxResult<T> {
  /** fn's events after idempotency dedupe; an existing event stands in for each duplicate. */
  appended: LedgerEvent[];
  result: T;
}

export type TxFn<T> = (events: readonly LedgerEvent[]) => { append: NewLedgerEvent[]; result: T };

export interface LedgerStore {
  /**
   * Appends events atomically. An event whose idempotencyKey already exists in the same project
   * (in the store or earlier in the batch) is skipped and that project's existing event is returned.
   */
  append(events: NewLedgerEvent[]): Promise<LedgerEvent[]>;
  read(filter?: LedgerFilter): Promise<LedgerEvent[]>;
  /**
   * Reads the whole ledger of projectId, hands it to fn, and appends what fn returns in the
   * same transaction. fn must be synchronous (no await), so concurrent calls in one process
   * cannot interleave. If fn throws, nothing is written and the error propagates.
   */
  transaction<T>(projectId: Id, fn: TxFn<T>): Promise<TxResult<T>>;
  close(): void;
}

export { MemoryLedgerStore } from "./memory.ts";
export { SqliteLedgerStore } from "./sqlite.ts";
