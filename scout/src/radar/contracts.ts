import { z } from "zod";
import { comparableQuote } from "../research/contracts.ts";

export const STAGES = ["pre-seed", "seed", "pre-series-a", "series-a", "series-b", "later", "unknown"] as const;
export type Stage = (typeof STAGES)[number];

/** Early rounds: founders still hire directly, so these are the ones worth approaching. */
export const EARLY_STAGES: Stage[] = ["pre-seed", "seed", "pre-series-a", "series-a"];

export const RADAR_LIMITS = {
  resultsPerQuery: 8,
  maxArticles: 12,
  articleCharacters: 5000,
  articlesPerModelCall: 2,
  roundsPerModelCall: 12,
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

export const Round = z.object({
  company: z.string().trim().min(1).max(120),
  whatItDoes: optional(240),
  stage: z.enum(STAGES).catch("unknown"),
  amount: optional(60),
  investors: z.array(z.string().trim().min(1).max(120)).max(8).catch([]),
  announcedOn: optional(30),
  city: optional(80),
  website: optional(200),
  sourceId: z.string(),
  quote: z.string().trim().min(10).max(400),
});
export type Round = z.infer<typeof Round>;

export const Extraction = z.object({ rounds: z.array(z.unknown()).max(40) });

export type FundedCompany = Omit<Round, "sourceId"> & { key: string; sourceUrl: string; sourceTitle: string; publishedDate: string | null };

export const companyKey = (name: string) => name.toLowerCase().replace(/\b(pvt|private|ltd|limited|inc|technologies|labs)\b\.?/g, "").replace(/[^a-z0-9]/g, "");

/**
 * A round is kept only when its quote is verbatim in the saved article and
 * names the company. Returns a reason when it is rejected.
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
  if (!stages.includes(round.stage)) return `stage ${round.stage} not wanted`;
  const announced = Date.parse(round.announcedOn ?? article.publishedDate ?? "");
  if (Number.isFinite(announced) && announced < since.getTime()) return "older than window";
  return null;
}
