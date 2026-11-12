// Funding radar: `bun run radar [--days 14] [--all]`
// Finds Indian startups that announced an early round recently. Read-only: it
// searches news and prints a list; it never contacts anyone.
import { liveRadarProviders } from "./providers.ts";
import { RadarStore, runRadar } from "./radar.ts";
import type { FundedCompany } from "./contracts.ts";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const daysArg = args[args.indexOf("--days") + 1];
const days = flag("--days") ? Number(daysArg) : 14;
if (!Number.isFinite(days) || days < 1 || days > 90) throw new Error("--days must be between 1 and 90");

const line = (c: FundedCompany) =>
  `- ${c.company} | ${c.stage} | ${c.amount ?? "amount not stated"} | ${c.investors.join(", ") || "investors not stated"}` +
  `${c.city ? ` | ${c.city}` : ""}\n  ${c.whatItDoes ?? ""}\n  "${c.quote}"\n  ${c.sourceUrl}`;

const store = new RadarStore();
if (flag("--all")) {
  const all = store.all();
  console.log(`${all.length} companies on the radar\n`);
  for (const company of all) console.log(line(company) + `\n  first seen ${company.firstSeen.slice(0, 10)}\n`);
} else {
  const result = await runRadar(liveRadarProviders(), store, { days });
  await Bun.write(".data/radar-latest.json", JSON.stringify(result, null, 2));
  console.log(`Read ${result.articles} articles since ${result.since.slice(0, 10)}. ` +
    `${result.companies.length} verified rounds, ${result.fresh.length} new, ${result.rejected.length} rejected.\n`);
  for (const company of result.fresh) console.log(line(company) + "\n");
  for (const failure of result.failures) console.error(`failed: ${failure}`);
  console.log("Full result: .data/radar-latest.json");
}
store.close();
