import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { companyKey } from "../radar/contracts.ts";
import { nameRegex, type HiringCheck, type Page } from "./contracts.ts";

/** Result of a deliverability check by an outside verifier. `opted_out`: the owner asked the verifier not to process the address. */
export type Verification = {
  status: "valid" | "invalid" | "accept_all" | "webmail" | "disposable" | "unknown" | "opted_out";
  score: number | null;
  by: "hunter";
  checkedAt: string | null;
};
/** An address a finder service returned for a named person. `sources` are public pages where the service saw it. */
export type FoundEmail = { email: string; score: number | null; sources: string[]; verification: Verification | null };

export interface ContactProviders {
  /** Full text of specific pages (hiring posts, careers page, website). */
  read(urls: string[]): Promise<Page[]>;
  /** Open web search, used to find addresses published elsewhere. */
  web(query: string): Promise<Page[]>;
  /** Whether the domain accepts mail (MX record). null when it cannot be determined. */
  hasMail(domain: string): Promise<boolean | null>;
  /** Optional (Hunter Email Verifier): deliverability of one address. null when no answer. */
  verify?(email: string): Promise<Verification | null>;
  /** Optional (Hunter Email Finder): a named person's address at a company domain. */
  findEmail?(name: string, domain: string): Promise<FoundEmail | { optedOut: true } | null>;
}

export type Purpose = "apply" | "contact" | "support" | "grievance" | "press" | "sales" | "legal";

/** An address that appears verbatim on a public page. */
export type Contact = {
  email: string;
  kind: "person" | "role";
  /** For shared inboxes: where applications go, the founders' inbox, or anything else. null for a person. */
  inbox: "application" | "founders" | "general" | null;
  /** The person's name, when a poster, founder or a name on the same page matches the address. */
  person: string | null;
  founder: boolean;
  onCompanyDomain: boolean;
  /** company: the company's own site, page or hiring post. third-party: a listing or someone else's page. hunter: Hunter's index. */
  source: "company" | "third-party" | "hunter";
  /** What the surrounding words say the address is for, when they say. */
  purpose: Purpose | null;
  sourceUrl: string;
  evidence: string;
  verification: Verification | null;
};
/** Someone who posted about hiring at the company, or a founder named by the funding radar. */
export type Person = {
  name: string;
  headline: string | null;
  profileUrl: string | null;
  postUrl: string | null;
  affiliated: boolean;
  founderLikely: boolean;
  /** Named as a founder by the radar, flagged by the hiring check, or founderLikely. */
  founder: boolean;
};
/** An address inferred from a naming pattern. Never seen on a page. Unverified unless `verification.status` is "valid". */
export type Guess = { person: string; email: string; basis: string; founder: boolean; verification: Verification | null };
export type MailDomain = { domain: string; basis: string; acceptsMail: boolean | null };
export type Recommendation = {
  email: string;
  tier: "application-post" | "founder" | "team-member" | "application-inbox" | "founders-inbox" | "verified-guess";
  thirdParty: boolean;
  reason: string;
  sourceUrl: string | null;
};

export type ContactCheck = {
  key: string;
  company: string;
  /** The website's domain. */
  domain: string | null;
  /** Mail server check for `domain` (or the first learned mail domain when there is no website). */
  acceptsMail: boolean | null;
  /** Every domain treated as the company's for mail: the website's, plus any learned from its own posts and pages. */
  mailDomains: MailDomain[];
  recommended: Recommendation | null;
  contacts: Contact[];
  people: Person[];
  /** Empty unless guesses were asked for. */
  guesses: Guess[];
  failures: string[];
  checkedAt: string;
};

export type ContactOptions = {
  now?: Date;
  /** Founder names from another source (the funding radar). */
  founders?: string[];
  /** Offer pattern guesses for affiliated people with no published address. Off by default. */
  guesses?: boolean;
  /** Also verify the published addresses that would be recommended (needs providers.verify). */
  verifyFound?: boolean;
};

