// Hiring check: `bun run hiring [--days 30] [--limit 20] [--company "Name"] [--all]`
// For each company on the funding radar: find its site and careers page, read its
// public job board, and collect recent hiring posts. Read-only; contacts no one.
import { companyKey } from "../radar/contracts.ts";
import { RadarStore } from "../radar/radar.ts";
import { HiringStore, checkHiring, hiringScore, type Target } from "./check.ts";
import { liveHiringProviders } from "./providers.ts";
import type { HiringCheck } from "./contracts.ts";

const args = process.argv.slice(2);
const value = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const days = Number(value("--days") ?? 30);
const limit = Number(value("--limit") ?? 20);
if (!Number.isFinite(days) || days < 1 || days > 180) throw new Error("--days must be between 1 and 180");
if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("--limit must be between 1 and 100");

const print = (c: HiringCheck) => {
  console.log(`\n## ${c.company}  (score ${hiringScore(c)})`);
  console.log(`site: ${c.website ?? "not found"}   careers: ${c.careersUrl ?? "not found"}`);
  if (c.board) {
    console.log(`job board: ${c.board.provider}/${c.board.slug}${c.board.guessed ? " (matched by name, not linked from the site)" : ""} — ${c.board.total} open roles`);
    for (const job of c.board.jobs.slice(0, 8)) console.log(`  - ${job.title}${job.location ? ` | ${job.location}` : ""} | ${job.updatedAt?.slice(0, 10) ?? ""} | ${job.url}`);
  } else console.log("job board: none on Greenhouse, Lever or Ashby");
  console.log(`hiring posts: ${c.posts.length}`);
  for (const post of c.posts) console.log(`  - ${post.publishedDate?.slice(0, 10)}${post.founderLikely ? " [founder/exec]" : ""} ${post.author ?? ""} — ${post.title}\n    ${post.url}`);
  for (const listing of c.listings) console.log(`  listing: ${listing.title} | ${listing.url}`);
  for (const failure of c.failures) console.log(`  failed: ${failure}`);
};

const store = new HiringStore();
if (args.includes("--all")) {
  for (const check of store.all().sort((a, b) => hiringScore(b) - hiringScore(a))) print(check);
} else {
  const radar = new RadarStore();
  const only = value("--company");
  // A named company reuses its radar entry when there is one, so the website lookup keeps its hints.
  const targets: Target[] = only
    ? [radar.all().find((c) => c.key === companyKey(only)) ?? { company: only }]
    : radar.all().slice(0, limit);
  radar.close();
  if (!targets.length) console.log("No companies on the radar yet. Run `bun run radar` first, or pass --company.");
  const providers = liveHiringProviders();
  const checks: HiringCheck[] = [];
  for (const target of targets) {
    const check = await checkHiring(target, providers, { days });
    store.save(check);
    checks.push(check);
    console.error(`checked ${check.company}: ${check.posts.length} posts, ${check.board?.total ?? 0} board roles`);
  }
  checks.sort((a, b) => hiringScore(b) - hiringScore(a)).forEach(print);
  await Bun.write(".data/hiring-latest.json", JSON.stringify(checks, null, 2));
  console.log("\nFull result: .data/hiring-latest.json");
}
store.close();
