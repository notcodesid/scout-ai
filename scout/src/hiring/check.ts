import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { companyKey } from "../radar/contracts.ts";
import {
  HIRING_LIMITS, boardURL, careersLink, classifyCareerResults, extractRoles, findBoardLink, findBoardLinks, isFresh, parseBoard,
  judgePost, postId, rankWebsite, siteHost, siteOrigin,
  type Board, type HiringCheck, type Page, type Post, type Target,
} from "./contracts.ts";

export type { Target } from "./contracts.ts";

export interface HiringProviders {
  /** Company-focused search, used to find the company's own website. */
  companies(query: string): Promise<Page[]>;
  /** Open web search for careers pages and job listings, with each page's outgoing links. */
  web(query: string): Promise<Page[]>;
  /** Social posts (LinkedIn, X) published on or after `since`. */
  posts(query: string, since: Date): Promise<Page[]>;
  /** Text and outgoing links of specific pages (the careers page or the home page). */
  contents(urls: string[]): Promise<Page[]>;
  /** Public JSON GET. Resolves null when the resource does not exist. */
  json(url: string): Promise<unknown | null>;
}

export type CheckOptions = {
  /** How far back a hiring post may be and still be kept for context. */
  days?: number;
  /** A post this recent is `fresh`: the ones worth answering today. */
  freshDays?: number;
  now?: Date;
  /** Read the careers page (or home page) for board links and role titles. One or two extra page reads. */
  readPages?: boolean;
};

const POST_DEFAULTS = { byFounder: false, fresh: false, role: null, primary: true, reactions: null, comments: null, under100Likes: null, corroboratedBy: null };
/** Checks saved before a field existed read back with that field empty. */
const hydrate = (check: HiringCheck): HiringCheck => ({
  ...check, boards: check.boards ?? [], dropped: check.dropped ?? [], roles: check.roles ?? [], freshDays: check.freshDays ?? 2,
  posts: (check.posts ?? []).map((post) => ({ ...POST_DEFAULTS, ...post })),
});

/** Remembers the latest hiring check per company. HIRING_DB overrides the file. */
export class HiringStore {
  private db: Database;

  constructor(path = process.env.HIRING_DB?.trim() || ".data/radar.db") {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.exec("CREATE TABLE IF NOT EXISTS hiring(key TEXT PRIMARY KEY,data TEXT NOT NULL,checked TEXT NOT NULL)");
  }

  save(check: HiringCheck) {
    this.db.prepare("INSERT INTO hiring VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,checked=excluded.checked")
      .run(check.key, JSON.stringify(check), check.checkedAt);
  }

  get(key: string) {
    const row = this.db.prepare("SELECT data FROM hiring WHERE key=?").get(key) as { data: string } | null;
    return row ? hydrate(JSON.parse(row.data) as HiringCheck) : null;
  }

  all() {
    return (this.db.prepare("SELECT data FROM hiring ORDER BY checked DESC").all() as { data: string }[]).map((row) => hydrate(JSON.parse(row.data) as HiringCheck));
  }

  close() {
    this.db.close();
  }
}

const founderRank = (post: Post) => (post.byFounder ? 2 : post.founderLikely ? 1 : 0);

/** Fresh founder posts first, then fresh, then founder, then posts whose point is hiring, then newest. */
export const comparePosts = (a: Post, b: Post) =>
  Number(b.fresh) - Number(a.fresh) || founderRank(b) - founderRank(a) || Number(b.primary ?? true) - Number(a.primary ?? true)
  || (b.publishedDate ?? "").localeCompare(a.publishedDate ?? "");

/** Re-dates `fresh` against the present, for checks read back from the store. */
export const refresh = (check: HiringCheck, now = new Date(), freshDays = check.freshDays ?? 2): HiringCheck => ({
  ...check, freshDays,
  posts: check.posts.map((post) => ({ ...post, fresh: isFresh(post.publishedDate, now, freshDays) })).sort(comparePosts),
});

/**
 * Evidence that a company is hiring. A fresh post outweighs everything else, most of all from a
 * founder and while it still has few reactions; older posts, open roles and job pages add context.
 */
export const hiringScore = (check: HiringCheck) =>
  check.posts.reduce((sum, post) => sum + 2 + founderRank(post)
    + (post.fresh ? 10 + founderRank(post) * 5 + (post.under100Likes ? 3 : 0) : 0), 0)
  + (check.board?.total ?? 0) + check.listings.length + (check.boards?.length ?? 0) + Math.min(check.roles?.length ?? 0, 5) + (check.careersUrl ? 1 : 0);

export async function checkHiring(target: Target, providers: HiringProviders, options: CheckOptions = {}): Promise<HiringCheck> {
  const now = options.now ?? new Date();
  const freshDays = options.freshDays ?? 2;
  const since = new Date(now.getTime() - (options.days ?? 30) * 86_400_000);
  const check: HiringCheck = {
    key: companyKey(target.company), company: target.company, website: siteOrigin(target.website), careersUrl: null,
    board: null, boards: [], roles: [], posts: [], listings: [], dropped: [], failures: [], freshDays, checkedAt: now.toISOString(),
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

  // The radar's website is used as is. Otherwise: a company search, then a plain web search unless the first is a sure match.
  if (!check.website) {
    const hint = [target.whatItDoes, target.city, "India"].filter(Boolean).join(" ").slice(0, 200);
    const first = (await attempt("website", () => providers.companies(`${target.company} ${hint}`)))?.slice(0, HIRING_LIMITS.siteResults) ?? [];
    let best = rankWebsite(target, first);
    if (!best || best.score < 3) {
      const second = (await attempt("website search", () => providers.web(`${target.company} official website`))) ?? [];
      const other = rankWebsite(target, [...second, ...first]);
      if (other && (!best || other.score > best.score)) best = other;
    }
    check.website = best?.url ?? null;
  }
  const known: Target = { ...target, website: check.website };

  const careers = (await attempt("careers", () => providers.web(`${target.company} careers jobs open roles`))) ?? [];
  Object.assign(check, classifyCareerResults(target.company, check.website, careers));

  // The company's own careers page (else its home page): board links, a careers link, visible role titles.
  const own: Page[] = [];
  if (options.readPages !== false && check.website) {
    const read = async (url: string) => (await attempt("page", () => providers.contents([url])))?.[0] ?? null;
    let page = await read(check.careersUrl ?? check.website);
    if (page && !check.careersUrl) {
      own.push({ ...page, url: check.website });
      check.careersUrl = careersLink(check.website, page.links);
      page = check.careersUrl ? await read(check.careersUrl) : null;
    }
    if (page && check.careersUrl) {
      own.push({ ...page, url: check.careersUrl });
      check.roles = extractRoles(page.text);
    }
  }
  check.boards = findBoardLinks(target.company, [...own, ...careers], siteHost(check.website));

  // 1. A board the company links to. 2. Otherwise the company's own domain label as the slug.
  const linked = findBoardLink([...own, ...careers].flatMap((page) => [page.url, ...page.links]));
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
    const post = judgePost(known, page, since, { now, freshDays });
    if (typeof post !== "string") {
      if (!posts.has(postId(post.url))) posts.set(postId(post.url), post);
    } else if (social.includes(page) && check.dropped.length < HIRING_LIMITS.postResults) {
      check.dropped.push({ url: page.url, title: page.title.replace(/\s+/g, " ").slice(0, 160), reason: post });
    }
  }
  check.posts = [...posts.values()].sort(comparePosts).slice(0, HIRING_LIMITS.postsKept);
  return check;
}