const APPLICATION = /^(?:careers?|jobs?|hr|hiring|recruit\w*|talent|people|apply|applications?|cv|cvs|resumes?|internships?|interns?|joinus|join|work|workwithus)$/;
const FOUNDERS = /^(?:co-?founders?|founders?|foundersoffice|ceo)$/;
const GENERAL = /^(?:hello|hi|hey|info|contact|connect|team|support|admin|sales|press|media|business|partnerships?|partners?|office|mail|email|enquir\w*|inquir\w*|care|help|helpdesk|desk|trust|safety|security|abuse|grievances?|nodal|social|legal|privacy|dpo|compliance|billing|accounts?|finance|payments?|invoices?|marketing|pr|invest\w*|ir|noreply|no-reply|donotreply|reply|feedback|customers?|customercare|service|services|orders?|returns?|refunds?|shop|store|bookings?|reservations?|events?|community|newsletter|news|updates|notifications?|alerts?|webmaster|postmaster|hostmaster|root|system|tech|developers?|engineering|product|design|ops|operations|it|data|research|growth|brand|content|editor|editorial|ads|advertis\w*|affiliates?|vendors?|suppliers?|procurement|purchase|logistics|dispatch|export|exports|import|query|queries|ask|talk|reach|write|general|main|company|corporate|corp|official|india|global|us|uk|learn|academy|education|admissions?|demo|pilot|beta|app|web|site|online|digital|group|club|members?|volunteer|donate|projects?|studio|labs?|ai|bot|test|user|users|name|me|we|all|everyone|staff|employees?)$/;
/** Words that make a compound local part ("contactinfo", "customersupport") an inbox. */
const COMPOUND = /^(?:hr|careers?|jobs|hiring|talent|recruit|info|contact|connect|team|support|admin|sales|press|media|business|office|mail|care|help|desk|trust|safety|social|legal|privacy|billing|accounts?|marketing|customers?|service|feedback|founders?|enquiry|enquiries|inquiry|query|hello|india|global|official|us)+$/;
/** "Co-founder@acme.com" in a profile headline is a job title, not a mailbox. */
const TITLE = /^(?:co-?founder|founder|ceo|cto|coo|cfo|cmo|cpo|chro|engineer|developer|designer|analyst|associate|consultant|intern|head|lead|vp|svp|avp|director|manager|president|partner|principal|architect|scientist|sde|swe|building|working)$/i;
const FOUNDER = /\b(?:co-?founder|founder|ceo|cto|building)\b/i;
const NOISE = /\.(?:png|jpe?g|gif|svg|webp)$|@(?:example|sentry|wixpress|domain|email)\.|^(?:name|you|your|user|email)@/i;
const EMAIL = /[a-z0-9][a-z0-9._%+-]*@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;
const FREEMAIL = /^(?:(?:gmail|googlemail|outlook|hotmail|live|msn|yahoo|ymail|rocketmail|proton|protonmail|icloud|aol|zoho|zohomail|rediffmail|rediff|gmx|yandex|fastmail|tutanota|tuta|mailinator)\.[a-z.]+|(?:me|mac|pm|hey|duck|mail|email|inbox|qq|163|126)\.com|pm\.me|hey\.com)$/;
/** Platforms whose addresses show up on company pages without being the company's. */
const PLATFORM = /(?:^|\.)(?:linkedin|lnkd|greenhouse|lever|ashbyhq|workable|naukri|indeed|wellfound|instahyre|cutshort|keka|zohorecruit|freshteam|darwinbox|google|googlegroups|apple|microsoft|facebook|instagram|twitter|x|youtube|github|notion|typeform|calendly|shopify|wix|squarespace|wordpress|razorpay|stripe)\.[a-z.]+$/;
const NOT_FOR_JOBS: (Purpose | null)[] = ["support", "grievance", "press", "sales", "legal"];
const PURPOSES: [Purpose, RegExp][] = [
  ["apply", /\b(?:cvs?|resumes?|résumés?|apply|applying|applications?|portfolio|showreel|interested|candidates?|profiles?|hiring|internships?|vacanc\w*|job|opening)\b/gi],
  ["grievance", /\b(?:grievances?|complaints?|nodal|escalat\w*|redressal)\b/gi],
  ["support", /\b(?:support|helpdesk|customer\s+care|quer(?:y|ies)|refunds?|orders?)\b/gi],
  ["press", /\b(?:press|media|journalists?)\b/gi],
  ["sales", /\b(?:sales|business\s+(?:enquir|inquir)\w*|partnerships?|demo|advertis\w*|collaborat\w*)\b/gi],
  ["legal", /\b(?:legal|privacy|data\s+protection|compliance)\b/gi],
  ["contact", /\b(?:contact|reach(?:\s+out)?|get\s+in\s+touch|write\s+to|email\s+us|mail\s+us|drop\s+(?:us\s+|me\s+)?an?\s+(?:e-?mail|mail|line|note)|more\s+information)\b/gi],
];

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};
const domainOf = (email: string) => email.slice(email.indexOf("@") + 1);
const localOf = (email: string) => email.slice(0, email.indexOf("@"));
/** Never a company's own mail domain: public mailbox providers. */
export const isFreemail = (domain: string) => FREEMAIL.test(domain.toLowerCase());

/** What the words just before an address say it is for: the nearest cue wins. */
function purposeOf(before: string): Purpose | null {
  const text = before.replace(EMAIL, " ");
  let best: { purpose: Purpose; at: number } | null = null;
  for (const [purpose, pattern] of PURPOSES) {
    for (const match of text.matchAll(pattern)) if (!best || match.index > best.at) best = { purpose, at: match.index };
  }
  return best?.purpose ?? null;
}

