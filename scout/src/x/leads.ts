import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { X_LIMITS, buildQueries, classify, type Lead, type Tweet } from "./contracts.ts";

export interface XProviders {
  /** One page of latest-first search results. */
  search(query: string, cursor: string): Promise<{ tweets: Tweet[]; nextCursor: string | null }>;
}

export type XOptions = { hours?: number; pages?: number; now?: Date; queries?: string[] };

export type XResult = {
  /** Every tweet retrieved, kept so the filter can be re-run without new searches (`--from`). */
  raw: Tweet[];
  leads: Lead[];
  /** Leads not shown on any earlier run. */
  fresh: Lead[];
  tweets: number;
  requests: number;
  dropped: Record<string, number>;
  failures: string[];
};

/** Remembers which posts have been surfaced, so a rerun reports only new ones. */
export class XLeadStore {
  private db: Database;

  constructor(path = ".data/radar.db") {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.exec("CREATE TABLE IF NOT EXISTS xleads(id TEXT PRIMARY KEY,data TEXT NOT NULL,first_seen TEXT NOT NULL)");
  }

  /** Returns true when the post was not known before. */
  record(lead: Lead, now = new Date()) {
    return this.db.prepare("INSERT OR IGNORE INTO xleads VALUES(?,?,?)").run(lead.id, JSON.stringify(lead), now.toISOString()).changes > 0;
  }

  all() {
    return (this.db.prepare("SELECT data FROM xleads ORDER BY first_seen DESC").all() as { data: string }[]).map((row) => JSON.parse(row.data) as Lead);
  }

  close() {
    this.db.close();
  }
}

const sameText = (text: string) => text.toLowerCase().replace(/https?:\S+/g, "").replace(/[^a-z0-9]/g, "").slice(0, 80);

/** Founder posts first, then newest; the score already weighs both. */
export const rankLeads = (leads: Lead[]) => [...leads].sort((a, b) => b.score - a.score || a.hoursOld - b.hoursOld);

/** Turns raw tweets into ranked leads: one per post, and one per poster repeating the same text. */
export function leadsFromTweets(tweets: Tweet[], now: Date, hours = X_LIMITS.hours) {
  const dropped: Record<string, number> = {};
  const byPost = new Map<string, Lead>();
  const seenText = new Set<string>();
  for (const tweet of tweets) {
    const verdict = classify(tweet, now, { ...X_LIMITS, hours });
    if ("dropped" in verdict) {
      dropped[verdict.dropped] = (dropped[verdict.dropped] ?? 0) + 1;
      continue;
    }
    const repeat = `${verdict.lead.handle}:${sameText(verdict.lead.text)}`;
    if (byPost.has(verdict.lead.id) || seenText.has(repeat)) continue;
    seenText.add(repeat);
    byPost.set(verdict.lead.id, verdict.lead);
  }
  // Someone passing on three or more openings in one window runs a job feed, not a team.
  const shares = new Map<string, number>();
  for (const lead of byPost.values()) if (lead.poster === "shared") shares.set(lead.handle, (shares.get(lead.handle) ?? 0) + 1);
  const kept: Lead[] = [];
  const perHandle = new Set<string>();
  for (const lead of rankLeads([...byPost.values()])) {
    if (lead.poster === "shared" && (shares.get(lead.handle) ?? 0) >= 3) {
      dropped["job-sharing account"] = (dropped["job-sharing account"] ?? 0) + 1;
    } else if (perHandle.has(lead.handle)) {
      // One lead per poster: their best post stands for the rest.
      dropped["another post by the same poster"] = (dropped["another post by the same poster"] ?? 0) + 1;
    } else {
      perHandle.add(lead.handle);
      kept.push(lead);
    }
  }
  return { leads: kept, dropped };
}

export async function runXLeads(providers: XProviders, store: XLeadStore, options: XOptions = {}): Promise<XResult> {
  const now = options.now ?? new Date();
  const hours = options.hours ?? X_LIMITS.hours;
  const queries = options.queries ?? buildQueries(new Date(now.getTime() - hours * 3_600_000));
  const tweets = new Map<string, Tweet>();
  const failures: string[] = [];
  let requests = 0;
  for (const query of queries) {
    let cursor = "";
    for (let page = 0; page < (options.pages ?? X_LIMITS.pagesPerQuery); page++) {
      try {
        requests++;
        const result = await providers.search(query, cursor);
        for (const tweet of result.tweets) if (tweet.id && !tweets.has(tweet.id)) tweets.set(tweet.id, tweet);
        if (!result.nextCursor || !result.tweets.length) break;
        cursor = result.nextCursor;
      } catch (error) {
        // One failing query should not lose the others.
        failures.push(`${query.slice(0, 60)}: ${(error as Error).message.slice(0, 100)}`);
        break;
      }
    }
  }
  const { leads, dropped } = leadsFromTweets([...tweets.values()], now, hours);
  return { raw: [...tweets.values()], leads, fresh: leads.filter((lead) => store.record(lead, now)), tweets: tweets.size, requests, dropped, failures };
}

export function formatLead(lead: Lead, index: number) {
  const who = lead.poster === "founder" ? "founder" : lead.poster === "team" ? "team" : "shared by someone else";
  const apply = [...lead.emails, lead.dmOpen ? "DM" : "", ...lead.links].filter(Boolean).join(" | ") || "reply or DM (no method stated)";
  return [
    `${index + 1}. ${lead.role ?? "role not stated"}${lead.company ? ` at ${lead.company}` : ""}  [${who}]`,
    `   @${lead.handle} (${lead.name}; ${lead.followers} followers${lead.location ? `; ${lead.location}` : ""}) — ${lead.bio.slice(0, 110) || "no bio"}`,
    `   ${Math.round(lead.hoursOld)}h old; ${lead.likes} likes${lead.views === null ? "" : `; ${lead.views} views`}`,
    `   "${lead.text.slice(0, 220)}${lead.text.length > 220 ? "…" : ""}"`,
    `   Apply: ${apply}`,
    `   ${lead.url}`,
  ].join("\n");
}
