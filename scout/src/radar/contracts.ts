import { z } from "zod";
import { comparableQuote } from "../research/contracts.ts";

export const STAGES = ["pre-seed", "seed", "pre-series-a", "series-a", "series-b", "later", "unknown"] as const;
export type Stage = (typeof STAGES)[number];

/** Early rounds: founders still hire directly, so these are the ones worth approaching. */
export const EARLY_STAGES: Stage[] = ["pre-seed", "seed", "pre-series-a", "series-a"];

const fromEnv = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

/** Sector labels the model picks from; anything else becomes "other". */
export const SECTORS = [
  "software-ai", "fintech", "deeptech-hardware", "healthcare-biotech", "consumer-brand", "gaming-media", "climate-energy", "other",
] as const;
export type Sector = (typeof SECTORS)[number];

/** An unknown-stage round is kept only when its stated amount is at most this many million USD. */
export const UNKNOWN_STAGE_MAX_USD_MN = 15;
/** Rough conversion: 1 crore rupees is about $0.12M. */
export const USD_MN_PER_CRORE = 0.12;

/**
 * Defaults cover a normal fortnight of Indian funding news (about 30 distinct
 * stories). Lower them with the env overrides on a tight free model tier.
 */
export const RADAR_LIMITS = {
  resultsPerQuery: 10,
  maxArticles: fromEnv("RADAR_MAX_ARTICLES", 30),
  /** Characters kept from a single-story article. */
  articleCharacters: fromEnv("RADAR_ARTICLE_CHARS", 5000),
  /** Characters kept from a weekly roundup, which lists many rounds. */
  roundupCharacters: fromEnv("RADAR_ROUNDUP_CHARS", 12000),
  /** Single-story articles per model call. A roundup always gets a call to itself. */
  articlesPerModelCall: 3,
  roundsPerModelCall: 12,
  roundsPerRoundupCall: 30,
  maxTokensPerCall: fromEnv("RADAR_MAX_TOKENS", 16000),
  modelTimeoutMs: fromEnv("RADAR_MODEL_TIMEOUT_MS", 120_000),
  /** Minimum time between the starts of two model calls. */
  callGapMs: fromEnv("RADAR_CALL_GAP_MS", 6000),
  retryDelayMs: 8000,
  /** Longest wait before the one retry of a rate-limited call. */
  rateLimitWaitMs: 65_000,
};

/** India-focused startup funding outlets. Override with RADAR_DOMAINS (comma separated). */
export const INDIA_DOMAINS = [
  "inc42.com",
  "entrackr.com",
  "yourstory.com",
  "vccircle.com",
  "economictimes.indiatimes.com",
  "livemint.com",
  "techcrunch.com",
  "startuptalky.com",
];

export const INDIA_QUERIES = [
  "Indian startups weekly funding roundup: startups that raised funding this week",
  "Indian startup raises seed funding round led by",
  "India startup raises pre-seed or pre-Series A round",
  "Bengaluru startup raises Series A funding",
];

/** A news page as retrieved. `text` is untrusted evidence, never instructions. */
export type Article = { id: string; url: string; title: string; publishedDate: string | null; text: string };

const optional = (max: number) => z.string().trim().max(max).nullable().catch(null);

/** The stage a piece of text states, or null. Later stages win, so a later round is never mistaken for an early one. */
export function stageFromText(text: string): Stage | null {
  const t = text.toLowerCase().replace(/[‐-―_]/g, "-");
  if (/\bseries[-\s]?[c-k]\d?\b|\bpre[-\s]?ipo\b|\blate[-\s]stage\b|\bgrowth[-\s](?:stage|round)\b/.test(t)) return "later";
  if (/\bpre[-\s]?series[-\s]?[c-k]\d?\b/.test(t)) return "later";
  // "pre-Series B" is a round after Series A, so it is not early.
  if (/\bseries[-\s]?b\d?\b/.test(t)) return "series-b";
  if (/\bpre[-\s]?series[-\s]?a\d?\b/.test(t)) return "pre-series-a";
  if (/\bseries[-\s]?a\d?\b/.test(t)) return "series-a";
  if (/\bpre[-\s]?seed\b|\bangel (?:round|funding)\b/.test(t)) return "pre-seed";
  if (/\bseed\b/.test(t)) return "seed";
  return null;
}

/** Maps whatever the model wrote ("Series C", "Pre-Series B", "Seed round") onto STAGES. */
export function normalizeStage(value: unknown): Stage {
  if (typeof value !== "string") return "unknown";
  const t = value.trim().toLowerCase();
  if ((STAGES as readonly string[]).includes(t)) return t as Stage;
  return stageFromText(t) ?? "unknown";
}

