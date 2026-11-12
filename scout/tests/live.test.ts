// Opt-in live smoke test. Skipped unless RUN_LIVE=1 and EXA_API_KEY are set:
//   RUN_LIVE=1 EXA_API_KEY=... bun test tests/live.test.ts
// One real hiring check (4 Exa requests, no page reads) and one contact lookup
// (2 Exa requests) for a single company. It asserts the shape of the result
// only: what the live web says changes daily. Stores are in memory; nothing is sent.
import { expect, test } from "bun:test";
import { HiringStore, checkHiring, hiringScore } from "../src/hiring/check.ts";
import { liveContactProviders } from "../src/hiring/contact-providers.ts";
import { ContactStore, findContacts } from "../src/hiring/contacts.ts";
import { liveHiringProviders } from "../src/hiring/providers.ts";
import { buildDigest, formatDigest } from "../src/daily/digest.ts";
import { NO_FIT } from "../src/daily/fit.ts";
import { companyKey, type FundedCompany } from "../src/radar/contracts.ts";

const live = process.env.RUN_LIVE === "1" && !!process.env.EXA_API_KEY?.trim();
const company = process.env.LIVE_COMPANY?.trim() || "Venttup";

test.skipIf(!live)("live: one hiring check and one contact lookup return well-formed results", async () => {
  const check = await checkHiring({ company }, liveHiringProviders(), { days: 30, readPages: false });
  expect(check.key).toBe(companyKey(company));
  expect(check.failures).toEqual([]);
  expect(check.website === null || /^https:\/\//.test(check.website)).toBe(true);
  expect(Array.isArray(check.posts)).toBe(true);
  for (const post of check.posts) {
    expect(post.url).toMatch(/^https:\/\//);
    expect(typeof post.fresh).toBe("boolean");
    expect(post.reactions === null || Number.isInteger(post.reactions)).toBe(true);
  }
  expect(hiringScore(check)).toBeGreaterThanOrEqual(0);
  const hiring = new HiringStore(":memory:");
  hiring.save(check);
  expect(hiring.get(check.key)?.company).toBe(company);

  const contact = await findContacts(check, liveContactProviders());
  expect(contact.key).toBe(check.key);
  expect(Array.isArray(contact.contacts)).toBe(true);
  expect(contact.guesses).toEqual([]);
  for (const found of contact.contacts) {
    expect(found.email).toMatch(/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/);
    expect(found.sourceUrl).toMatch(/^https?:\/\//);
  }
  if (contact.recommended) {
    expect(contact.contacts.some((c) => c.email === contact.recommended!.email)).toBe(true);
    expect(contact.recommended.reason.length).toBeGreaterThan(0);
  }
  const contacts = new ContactStore(":memory:");
  contacts.save(contact);
  expect(contacts.all()).toHaveLength(1);

  const funded: FundedCompany = {
    company, whatItDoes: null, stage: "unknown", amount: null, investors: [], founders: [], sector: "other", announcedOn: null, city: null, website: null,
    quote: "", key: check.key, sourceUrl: "https://example.com/", sourceTitle: "", publishedDate: null,
  };
  const text = formatDigest(buildDigest({ companies: [funded], checks: [check], contacts: [contact], fit: NO_FIT }));
  expect(text).toContain(company);
}, 180_000);
