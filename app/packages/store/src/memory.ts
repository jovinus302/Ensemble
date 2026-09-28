// In-memory LedgerStore for tests and ephemeral runs. Every operation runs synchronously
// inside the returned promise, so transactions cannot interleave.
import { randomUUID } from "node:crypto";
import type { Id, LedgerEvent, NewLedgerEvent } from "@ensemble/core";
import type { LedgerFilter, LedgerStore, TxFn, TxResult } from "./index.ts";

export class MemoryLedgerStore implements LedgerStore {
  private readonly events: LedgerEvent[] = [];
  private readonly byKey = new Map<string, LedgerEvent>();
  private closed = false;

  async append(events: NewLedgerEvent[]): Promise<LedgerEvent[]> {
    this.assertOpen();
    return this.appendSync(events);
  }

  async read(filter: LedgerFilter = {}): Promise<LedgerEvent[]> {
    this.assertOpen();
    return this.readSync(filter);
  }

  async transaction<T>(projectId: Id, fn: TxFn<T>): Promise<TxResult<T>> {
    this.assertOpen();
    const { append, result } = fn(this.readSync({ projectId }));
    return { appended: this.appendSync(append), result };
  }

  close(): void {
    this.closed = true;
  }

  private appendSync(events: NewLedgerEvent[]): LedgerEvent[] {
    // Stage the whole batch before committing so a failure (e.g. an unclonable payload)
    // cannot leave a partial write behind.
    const out: LedgerEvent[] = [];
    const staged: LedgerEvent[] = [];
    const stagedKeys = new Map<string, LedgerEvent>();
    let seq = this.events.length;
    for (const input of events) {
      const key = input.idempotencyKey;
      const existing = key === undefined ? undefined : (this.byKey.get(key) ?? stagedKeys.get(key));
      if (existing) {
        out.push(existing);
        continue;
      }
      const event: LedgerEvent = structuredClone({
        ...input,
        id: randomUUID(),
        seq: ++seq,
        at: input.at ?? new Date().toISOString(),
      });
      staged.push(event);
      if (key !== undefined) stagedKeys.set(key, event);
      out.push(event);
    }
    for (const event of staged) {
      this.events.push(event);
      if (event.idempotencyKey !== undefined) this.byKey.set(event.idempotencyKey, event);
    }
    return out.map((e) => structuredClone(e));
  }

  private readSync({ projectId, afterSeq }: LedgerFilter): LedgerEvent[] {
    return this.events
      .filter(
        (e) => (projectId === undefined || e.projectId === projectId) && (afterSeq === undefined || e.seq > afterSeq),
      )
      .map((e) => structuredClone(e));
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("MemoryLedgerStore is closed");
  }
}