/** Finds addresses in page text, including "name [at] company [dot] com" forms, with surrounding words and a purpose hint. */
export function extractEmails(text: string) {
  const plain = text
    .replace(/\s*[\[(]\s*at\s*[\])]\s*/gi, "@")
    .replace(/\s*[\[(]\s*dot\s*[\])]\s*/gi, ".");
  const found = new Map<string, { evidence: string; purpose: Purpose | null }>();
  for (const match of plain.matchAll(EMAIL)) {
    const email = match[0].toLowerCase().replace(/\.+$/, "");
    const local = localOf(email);
    if (NOISE.test(email) || TITLE.test(local) || found.has(email)) continue;
    // In a profile headline ("**Name**: Growth@Acme.com | ..."), a capitalised word before @ is a title.
    const line = plain.slice(plain.lastIndexOf("\n", match.index) + 1, match.index);
    if (/^\*\*[^*\n]+\*\*:/.test(line) && /^\p{Lu}/u.test(match[0])) continue;
    const start = Math.max(0, match.index - 70);
    found.set(email, {
      evidence: plain.slice(start, match.index + match[0].length + 40).replace(/\s+/g, " ").trim(),
      purpose: purposeOf(plain.slice(Math.max(0, match.index - 110), match.index)),
    });
  }
  return [...found].map(([email, hit]) => ({ email, ...hit }));
}

