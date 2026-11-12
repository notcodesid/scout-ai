// Contact finder: `bun run contacts [--limit 20] [--company "Name"] [--all]`
// For companies the hiring check found evidence for: list addresses published on
// their own pages and posts, and the people who posted. Read-only; sends nothing.
import Exa from "exa-js";
import { resolveMx } from "node:dns/promises";
import { publicURL } from "../research/contracts.ts";
import { companyKey } from "../radar/contracts.ts";
import { HiringStore, hiringScore } from "./check.ts";
import { ContactStore, findContacts, type ContactCheck, type ContactProviders } from "./contacts.ts";
import type { Page } from "./contracts.ts";

let dnsWorks: Promise<boolean> | undefined;

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
  return {
    read: async (urls) => pages(await exa.getContents(urls, { text })),
    web: async (query) => pages(await exa.search(query, { numResults: 5, contents: { text } })),
    async hasMail(domain) {
      // Some environments block DNS entirely; a failed lookup only means "no mail" if DNS works at all.
      dnsWorks ??= resolveMx("gmail.com").then((records) => records.length > 0, () => false);
      if (!(await dnsWorks)) return null;
      try {
        return (await resolveMx(domain)).length > 0;
      } catch (error) {
        return ["ENODATA", "ENOTFOUND"].includes((error as { code?: string }).code ?? "") ? false : null;
      }
    },
  };
}

const args = process.argv.slice(2);
const value = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const limit = Number(value("--limit") ?? 20);
if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("--limit must be between 1 and 100");

const print = (c: ContactCheck) => {
  console.log(`\n## ${c.company}  (${c.domain ?? "no website"}${c.acceptsMail === false ? ", domain does not accept mail" : c.acceptsMail === null && c.domain ? ", mail server not checked" : ""})`);
  for (const contact of c.contacts) {
    console.log(`  ${contact.kind === "role" ? "team inbox" : contact.person ?? "person"}: ${contact.email}${contact.onCompanyDomain ? "" : "  (not the company's domain)"}\n    seen at ${contact.sourceUrl}\n    "${contact.evidence}"`);
  }
  for (const person of c.people) {
    console.log(`  poster: ${person.name}${person.founderLikely ? " [founder/exec]" : person.affiliated ? " [works there]" : " [affiliation not shown]"} — ${person.headline ?? "no headline"}\n    ${person.profileUrl ?? person.postUrl}`);
  }
  for (const guess of c.guesses) console.log(`  UNVERIFIED guess for ${guess.person}: ${guess.email}  (${guess.basis})`);
  if (!c.contacts.length && !c.people.length) console.log("  nothing published");
  for (const failure of c.failures) console.log(`  failed: ${failure}`);
};

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
  const results: ContactCheck[] = [];
  for (const check of checks) {
    const result = await findContacts(check, providers);
    store.save(result);
    results.push(result);
    console.error(`checked ${result.company}: ${result.contacts.length} addresses, ${result.people.length} people`);
  }
  results.forEach(print);
  await Bun.write(".data/contacts-latest.json", JSON.stringify(results, null, 2));
  console.log("\nFull result: .data/contacts-latest.json");
}
store.close();
