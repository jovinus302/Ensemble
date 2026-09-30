// SQLite LedgerStore on the built-in node:sqlite module. Every write runs inside
// BEGIN IMMEDIATE, so several instances opening the same file serialize on the write lock.
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { Id, LedgerEvent, NewLedgerEvent } from "@ensemble/core";
import type { LedgerFilter, LedgerStore, TxFn, TxResult } from "./index.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS ledger (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL,
  project_id TEXT NOT NULL,
  target_product_id TEXT NOT NULL,
  actor_kind TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  at TEXT NOT NULL,
  idempotency_key TEXT,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_project_id ON ledger (project_id);
`;

interface Row {
  seq: number;
  id: string;
  type: string;
  project_id: string;
  target_product_id: string;
  actor_kind: string;
  actor_id: string;
  at: string;
  idempotency_key: string | null;
  payload: string;
}

function toEvent(row: Row): LedgerEvent {
  const event: LedgerEvent = {
    id: row.id,
    seq: Number(row.seq),
    type: row.type,
    projectId: row.project_id,
    targetProductId: row.target_product_id,
    actor: { kind: row.actor_kind as LedgerEvent["actor"]["kind"], id: row.actor_id },
    at: row.at,
    payload: JSON.parse(row.payload) as unknown,
  };
  if (row.idempotency_key !== null) event.idempotencyKey = row.idempotency_key;
  return event;
}

export class SqliteLedgerStore implements LedgerStore {
  private readonly db: DatabaseSync;

  /** path is a database file, or ":memory:". */
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    // Wait for another connection's write lock instead of failing with SQLITE_BUSY.
    this.db.exec("PRAGMA busy_timeout = 5000;");
    if (path !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(SCHEMA);
    this.migrateIdempotency();
  }

  /** Preserve every event and sequence while replacing SQLite's non-droppable legacy UNIQUE autoindex. */
  private migrateIdempotency(): void {
    this.inTransaction(() => {
      const indexes = this.db.prepare("SELECT name FROM pragma_index_list('ledger') WHERE \"unique\" = 1").all() as { name: string }[];
      const legacy = indexes.some(index => {
        const columns = this.db.prepare('SELECT name FROM pragma_index_info(?)').all(index.name) as { name: string }[];
        return columns.length === 1 && columns[0]!.name === 'idempotency_key';
      });
      if (legacy) {
        // A single transaction makes a crash/failure leave either the original or the complete new table.
        this.db.exec(`CREATE TABLE ledger_project_scoped (
          seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, type TEXT NOT NULL,
          project_id TEXT NOT NULL, target_product_id TEXT NOT NULL, actor_kind TEXT NOT NULL,
          actor_id TEXT NOT NULL, at TEXT NOT NULL, idempotency_key TEXT, payload TEXT NOT NULL
        );
        INSERT INTO ledger_project_scoped SELECT * FROM ledger;
        DROP TABLE ledger;
        ALTER TABLE ledger_project_scoped RENAME TO ledger;`);
      }
      this.db.exec(`CREATE INDEX IF NOT EXISTS ledger_project_id ON ledger (project_id);
        CREATE UNIQUE INDEX IF NOT EXISTS ledger_project_idempotency ON ledger (project_id, idempotency_key);`);
    });
  }

  async append(events: NewLedgerEvent[]): Promise<LedgerEvent[]> {
    return this.inTransaction(() => this.appendSync(events));
  }

  async read(filter: LedgerFilter = {}): Promise<LedgerEvent[]> {
    return this.readSync(filter);
  }

  async transaction<T>(projectId: Id, fn: TxFn<T>): Promise<TxResult<T>> {
    return this.inTransaction(() => {
      const { append, result } = fn(this.readSync({ projectId }));
      return { appended: this.appendSync(append), result };
    });
  }

  close(): void {
    if (this.db.isOpen) this.db.close();
  }

  private inTransaction<T>(body: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = body();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private appendSync(events: NewLedgerEvent[]): LedgerEvent[] {
    const byKey = this.db.prepare("SELECT * FROM ledger WHERE project_id = ? AND idempotency_key = ?");
    const insert = this.db.prepare(
      `INSERT INTO ledger (id, type, project_id, target_product_id, actor_kind, actor_id, at, idempotency_key, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    );
    return events.map((input) => {
      // Rows inserted earlier in this batch are visible here, so in-batch duplicates dedupe too.
      if (input.idempotencyKey !== undefined) {
        const existing = byKey.get(input.projectId, input.idempotencyKey) as Row | undefined;
        if (existing) return toEvent(existing);
      }
      const row = insert.get(
        randomUUID(),
        input.type,
        input.projectId,
        input.targetProductId,
        input.actor.kind,
        input.actor.id,
        input.at ?? new Date().toISOString(),
        input.idempotencyKey ?? null,
        JSON.stringify(input.payload ?? null),
      ) as unknown as Row;
      return toEvent(row);
    });
  }

  private readSync({ projectId, afterSeq }: LedgerFilter): LedgerEvent[] {
    const rows = this.db
      .prepare("SELECT * FROM ledger WHERE (? IS NULL OR project_id = ?) AND seq > ? ORDER BY seq")
      .all(projectId ?? null, projectId ?? null, afterSeq ?? 0) as unknown as Row[];
    return rows.map(toEvent);
  }
}
