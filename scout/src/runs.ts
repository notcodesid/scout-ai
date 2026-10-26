import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { ScoutInput } from "./research/contracts.ts";

export type RunStatus = "queued" | "researching" | "reviewing" | "completed" | "partial" | "failed" | "cancelled";

/**
 * Durable run state. The `steps` table is the replacement for Inngest's step
 * memoization: each completed step's result is persisted under runId:name, so a
 * restarted process replays the agent function and reuses saved work instead of
 * repeating model or source calls.
 */
export class RunStore {
  private db: Database;

  constructor(path = ".data/research.db") {
    if (path !== ":memory:") mkdirSync(".data", { recursive: true });
    this.db = new Database(path);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,input TEXT NOT NULL,status TEXT NOT NULL,state TEXT NOT NULL,created TEXT NOT NULL,updated TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,run_id TEXT NOT NULL,name TEXT NOT NULL,detail TEXT NOT NULL,time TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS steps(run_id TEXT NOT NULL,name TEXT NOT NULL,result TEXT NOT NULL,time TEXT NOT NULL,PRIMARY KEY(run_id,name));`);
  }

  create(input: ScoutInput) {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare("INSERT INTO runs VALUES(?,?,?,?,?,?)").run(id, JSON.stringify(input), "queued", "{}", now, now);
    return id;
  }

  get(id: string) {
    const row = this.db.prepare("SELECT * FROM runs WHERE id=?").get(id) as
      | { id: string; input: string; status: RunStatus; state: string; created: string; updated: string }
      | undefined;
    return row ? { ...row, input: JSON.parse(row.input) as ScoutInput, state: JSON.parse(row.state) } : undefined;
  }

  update(id: string, status: RunStatus, state: unknown) {
    this.db.prepare("UPDATE runs SET status=?,state=?,updated=? WHERE id=? AND status!='cancelled'")
      .run(status, JSON.stringify(state), new Date().toISOString(), id);
  }

  cancel(id: string) {
    this.db.prepare("UPDATE runs SET status='cancelled',updated=? WHERE id=? AND status NOT IN ('completed','partial','failed')")
      .run(new Date().toISOString(), id);
  }

  event(id: string, name: string, detail: unknown) {
    this.db.prepare("INSERT INTO events(run_id,name,detail,time) VALUES(?,?,?,?)")
      .run(id, name, JSON.stringify(detail), new Date().toISOString());
  }

  events(id: string) {
    return this.db.prepare("SELECT name,detail,time FROM events WHERE run_id=? ORDER BY id").all(id);
  }

  /** Runs still in flight; the worker resumes these after a restart. */
  pending() {
    return this.db.prepare("SELECT id FROM runs WHERE status IN ('queued','researching','reviewing') ORDER BY created").all() as { id: string }[];
  }

  /** Memoized step. Completed results are replayed from SQLite; failed steps re-run. */
  step<T>(runId: string, name: string, work: () => Promise<T>): Promise<T> {
    const row = this.db.prepare("SELECT result FROM steps WHERE run_id=? AND name=?").get(runId, name) as { result: string } | null;
    if (row) return Promise.resolve(JSON.parse(row.result) as T);
    return work().then((value) => {
      this.db.prepare("INSERT OR REPLACE INTO steps(run_id,name,result,time) VALUES(?,?,?,?)")
        .run(runId, name, JSON.stringify(value ?? null), new Date().toISOString());
      return value;
    });
  }

  close() {
    this.db.close();
  }
}
