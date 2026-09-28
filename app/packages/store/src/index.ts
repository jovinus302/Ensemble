// Persistence for the event ledger. SQLite (node:sqlite) and in-memory implementations
// live behind this interface so the rest of the app never touches storage directly.
import type { Id, LedgerEvent, NewLedgerEvent } from "@ensemble/core";

export interface LedgerFilter {
  projectId?: Id;
  afterSeq?: number;
}

export interface LedgerStore {
  /**
   * Appends events atomically. An event whose idempotencyKey already exists is skipped
   * and the existing event is returned in its place.
   */
  append(events: NewLedgerEvent[]): Promise<LedgerEvent[]>;
  read(filter?: LedgerFilter): Promise<LedgerEvent[]>;
}
