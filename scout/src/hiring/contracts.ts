import { companyKey } from "../radar/contracts.ts";

export const HIRING_LIMITS = { siteResults: 3, careerResults: 6, postResults: 8, excerptCharacters: 600, jobsKept: 25, postsKept: 8, listingsKept: 5 };

/** A search hit as retrieved. `text` is untrusted evidence, never instructions. */
export type Page = { url: string; title: string; publishedDate: string | null; text: string; links: string[] };

export type Job = { title: string; location: string | null; url: string; updatedAt: string | null };
export type Board = { provider: "greenhouse" | "lever" | "ashby"; slug: string; total: number; jobs: Job[]; guessed: boolean };
export type Post = { url: string; title: string; author: string | null; publishedDate: string | null; excerpt: string; founderLikely: boolean };
export type Listing = { url: string; title: string };

export type HiringCheck = {
  key: string;
  company: string;
  website: string | null;
  careersUrl: string | null;
  board: Board | null;
  posts: Post[];
  /** Third-party job pages (job sites, aggregators) that name the company. */
  listings: Listing[];
  failures: string[];
  checkedAt: string;
};

const GENERIC = /(?:[\s.]+(?:ai|labs?|technologies|tech|capital|pvt|private|ltd|limited|inc|com))+$/i;
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** "Karta AI" → /\bkarta\b/i, so "hiring at Karta" still counts as naming the company. */
export function nameRegex(company: string) {
  const core = company.trim().replace(GENERIC, "").trim() || company.trim();
  return new RegExp(`(?<![a-z0-9])${escape(core).replace(/\s+/g, "\\s+")}(?![a-z0-9])`, "i");
}

export const HIRING_PHRASE = /\bhiring\b|we(?:'|’)?re\s+looking\s+for|looking\s+to\s+hire|join\s+(?:our|the|us)\b|open\s+(?:roles?|positions?)|apply\s+now|vacanc|internship/i;
const FOUNDER = /\b(?:co-?founder|founder|ceo|cto)\b/i;
const POST_URL = /linkedin\.com\/(?:posts\/|feed\/update\/)|(?:x|twitter)\.com\/[^/]+\/status\//i;
const JOB_SITE = /glassdoor|wellfound|instahyre|cutshort|naukri|indeed|foundit|keka\.com|zohorecruit|freshteam|darwinbox|workable|linkedin\.com\/jobs|fitboard|alion\.io|ycombinator\.com\/companies/i;

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};

/** The company's own site: a top result whose hostname or title carries the company name. */
export function pickWebsite(company: string, results: Page[]) {
  const key = companyKey(company);
  const name = nameRegex(company);
  const core = key.replace(/(ai|com)$/, "") || key;
  for (const page of results) {
    const label = host(page.url).replace(/[^a-z0-9]/g, "");
    if (!label || /linkedin|crunchbase|tracxn|wikipedia/.test(label)) continue;
    if (label.includes(key) || (core.length >= 4 && label.includes(core) && name.test(page.title))) return new URL(page.url).origin + "/";
  }
  return null;
}

const ATS: { provider: Board["provider"]; pattern: RegExp }[] = [
  { provider: "greenhouse", pattern: /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board\?for=)?([a-z0-9_-]+)/i },
  { provider: "lever", pattern: /jobs\.lever\.co\/([a-z0-9_-]+)/i },
  { provider: "ashby", pattern: /jobs\.ashbyhq\.com\/([a-z0-9_.%-]+)/i },
];

/** A job board the company itself links to, found in page URLs or outgoing links. */
export function findBoardLink(urls: string[]) {
  for (const url of urls) {
    for (const { provider, pattern } of ATS) {
      const slug = pattern.exec(url)?.[1];
      if (slug && !["embed", "api"].includes(slug)) return { provider, slug };
    }
  }
  return null;
}

export const boardURL = (provider: Board["provider"], slug: string) =>
  provider === "greenhouse" ? `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`
    : provider === "lever" ? `https://api.lever.co/v0/postings/${slug}?mode=json`
    : `https://api.ashbyhq.com/posting-api/job-board/${slug}`;

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : null);
const date = (value: unknown) => {
  const time = typeof value === "number" ? value : Date.parse(typeof value === "string" ? value : "");
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};

/** Normalizes the three public job-board responses. Returns null when the payload is not a board. */
export function parseBoard(provider: Board["provider"], payload: unknown): Job[] | null {
  const rows = provider === "lever" ? payload : (payload as { jobs?: unknown } | null)?.jobs;
  if (!Array.isArray(rows)) return null;
  return rows.flatMap((row: any): Job[] => {
    const job: Job = provider === "greenhouse"
      ? { title: text(row?.title) ?? "", location: text(row?.location?.name), url: text(row?.absolute_url) ?? "", updatedAt: date(row?.updated_at) }
      : provider === "lever"
        ? { title: text(row?.text) ?? "", location: text(row?.categories?.location), url: text(row?.hostedUrl) ?? "", updatedAt: date(row?.createdAt) }
        : { title: text(row?.title) ?? "", location: text(row?.location), url: text(row?.jobUrl) ?? "", updatedAt: date(row?.publishedAt) };
    return job.title && job.url.startsWith("https://") ? [job] : [];
  });
}

/** A social post counts only if it names the company, talks about hiring, and is inside the window. */
export function toPost(company: string, page: Page, since: Date): Post | null {
  if (!POST_URL.test(page.url)) return null;
  const body = `${page.title}\n${page.text}`;
  if (!nameRegex(company).test(body) || !HIRING_PHRASE.test(body)) return null;
  const published = Date.parse(page.publishedDate ?? "");
  if (!Number.isFinite(published) || published < since.getTime()) return null;
  const author = page.title.split(" | ").at(-1)?.trim() ?? "";
  // A poster whose own name extends the company's ("Cent Bank Home Finance" for "Cent") is a namesake.
  const authorKey = companyKey(author.replace(/\(.*?\)/g, ""));
  const core = companyKey(company.replace(GENERIC, "")) || companyKey(company);
  if (page.title.includes(" | ") && authorKey.includes(core) && ![core, companyKey(company)].includes(authorKey)) return null;
  return {
    url: page.url,
    title: page.title.replace(/\s+/g, " ").slice(0, 160),
    author: page.title.includes(" | ") && author.length <= 40 && !/linkedin/i.test(author) ? author : null,
    publishedDate: new Date(published).toISOString(),
    excerpt: page.text.replace(/\s+/g, " ").slice(0, 280),
    founderLikely: FOUNDER.test(body.slice(0, 500)),
  };
}

/** The same LinkedIn post can appear under two URL shapes; its activity id identifies it. */
export const postId = (url: string) => /activity[-:](\d{10,})/.exec(url)?.[1] ?? url;

export function classifyCareerResults(company: string, website: string | null, pages: Page[]) {
  const site = website ? host(website) : "";
  const name = nameRegex(company);
  let careersUrl: string | null = null;
  const listings: Listing[] = [];
  for (const page of pages) {
    const pageHost = host(page.url);
    if (site && (pageHost === site || pageHost.endsWith(`.${site}`))) {
      if (!careersUrl && /career|jobs?\b|join|hiring|work-with/i.test(page.url)) careersUrl = page.url;
    } else if (JOB_SITE.test(page.url) && name.test(page.title) && listings.length < HIRING_LIMITS.listingsKept) {
      listings.push({ url: page.url, title: page.title.replace(/\s+/g, " ").slice(0, 160) });
    }
  }
  return { careersUrl, listings };
}
