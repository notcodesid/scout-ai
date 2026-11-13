// Daily digest: `bun run daily [--days 14] [--fresh-days 2] [--post-days 30] [--skip-radar] [--limit 20]
//   [--recheck-hours 20] [--roles backend,engineer] [--sectors software-ai,fintech] [--cities Bengaluru]
//   [--work-mode remote] [--guesses] [--stored] [--imessage]`
// Runs the funding radar, checks who is hiring, finds the address to write to and prints one digest.
// Read-only: it searches and shows. Nothing is ever sent to a company.
//   --days N           radar window: funding news from the last N days
//   --fresh-days N     a hiring post within N days is FRESH (default 2)
//   --post-days N      how far back a hiring post still counts as evidence (default 30)
//   --skip-radar       no news search and no model calls: work from companies already stored
//   --limit N          most companies checked per stage on this run (default 20)
//   --recheck-hours N  skip the hiring check for companies checked within N hours (default 20; 0 rechecks all)
//   --roles/--sectors/--cities/--work-mode  the fit profile (else SCOUT_ROLES / SCOUT_SECTORS / SCOUT_CITIES /
//                      SCOUT_WORK_MODE, else a single locked interview profile, else no filter)
//   --guesses          also show guessed addresses (unverified unless HUNTER_API_KEY is set)
//   --stored           print the digest from what is stored; no searches at all
//   --imessage         also print the short text-message version
// Writes daily-latest.json and daily-latest.txt beside the database (.data/ by default).
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { liveContactProviders } from "../hiring/contact-providers.ts";
import { liveHiringProviders } from "../hiring/providers.ts";
import { liveRadarProviders } from "../radar/providers.ts";
import { openStore } from "../store.ts";
import { formatDigest, formatDigestMessages } from "./digest.ts";
import { resolveFit } from "./fit.ts";
import { digestFromStores, openDailyStores, radarDbPath, runDaily, type DailyProviders, type StageReport } from "./pipeline.ts";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => (flag(name) ? args[args.indexOf(name) + 1] : undefined);
const number = (name: string, fallback: number, min: number, max: number) => {
  const n = flag(name) ? Number(value(name)) : fallback;
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${name} must be between ${min} and ${max}`);
  return n;
};
const days = number("--days", 14, 1, 90);
const postDays = number("--post-days", 30, 1, 180);
const freshDays = number("--fresh-days", 2, 0.1, postDays);
const limit = number("--limit", 20, 1, 100);
const recheckHours = number("--recheck-hours", 20, 0, 24 * 30);
const guesses = flag("--guesses");

/** The interview profile, when exactly one interview is stored and it is locked. Otherwise none is assumed. */
function lockedDraft() {
  try {
    if (!existsSync(".data/interviews.db")) return null;
    const all = openStore().all();
    return all.length === 1 && all[0]!.chat.status === "locked" ? all[0]!.chat.draft : null;
  } catch {
    return null;
  }
}

const flags = { roles: value("--roles"), sectors: value("--sectors"), cities: value("--cities"), workMode: value("--work-mode") };
const fit = resolveFit({ flags, env: process.env, draft: flags.roles || flags.sectors || flags.cities ? null : lockedDraft() });

// Every search and page read is one Exa request; the count is printed so a run's cost is visible.
let exaRequests = 0;
const counted = <T extends object>(live: T, names: (keyof T)[]): T => {
  const wrapped = { ...live };
  for (const name of names) {
    const call = live[name] as unknown as (...a: unknown[]) => unknown;
    (wrapped as Record<keyof T, unknown>)[name] = (...a: unknown[]) => (exaRequests++, call(...a));
  }
  return wrapped;
};
const providers: DailyProviders = {
  radar: () => counted(liveRadarProviders(), ["news"]),
  hiring: () => counted(liveHiringProviders(), ["companies", "web", "posts", "contents"]),
  contacts: () => counted(liveContactProviders(), ["read", "web"]),
};

const stores = openDailyStores()!;
let stages: StageReport[] = [];
let digest;
if (flag("--stored")) digest = digestFromStores(stores, fit, { freshDays, notes: ["read from the stores; nothing was searched on this run"] });
else {
  const result = await runDaily(providers, stores, {
    fit, days, freshDays, postDays, skipRadar: flag("--skip-radar"), limit, recheckHours, guesses, log: (line) => console.error(line),
  });
  ({ digest, stages } = result);
}
stores.close();

const text = formatDigest(digest, { guesses });
const dir = dirname(radarDbPath());
await Bun.write(join(dir, "daily-latest.json"), JSON.stringify({ digest, stages, exaRequests }, null, 2));
await Bun.write(join(dir, "daily-latest.txt"), `${text}\n`);
console.log(text);
if (flag("--imessage")) console.log(`\n--- as text messages ---\n${formatDigestMessages(digest).join("\n\n---\n")}`);
for (const report of stages) for (const failure of report.failures.slice(0, 10)) console.error(`${report.stage} failed: ${failure}`);
console.error(`Exa requests: ${exaRequests}. Full result: ${join(dir, "daily-latest.json")} and daily-latest.txt`);
