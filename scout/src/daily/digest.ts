// The daily digest: funded companies joined with their hiring evidence and the
// one address to write to, ordered by how actionable they are today. Pure
// functions: everything here works from stored rows and prints text. Nothing is
// sent to anyone; the reader writes their own email.
import { hiringScore, refresh } from "../hiring/check.ts";
import type { ContactCheck } from "../hiring/contacts.ts";
import type { HiringCheck, Post } from "../hiring/contracts.ts";
import type { FundedCompany } from "../radar/contracts.ts";
import { describeFit, scoreFit, type Fit, type FitScore } from "./fit.ts";

/** 1: fresh post by a founder. 2: another fresh post. 3: older hiring evidence. 4: funded, nothing found. */
export type Tier = 1 | 2 | 3 | 4;

export type DigestEntry = {
  company: FundedCompany;
  /** Latest hiring check, with `fresh` re-dated against the digest's `now`. null: never checked. */
  check: HiringCheck | null;
  contact: ContactCheck | null;
  tier: Tier;
  /** The post that puts the company in its tier (the freshest founder post there is). */
  post: Post | null;
  hiringScore: number;
  fit: FitScore;
};

export type Digest = {
  generatedAt: string;
  freshDays: number;
  fit: Fit;
  /** Companies the filter keeps, most actionable first. */
  entries: DigestEntry[];
  /** Companies the filter left out, with the reason. Counted and named in every rendering. */
  leftOut: { company: string; reason: "sector" | "role" }[];
  /** What the run did (stage results), shown under the header. Empty when read back from the stores. */
  notes: string[];
};

export type DigestInput = {
  companies: FundedCompany[];
  checks: HiringCheck[];
  contacts: ContactCheck[];
  fit: Fit;
  now?: Date;
  freshDays?: number;
  notes?: string[];
};

const founderPost = (post: Post) => post.byFounder || post.founderLikely;

export function buildDigest(input: DigestInput): Digest {
  const now = input.now ?? new Date();
  const freshDays = input.freshDays ?? 2;
  const checks = new Map(input.checks.map((check) => [check.key, check]));
  const contacts = new Map(input.contacts.map((contact) => [contact.key, contact]));
  const entries: DigestEntry[] = [];
  const leftOut: Digest["leftOut"] = [];
  for (const company of input.companies) {
    const stored = checks.get(company.key);
    // Freshness is judged against today, not against the day the check ran.
    const check = stored ? refresh(stored, now, freshDays) : null;
    const fit = scoreFit(input.fit, company, check);
    if (fit.leftOut) {
      leftOut.push({ company: company.company, reason: fit.leftOut });
      continue;
    }
    const fresh = check?.posts.filter((post) => post.fresh) ?? [];
    const score = check ? hiringScore(check) : 0;
    const tier: Tier = fresh.some(founderPost) ? 1 : fresh.length ? 2 : score > 0 ? 3 : 4;
    const post = fresh.find(founderPost) ?? fresh[0] ?? check?.posts[0] ?? null;
    entries.push({ company, check, contact: contacts.get(company.key) ?? null, tier, post, hiringScore: score, fit });
  }
  // Within a tier: best fit, then a post still under 100 likes, then the weight of evidence.
  const quiet = (entry: DigestEntry) => Number(entry.post?.fresh === true && entry.post.under100Likes === true);
  entries.sort((a, b) => a.tier - b.tier || b.fit.score - a.fit.score || quiet(b) - quiet(a) || b.hiringScore - a.hiringScore
    || a.company.company.localeCompare(b.company.company));
  return { generatedAt: now.toISOString(), freshDays, fit: input.fit, entries, leftOut, notes: input.notes ?? [] };
}

