// Fit ranking: which funded companies suit this candidate. Deterministic, no model calls.
// The profile is a handful of keywords; everything matched is shown with where it was seen.
import { SECTORS, type FundedCompany, type Sector } from "../radar/contracts.ts";
import type { HiringCheck } from "../hiring/contracts.ts";
import type { Draft, WorkMode } from "../interview.ts";

export type FitSource = "flags" | "env" | "interview" | "none";

export type Fit = {
  /** Wanted sectors (the radar's labels). Empty: any sector. */
  sectors: Sector[];
  /** Role keywords matched against role titles, e.g. "backend", "engineer". Empty: any role. */
  roles: string[];
  /** Preferred cities. They rank, they never exclude. */
  cities: string[];
  workMode: WorkMode | null;
  source: FitSource;
};

export const NO_FIT: Fit = { sectors: [], roles: [], cities: [], workMode: null, source: "none" };

export type RoleMatch = { title: string; keyword: string; where: "hiring post" | "careers page" | "job board"; url: string | null };

export type FitScore = {
  score: number;
  /** null when the profile names no sectors (or cities). */
  sectorMatch: boolean | null;
  cityMatch: boolean | null;
  matchedRoles: RoleMatch[];
  /** Role titles were found for the company, whether or not any matched. */
  rolesStated: boolean;
  /** Why the filter leaves this company out, or null when it stays. */
  leftOut: "sector" | "role" | null;
};

