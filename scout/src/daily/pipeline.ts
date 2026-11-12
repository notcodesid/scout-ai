// The daily run: funding radar -> hiring check -> contact finder -> digest.
// It only strings together the three existing tools and their stores. Each stage
// is isolated: one failing (a spent model quota, a missing key) never loses the
// others, which carry on with the companies already stored.
import { existsSync } from "node:fs";
import { HiringStore, checkHiring, hiringScore, type CheckOptions, type HiringProviders } from "../hiring/check.ts";
import { ContactStore, findContacts, type ContactCheck, type ContactProviders } from "../hiring/contacts.ts";
import type { HiringCheck, Target } from "../hiring/contracts.ts";
import type { FundedCompany } from "../radar/contracts.ts";
import { RadarStore, runRadar, type RadarProviders } from "../radar/radar.ts";
import { buildDigest, type Digest } from "./digest.ts";
import { NO_FIT, resolveFit, scoreFit, type Fit } from "./fit.ts";
import type { Draft } from "../interview.ts";

export type DailyStores = { radar: RadarStore; hiring: HiringStore; contacts: ContactStore };

/** Providers are built only when their stage starts, so a missing key fails that stage alone. */
export type DailyProviders = {
  radar: () => RadarProviders;
  hiring: () => HiringProviders;
  contacts: () => ContactProviders;
};

export type DailyOptions = {
  fit: Fit;
  /** Radar window: funding news from the last N days (default 14). */
  days?: number;
  /** A post this recent is fresh (default 2: Exa dates posts by day). */
  freshDays?: number;
  /** How far back a hiring post may be and still count as evidence (default 30). */
  postDays?: number;
  skipRadar?: boolean;
  /** Most companies checked per stage on one run (default 20). */
  limit?: number;
  /** A company checked more recently than this is not checked again (default 20). */
  recheckHours?: number;
  guesses?: boolean;
  now?: Date;
  log?: (line: string) => void;
};

export type StageReport = { stage: "radar" | "hiring" | "contacts"; ok: boolean; note: string; failures: string[] };
export type DailyResult = { digest: Digest; stages: StageReport[] };

const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 160);

/** What the radar knows about a company, handed to the hiring check so its lookups keep those hints. */
export const toTarget = (c: FundedCompany): Target => ({
  company: c.company, whatItDoes: c.whatItDoes ?? null, city: c.city ?? null, website: c.website ?? null,
  founders: c.founders ?? [], sector: c.sector ?? null,
});

/** The digest as the stores hold it right now. No network, no model: safe to call from the message loop. */
export function digestFromStores(stores: DailyStores, fit: Fit, options: { now?: Date; freshDays?: number; notes?: string[] } = {}): Digest {
  return buildDigest({ companies: stores.radar.all(), checks: stores.hiring.all(), contacts: stores.contacts.all(), fit, ...options });
}

export const radarDbPath = () => process.env.RADAR_DB?.trim() || ".data/radar.db";

/** Opens the three stores where the standalone commands keep them. With `create: false`, null when nothing was ever stored. */
export function openDailyStores(options: { create?: boolean } = {}): (DailyStores & { close(): void }) | null {
  const path = radarDbPath();
  if (options.create === false && path !== ":memory:" && !existsSync(path)) return null;
  const stores = { radar: new RadarStore(path), hiring: new HiringStore(), contacts: new ContactStore() };
  return { ...stores, close: () => [stores.radar, stores.hiring, stores.contacts].forEach((store) => store.close()) };
}

