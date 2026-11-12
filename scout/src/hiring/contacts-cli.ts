// Contact finder: `bun run contacts [--limit 20] [--company "Name"] [--all] [--guesses] [--verify]`
// For companies the hiring check found evidence for: list addresses published on
// their own pages and posts, the people who posted, and the one address best
// suited to an application. Read-only; sends nothing.
//   --guesses  also offer pattern guesses for people with no published address (unverified; off by default)
//   --verify   with HUNTER_API_KEY: also verify the published address that would be recommended
// Env: EXA_API_KEY (required), HUNTER_API_KEY (optional: Email Finder + Verifier), CONTACTS_DB (store path).
import Exa from "exa-js";
import { resolveMx } from "node:dns/promises";
import { publicURL } from "../research/contracts.ts";
import { companyKey } from "../radar/contracts.ts";
import { RadarStore } from "../radar/radar.ts";
import { HiringStore, hiringScore } from "./check.ts";
import { ContactStore, findContacts, formatContacts, hunterProviders, mxOverHttps, type ContactCheck, type ContactProviders, type HttpGet } from "./contacts.ts";
import type { Page } from "./contracts.ts";

let dnsWorks: Promise<boolean> | undefined;

const get: HttpGet = async (url, headers) => {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  return { status: response.status, body: await response.json().catch(() => null) };
};

function liveContactProviders(): ContactProviders {
  if (!process.env.EXA_API_KEY?.trim()) throw new Error("EXA_API_KEY_REQUIRED");
  const exa = new Exa(process.env.EXA_API_KEY);
  const text = { maxCharacters: 6000 };
  const pages = (response: { results: any[] }): Page[] =>
    response.results.flatMap((r): Page[] => {
      try {
        return [{ url: publicURL(r.url), title: r.title || r.url, publishedDate: r.publishedDate ?? null, text: r.text ?? "", links: [] }];
      } catch {
        return [];
      }
    });
  const hunterKey = process.env.HUNTER_API_KEY?.trim();
  return {
    read: async (urls) => pages(await exa.getContents(urls, { text })),
    web: async (query) => pages(await exa.search(query, { numResults: 5, contents: { text } })),
    async hasMail(domain) {
      // Plain DNS first; where the network blocks it, ask a public resolver over HTTPS instead.
      dnsWorks ??= resolveMx("gmail.com").then((records) => records.length > 0, () => false);
      if (await dnsWorks) {
        try {
          return (await resolveMx(domain)).some((record) => record.exchange && record.exchange !== ".");
        } catch (error) {
          if (["ENODATA", "ENOTFOUND"].includes((error as { code?: string }).code ?? "")) return false;
        }
      }
      return mxOverHttps(domain, get);
    },
    ...(hunterKey ? hunterProviders(hunterKey, get) : {}),
  };
}

/** Founder names the funding radar recorded for a company, if it records any. */
function radarFounders(): Map<string, string[]> {
  const founders = new Map<string, string[]>();
  try {
    const radar = new RadarStore();
    for (const company of radar.all()) {
      const names = (company as { founders?: unknown }).founders;
      if (Array.isArray(names)) founders.set(company.key, names.filter((n): n is string => typeof n === "string"));
    }
    radar.close();
  } catch {
    // No radar data: founders stay unknown.
  }
  return founders;
}

const args = process.argv.slice(2);
const value = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const limit = Number(value("--limit") ?? 20);
if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("--limit must be between 1 and 100");
const guesses = args.includes("--guesses");
const print = (c: ContactCheck) => console.log(formatContacts(c, { guesses }));

const store = new ContactStore();
if (args.includes("--all")) store.all().forEach(print);
else {
  const hiring = new HiringStore();
  const only = value("--company");
  const checks = hiring.all()
    .filter((c) => (only ? c.key === companyKey(only) : hiringScore(c) > 0))
    .sort((a, b) => hiringScore(b) - hiringScore(a))
    .slice(0, limit);
  hiring.close();
  if (!checks.length) console.log("No hiring checks to work from. Run `bun run hiring` first.");
  const providers = liveContactProviders();
  const founders = radarFounders();
  const results: ContactCheck[] = [];
  for (const check of checks) {
    const result = await findContacts(check, providers, { founders: founders.get(check.key), guesses, verifyFound: args.includes("--verify") });
    store.save(result);
    results.push(result);
    console.error(`checked ${result.company}: ${result.contacts.length} addresses, ${result.people.length} people`);
  }
  results.forEach(print);
  if (!guesses) console.log("\nPattern guesses are off. Add --guesses to see them (unverified unless HUNTER_API_KEY is set).");
  // A test store keeps its JSON beside it, so .data/ is left alone.
  const latest = process.env.CONTACTS_DB?.trim() ? `${process.env.CONTACTS_DB.trim()}.latest.json` : ".data/contacts-latest.json";
  await Bun.write(latest, JSON.stringify(results, null, 2));
  console.log(`Full result: ${latest}`);
}
store.close();