const names = (max: number) =>
  z.array(z.unknown()).catch([]).transform((list) =>
    list.flatMap((v) => (typeof v === "string" && v.trim() && v.trim().length <= 120 ? [v.trim()] : [])).slice(0, max));

export const Round = z.object({
  company: z.string().trim().min(1).max(120),
  whatItDoes: optional(240),
  // A round that leaves the stage out is an unknown-stage round, not a malformed one.
  stage: z.unknown().optional().transform(normalizeStage),
  amount: optional(60),
  investors: names(8),
  founders: names(6),
  sector: z.enum(SECTORS).catch("other"),
  announcedOn: optional(30),
  city: optional(80),
  website: optional(200),
  sourceId: z.string(),
  quote: z.string().trim().min(10).max(400),
});
export type Round = z.infer<typeof Round>;

export const Extraction = z.object({ rounds: z.array(z.unknown()).max(60) });

export type FundedCompany = Omit<Round, "sourceId"> & { key: string; sourceUrl: string; sourceTitle: string; publishedDate: string | null };

export const companyKey = (name: string) => name.toLowerCase().replace(/\b(pvt|private|ltd|limited|inc|technologies|labs)\b\.?/g, "").replace(/[^a-z0-9]/g, "");

/** "Cosmoserve" and "Cosmoserve Space" are one company: the words of one name begin the other. */
export function sameCompany(a: string, b: string) {
  const words = (name: string) =>
    name.toLowerCase().replace(/\([^)]*\)/g, " ").replace(/\b(pvt|private|ltd|limited|inc|technologies|labs)\b\.?/g, "").split(/[^a-z0-9]+/).filter(Boolean);
  const [short, long] = [words(a), words(b)].sort((x, y) => x.length - y.length) as [string[], string[]];
  return short.join("").length >= 4 && short.every((word, i) => word === long[i]);
}

const AMOUNT = /(?<![a-z])(us\$|\$|usd|rs\.?|inr|₹)?\s*(\d[\d,]*(?:\.\d+)?)\s*-?\s*(crores?|cr|lakhs?|lacs?|million|mn|mln|m|billion|bn|b|k|thousand)?(?![a-z0-9])/gi;

/** Money amounts in a text, in millions of US dollars, with where each one starts. */
export function findAmounts(text: string): { index: number; usdMn: number }[] {
  const found: { index: number; usdMn: number }[] = [];
  for (const m of text.matchAll(AMOUNT)) {
    const currency = (m[1] ?? "").toLowerCase();
    const unit = (m[3] ?? "").toLowerCase();
    const value = Number(m[2]!.replace(/,/g, ""));
    const rupeeUnit = /^(cr|lakh|lac)/.test(unit);
    // A bare number is not money; neither is "5 m" or "3 b" without a currency.
    if (!Number.isFinite(value) || (!currency && !rupeeUnit && !/^(million|mn|mln|billion|bn)$/.test(unit))) continue;
    const rupees = rupeeUnit || /^(rs|inr|₹)/.test(currency);
    let millions: number; // of the stated currency
    if (unit.startsWith("cr")) millions = value * 10;
    else if (/^(lakh|lac)/.test(unit)) millions = value / 10;
    else if (/^(million|mn|mln|m)$/.test(unit)) millions = value;
    else if (/^(billion|bn|b)$/.test(unit)) millions = value * 1000;
    else if (/^(k|thousand)$/.test(unit)) millions = value / 1000;
    else millions = value / 1e6;
    found.push({ index: m.index + m[0].search(/\S/), usdMn: rupees ? (millions / 10) * USD_MN_PER_CRORE : millions });
  }
  return found;
}

/** "$10 Mn", "Rs 25 crore", "₹7.6 Cr", "$390K" -> millions of US dollars, or null when unreadable. */
export const amountUsdMn = (amount: string | null | undefined) => (amount ? findAmounts(amount)[0]?.usdMn ?? null : null);

/** Weekly or monthly pages that list many rounds, as opposed to one company's announcement. */
export const isRoundup = (article: Pick<Article, "title">) =>
  /round-?\s?up|funding galore|wrap-?up|\bfunding wrap\b|\bdeals digest\b|\bweekly\b|\bthis week\b|\blast week\b|\bweek in\b|\bfunding (?:report|tracker|digest|recap)\b|startups? (?:that |which )?raised|\btop (?:funding|deals)\b|\bdeals of the week\b|\bearly-stage (?:cheques|rounds|deals)\b|,.*\b(?:and )?others\b/i
    .test(article.title);

