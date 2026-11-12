import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { companyKey } from "../radar/contracts.ts";
import {
  HIRING_LIMITS, boardURL, classifyCareerResults, findBoardLink, parseBoard, pickWebsite, postId, toPost,
  type Board, type HiringCheck, type Page, type Post,
} from "./contracts.ts";

export interface HiringProviders {
  /** Company-focused search, used to find the company's own website. */
  companies(query: string): Promise<Page[]>;
  /** Open web search for careers pages and job listings, with each page's outgoing links. */
  web(query: string): Promise<Page[]>;
  /** Social posts (LinkedIn, X) published on or after `since`. */
  posts(query: string, since: Date): Promise<Page[]>;
  /** Public JSON GET. Resolves null when the resource does not exist. */
  json(url: string): Promise<unknown | null>;
}

export type Target = { company: string; whatItDoes?: string | null; city?: string | null; website?: string | null };
export type CheckOptions = { days?: number; now?: Date };

/** Remembers the latest hiring check per company. */
export class HiringStore {
  private db: Database;

  constructor(path = ".data/radar.db") {
    if (path !== ":memory:") mkdirSync(".data", { recursive: true });
    this.db = new Database(path);
    this.db.exec("CREATE TABLE IF NOT EXISTS hiring(key TEXT PRIMARY KEY,data TEXT NOT NULL,checked TEXT NOT NULL)");
  }

  save(check: HiringCheck) {
    this.db.prepare("INSERT INTO hiring VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,checked=excluded.checked")
      .run(check.key, JSON.stringify(check), check.checkedAt);
  }

  get(key: string) {
    const row = this.db.prepare("SELECT data FROM hiring WHERE key=?").get(key) as { data: string } | null;
    return row ? (JSON.parse(row.data) as HiringCheck) : null;
  }

  all() {
    return (this.db.prepare("SELECT data FROM hiring ORDER BY checked DESC").all() as { data: string }[]).map((row) => JSON.parse(row.data) as HiringCheck);
  }

  close() {
    this.db.close();
  }
}

/** Evidence that a company is hiring: more recent posts and open roles rank higher. */
export const hiringScore = (check: HiringCheck) =>
  check.posts.length * 2 + check.posts.filter((p) => p.founderLikely).length + (check.board?.total ?? 0) + check.listings.length + (check.careersUrl ? 1 : 0);

export async function checkHiring(target: Target, providers: HiringProviders, options: CheckOptions = {}): Promise<HiringCheck> {
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - (options.days ?? 30) * 86_400_000);
  const check: HiringCheck = {
    key: companyKey(target.company), company: target.company, website: target.website ?? null, careersUrl: null,
    board: null, posts: [], listings: [], failures: [], checkedAt: now.toISOString(),
  };
  // Each lookup is independent: one failing source should not lose the others.
  const attempt = async <T>(label: string, work: () => Promise<T>): Promise<T | null> => {
    try {
      return await work();
    } catch (error) {
      check.failures.push(`${label}: ${(error as Error).message.slice(0, 120)}`);
      return null;
    }
  };

  if (!check.website) {
    const hint = [target.whatItDoes, target.city, "India"].filter(Boolean).join(" ").slice(0, 200);
    const results = await attempt("website", () => providers.companies(`${target.company} ${hint}`));
    check.website = results ? pickWebsite(target.company, results.slice(0, HIRING_LIMITS.siteResults)) : null;
  }

  const careers = (await attempt("careers", () => providers.web(`${target.company} careers jobs open roles`))) ?? [];
  Object.assign(check, classifyCareerResults(target.company, check.website, careers));

  // 1. A board the company links to. 2. Otherwise the company's own domain label as the slug.
  const linked = findBoardLink(careers.flatMap((page) => [page.url, ...page.links]));
  const label = check.website ? new URL(check.website).hostname.replace(/^www\./, "").split(".")[0]! : "";
  const candidates = linked
    ? [{ ...linked, guessed: false }]
    : label.length >= 4 ? (["greenhouse", "lever", "ashby"] as const).map((provider) => ({ provider, slug: label, guessed: true })) : [];
  for (const candidate of candidates) {
    const payload = await attempt(`board ${candidate.provider}`, () => providers.json(boardURL(candidate.provider, candidate.slug)));
    const jobs = payload === null ? null : parseBoard(candidate.provider, payload);
    // A guessed slug with no roles proves nothing; a linked board is real even when empty.
    if (!jobs || (candidate.guessed && !jobs.length)) continue;
    jobs.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
    check.board = { ...candidate, total: jobs.length, jobs: jobs.slice(0, HIRING_LIMITS.jobsKept) } satisfies Board;
    break;
  }

  const social = (await attempt("posts", () => providers.posts(`${target.company} we're hiring`, since))) ?? [];
  const posts = new Map<string, Post>();
  for (const page of [...social, ...careers]) {
    const post = toPost(target.company, page, since);
    if (post && !posts.has(postId(post.url))) posts.set(postId(post.url), post);
  }
  check.posts = [...posts.values()]
    .sort((a, b) => (b.publishedDate ?? "").localeCompare(a.publishedDate ?? ""))
    .slice(0, HIRING_LIMITS.postsKept);
  return check;
}
