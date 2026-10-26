import { z } from "zod";
import { isIP } from "node:net";
import removeMarkdown from "remove-markdown";

export function publicURL(value: string) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    isIP(host.replace(/^\[|\]$/g, "")) ||
    !host.includes(".") ||
    ["localhost", "local", "internal", "test", "invalid"].some((s) => host === s || host.endsWith(`.${s}`))
  ) {
    throw new Error("Use a public HTTPS company URL.");
  }
  url.hash = "";
  return url.href;
}

const companyURLSchema = z.string().transform((value, ctx) => {
  try {
    return publicURL(value);
  } catch {
    ctx.addIssue({ code: "custom", message: "Use a public HTTPS company URL." });
    return z.NEVER;
  }
});

const short = z.string().trim().min(1).max(600);

export const Input = z.object({
  profile: z.object({
    name: z.string().trim().min(1).max(80),
    skills: z.array(z.string().trim().min(1).max(80)).min(1).max(12),
    experience: z.string().trim().min(1).max(1500),
    interests: z.string().trim().max(600),
    constraints: z.string().trim().max(600),
    fictional: z.boolean(),
  }).strict(),
  companyURL: companyURLSchema,
}).strict();
export type ScoutInput = z.infer<typeof Input>;

export const Citation = z.object({ sourceId: z.string(), quote: z.string().min(10).max(500) }).strict();
const Claim = z.object({ text: short, citations: z.array(Citation).min(1).max(3) }).strict();

export const Dossier = z.object({
  companyName: z.string().min(1).max(120),
  brief: z.array(Claim).min(1).max(4),
  fit: z.array(z.object({ skill: z.string(), reasoning: short, citations: z.array(Citation).min(1).max(3) }).strict()).min(1).max(3),
  hiringSignals: z.array(Claim).max(3),
  contribution: z.object({ hypothesis: short, basis: Claim, nextStep: short }).strict(),
  outreachDraft: z.string().min(20).max(1800),
  unknowns: z.array(short).min(1).max(8),
}).strict();
export type ScoutDossier = z.infer<typeof Dossier>;

export type Source = { id: string; url: string; title: string; retrievedAt: string; excerpt: string };

export const Review = z.object({ approved: z.boolean(), issues: z.array(short).max(12) }).strict();
export const SearchArgs = z.object({ query: z.string().trim().min(3).max(400), objective: z.string().trim().min(3).max(600) }).strict();
export const ReadArgs = z.object({ url: companyURLSchema }).strict();

export const LIMITS = {
  modelCalls: 8,
  sourceCalls: 4,
  searchResults: 3,
  sourceCharacters: 12000,
  maxTokensPerCall: 2400,
  elapsedMs: 240000,
  maximumReservedDollars: 0.5,
};

export function parseJSON(text: string) {
  const trimmed = text.trim();
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/.exec(trimmed);
  const body = (fence ? fence[1]! : trimmed).trim();
  try {
    return JSON.parse(body);
  } catch (error) {
    // Some models emit JavaScript-style escaped apostrophes inside otherwise valid JSON.
    const repaired = body.replace(/\\'/g, "'");
    if (repaired !== body) return JSON.parse(repaired);
    throw error;
  }
}

export function comparableQuote(value: string) {
  return removeMarkdown(value)
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function validateEvidence(dossier: ScoutDossier, sources: Source[], input: ScoutInput) {
  const citations = [
    ...dossier.brief.flatMap((c) => c.citations),
    ...dossier.fit.flatMap((c) => c.citations),
    ...dossier.hiringSignals.flatMap((c) => c.citations),
    ...dossier.contribution.basis.citations,
  ];
  const issues: string[] = [];
  for (const citation of citations) {
    const source = sources.find((s) => s.id === citation.sourceId);
    if (!source) issues.push(`Unknown source ${citation.sourceId}`);
    else if (!comparableQuote(source.excerpt).includes(comparableQuote(citation.quote))) {
      issues.push(`Quote missing from ${citation.sourceId}`);
    }
  }
  for (const fit of dossier.fit) {
    if (!input.profile.skills.some((s) => s.toLowerCase() === fit.skill.toLowerCase())) {
      issues.push(`Skill not supplied: ${fit.skill}`);
    }
  }
  return [...new Set(issues)];
}