// Verb forms that state a raise as done. Deliberately absent: "raise", "raising",
// "to raise" (intent or background) and "backed by" (a past investor, not a round).
const RAISE_VERB = /\b(?:raised|raises|secured|secures|bagged|bags|closed|closes|landed|lands|picked up|picks up|got|gets|received|receives|garnered|garners|netted|nets|snagged|snags|mopped up|mops up|pocketed|pockets|scooped up|scoops up|pulled in|pulls in|announced|announces|invested|invests|infused|infuses|pumped|pumps)\b/gi;
const BEFORE_VERB = /\b(?:(?:had|previously|formerly|not|never|yet to|since|when it|after it|after having)\s+(?:\w+\s+){0,2}|(?:earlier|last)\s+)$/i;
const AFTER_VERB = /\b(?:last year|a year ago|years? ago|months ago|previously|earlier this year|earlier rounds?|so far|to date|till date|till now|thus far|in the past|in total funding|since (?:its )?inception)\b/i;
const YEAR = /\b(?:in|during|back in|of)\s+(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+)?((?:19|20)\d\d)\b/gi;
const FOUNDING = /\b(?:found|establish|start|launch|incorporat|set up|born|incubat)\w*(?:\s+\w+){0,2}\s*$/i;

/**
 * Finds where a quote states a raise as the news, not as history. Returns the
 * position of that verb, or the reason no verb qualifies.
 */
export function announcement(quote: string, articleYear: number): { at: number } | { reason: string } {
  const verbs = [...quote.matchAll(RAISE_VERB)];
  if (!verbs.length) {
    return { reason: /\b(?:since|after|before) raising\b|\bbacked by\b/i.test(quote) ? "background mention, not a new round" : "no raise verb in quote" };
  }
  for (const [i, verb] of verbs.entries()) {
    if (BEFORE_VERB.test(quote.slice(Math.max(0, verb.index - 40), verb.index))) continue;
    const clause = quote.slice(verb.index, Math.min(verbs[i + 1]?.index ?? quote.length, verb.index + 200));
    if (AFTER_VERB.test(clause)) continue;
    const pastYear = [...clause.matchAll(YEAR)].some((y) =>
      Number(y[1]) < articleYear && !FOUNDING.test(clause.slice(Math.max(0, y.index - 40), y.index)));
    if (!pastYear) return { at: verb.index };
  }
  return { reason: "background mention, not a new round" };
}

/** The stage to act on: the model's, or when it said "unknown", the one the quote or a headline naming the company states. */
export function settledStage(round: Round, article: Article): Stage {
  if (round.stage !== "unknown") return round.stage;
  const key = companyKey(round.company);
  const titleNamesCompany = !isRoundup(article) && !!key && article.title.toLowerCase().replace(/[^a-z0-9]/g, "").includes(key);
  return stageFromText(round.quote) ?? (titleNamesCompany ? stageFromText(article.title) : null) ?? "unknown";
}

/**
 * A round is kept only when its quote is verbatim in the saved article, names
 * the company and states the raise as this page's news. Returns a reason when
 * it is rejected. These checks are deterministic: the prompt asks for the same
 * things, but a model's word is not evidence.
 */
export function rejectRound(round: Round, articles: Article[], stages: Stage[], since: Date): string | null {
  const article = articles.find((a) => a.id === round.sourceId);
  if (!article) return "unknown source";
  const text = comparableQuote(article.text).toLowerCase();
  if (!text.includes(comparableQuote(round.quote).toLowerCase())) return "quote not in source";
  // The quote itself must name the company, so a round cannot be pinned on a
  // company the page merely mentions elsewhere.
  const key = companyKey(round.company);
  if (!key) return "empty company name";
  if (!round.quote.toLowerCase().replace(/[^a-z0-9]/g, "").includes(key)) return "company not named in quote";

  // A page about something else (a trend piece, another company's profile) often
  // recalls old rounds in passing. Outside roundups, the headline must be about this company.
  if (!isRoundup(article)) {
    const headline = `${article.title} ${article.url}`.toLowerCase().replace(/[^a-z0-9]/g, "");
    const words = round.company.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const lead = words.slice(0, 2).join("");
    if (!headline.includes(key) && !(lead.length >= 4 && headline.includes(lead))) return "company not named in headline";
  }

  // Background mentions ("Backed by ... Series A funding", "Since raising $3.5
  // million in 2023") are not rounds announced now.
  const published = Date.parse(article.publishedDate ?? "");
  const stated = announcement(round.quote, new Date(Number.isFinite(published) ? published : since.getTime()).getUTCFullYear());
  const amounts = findAmounts(round.quote);
  if ("reason" in stated) {
    // Roundup tables list this week's rounds as rows without a verb; a row that
    // names the company and an amount is accepted there, history never is.
    const intent = /\b(?:rais(?:e|ing)|talks|plans?|looking|seeking|backed|may|could|set to|expected)\b/i.test(round.quote);
    if (stated.reason !== "no raise verb in quote" || !isRoundup(article) || !amounts.length || intent) return stated.reason;
  }

  const stage = settledStage(round, article);
  if (stage === "unknown" && !stages.includes("unknown")) {
    // No stated stage: keep it only when the amount on the page is small enough to be an early round.
    const at = "at" in stated ? stated.at : 0;
    const quoted = (amounts.find((a) => a.index >= at) ?? amounts[0])?.usdMn;
    const claimed = round.amount && text.includes(comparableQuote(round.amount).toLowerCase()) ? amountUsdMn(round.amount) : null;
    const usdMn = quoted ?? claimed;
    if (usdMn == null) return "stage unknown and no readable amount on the page";
    if (usdMn > UNKNOWN_STAGE_MAX_USD_MN) return `stage unknown and amount too large (about $${Math.round(usdMn)}M)`;
  } else if (!stages.includes(stage)) return `stage ${stage} not wanted`;

  // A date the model gives counts only when the page writes it; otherwise the publish date stands in.
  const announced = Date.parse(statedDate(round.announcedOn, article.text) ?? article.publishedDate ?? "");
  if (Number.isFinite(announced) && announced < since.getTime()) return "older than window";
  return null;
}

