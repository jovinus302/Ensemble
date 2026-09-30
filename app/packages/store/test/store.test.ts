import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from "vitest";
import type { LedgerEvent, NewLedgerEvent } from "@ensemble/core";
import { MemoryLedgerStore, SqliteLedgerStore, type LedgerStore } from "../src/index.ts";

function ev(overrides: Partial<NewLedgerEvent> = {}): NewLedgerEvent {
  return {
    type: "claim_recorded",
    projectId: "p1",
    targetProductId: "tp1",
    actor: { kind: "human", id: "designer" },
    payload: {},
    ...overrides,
  };
}

const tempDirs: string[] = [];
const openStores: LedgerStore[] = [];

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "ensemble-store-"));
  tempDirs.push(dir);
  return join(dir, "ledger.db");
}

function track<S extends LedgerStore>(store: S): S {
  openStores.push(store);
  return store;
}

afterEach(() => {
  for (const store of openStores.splice(0)) store.close();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Adds the start:T1 event only if the project's ledger does not have it yet. */
function startOnce(events: readonly LedgerEvent[]) {
  const started = events.some((e) => e.idempotencyKey === "start:T1");
  return {
    append: started ? [] : [ev({ type: "task_started", idempotencyKey: "start:T1" })],
    result: !started,
  };
}

const implementations: Array<[string, () => LedgerStore]> = [
  ["memory", () => track(new MemoryLedgerStore())],
  ["sqlite", () => track(new SqliteLedgerStore(tempDb()))],
];

describe.each(implementations)("LedgerStore contract (%s)", (_name, make) => {
  it("assigns increasing seq, id and at, and preserves order", async () => {
    const store = make();
    const written = await store.append([ev({ payload: { n: 1 } }), ev({ payload: { n: 2 }, at: "2026-01-01T00:00:00.000Z" })]);
    const more = await store.append([ev({ payload: { n: 3 } })]);

    expect(written.map((e) => e.seq)).toEqual([1, 2]);
    expect(more[0]?.seq).toBe(3);
    expect(written[1]?.at).toBe("2026-01-01T00:00:00.000Z");
    expect(written[0]?.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(new Set([...written, ...more].map((e) => e.id)).size).toBe(3);

    const all = await store.read();
    expect(all.map((e) => e.payload)).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
    expect(all[0]).toEqual(written[0]);
  });

  it("filters by projectId and afterSeq", async () => {
    const store = make();
    await store.append([ev({ projectId: "p1" }), ev({ projectId: "p2" }), ev({ projectId: "p1" })]);

    expect((await store.read({ projectId: "p1" })).map((e) => e.seq)).toEqual([1, 3]);
    expect((await store.read({ afterSeq: 1 })).map((e) => e.seq)).toEqual([2, 3]);
    expect((await store.read({ projectId: "p1", afterSeq: 1 })).map((e) => e.seq)).toEqual([3]);
    expect(await store.read({ projectId: "none" })).toEqual([]);
  });

  it("stores an idempotency key once across calls and returns the existing event", async () => {
    const store = make();
    const [first] = await store.append([ev({ idempotencyKey: "k1", payload: { v: 1 } })]);
    const [second] = await store.append([ev({ idempotencyKey: "k1", payload: { v: 2 } })]);

    expect(second).toEqual(first);
    expect(await store.read()).toHaveLength(1);
  });

  it('isolates the same reservation key across projects while deduplicating within each project', async () => {
    const store = make();
    const key = 'start:prototype:v1';
    const events = await store.append([ev({ projectId: 'old', idempotencyKey: key }), ev({ projectId: 'new', idempotencyKey: key }), ev({ projectId: 'old', idempotencyKey: key })]);
    expect(events[0]!.id).not.toBe(events[1]!.id);
    expect(events[2]).toEqual(events[0]);
    expect((await store.read({ projectId: 'new' }))[0]).toEqual(events[1]);
    expect((await store.append([ev({ projectId: 'new', idempotencyKey: key })]))[0]).toEqual(events[1]);
    expect(await store.read()).toHaveLength(2);
  });

  it("stores a duplicate key within one batch once", async () => {
    const store = make();
    const out = await store.append([
      ev({ idempotencyKey: "k1", payload: { v: 1 } }),
      ev({ payload: { v: 2 } }),
      ev({ idempotencyKey: "k1", payload: { v: 3 } }),
    ]);

    expect(out).toHaveLength(3);
    expect(out[2]).toEqual(out[0]);
    expect((await store.read()).map((e) => e.payload)).toEqual([{ v: 1 }, { v: 2 }]);
  });

  it("always writes events without an idempotency key", async () => {
    const store = make();
    await store.append([ev(), ev()]);
    await store.append([ev()]);
    expect(await store.read()).toHaveLength(3);
  });

  it("transaction hands fn only its project's ledger and appends fn's events", async () => {
    const store = make();
    await store.append([ev({ projectId: "p1" }), ev({ projectId: "p2" })]);

    const tx = await store.transaction("p1", (events) => ({
      append: [ev({ type: "seen", payload: { count: events.length, projects: events.map((e) => e.projectId) } })],
      result: events.length,
    }));

    expect(tx.result).toBe(1);
    expect(tx.appended.map((e) => e.payload)).toEqual([{ count: 1, projects: ["p1"] }]);
    expect(tx.appended[0]?.seq).toBe(3);
  });

  it("two concurrent transactions produce exactly one start:T1 event", async () => {
    const store = make();
    const [a, b] = await Promise.all([store.transaction("p1", startOnce), store.transaction("p1", startOnce)]);

    expect([a.result, b.result].filter(Boolean)).toHaveLength(1);
    expect((await store.read()).filter((e) => e.idempotencyKey === "start:T1")).toHaveLength(1);
  });

  it("writes nothing when fn throws", async () => {
    const store = make();
    await store.append([ev()]);

    await expect(
      store.transaction("p1", () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(await store.read()).toHaveLength(1);
    // The store remains usable after a failed transaction.
    const tx = await store.transaction("p1", startOnce);
    expect(tx.appended).toHaveLength(1);
  });
});

describe("SqliteLedgerStore on a shared file", () => {
  it('migrates a legacy globally-unique database without changing historical events, and safely reopens', async () => {
    const file = tempDb();
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE ledger (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, type TEXT NOT NULL,
      project_id TEXT NOT NULL, target_product_id TEXT NOT NULL, actor_kind TEXT NOT NULL, actor_id TEXT NOT NULL,
      at TEXT NOT NULL, idempotency_key TEXT UNIQUE, payload TEXT NOT NULL);
      INSERT INTO ledger VALUES (7, 'historical-event', 'claim_recorded', 'old', 'tp1', 'human', 'designer', '2026-01-01T00:00:00Z', 'start:prototype:v1', '{"kept":true}');`);
    old.close();
    const migrated = new SqliteLedgerStore(file);
    const historical = await migrated.read();
    expect(historical).toEqual([{ seq: 7, id: 'historical-event', type: 'claim_recorded', projectId: 'old', targetProductId: 'tp1', actor: { kind: 'human', id: 'designer' }, at: '2026-01-01T00:00:00Z', idempotencyKey: 'start:prototype:v1', payload: { kept: true } }]);
    expect((await migrated.append([ev({ projectId: 'old', idempotencyKey: 'start:prototype:v1' })]))[0]).toEqual(historical[0]);
    const added = await migrated.append([ev({ projectId: 'new', idempotencyKey: 'start:prototype:v1' })]);
    expect(added[0]!.seq).toBe(8);
    const all = await migrated.read(); migrated.close();
    const reopened = track(new SqliteLedgerStore(file));
    expect(await reopened.read()).toEqual(all);
    expect(await reopened.append([ev({ projectId: 'new', idempotencyKey: 'start:prototype:v1' })])).toEqual(added);
  });
  it("a second instance sees the first instance's key and does not duplicate it", async () => {
    const path = tempDb();
    const one = track(new SqliteLedgerStore(path));
    const two = track(new SqliteLedgerStore(path));

    const first = await one.transaction("p1", startOnce);
    const second = await two.transaction("p1", startOnce);
    const [viaAppend] = await two.append([ev({ idempotencyKey: "start:T1" })]);

    expect(first.result).toBe(true);
    expect(second.result).toBe(false);
    expect(viaAppend).toEqual(first.appended[0]);
    expect(await one.read()).toHaveLength(1);
  });

  it("concurrent transactions across two instances produce one start:T1 event", async () => {
    const path = tempDb();
    const one = track(new SqliteLedgerStore(path));
    const two = track(new SqliteLedgerStore(path));

    await Promise.all([one.transaction("p1", startOnce), two.transaction("p1", startOnce)]);
    expect((await one.read()).filter((e) => e.idempotencyKey === "start:T1")).toHaveLength(1);
  });

  it("keeps the ledger after close and reopen", async () => {
    const path = tempDb();
    const store = new SqliteLedgerStore(path);
    const written = await store.append([ev({ idempotencyKey: "k1", payload: { deep: { list: [1, 2] } } }), ev()]);
    store.close();

    const reopened = track(new SqliteLedgerStore(path));
    expect(await reopened.read()).toEqual(written);
    const [next] = await reopened.append([ev()]);
    expect(next?.seq).toBe(3);
  });
});
