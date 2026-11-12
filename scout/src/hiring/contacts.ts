import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { nameRegex, type HiringCheck, type Page } from "./contracts.ts";

export interface ContactProviders {
  /** Full text of specific pages (hiring posts, careers page, website). */
  read(urls: string[]): Promise<Page[]>;
  /** Open web search, used to find addresses published elsewhere. */
  web(query: string): Promise<Page[]>;
  /** Whether the domain accepts mail (MX record). null when it cannot be determined. */
  hasMail(domain: string): Promise<boolean | null>;
}

/** An address that appears verbatim on a public page. */
export type Contact = {
  email: string;
  kind: "person" | "role";
  person: string | null;
  onCompanyDomain: boolean;
  sourceUrl: string;
  evidence: string;
};
/** Someone who posted about hiring at the company. */
export type Person = { name: string; headline: string | null; profileUrl: string | null; postUrl: string; affiliated: boolean; founderLikely: boolean };
/** An address inferred from a naming pattern. Never seen on a page; unverified. */
export type Guess = { person: string; email: string; basis: string };

export type ContactCheck = {
  key: string;
  company: string;
  domain: string | null;
  acceptsMail: boolean | null;
  contacts: Contact[];
  people: Person[];
  guesses: Guess[];
  failures: string[];
  checkedAt: string;
};

const ROLE = /^(?:careers?|jobs?|hr|hiring|hello|hi|hey|info|contact|connect|team|support|founders?|recruit\w*|talent|people|admin|sales|press|media|business|partnerships?|office|mail|enquir\w*|inquir\w*|care|help|work|trust|grievance|social|contactinfo|legal|privacy|compliance|billing|accounts?|marketing|pr|partners|invest\w*|ir|noreply|no-reply)$/i;
/** "Co-founder@acme.com" in a profile headline is a job title, not a mailbox. */
const TITLE = /^(?:co-?founder|founder|ceo|cto|coo|cfo|engineer|intern|head|vp|director|manager)$/i;
const FOUNDER = /\b(?:co-?founder|founder|ceo|cto|building)\b/i;
const NOISE = /\.(?:png|jpe?g|gif|svg|webp)$|@(?:example|sentry|wixpress|domain|email)\.|^(?:name|you|your|user|email)@/i;
const EMAIL = /[a-z0-9][a-z0-9._%+-]*@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;

/** Finds addresses in page text, including "name [at] company [dot] com" forms, with surrounding words. */
export function extractEmails(text: string) {
  const plain = text
    .replace(/\s*[\[(]\s*at\s*[\])]\s*/gi, "@")
    .replace(/\s*[\[(]\s*dot\s*[\])]\s*/gi, ".");
  const found = new Map<string, string>();
  for (const match of plain.matchAll(EMAIL)) {
    const email = match[0].toLowerCase().replace(/\.+$/, "");
    if (NOISE.test(email) || TITLE.test(email.split("@")[0]!) || found.has(email)) continue;
    const start = Math.max(0, match.index - 70);
    found.set(email, plain.slice(start, match.index + match[0].length + 40).replace(/\s+/g, " ").trim());
  }
  return [...found].map(([email, evidence]) => ({ email, evidence }));
}

const firstName = (name: string) => name.trim().split(/\s+/)[0]!.toLowerCase().replace(/[^a-z]/g, "");
const lastName = (name: string) => name.trim().split(/\s+/).at(-1)!.toLowerCase().replace(/[^a-z]/g, "");

/** Which naming pattern a known person's address follows, if it is a recognisable one. */
function patternOf(local: string, name: string) {
  const first = firstName(name);
  const last = lastName(name);
  if (!first) return null;
  if (local === first) return "first";
  if (last && last !== first) {
    if (local === `${first}.${last}`) return "first.last";
    if (local === `${first}${last}`) return "firstlast";
    if (local === `${first[0]}${last}`) return "flast";
  }
  return null;
}

const applyPattern = (pattern: string, name: string) => {
  const first = firstName(name);
  const last = lastName(name);
  return pattern === "first" ? first : pattern === "first.last" ? `${first}.${last}` : pattern === "firstlast" ? `${first}${last}` : `${first[0]}${last}`;
};

