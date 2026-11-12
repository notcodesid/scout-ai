// Funding radar: `bun run radar [--days 14] [--sectors software-ai,fintech] [--all]`
// Finds Indian startups that announced an early round recently. Read-only: it
// searches news and prints a list; it never contacts anyone.
// Env: RADAR_SECTORS (same as --sectors), RADAR_DB (database path, default .data/radar.db).
import { dirname, join } from "node:path";
import { liveRadarProviders } from "./providers.ts";
import { RadarStore, runRadar } from "./radar.ts";
import { SECTORS, type FundedCompany, type Sector } from "./contracts.ts";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => (flag(name) ? args[args.indexOf(name) + 1] : undefined);
const days = flag("--days") ? Number(value("--days")) : 14;
if (!Number.isFinite(days) || days < 1 || days > 90) throw new Error("--days must be between 1 and 90");

const sectors = (value("--sectors") ?? process.env.RADAR_SECTORS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const unknownSector = sectors.find((s) => !(SECTORS as readonly string[]).includes(s));
if (flag("--sectors") && !sectors.length) throw new Error(`--sectors needs a comma separated list of: ${SECTORS.join(", ")}`);
if (unknownSector) throw new Error(`unknown sector "${unknownSector}". Choose from: ${SECTORS.join(", ")}`);
const wanted = (c: FundedCompany) => !sectors.length || sectors.includes(c.sector);

const line = (c: FundedCompany) =>
  `- ${c.company} | ${c.stage === "unknown" ? "stage not stated (small round)" : c.stage} | ${c.amount ?? "amount not stated"} | ${c.sector}` +
  ` | ${c.investors.join(", ") || "investors not stated"}${c.city ? ` | ${c.city}` : ""}` +
  `${c.whatItDoes ? `\n  ${c.whatItDoes}` : ""}` +
  `\n  founders: ${c.founders.join(", ") || "not stated"}${c.website ? ` | ${c.website}` : ""}` +
  `\n  "${c.quote}"\n  ${c.sourceUrl}`;

const dbPath = process.env.RADAR_DB?.trim() || ".data/radar.db";
const store = new RadarStore(dbPath);
if (flag("--all")) {
  const all = store.all().filter(wanted);
  console.log(`${all.length} companies on the radar${sectors.length ? ` in ${sectors.join(", ")}` : ""}\n`);
  for (const company of all) console.log(line(company) + `\n  first seen ${company.firstSeen.slice(0, 10)}\n`);
} else {
  const result = await runRadar(liveRadarProviders(), store, { days, sectors: sectors as Sector[] });
  const latest = join(dirname(dbPath), "radar-latest.json");
  await Bun.write(latest, JSON.stringify(result, null, 2));
  console.log(`Articles since ${result.since.slice(0, 10)}: ${result.articles} new, ${result.articlesSkipped} skipped (already read), ` +
    `${result.articlesDuplicate} same-story duplicates, ${result.articlesFailed} failed (retried next run).`);
  console.log(`${result.companies.length} verified rounds, ${result.fresh.length} new` +
    `${sectors.length ? ` in ${sectors.join(", ")} (${result.outsideSectors} new in other sectors stored, not shown)` : ""}, ${result.rejected.length} rejected.\n`);
  for (const company of result.fresh) console.log(line(company) + "\n");
  const updated = result.updated.filter(wanted);
  if (updated.length) console.log(`${updated.length} known companies gained detail:\n`);
  for (const company of updated) console.log(line(company) + "\n");
  for (const failure of result.failures) console.error(`failed: ${failure}`);
  console.log(`Full result: ${latest}`);
}
store.close();