export async function runDaily(providers: DailyProviders, stores: DailyStores, options: DailyOptions): Promise<DailyResult> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 20;
  const freshDays = options.freshDays ?? 2;
  const recheckMs = (options.recheckHours ?? 20) * 3_600_000;
  const log = options.log ?? (() => undefined);
  const stages: StageReport[] = [];
  const stage = async (name: StageReport["stage"], work: (report: StageReport) => Promise<void>) => {
    const report: StageReport = { stage: name, ok: true, note: "", failures: [] };
    stages.push(report);
    try {
      await work(report);
    } catch (error) {
      report.ok = false;
      report.failures.push(message(error));
      report.note = `failed: ${message(error)}${report.note ? ` (before that: ${report.note})` : ""}`;
    }
    log(`${name}: ${report.note}`);
  };

  // 1. Radar: new funded companies. A spent model quota leaves the stored companies to work with.
  if (options.skipRadar) stages.push({ stage: "radar", ok: true, note: "skipped (--skip-radar)", failures: [] });
  else {
    await stage("radar", async (report) => {
      const result = await runRadar(providers.radar(), stores.radar, { days: options.days ?? 14, sectors: options.fit.sectors, now });
      report.failures = result.failures;
      report.ok = result.failures.length === 0;
      report.note = `${result.articles} articles read, ${result.companies.length} verified rounds, ${result.fresh.length} new`
        + `${result.failures.length ? `; ${result.failures.length} failures, first: ${result.failures[0]!.slice(0, 120)}` : ""}`;
    });
  }

  // 2. Hiring: only companies that are new or whose last check is old, and only inside the wanted sectors.
  await stage("hiring", async (report) => {
    const companies = stores.radar.all();
    const wanted = companies.filter((c) => scoreFit(options.fit, c, null).leftOut !== "sector");
    const last = (c: FundedCompany) => Date.parse(stores.hiring.get(c.key)?.checkedAt ?? "") || 0;
    const due = wanted.filter((c) => now.getTime() - last(c) >= recheckMs).sort((a, b) => last(a) - last(b));
    const recent = wanted.length - due.length;
    const outside = companies.length - wanted.length;
    const summary = (checked: number, kept: number) =>
      `${checked} checked${kept ? ` (${kept} kept their earlier result: the new lookup failed)` : ""}, ${recent} checked within ${options.recheckHours ?? 20}h`
      + `${due.length > limit ? `, ${due.length - limit} waiting for the next run (--limit ${limit})` : ""}${outside ? `, ${outside} outside your sectors` : ""}`;
    report.note = summary(0, 0);
    if (!due.length) return;
    const live = providers.hiring();
    const check: CheckOptions = { days: options.postDays ?? 30, freshDays, now };
    let checked = 0;
    let kept = 0;
    for (const company of due.slice(0, limit)) {
      try {
        const result = await checkHiring(toTarget(company), live, check);
        const earlier = stores.hiring.get(company.key);
        report.failures.push(...result.failures.map((f) => `${company.company}: ${f}`));
        // A lookup that failed part-way must not wipe evidence an earlier run found.
        if (earlier && result.failures.length && hiringScore(result) < hiringScore(earlier)) kept++;
        else stores.hiring.save(result);
        checked++;
        log(`  checked ${company.company}: ${result.posts.length} posts (${result.posts.filter((p) => p.fresh).length} fresh)${result.failures.length ? `, ${result.failures.length} lookups failed` : ""}`);
      } catch (error) {
        report.failures.push(`${company.company}: ${message(error)}`);
      }
      report.note = summary(checked, kept);
    }
    report.ok = report.failures.length === 0;
    if (!report.ok) report.note += `; ${report.failures.length} failures, first: ${report.failures[0]!.slice(0, 120)}`;
  });

  // 3. Contacts: only companies with hiring evidence, and only when the evidence is newer than the last lookup.
  await stage("contacts", async (report) => {
    const companies = new Map(stores.radar.all().map((c) => [c.key, c]));
    const known = new Map(stores.contacts.all().map((c): [string, ContactCheck] => [c.key, c]));
    const hiring = stores.hiring.all()
      .filter((check) => {
        const company = companies.get(check.key);
        return company && hiringScore(check) > 0 && !scoreFit(options.fit, company, check).leftOut;
      })
      .sort((a, b) => hiringScore(b) - hiringScore(a));
    const stale = (check: HiringCheck) => {
      const contact = known.get(check.key);
      // Rows saved before recommendations existed are looked up again.
      return !contact || contact.recommended === undefined || contact.checkedAt < check.checkedAt;
    };
    const due = hiring.filter(stale);
    const summary = (done: number) =>
      `${done} looked up, ${hiring.length - due.length} already current${due.length > limit ? `, ${due.length - limit} waiting for the next run (--limit ${limit})` : ""}`;
    report.note = summary(0);
    if (!due.length) return;
    const live = providers.contacts();
    let done = 0;
    for (const check of due.slice(0, limit)) {
      try {
        const result = await findContacts(check, live, { founders: companies.get(check.key)?.founders ?? [], guesses: options.guesses === true, now });
        const earlier = known.get(check.key);
        report.failures.push(...result.failures.map((f) => `${check.company}: ${f}`));
        if (!(earlier?.contacts.length && result.failures.length && !result.contacts.length)) stores.contacts.save(result);
        done++;
        log(`  contacts ${check.company}: ${result.recommended?.email ?? "no recommended address"}${result.failures.length ? `, ${result.failures.length} lookups failed` : ""}`);
      } catch (error) {
        report.failures.push(`${check.company}: ${message(error)}`);
      }
      report.note = summary(done);
    }
    report.ok = report.failures.length === 0;
    if (!report.ok) report.note += `; ${report.failures.length} failures, first: ${report.failures[0]!.slice(0, 120)}`;
  });

  const notes = stages.map((s) => `${s.stage}: ${s.note}`);
  return { digest: digestFromStores(stores, options.fit, { now, freshDays, notes }), stages };
}

/**
 * The latest digest for one texter, read from the stores (null when nothing is stored).
 * Their own locked interview profile ranks it, unless SCOUT_* settings say otherwise.
 */
export function readStoredDigest(draft: Draft | null = null, env: Record<string, string | undefined> = process.env): Digest | null {
  const stores = openDailyStores({ create: false });
  if (!stores) return null;
  try {
    let fit = NO_FIT;
    try {
      fit = resolveFit({ env, draft });
    } catch {
      // A mistyped SCOUT_SECTORS should not take the digest away: show everything instead.
    }
    return digestFromStores(stores, fit);
  } finally {
    stores.close();
  }
}
