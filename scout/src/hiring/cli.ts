// Hiring check: `bun run hiring [--days 30] [--fresh-days 2] [--fresh] [--limit 20] [--company "Name"] [--all] [--no-read] [--why]`
// For each company on the funding radar: find its site and careers page, read its
// public job board, and collect recent hiring posts. Read-only; contacts no one.
//   --fresh-days N  a post published within N days is marked FRESH (default 2)
//   --fresh         print only companies with a fresh post
//   --why           also print the posts that were found but not counted, with the reason
//   --no-read       skip reading the careers / home page (saves one or two Exa page reads per company)
// HIRING_DB=path stores the checks (and hiring-latest.json beside it) somewhere other than .data/radar.db.
import { dirname, join } from "node:path";
import { companyKey } from "../radar/contracts.ts";
import { RadarStore } from "../radar/radar.ts";
import { HiringStore, checkHiring, hiringScore, refresh, type Target } from "./check.ts";
import { liveHiringProviders } from "./providers.ts";
import type { HiringCheck, Post } from "./contracts.ts";

const args = process.argv.slice(2);
const value = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const days = Number(value("--days") ?? 30);
const freshDays = Number(value("--fresh-days") ?? 2);
const limit = Number(value("--limit") ?? 20);
const freshOnly = args.includes("--fresh");
if (!Number.isFinite(days) || days < 1 || days > 180) throw new Error("--days must be between 1 and 180");
if (!Number.isFinite(freshDays) || freshDays <= 0 || freshDays > days) throw new Error("--fresh-days must be above 0 and at most --days");
if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("--limit must be between 1 and 100");

const tags = (post: Post) => [
  post.fresh ? "FRESH" : "",
  post.byFounder ? "founder" : post.founderLikely ? "founder/exec?" : "",
  post.under100Likes === null ? "likes unknown" : `${post.under100Likes ? "under 100 likes" : "100+ likes"}: ${post.reactions} reactions${post.comments === null ? "" : `, ${post.comments} comments`}`,
  post.primary ? "" : "hiring mentioned in passing",
].filter(Boolean).map((tag) => `[${tag}]`).join(" ");

const print = (c: HiringCheck) => {
  console.log(`\n## ${c.company}  (score ${hiringScore(c)})`);
  console.log(`site: ${c.website ?? "not found"}   careers: ${c.careersUrl ?? "not found"}`);
  if (c.board) {
    console.log(`job board: ${c.board.provider}/${c.board.slug}${c.board.guessed ? " (matched by name, not linked from the site)" : ""} — ${c.board.total} open roles`);
    for (const job of c.board.jobs.slice(0, 8)) console.log(`  - ${job.title}${job.location ? ` | ${job.location}` : ""} | ${job.updatedAt?.slice(0, 10) ?? ""} | ${job.url}`);
  } else console.log("job board: none on Greenhouse, Lever or Ashby");
  for (const link of c.boards) console.log(`  board link: ${link.provider} (${link.source === "site" ? "linked from the company's site" : "search result naming the company"}) ${link.url}`);
  if (c.roles.length) console.log(`roles on the careers page: ${c.roles.join("; ")}`);
  console.log(`hiring posts: ${c.posts.length} (${c.posts.filter((p) => p.fresh).length} within ${c.freshDays} days)`);
  for (const post of c.posts) {
    console.log(`  - ${post.publishedDate?.slice(0, 10)} ${tags(post)} ${post.author ?? ""} — ${post.title}`);
    console.log(`    ${post.role ? `role: ${post.role}   ` : ""}${post.corroboratedBy ? `matched by: ${post.corroboratedBy}   ` : ""}${post.url}`);
  }
  if (args.includes("--why")) for (const d of c.dropped) console.log(`  not counted (${d.reason}): ${d.title} | ${d.url}`);
  for (const listing of c.listings) console.log(`  listing: ${listing.title} | ${listing.url}`);
  for (const failure of c.failures) console.log(`  failed: ${failure}`);
};
const show = (checks: HiringCheck[]) => {
  const shown = checks.filter((c) => !freshOnly || c.posts.some((p) => p.fresh)).sort((a, b) => hiringScore(b) - hiringScore(a));
  shown.forEach(print);
  if (freshOnly && !shown.length) console.log(`No company has a hiring post from the last ${freshDays} days.`);
};

const store = new HiringStore();
if (args.includes("--all")) {
  // Freshness is judged against today, not against the day the check ran.
  show(store.all().map((check) => refresh(check, new Date(), freshDays)));
} else {
  const radar = new RadarStore();
  const only = value("--company");
  // A named company reuses its radar entry when there is one, so the lookups keep its hints.
  const targets: Target[] = only
    ? [radar.all().find((c) => c.key === companyKey(only)) ?? { company: only }]
    : radar.all().slice(0, limit);
  radar.close();
  if (!targets.length) console.log("No companies on the radar yet. Run `bun run radar` first, or pass --company.");
  // Every search and page read is one Exa request; the count is printed so a run's cost is visible.
  let requests = 0;
  const live = liveHiringProviders();
  const counted = <A extends unknown[], R>(call: (...a: A) => Promise<R>) => (...a: A) => (requests++, call(...a));
  const providers = { ...live, companies: counted(live.companies), web: counted(live.web), posts: counted(live.posts), contents: counted(live.contents) };
  const checks: HiringCheck[] = [];
  for (const target of targets) {
    const check = await checkHiring(target, providers, { days, freshDays, readPages: !args.includes("--no-read") });
    store.save(check);
    checks.push(check);
    console.error(`checked ${check.company}: ${check.posts.length} posts (${check.posts.filter((p) => p.fresh).length} fresh), ${check.board?.total ?? 0} board roles`);
  }
  show(checks);
  console.error(`Exa requests: ${requests}`);
  const latest = join(process.env.HIRING_DB?.trim() ? dirname(process.env.HIRING_DB.trim()) : ".data", "hiring-latest.json");
  await Bun.write(latest, JSON.stringify(checks, null, 2));
  console.log(`\nFull result: ${latest}`);
}
store.close();