const list = (value: string | null | undefined) => (value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const WORK_MODES: WorkMode[] = ["remote", "hybrid", "onsite", "unspecified"];

/** Builds a profile from comma separated lists. Throws on a sector the radar does not use. */
export function parseFit(input: { roles?: string | null; sectors?: string | null; cities?: string | null; workMode?: string | null }, source: FitSource): Fit {
  const sectors = [...new Set(list(input.sectors).map((s) => s.toLowerCase()))];
  const unknown = sectors.find((s) => !(SECTORS as readonly string[]).includes(s));
  if (unknown) throw new Error(`unknown sector "${unknown}". Choose from: ${SECTORS.join(", ")}`);
  const mode = input.workMode?.trim().toLowerCase();
  if (mode && !(WORK_MODES as string[]).includes(mode)) throw new Error(`unknown work mode "${mode}". Choose from: ${WORK_MODES.join(", ")}`);
  return {
    sectors: sectors as Sector[],
    roles: [...new Set(list(input.roles).map((r) => r.toLowerCase()))].slice(0, 20),
    cities: [...new Set(list(input.cities))].slice(0, 10),
    workMode: mode && mode !== "unspecified" ? (mode as WorkMode) : null,
    source,
  };
}

const isEmpty = (fit: Fit) => !fit.sectors.length && !fit.roles.length && !fit.cities.length;

// Skills -> role keywords. Only plain, well-known mappings: a wrong guess here would hide companies.
const ROLE_HINTS: [RegExp, string[]][] = [
  [/\b(?:react|next\.?js|vue|svelte|angular|css|tailwind|front[- ]?end)\b/i, ["frontend", "full-stack"]],
  [/\b(?:node(?:\.?js)?|python|django|flask|fastapi|golang|go|java|kotlin|rust|ruby|rails|postgres(?:ql)?|sql|apis?|back[- ]?end|microservices|bun)\b/i, ["backend", "full-stack"]],
  [/\b(?:typescript|javascript|full[- ]?stack)\b/i, ["full-stack"]],
  [/\b(?:swift|ios|android|flutter|react native|mobile)\b/i, ["mobile", "ios", "android"]],
  [/\b(?:pytorch|tensorflow|machine learning|ml|llms?|deep learning|nlp|computer vision)\b/i, ["machine learning", "ml", "ai"]],
  [/\b(?:figma|ux|ui design|product design|design|illustrat\w+)\b/i, ["design"]],
  [/\b(?:product management|product manager|roadmaps?|user research)\b/i, ["product"]],
  [/\b(?:data (?:science|engineering|analysis)|analytics|pandas|dbt|spark)\b/i, ["data"]],
  [/\b(?:aws|gcp|kubernetes|docker|terraform|devops|infrastructure)\b/i, ["devops", "infrastructure", "platform"]],
];
const BUILDS_SOFTWARE = /^(?:frontend|backend|full-stack|mobile|machine learning|devops)$/;

// What they want to work on -> radar sectors.
const SECTOR_HINTS: [RegExp, Sector][] = [
  [/\b(?:ai|saas|software|dev(?:eloper)? ?tools?|b2b|apis?|infra(?:structure)?|llms?|agents?)\b/i, "software-ai"],
  [/\b(?:fintech|payments?|lending|banking|upi|insurance|insurtech|wealth|trading)\b/i, "fintech"],
  [/\b(?:hardware|robot\w*|space|drones?|semiconductors?|chips?|deep ?tech)\b/i, "deeptech-hardware"],
  [/\b(?:health\w*|bio\w*|med\w*|pharma\w*|clinic\w*)\b/i, "healthcare-biotech"],
  [/\b(?:consumer brands?|d2c|fashion|beauty|food|beverages?)\b/i, "consumer-brand"],
  [/\b(?:gam(?:es|ing)|media|creator|content|music|video|entertainment)\b/i, "gaming-media"],
  [/\b(?:climate|energy|solar|ev|evs|batter\w+|sustainab\w+)\b/i, "climate-energy"],
];

// Indian startup cities, each with the other names it goes by.
const CITY_NAMES: string[][] = [
  ["Bengaluru", "Bangalore"], ["Mumbai", "Bombay"], ["Delhi", "New Delhi", "NCR"], ["Gurugram", "Gurgaon"], ["Noida"],
  ["Hyderabad"], ["Pune"], ["Chennai", "Madras"], ["Kolkata", "Calcutta"], ["Ahmedabad"], ["Jaipur"], ["Kochi", "Cochin"],
  ["Thiruvananthapuram", "Trivandrum"], ["Indore"], ["Chandigarh"], ["Coimbatore"], ["Goa"],
];
const word = (text: string, name: string) => new RegExp(`(?<![a-z])${name.toLowerCase()}(?![a-z])`).test(text.toLowerCase());
const cityGroup = (city: string) => CITY_NAMES.find((names) => names.some((name) => word(city, name)));

/** True when two city strings name the same place ("Bangalore, India" and "Bengaluru"). */
export function sameCity(a: string, b: string) {
  const [ga, gb] = [cityGroup(a), cityGroup(b)];
  if (ga || gb) return ga === gb;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  return norm(a).length >= 3 && norm(a) === norm(b);
}

/**
 * What a locked interview profile safely says about fit. Skills map to role
 * keywords, the wanted product kind to sectors, the location to a known city.
 * Anything not recognised is left out rather than guessed. null: nothing usable.
 */
export function fitFromDraft(draft: Draft): Fit | null {
  const skills = (draft.skills ?? []).join(", ");
  const roles = new Set<string>();
  for (const [pattern, keywords] of ROLE_HINTS) if (pattern.test(skills)) keywords.forEach((k) => roles.add(k));
  if ([...roles].some((r) => BUILDS_SOFTWARE.test(r))) ["engineer", "developer", "sde"].forEach((k) => roles.add(k));
  const wants = [draft.productKind, draft.products].filter(Boolean).join(". ");
  const sectors = SECTOR_HINTS.filter(([pattern]) => pattern.test(wants)).map(([, sector]) => sector);
  const cities = draft.location ? CITY_NAMES.filter((names) => names.some((name) => word(draft.location!, name))).map((names) => names[0]!) : [];
  const fit: Fit = {
    sectors: [...new Set(sectors)], roles: [...roles], cities,
    workMode: draft.workMode && draft.workMode !== "unspecified" ? draft.workMode : null, source: "interview",
  };
  return isEmpty(fit) ? null : fit;
}

/**
 * The profile to rank with, from the first source that says anything:
 * command-line flags, then SCOUT_ROLES / SCOUT_SECTORS / SCOUT_CITIES, then a
 * locked interview profile, then no filter at all.
 */
export function resolveFit(sources: {
  flags?: { roles?: string; sectors?: string; cities?: string; workMode?: string };
  env?: Record<string, string | undefined>;
  draft?: Draft | null;
}): Fit {
  const flags = parseFit(sources.flags ?? {}, "flags");
  if (!isEmpty(flags)) return flags;
  const env = sources.env ?? {};
  const fromEnv = parseFit({ roles: env.SCOUT_ROLES, sectors: env.SCOUT_SECTORS, cities: env.SCOUT_CITIES, workMode: env.SCOUT_WORK_MODE }, "env");
  if (!isEmpty(fromEnv)) return fromEnv;
  return (sources.draft && fitFromDraft(sources.draft)) || { ...NO_FIT, workMode: flags.workMode ?? fromEnv.workMode };
}

const norm = (text: string) => text.toLowerCase().replace(/[^a-z0-9+#]+/g, " ").trim();
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A keyword matches a title at a word start, allowing a plural or -er/-ing
 * ending: "engineer" finds "Engineering Lead", "design" finds "Product Designer",
 * "full-stack" finds "Fullstack Developer"; "product" does not find "Production".
 */
export function roleMatches(title: string, keyword: string) {
  const [t, k] = [norm(title), norm(keyword)];
  if (!t || !k) return false;
  const pattern = (hay: string, needle: string) => new RegExp(`(?:^| )${escape(needle)}(?:s|er|ers|ing|or)?(?: |$)`).test(hay);
  return pattern(t, k) || (k.includes(" ") && pattern(t, k.replace(/ /g, "")));
}

/** Scores one company against the profile and lists the role titles that matched, each with its page. */
export function scoreFit(fit: Fit, company: Pick<FundedCompany, "sector" | "city">, check: HiringCheck | null): FitScore {
  const titles: Omit<RoleMatch, "keyword">[] = check ? [
    ...check.posts.flatMap((post) => (post.role ? [{ title: post.role, where: "hiring post" as const, url: post.url }] : [])),
    ...check.roles.map((title) => ({ title, where: "careers page" as const, url: check.careersUrl })),
    ...(check.board?.jobs ?? []).map((job) => ({ title: job.title, where: "job board" as const, url: job.url })),
  ] : [];
  const matchedRoles: RoleMatch[] = [];
  for (const entry of titles) {
    const keyword = fit.roles.find((k) => roleMatches(entry.title, k));
    if (keyword && !matchedRoles.some((m) => norm(m.title) === norm(entry.title))) matchedRoles.push({ ...entry, keyword });
  }
  const sectorMatch = fit.sectors.length ? fit.sectors.includes(company.sector) : null;
  const cityMatch = fit.cities.length ? !!company.city && fit.cities.some((city) => sameCity(city, company.city!)) : null;
  // Someone who wants an office cares more about the city than someone working remotely.
  const cityWeight = fit.workMode === "onsite" || fit.workMode === "hybrid" ? 2 : 1;
  const remote = fit.workMode === "remote" && !!check
    && [...check.posts.map((p) => `${p.title} ${p.excerpt}`), ...(check.board?.jobs ?? []).map((j) => j.location ?? "")].some((text) => /\bremote\b/i.test(text));
  return {
    score: (sectorMatch ? 3 : 0) + Math.min(matchedRoles.length, 3) * 2 + (cityMatch ? cityWeight : 0) + (remote ? 1 : 0),
    sectorMatch, cityMatch, matchedRoles, rolesStated: titles.length > 0,
    // A company is left out only on what is known: a different sector, or stated roles of which none match.
    leftOut: sectorMatch === false ? "sector" : fit.roles.length && titles.length && !matchedRoles.length ? "role" : null,
  };
}

/** One line describing the profile, for the top of a digest. */
export function describeFit(fit: Fit) {
  const parts = [
    fit.roles.length ? `roles ${fit.roles.join(", ")}` : "", fit.sectors.length ? `sectors ${fit.sectors.join(", ")}` : "",
    fit.cities.length ? `cities ${fit.cities.join(", ")}` : "", fit.workMode ? `${fit.workMode} work` : "",
  ].filter(Boolean);
  const from = { flags: "from the command line", env: "from SCOUT_* settings", interview: "from your interview profile", none: "" }[fit.source];
  return fit.source === "none" || !parts.length ? "no filter (ranked by hiring evidence only)" : `${parts.join("; ")} (${from})`;
}