/** Drops founder names and a website the page does not actually state. */
export function statedOnly<T extends Pick<Round, "founders" | "website">>(fields: T, article: Article): T {
  const text = comparableQuote(article.text).toLowerCase();
  let website: string | null = null;
  const host = fields.website?.toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#\s]/)[0] ?? "";
  if (host.includes(".") && text.includes(host)) website = fields.website;
  return { ...fields, website, founders: fields.founders.filter((name) => text.includes(comparableQuote(name).toLowerCase())) };
}

const MONTHS = [
  "jan(?:uary)?", "feb(?:ruary)?", "mar(?:ch)?", "apr(?:il)?", "may", "june?", "july?", "aug(?:ust)?", "sept?(?:ember)?", "oct(?:ober)?", "nov(?:ember)?", "dec(?:ember)?",
];

/**
 * The model's date as YYYY-MM-DD, but only when the page itself writes that
 * date ("5 Nov 2026", "November 5, 2026", "05 Nov'26", "2026-11-05",
 * "05/11/2026"). A date the page never writes is a guess and becomes null.
 */
export function statedDate(value: string | null | undefined, pageText: string): string | null {
  if (!value?.trim()) return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/.exec(value.trim());
  let y: number, m: number, d: number;
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else {
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) return null;
    [y, m, d] = [parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate()];
  }
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `(?<!\\d)0?${d}(?:st|nd|rd|th)?`;
  const month = `(?<![a-z])(?:${MONTHS[m - 1]})(?![a-z])\\.?`;
  const year = `(?:${y}|['’‘]\\s?${pad(y % 100)})(?!\\d)`;
  const gap = "[\\s.,-]*";
  const written = new RegExp([
    `${day}${gap}(?:of\\s+)?${month}${gap}${year}`,
    `${month}${gap}${day}${gap}${year}`,
    `(?<!\\d)${y}[-/.]0?${m}[-/.]0?${d}(?!\\d)`,
    `(?<!\\d)0?${d}[-/.]0?${m}[-/.]${y}(?!\\d)`,
    `(?<!\\d)0?${m}[-/.]0?${d}[-/.]${y}(?!\\d)`,
  ].join("|"), "i");
  return written.test(pageText) ? `${y}-${pad(m)}-${pad(d)}` : null;
}

/**
 * Two verified reports of the same company become one, and detail wins over
 * brevity. The quote, source and stage come from the report that states the
 * stage (on a tie, a single story beats a roundup, then the first stays);
 * every other field takes whichever report states more.
 */
export function mergeCompanies(a: FundedCompany, b: FundedCompany): FundedCompany {
  const rank = (c: FundedCompany) => (c.stage !== "unknown" ? 2 : 0) + (isRoundup({ title: c.sourceTitle }) ? 0 : 1);
  const [main, extra] = rank(b) > rank(a) ? [b, a] : [a, b];
  const longer = (x: string[], y: string[]) => (y.length > x.length ? y : x);
  return {
    ...main,
    key: a.key,
    whatItDoes: main.whatItDoes ?? extra.whatItDoes,
    amount: main.amount ?? extra.amount,
    investors: longer(main.investors, extra.investors),
    founders: longer(main.founders, extra.founders),
    sector: main.sector !== "other" ? main.sector : extra.sector,
    announcedOn: main.announcedOn ?? extra.announcedOn,
    city: main.city ?? extra.city,
    website: main.website ?? extra.website,
  };
}