/** The poster as LinkedIn shows them: "**Name**: headline" at the top of the post text. */
export function readPerson(company: string, post: HiringCheck["posts"][number], text: string): Person | null {
  const name = post.author?.trim();
  if (!name || !/^[\p{L}.' -]{3,40}$/u.test(name) || !name.includes(" ")) return null;
  // A company page posting under its own name is not a person.
  if (nameRegex(company).test(name)) return null;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headline = new RegExp(`\\*\\*${escaped}\\*\\*:\\s*([^\\n]{3,200})`).exec(text)?.[1]?.trim() ?? null;
  const vanity = /linkedin\.com\/posts\/([a-z0-9-]+)_/i.exec(post.url)?.[1];
  return {
    name,
    headline,
    profileUrl: vanity ? `https://www.linkedin.com/in/${vanity}` : null,
    postUrl: post.url,
    affiliated: headline ? nameRegex(company).test(headline) : false,
    founderLikely: headline ? FOUNDER.test(headline) && nameRegex(company).test(headline) : false,
  };
}

export async function findContacts(check: HiringCheck, providers: ContactProviders, now = new Date()): Promise<ContactCheck> {
  const domain = check.website ? new URL(check.website).hostname.replace(/^www\./, "").toLowerCase() : null;
  const result: ContactCheck = { key: check.key, company: check.company, domain, acceptsMail: null, contacts: [], people: [], guesses: [], failures: [], checkedAt: now.toISOString() };
  const attempt = async <T>(label: string, work: () => Promise<T>): Promise<T | null> => {
    try {
      return await work();
    } catch (error) {
      result.failures.push(`${label}: ${(error as Error).message.slice(0, 120)}`);
      return null;
    }
  };
  const onDomain = (email: string) => !!domain && (email.endsWith(`@${domain}`) || email.endsWith(`.${domain}`));
  const add = (page: Page, trusted: boolean) => {
    for (const { email, evidence } of extractEmails(`${page.title}\n${page.text}`)) {
      // Pages the company controls may list any address; other pages count only for the company's domain.
      if (!(trusted || onDomain(email)) || result.contacts.some((c) => c.email === email)) continue;
      result.contacts.push({ email, kind: ROLE.test(email.split("@")[0]!) ? "role" : "person", person: null, onCompanyDomain: onDomain(email), sourceUrl: page.url, evidence });
    }
  };

  // 1. The company's own hiring posts, careers page and website.
  const own = [...check.posts.map((p) => p.url), check.careersUrl, check.website].filter((u): u is string => !!u);
  const pages = own.length ? (await attempt("read", () => providers.read(own))) ?? [] : [];
  for (const page of pages) add(page, true);
  for (const post of check.posts) {
    const text = pages.find((p) => p.url === post.url)?.text ?? post.excerpt;
    const person = readPerson(check.company, post, text);
    if (person && !result.people.some((p) => p.name === person.name)) result.people.push(person);
  }

  // 2. Addresses on the company's domain published anywhere else.
  if (domain) {
    for (const page of (await attempt("search", () => providers.web(`"@${domain}" ${check.company} email contact`))) ?? []) add(page, false);
    result.acceptsMail = await attempt("mail", () => providers.hasMail(domain));
  }

  // 3. Attach names to addresses, then infer addresses for affiliated people who have none.
  let pattern: { name: string; example: string } | null = null;
  for (const contact of result.contacts.filter((c) => c.kind === "person" && c.onCompanyDomain)) {
    const local = contact.email.split("@")[0]!;
    const owner = result.people.find((p) => patternOf(local, p.name));
    if (!owner) continue;
    contact.person = owner.name;
    pattern ??= { name: patternOf(local, owner.name)!, example: contact.email };
  }
  // No named example: fall back to the shape other people's addresses at the company share.
  if (!pattern) {
    const others = result.contacts.filter((c) => c.kind === "person" && c.onCompanyDomain).map((c) => c.email);
    const shape = (test: RegExp) => others.filter((email) => test.test(email.split("@")[0]!));
    const single = shape(/^[a-z]{3,}$/);
    const dotted = shape(/^[a-z]+\.[a-z]+$/);
    if (single.length && single.length >= dotted.length) pattern = { name: "first", example: single[0]! };
    else if (dotted.length) pattern = { name: "first.last", example: dotted[0]! };
  }
  if (domain && result.acceptsMail !== false) {
    for (const person of result.people.filter((p) => p.affiliated && !result.contacts.some((c) => c.person === p.name))) {
      const patterns = pattern ? [pattern.name] : ["first", "first.last"];
      for (const name of patterns) {
        const local = applyPattern(name, person.name);
        if (local.length < 2) continue;
        result.guesses.push({
          person: person.name,
          email: `${local}@${domain}`,
          basis: pattern ? `same pattern as ${pattern.example}` : "common naming pattern; no example found",
        });
      }
    }
  }
  result.people.sort((a, b) => Number(b.founderLikely) - Number(a.founderLikely) || Number(b.affiliated) - Number(a.affiliated));
  return result;
}

export class ContactStore {
  private db: Database;

  constructor(path = ".data/radar.db") {
    if (path !== ":memory:") mkdirSync(".data", { recursive: true });
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