const letters = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[^a-z]/g, "");
const firstName = (name: string) => letters(name.trim().split(/\s+/)[0]!);
const lastName = (name: string) => letters(name.trim().split(/\s+/).at(-1)!);
const validName = (name: string) => /^[\p{L}.' -]{3,40}$/u.test(name) && name.trim().includes(" ");
const sameName = (a: string, b: string) => firstName(a) === firstName(b) && lastName(a) === lastName(b);

/** Which naming pattern a known person's address follows, if it is a recognisable one. */
function patternOf(local: string, name: string) {
  const first = firstName(name);
  const last = lastName(name);
  if (!first) return null;
  if (local === first) return "first";
  if (last && last !== first) {
    if (local === `${first}.${last}`) return "first.last";
    if (local === `${first}${last}`) return "firstlast";
    if (local === `${first}_${last}`) return "first_last";
    if (local === `${first[0]}${last}`) return "flast";
    if (local === `${first}${last[0]}`) return "firstl";
  }
  return null;
}

const applyPattern = (pattern: string, name: string) => {
  const first = firstName(name);
  const last = lastName(name);
  return pattern === "first" ? first
    : pattern === "first.last" ? `${first}.${last}`
    : pattern === "firstlast" ? `${first}${last}`
    : pattern === "first_last" ? `${first}_${last}`
    : pattern === "firstl" ? `${first}${last[0]}`
    : `${first[0]}${last}`;
};

const inboxOf = (local: string): Contact["inbox"] => {
  const tokens = local.split(/[._+-]+/).filter(Boolean);
  if (tokens.some((t) => APPLICATION.test(t))) return "application";
  if (tokens.some((t) => FOUNDERS.test(t)) || FOUNDERS.test(local)) return "founders";
  if (tokens.some((t) => GENERAL.test(t)) || COMPOUND.test(local.replace(/[^a-z]/g, ""))) return "general";
  return null;
};

/** Two-part names written on a page ("Divyam Shah"), used to confirm that first.last@ is that person. */
const namesIn = (text: string) => [...new Set([...text.matchAll(/\p{Lu}\p{Ll}+(?:[ \t]+\p{Lu}\p{Ll}+){1,2}/gu)].map((m) => m[0]))].slice(0, 300);

/**
 * Person or shared inbox. A local part is a person only when it matches a known
 * name (poster, founder, or a name written on the same page) or has the plain
 * shape of a human name and no inbox word in it; everything else is an inbox.
 */
export function classifyLocal(local: string, known: string[] = [], pageNames: string[] = []): Pick<Contact, "kind" | "inbox" | "person"> {
  const strict = known.find((name) => patternOf(local, name));
  if (strict) return { kind: "person", inbox: null, person: strict };
  const inbox = inboxOf(local);
  const tokens = local.split(/[._+-]+/).filter(Boolean);
  // "tara.cv" is still Tara's own mailbox, whatever she uses it for.
  const loose = known.find((name) => tokens.some((t) => t.length >= 3 && (t === firstName(name) || t === lastName(name))));
  if (loose) return { kind: "person", inbox: null, person: loose };
  if (inbox) return { kind: "role", inbox, person: null };
  const written = pageNames.find((name) => ![null, "first"].includes(patternOf(local, name)));
  if (written) return { kind: "person", inbox: null, person: written };
  const humanShape = /^[a-z]{3,20}$/.test(local) || /^[a-z]{1,20}[._-][a-z]{2,20}$/.test(local) || /^[a-z]{2,15}[._][a-z]{1,15}[._][a-z]{2,15}$/.test(local);
  return humanShape && /[aeiouy]/.test(local) ? { kind: "person", inbox: null, person: null } : { kind: "role", inbox: "general", person: null };
}

const activityId = (url: string) => /activity[-:](\d{10,})/.exec(url)?.[1] ?? url;

/** The poster as LinkedIn shows them: "**Name**: headline" at the top of the post text. */
export function readPerson(company: string, post: HiringCheck["posts"][number], text: string): Person | null {
  const name = post.author?.trim();
  if (!name || !validName(name)) return null;
  // A company page posting under its own name is not a person.
  if (nameRegex(company).test(name)) return null;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headline = new RegExp(`\\*\\*${escaped}\\*\\*:\\s*([^\\n]{3,200})`).exec(text)?.[1]?.trim() ?? null;
  const vanity = /linkedin\.com\/posts\/([a-z0-9-]+)_/i.exec(post.url)?.[1];
  const founderLikely = headline ? FOUNDER.test(headline) && nameRegex(company).test(headline) : false;
  return {
    name,
    headline,
    profileUrl: vanity ? `https://www.linkedin.com/in/${vanity}` : null,
    postUrl: post.url,
    affiliated: headline ? nameRegex(company).test(headline) : false,
    founderLikely,
    founder: founderLikely || (post as { byFounder?: unknown }).byFounder === true,
  };
}

const TIER_LABEL: Record<Recommendation["tier"], string> = {
  "application-post": "published for applications in a recent hiring post",
  founder: "a founder's published address",
  "team-member": "a team member's published address",
  "application-inbox": "the company's applications inbox",
  "founders-inbox": "the founders' shared inbox",
  "verified-guess": "a pattern guess that a verifier reports as deliverable; never seen published",
};
const TIERS = Object.keys(TIER_LABEL) as Recommendation["tier"][];

export async function findContacts(check: HiringCheck, providers: ContactProviders, options: ContactOptions | Date = {}): Promise<ContactCheck> {
  const opts = options instanceof Date ? { now: options } : options;
  const site = check.website ? hostOf(check.website) || null : null;
  const result: ContactCheck = {
    key: check.key, company: check.company, domain: site, acceptsMail: null,
    mailDomains: site ? [{ domain: site, basis: "website", acceptsMail: null }] : [],
    recommended: null, contacts: [], people: [], guesses: [], failures: [], checkedAt: (opts.now ?? new Date()).toISOString(),
  };
  const attempt = async <T>(label: string, work: () => Promise<T>): Promise<T | null> => {
    try {
      return await work();
    } catch (error) {
      result.failures.push(`${label}: ${(error as Error).message.slice(0, 120)}`);
      return null;
    }
  };
  const name = nameRegex(check.company);
  const key = companyKey(check.company);
  const core = key.replace(/(?:ai|com)$/, "") || key;
  const resembles = (label: string) => core.length >= 4 && (label.includes(core) || (label.length >= 5 && core.includes(label)));
  const onDomain = (email: string) => result.mailDomains.some((d) => email.endsWith(`@${d.domain}`) || email.endsWith(`.${d.domain}`));
  const postOf = (url: string) => check.posts.find((p) => p.url === url || activityId(p.url) === activityId(url));
  /** Pages the company itself writes: its site, its company-page posts. */
  const companyControlled = (url: string) => {
    const host = hostOf(url);
    if (site && (host === site || host.endsWith(`.${site}`))) return true;
    const vanity = /linkedin\.com\/posts\/([a-z0-9-]+)_/i.exec(url)?.[1]?.replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (vanity && resembles(vanity) && !/\d{3,}$/.test(vanity)) return true;
    const author = postOf(url)?.author;
    return !!author && name.test(author) && !validPoster(author);
  };
  const validPoster = (author: string) => validName(author) && !name.test(author);

  // 1. The company's own hiring posts, careers page and website.
  type Raw = { email: string; evidence: string; purpose: Purpose | null; page: Page; own: boolean };
  const raws: Raw[] = [];
  const collect = (page: Page, own: boolean) => {
    for (const hit of extractEmails(`${page.title}\n${page.text}`)) if (!raws.some((r) => r.email === hit.email)) raws.push({ ...hit, page, own });
  };
  const own = [...check.posts.map((p) => p.url), check.careersUrl, check.website].filter((u): u is string => !!u);
  const pages = own.length ? (await attempt("read", () => providers.read(own))) ?? [] : [];
  for (const page of pages) collect(page, true);
  for (const post of check.posts) {
    const text = pages.find((p) => postOf(p.url) === post)?.text ?? post.excerpt;
    const person = readPerson(check.company, post, text);
    if (person && !result.people.some((p) => sameName(p.name, person.name))) result.people.push(person);
  }
  for (const founder of (opts.founders ?? []).map((f) => f.trim()).filter(validName).slice(0, 6)) {
    const known = result.people.find((p) => sameName(p.name, founder));
    if (known) Object.assign(known, { founder: true, affiliated: true });
    else result.people.push({ name: founder, headline: null, profileUrl: null, postUrl: null, affiliated: true, founderLikely: false, founder: true });
  }

  // 2. Mail domains other than the website's, learned from addresses the company itself published.
  const byDomain = new Map<string, Raw[]>();
  for (const raw of raws) {
    const domain = domainOf(raw.email);
    if (isFreemail(domain) || PLATFORM.test(domain) || onDomain(raw.email)) continue;
    byDomain.set(domain, [...(byDomain.get(domain) ?? []), raw]);
  }
  for (const [domain, hits] of byDomain) {
    const urls = new Set(hits.map((h) => h.page.url));
    const controlled = hits.filter((h) => companyControlled(h.page.url)).length;
    const basis = domain.split(".").slice(0, -1).some((label) => resembles(label.replace(/[^a-z0-9]/g, "")))
      ? `domain name resembles the company's; published at ${hits[0]!.page.url}`
      : hits.length >= 2 && (urls.size >= 2 || controlled >= 2)
        ? `${hits.length} addresses on this domain in the company's own posts and pages`
        : null;
    if (basis) result.mailDomains.push({ domain, basis, acceptsMail: null });
  }

  // 3. Addresses on the company's domains published anywhere else.
  const searchDomain = result.mailDomains[0]?.domain;
  if (searchDomain) {
    for (const page of (await attempt("search", () => providers.web(`"@${searchDomain}" ${check.company} email contact`))) ?? []) collect(page, companyControlled(page.url));
  }
  for (const entry of result.mailDomains.slice(0, 3)) entry.acceptsMail = await attempt(`mail ${entry.domain}`, () => providers.hasMail(entry.domain));
  result.acceptsMail = result.mailDomains[0]?.acceptsMail ?? null;

  // 4. Classify: person or inbox, whose, and where it was published.
  const known = result.people.map((p) => p.name);
  const pageNames = new Map<Page, string[]>();
  for (const raw of raws) {
    const companyDomain = onDomain(raw.email);
    // Pages the company controls may list any address; other pages count only for the company's domains.
    if (!raw.own && !companyDomain) continue;
    if (!pageNames.has(raw.page)) pageNames.set(raw.page, namesIn(raw.page.text));
    const poster = result.people.find((p) => p.postUrl && postOf(raw.page.url) === postOf(p.postUrl));
    // A name only vouches for an off-domain address in that person's own post.
    const sort = classifyLocal(localOf(raw.email), companyDomain ? known : poster ? [poster.name] : [], companyDomain ? pageNames.get(raw.page)! : []);
    const owner = result.people.find((p) => p.name === sort.person);
    if (owner && companyDomain) owner.affiliated = true;
    result.contacts.push({
      email: raw.email, ...sort, founder: owner?.founder ?? false, onCompanyDomain: companyDomain,
      source: raw.own ? "company" : "third-party", purpose: raw.purpose, sourceUrl: raw.page.url, evidence: raw.evidence, verification: null,
    });
  }
  for (const contact of result.contacts) {
    const poster = result.people.find((p) => p.postUrl && postOf(contact.sourceUrl) === postOf(p.postUrl));
    // An outsider's post about the company is not the company speaking.
    if (contact.source === "company" && !contact.onCompanyDomain && poster && !poster.affiliated) contact.source = "third-party";
  }

  // 5. Named people with no published address: ask the finder, then (only when asked) guess from the naming pattern.
  const mailCount = (domain: string) => result.contacts.filter((c) => c.kind === "person" && domainOf(c.email).endsWith(domain)).length;
  const target = [...result.mailDomains].filter((d) => d.acceptsMail !== false).sort((a, b) => mailCount(b.domain) - mailCount(a.domain))[0];
  const missing = () => result.people.filter((p) => (p.affiliated || p.founder) && !result.contacts.some((c) => c.person === p.name)).sort((a, b) => Number(b.founder) - Number(a.founder));
  const optedOut = new Set<string>();
  let hunterDown = false;
  const hunter = async <T>(label: string, work: () => Promise<T>) => {
    if (hunterDown) return null;
    const before = result.failures.length;
    const value = await attempt(label, work);
    hunterDown = result.failures.length > before;
    return value;
  };
  if (target && providers.findEmail) {
    for (const person of missing().slice(0, 3)) {
      const found = await hunter(`finder ${person.name}`, () => providers.findEmail!(person.name, target.domain));
      if (!found) continue;
      if ("optedOut" in found) {
        optedOut.add(person.name);
        continue;
      }
      const email = found.email.toLowerCase();
      if (!onDomain(email) || result.contacts.some((c) => c.email === email)) continue;
      if (found.sources.length) {
        result.contacts.push({
          email, kind: "person", inbox: null, person: person.name, founder: person.founder, onCompanyDomain: true, source: "hunter", purpose: null,
          sourceUrl: found.sources[0]!, verification: found.verification,
          evidence: `Hunter Email Finder: seen on ${found.sources.length} public page${found.sources.length > 1 ? "s" : ""}${found.score === null ? "" : `, confidence ${found.score}`}; not read by this tool`,
        });
      } else if (opts.guesses) {
        result.guesses.push({ person: person.name, email, founder: person.founder, verification: found.verification, basis: `Hunter Email Finder inference${found.score === null ? "" : `, confidence ${found.score}`}; no public source` });
      }
    }
  }
  if (target && opts.guesses) {
    let pattern: { name: string; example: string } | null = null;
    const persons = result.contacts.filter((c) => c.kind === "person" && c.onCompanyDomain && c.source !== "hunter");
    for (const contact of persons) {
      const shape = contact.person ? patternOf(localOf(contact.email), contact.person) : null;
      if (shape) pattern ??= { name: shape, example: contact.email };
    }
    // No named example: fall back to the shape other people's addresses at the company share.
    if (!pattern) {
      const shape = (test: RegExp) => persons.map((c) => c.email).filter((email) => test.test(localOf(email)));
      const single = shape(/^[a-z]{3,}$/);
      const dotted = shape(/^[a-z]+\.[a-z]+$/);
      if (single.length && single.length >= dotted.length) pattern = { name: "first", example: single[0]! };
      else if (dotted.length) pattern = { name: "first.last", example: dotted[0]! };
    }
    for (const person of missing().filter((p) => !optedOut.has(p.name) && !result.guesses.some((g) => g.person === p.name))) {
      for (const shape of pattern ? [pattern.name] : ["first", "first.last"]) {
        const local = applyPattern(shape, person.name);
        if (local.length < 2) continue;
        result.guesses.push({
          person: person.name, email: `${local}@${target.domain}`, founder: person.founder, verification: null,
          basis: pattern ? `same pattern as ${pattern.example}` : "common naming pattern; no example found",
        });
      }
    }
    if (providers.verify) {
      for (const guess of result.guesses.slice(0, 6)) guess.verification ??= await hunter(`verify ${guess.email}`, () => providers.verify!(guess.email));
      // A guess the verifier rejects, or whose owner opted out, is not offered at all.
      result.guesses = result.guesses.filter((g) => !["invalid", "opted_out", "disposable"].includes(g.verification?.status ?? ""));
    }
  }

  // 6. One recommendation, by how directly the company offered the address for applications.
  const tierOf = (c: Contact): Recommendation["tier"] | null => {
    const post = postOf(c.sourceUrl);
    const poster = result.people.find((p) => p.postUrl && post === postOf(p.postUrl));
    if (post && (c.purpose === "apply" || c.purpose === "contact") && (c.onCompanyDomain || poster?.affiliated || (!poster && companyControlled(c.sourceUrl)))) return "application-post";
    if (!c.onCompanyDomain || NOT_FOR_JOBS.includes(c.purpose)) return null;
    if (c.kind === "person") return c.founder ? "founder" : "team-member";
    return c.inbox === "application" ? "application-inbox" : c.inbox === "founders" ? "founders-inbox" : null;
  };
  const posted = (c: Contact) => postOf(c.sourceUrl)?.publishedDate ?? "";
  const ranked = result.contacts
    .flatMap((contact) => {
      const tier = tierOf(contact);
      return tier ? [{ contact, tier }] : [];
    })
    .sort((a, b) =>
      Number(a.contact.source !== "company") - Number(b.contact.source !== "company")
      || TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier)
      || Number(b.contact.founder) - Number(a.contact.founder)
      || Number(!!b.contact.person) - Number(!!a.contact.person)
      || posted(b.contact).localeCompare(posted(a.contact)));
  let verified = 0;
  for (const { contact, tier } of ranked) {
    if (opts.verifyFound && providers.verify && !contact.verification && verified < 3) {
      contact.verification = await hunter(`verify ${contact.email}`, () => providers.verify!(contact.email));
      verified++;
    }
    if (["invalid", "opted_out", "disposable"].includes(contact.verification?.status ?? "")) continue;
    const thirdParty = contact.source !== "company";
    const who = contact.person ? `${contact.person}${contact.founder ? " (founder)" : ""}: ` : "";
    const where = tier === "application-post" && posted(contact) ? ` (post of ${posted(contact).slice(0, 10)})` : "";
    result.recommended = {
      email: contact.email, tier, thirdParty, sourceUrl: contact.sourceUrl,
      reason: `${who}${TIER_LABEL[tier]}${where}`
        + (tier === "founder" || tier === "team-member" ? `; not published specifically for applications${contact.purpose ? ` (the page offers it for: ${contact.purpose})` : ""}` : "")
        + (thirdParty ? `; seen only on ${contact.source === "hunter" ? "pages indexed by Hunter" : `a third-party page (${hostOf(contact.sourceUrl)})`}, not published by the company itself` : "")
        + (contact.verification ? `; verifier: ${contact.verification.status}` : ""),
    };
    break;
  }
  if (!result.recommended) {
    const guess = result.guesses.find((g) => g.verification?.status === "valid");
    if (guess) result.recommended = { email: guess.email, tier: "verified-guess", thirdParty: false, sourceUrl: null, reason: `${guess.person}${guess.founder ? " (founder)" : ""}: ${TIER_LABEL["verified-guess"]} (${guess.basis})` };
  }
  result.people.sort((a, b) => Number(b.founder) - Number(a.founder) || Number(b.affiliated) - Number(a.affiliated));
  return result;
}