/** Page text is untrusted: it is shown as one clipped line of plain text, nothing more. */
const clean = (text: string | null | undefined, max = 120) => {
  const line = (text ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
};
const day = (iso: string | null | undefined) => iso?.slice(0, 10) ?? "date unknown";
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const stageLine = (c: FundedCompany) =>
  [c.stage === "unknown" ? "stage not stated" : c.stage, c.amount ? clean(c.amount, 40) : "amount not stated", c.sector, c.city ? clean(c.city, 30) : ""].filter(Boolean).join(", ");

const likes = (post: Post) =>
  post.under100Likes === null || post.reactions === null ? "likes unknown" : `${plural(post.reactions, "reaction")} (${post.under100Likes ? "under 100 likes" : "100+ likes"})`;

const poster = (post: Post) =>
  `${clean(post.author, 50) || "poster not named"}${post.byFounder ? " (founder)" : post.founderLikely ? " (founder/exec, from their headline)" : ""}`;

/** Why the company is in the digest: its best post, or the other evidence when there is no post. */
function why(entry: DigestEntry): string[] {
  const { check, post } = entry;
  if (!check) return [];
  if (post) {
    const more = check.posts.length - 1;
    return [
      `${post.fresh ? "FRESH post" : "Post"} ${day(post.publishedDate)} by ${poster(post)}: ${post.role ? `hiring ${clean(post.role, 70)}` : "role not stated"}`
        + `${post.primary ? "" : ", hiring mentioned in passing"}; ${likes(post)}${more > 0 ? `; +${plural(more, "more post")}` : ""}`,
      post.url,
    ];
  }
  const lines: string[] = [];
  if (check.board) lines.push(`${plural(check.board.total, "open role")} on ${check.board.provider}: ${check.board.jobs[0]?.url ?? ""}`.trim());
  if (check.roles.length) lines.push(`Careers page lists ${clean(check.roles.slice(0, 4).join("; "), 110)}: ${check.careersUrl ?? ""}`.trim());
  else if (check.careersUrl) lines.push(`Careers page (no role titles read): ${check.careersUrl}`);
  for (const link of check.boards.slice(0, 1)) lines.push(`Job board page (${link.provider}): ${link.url}`);
  if (!lines.length && check.listings[0]) lines.push(`Third-party listing: ${clean(check.listings[0].title, 60)} ${check.listings[0].url}`);
  return lines.slice(0, 2);
}

const matching = (entry: DigestEntry) =>
  entry.fit.matchedRoles.slice(0, 3).map((m) => `${clean(m.title, 60)} ("${m.keyword}", ${m.where}${m.url ? ` ${m.url}` : ""})`).join("; ");

/** The address to write to, its reason and source, and who published it. Guesses only when asked for. */
function contactLines(entry: DigestEntry, guesses: boolean): string[] {
  const contact = entry.contact;
  // A row saved before recommendations existed says nothing either way.
  if (!contact || contact.recommended === undefined) return ["Write to: not looked up yet"];
  const rec = contact.recommended ?? null;
  const lines: string[] = [];
  if (rec && (rec.tier !== "verified-guess" || guesses)) {
    const origin = rec.tier === "verified-guess" ? "a guess, never seen published" : rec.thirdParty ? "seen on a third-party page, not published by the company" : "published by the company";
    lines.push(`Write to: ${rec.email} (${origin})`, `  why: ${clean(rec.reason, 200)}${rec.sourceUrl ? ` Source: ${rec.sourceUrl}` : ""}`);
  } else {
    const person = contact.people.find((p) => p.postUrl) ?? contact.people[0];
    lines.push(`Write to: no published address found${person ? `; ${person.postUrl ? "poster" : "founder"} ${clean(person.name, 50)}${person.profileUrl ? ` ${person.profileUrl}` : ""}` : ""}`);
  }
  if (guesses) {
    for (const guess of (contact.guesses ?? []).slice(0, 2)) {
      lines.push(`  ${guess.verification?.status === "valid" ? "GUESS (verifier: deliverable)" : "UNVERIFIED guess"} for ${clean(guess.person, 50)}: ${guess.email}`);
    }
  }
  return lines;
}

const TIER_TITLES: Record<Exclude<Tier, 4>, string> = {
  1: "FRESH FOUNDER POSTS", 2: "OTHER FRESH POSTS", 3: "OLDER HIRING EVIDENCE",
};

const counts = (digest: Digest) => {
  const of = (tier: Tier) => digest.entries.filter((entry) => entry.tier === tier).length;
  return { founder: of(1), fresh: of(2), older: of(3), none: of(4) };
};

const leftOutLine = (digest: Digest) => {
  if (!digest.leftOut.length) return "";
  const names = (reason: "sector" | "role") => digest.leftOut.filter((l) => l.reason === reason).map((l) => clean(l.company, 40));
  const part = (reason: "sector" | "role", label: string) => (names(reason).length ? `${label}: ${names(reason).join(", ")}` : "");
  return `Left out by your filter (${digest.leftOut.length}): ${[part("sector", "other sectors"), part("role", "no matching role")].filter(Boolean).join("; ")}`;
};

/** The whole digest as plain text: a few lines per company, every claim next to its URL. */
export function formatDigest(digest: Digest, options: { guesses?: boolean } = {}): string {
  const n = counts(digest);
  const total = digest.entries.length + digest.leftOut.length;
  const lines = [
    `Scout daily digest, ${day(digest.generatedAt)}`,
    `Fit: ${describeFit(digest.fit)}`,
    `${plural(total, "funded company", "funded companies")} on the radar: ${plural(n.founder, "fresh founder post")}, ${n.fresh} other fresh, `
      + `${n.older} with older hiring evidence, ${n.none} with none. ${digest.leftOut.length} left out by the filter.`,
    `Fresh means posted within ${plural(digest.freshDays, "day")}. Nothing here was sent to anyone.`,
    ...digest.notes.map((note) => `- ${note}`),
  ];
  let index = 0;
  for (const tier of [1, 2, 3] as const) {
    const entries = digest.entries.filter((entry) => entry.tier === tier);
    lines.push("", `== ${TIER_TITLES[tier]} (${entries.length}) ==`);
    for (const entry of entries) {
      const c = entry.company;
      lines.push("", `${++index}. ${clean(c.company, 60)} | ${stageLine(c)}${entry.fit.score ? ` | fit ${entry.fit.score}` : ""}`);
      if (c.whatItDoes) lines.push(`   ${clean(c.whatItDoes, 110)}`);
      lines.push(`   Funding news: ${c.sourceUrl}`);
      lines.push(...why(entry).map((line, i) => (i === 0 ? `   Why: ${line}` : `        ${line}`)));
      if (entry.fit.matchedRoles.length) lines.push(`   Matching roles: ${matching(entry)}`);
      else if (digest.fit.roles.length) lines.push(`   Matching roles: none stated (no role titles found to compare)`);
      lines.push(...contactLines(entry, options.guesses === true).map((line) => `   ${line}`));
    }
  }
  const quiet = digest.entries.filter((entry) => entry.tier === 4);
  const checked = quiet.filter((entry) => entry.check).map((entry) => clean(entry.company.company, 40));
  const unchecked = quiet.filter((entry) => !entry.check).map((entry) => clean(entry.company.company, 40));
  lines.push("", `== FUNDED, NO HIRING EVIDENCE (${quiet.length}) ==`);
  if (checked.length) lines.push(`Checked, nothing found: ${checked.join(", ")}`);
  if (unchecked.length) lines.push(`Not checked yet: ${unchecked.join(", ")}`);
  const left = leftOutLine(digest);
  if (left) lines.push("", left);
  if (!options.guesses) lines.push("", "Guessed addresses are off (add --guesses to see them, unverified).");
  return lines.join("\n");
}

/** iMessage sizes: a text that reads in one screen, and few enough texts to not flood the thread. */
export const MESSAGE_LIMITS = { characters: 700, companies: 5 };

const shortDay = (iso: string | null | undefined) => {
  const date = new Date(iso ?? "");
  return Number.isNaN(date.getTime()) ? "date unknown" : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
};

/** Keeps whole lines up to the limit, so a URL is never cut in half. */
const fitLines = (lines: string[], max: number) => {
  const kept: string[] = [];
  for (const line of lines) {
    if ([...kept, line].join("\n").length > max) break;
    kept.push(line);
  }
  return kept.join("\n");
};

/**
 * The digest as a short run of plain-text messages: one summary, one per
 * company for the most actionable few, one closing line. No Markdown, no
 * tables, no guessed addresses.
 */
export function formatDigestMessages(digest: Digest, limits: Partial<typeof MESSAGE_LIMITS> = {}): string[] {
  const { characters, companies } = { ...MESSAGE_LIMITS, ...limits };
  const n = counts(digest);
  const active = digest.entries.filter((entry) => entry.tier < 4);
  const total = digest.entries.length + digest.leftOut.length;
  if (!total) return ["Nothing on the radar yet. The daily run has not stored any funded companies."];
  const messages = [fitLines([
    `Scout, ${shortDay(digest.generatedAt)}: ${plural(total, "funded startup")} on the radar.`,
    `${plural(n.founder, "fresh founder post")}, ${n.fresh} other fresh, ${n.older} older hiring signs, ${n.none} with none.`,
    digest.fit.source === "none" ? "" : `Fit: ${describeFit(digest.fit)}.`,
    digest.leftOut.length ? `${digest.leftOut.length} left out by your filter.` : "",
  ].filter(Boolean), characters)];
  for (const entry of active.slice(0, companies)) {
    const { company: c, post, contact } = entry;
    const rec = contact?.recommended && contact.recommended.tier !== "verified-guess" ? contact.recommended : null;
    const evidence = why(entry);
    messages.push(fitLines([
      `${clean(c.company, 50)} (${[c.stage === "unknown" ? "" : c.stage, c.amount ? clean(c.amount, 30) : ""].filter(Boolean).join(", ") || "early round"})`,
      c.whatItDoes ? clean(c.whatItDoes, 90) : "",
      post
        ? `${post.fresh ? "Fresh: " : ""}${poster(post)} posted ${shortDay(post.publishedDate)}${post.role ? `, hiring ${clean(post.role, 50)}` : ""}; ${likes(post)}.`
        : clean(evidence[0]?.replace(/https?:\/\/\S+/g, "").replace(/:\s*$/, ""), 120),
      post?.url ?? evidence[0]?.match(/https?:\/\/\S+/)?.[0] ?? "",
      entry.fit.matchedRoles.length ? `Matches you: ${entry.fit.matchedRoles.slice(0, 2).map((m) => clean(m.title, 40)).join(", ")}` : "",
      rec ? `Write to ${rec.email} (${rec.thirdParty ? "third-party page, not the company's" : "published by the company"})`
        : contact && contact.recommended !== undefined ? "No published address found." : "Address not looked up yet.",
      rec?.sourceUrl ?? "",
    ].filter(Boolean), characters));
  }
  const rest = active.slice(companies).map((entry) => clean(entry.company.company, 30));
  const quiet = digest.entries.filter((entry) => entry.tier === 4).map((entry) => clean(entry.company.company, 30));
  const closing = fitLines([
    rest.length ? `Also hiring signs: ${clean(rest.join(", "), 200)}` : "",
    quiet.length ? `Funded, no hiring signs: ${clean(quiet.join(", "), 220)}` : "",
    digest.leftOut.length ? clean(leftOutLine(digest), 200) : "",
    "I only collect and show. You write the email.",
  ].filter(Boolean), characters);
  messages.push(closing);
  return messages;
}
