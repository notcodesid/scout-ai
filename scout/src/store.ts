import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { freshChat, type Chat } from "./interview.ts";

export type Row = { chat: Chat; seen: string[] };

export function openStore(path = ".data/interviews.db") {
  mkdirSync(".data", { recursive: true });
  const db = new Database(path);
  db.run(`CREATE TABLE IF NOT EXISTS interviews (
    space_id TEXT PRIMARY KEY,
    interview TEXT NOT NULL,
    seen TEXT NOT NULL
  )`);
  return {
    load(spaceId: string): Row {
      const row = db.query("SELECT interview, seen FROM interviews WHERE space_id = ?").get(spaceId) as
        | { interview: string; seen: string }
        | null;
      if (!row) return { chat: freshChat(), seen: [] };
      const chat = JSON.parse(row.interview) as Chat;
      if (!chat.transcript || !chat.draft) return { chat: freshChat(), seen: [] };
      return { chat, seen: JSON.parse(row.seen) as string[] };
    },
    /** Every stored interview, for callers that need "the" profile without knowing the chat. */
    all(): { spaceId: string; chat: Chat }[] {
      return (db.query("SELECT space_id, interview FROM interviews").all() as { space_id: string; interview: string }[])
        .flatMap((row) => {
          const chat = JSON.parse(row.interview) as Chat;
          return chat.transcript && chat.draft ? [{ spaceId: row.space_id, chat }] : [];
        });
    },
    save(spaceId: string, row: Row) {
      db.query("INSERT INTO interviews (space_id, interview, seen) VALUES (?, ?, ?) ON CONFLICT(space_id) DO UPDATE SET interview = excluded.interview, seen = excluded.seen")
        .run(spaceId, JSON.stringify(row.chat), JSON.stringify(row.seen.slice(-200)));
    },
  };
}