/** A plain GET returning the status and parsed JSON body (null when the body is not JSON). */
export type HttpGet = (url: string, headers?: Record<string, string>) => Promise<{ status: number; body: unknown }>;

const DOH = [
  (domain: string) => `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=MX`,
  (domain: string) => `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`,
];

/**
 * MX lookup over HTTPS, for networks where plain DNS is blocked. true: the
 * domain lists a mail server. false: it does not exist, lists none, or refuses
 * mail ("0 ."). null: no resolver gave a usable answer.
 */
export async function mxOverHttps(domain: string, get: HttpGet): Promise<boolean | null> {
  for (const url of DOH) {
    try {
      const { status, body } = await get(url(domain), { accept: "application/dns-json" });
      const answer = body as { Status?: unknown; Answer?: { type?: unknown; data?: unknown }[] } | null;
      if (status !== 200 || !answer || typeof answer.Status !== "number") continue;
      if (answer.Status === 3) return false;
      if (answer.Status !== 0) continue;
      const servers = (Array.isArray(answer.Answer) ? answer.Answer : []).filter((r) => r?.type === 15 && typeof r.data === "string").map((r) => String(r.data).trim().split(/\s+/).at(-1)!);
      return servers.some((server) => server !== "." && server !== "");
    } catch {
      // Try the next resolver.
    }
  }
  return null;
}

const STATUSES: Verification["status"][] = ["valid", "invalid", "accept_all", "webmail", "disposable", "unknown"];
const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

function hunterVerification(data: any): Verification | null {
  const status = STATUSES.find((s) => s === data?.status);
  if (!status) return null;
  const date = data?.verification?.date ?? data?.date;
  return { status, score: number(data?.score), by: "hunter", checkedAt: typeof date === "string" ? date : null };
}

/**
 * Hunter.io v2 Email Verifier and Email Finder (https://hunter.io/api-documentation/v2).
 * The key travels in the X-API-KEY header, never in a URL.
 */
export function hunterProviders(apiKey: string, get: HttpGet, wait: (ms: number) => Promise<unknown> = (ms) => Bun.sleep(ms)): Required<Pick<ContactProviders, "verify" | "findEmail">> {
  const headers = { "X-API-KEY": apiKey };
  const fail = (status: number, body: unknown) => new Error(`HUNTER_${status} ${String((body as any)?.errors?.[0]?.id ?? "").slice(0, 40)}`.trim());
  return {
    async verify(email) {
      const url = `https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(email)}`;
      // 202: still running; the same request again collects the result and is not charged twice.
      for (let tries = 0; tries < 3; tries++) {
        const { status, body } = await get(url, headers);
        if (status === 202) {
          await wait(4000);
          continue;
        }
        if (status === 451) return { status: "opted_out", score: null, by: "hunter", checkedAt: null };
        // 222: the remote mail server gave an unexpected answer; Hunter could not tell.
        if (status === 222) return { status: "unknown", score: null, by: "hunter", checkedAt: null };
        if (status !== 200) throw fail(status, body);
        return hunterVerification((body as any)?.data);
      }
      return null;
    },
    async findEmail(name, domain) {
      const parts = name.trim().split(/\s+/);
      const query = new URLSearchParams({ domain, first_name: parts[0]!, last_name: parts.slice(1).join(" ") || parts[0]! });
      const { status, body } = await get(`https://api.hunter.io/v2/email-finder?${query}`, headers);
      if (status === 451) return { optedOut: true };
      if (status !== 200) throw fail(status, body);
      const data = (body as any)?.data;
      const email = typeof data?.email === "string" ? data.email.trim().toLowerCase() : "";
      if (!new RegExp(`^${EMAIL.source}$`, "i").test(email)) return null;
      const sources = (Array.isArray(data.sources) ? data.sources : []).map((s: any) => s?.uri).filter((uri: unknown): uri is string => typeof uri === "string" && /^https?:\/\//.test(uri));
      return { email, score: number(data.score), sources: sources.slice(0, 20), verification: hunterVerification(data.verification) && { ...hunterVerification(data.verification)!, score: number(data.score) } };
    },
  };
}

const verdict = (v: Verification | null | undefined) =>
  !v ? "" : v.status === "valid" ? "  [verifier: deliverable]"
    : v.status === "invalid" ? "  [verifier: UNDELIVERABLE, do not use]"
    : v.status === "opted_out" ? "  [owner asked not to be contacted through lookups, do not use]"
    : v.status === "accept_all" ? "  [verifier: server accepts anything, cannot confirm]"
    : `  [verifier: ${v.status}]`;

/** The report for one company. Guesses are left out unless asked for, and are always labelled. */
export function formatContacts(c: ContactCheck, options: { guesses?: boolean } = {}): string {
  const domains = c.mailDomains ?? (c.domain ? [{ domain: c.domain, basis: "website", acceptsMail: c.acceptsMail }] : []);
  const mail = (d: MailDomain) => `${d.domain}: ${d.acceptsMail === true ? "accepts mail" : d.acceptsMail === false ? "DOES NOT accept mail" : "mail server not checked"}`;
  const lines = [`\n## ${c.company}  (${domains.length ? domains.map(mail).join("; ") : "no website"})`];
  for (const d of domains.filter((d) => d.basis !== "website")) lines.push(`  also the company's mail domain: ${d.domain} (${d.basis})`);
  lines.push(c.recommended
    ? `  RECOMMENDED: ${c.recommended.email}\n    why: ${c.recommended.reason}${c.recommended.sourceUrl ? `\n    seen at ${c.recommended.sourceUrl}` : ""}`
    : "  RECOMMENDED: none (no address published for applications, by a founder or team member, or as a careers inbox)");
  for (const contact of c.contacts) {
    const label = contact.kind === "person" ? `${contact.person ?? "person (name not confirmed)"}${contact.founder ? " [founder]" : ""}`
      : contact.inbox === "application" ? "applications inbox" : contact.inbox === "founders" ? "founders inbox" : "team inbox";
    const notes = [
      contact.purpose ? `for: ${contact.purpose}` : "",
      contact.onCompanyDomain ? "" : "not the company's domain",
      contact.source === "third-party" ? "third-party page" : contact.source === "hunter" ? "from Hunter's index" : "",
    ].filter(Boolean);
    lines.push(`  ${label}: ${contact.email}${notes.length ? `  (${notes.join("; ")})` : ""}${verdict(contact.verification)}\n    seen at ${contact.sourceUrl}\n    "${contact.evidence}"`);
  }
  for (const person of c.people) {
    const tag = person.founder ?? person.founderLikely ? "founder/exec" : person.affiliated ? "works there" : "affiliation not shown";
    lines.push(`  ${person.postUrl ? "poster" : "founder (from funding news)"}: ${person.name} [${tag}] — ${person.headline ?? "no headline"}${person.profileUrl ?? person.postUrl ? `\n    ${person.profileUrl ?? person.postUrl}` : ""}`);
  }
  if (options.guesses) {
    for (const guess of c.guesses) {
      const state = guess.verification?.status === "valid" ? "GUESS, never seen published (verifier: deliverable)" : "UNVERIFIED guess";
      lines.push(`  ${state} for ${guess.person}: ${guess.email}  (${guess.basis})${guess.verification?.status === "valid" ? "" : verdict(guess.verification)}`);
    }
  }
  if (!c.contacts.length && !c.people.length) lines.push("  nothing published");
  for (const failure of c.failures) lines.push(`  failed: ${failure}`);
  return lines.join("\n");
}

export class ContactStore {
  private db: Database;

  /** Path: the argument, else CONTACTS_DB, else the shared .data/radar.db. */
  constructor(path = process.env.CONTACTS_DB?.trim() || ".data/radar.db") {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.exec("CREATE TABLE IF NOT EXISTS contacts(key TEXT PRIMARY KEY,data TEXT NOT NULL,checked TEXT NOT NULL)");
  }

  save(check: ContactCheck) {
    this.db.prepare("INSERT INTO contacts VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,checked=excluded.checked")
      .run(check.key, JSON.stringify(check), check.checkedAt);
  }

  all() {
    return (this.db.prepare("SELECT data FROM contacts ORDER BY checked DESC").all() as { data: string }[]).map((row) => JSON.parse(row.data) as ContactCheck);
  }

  close() {
    this.db.close();
  }
}
