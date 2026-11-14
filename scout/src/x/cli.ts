// X hiring leads: `bun run xleads [--hours 72] [--pages 5] [--from tweets.json ...] [--all]`
// Finds recent "we're hiring" posts on X from founders and teams at Indian startups.
// Read-only: it searches and prints; it never replies, follows or messages anyone.
// Env: TWITTERAPI_KEY (twitterapi.io), XLEADS_DB (database path, default .data/radar.db),
// XLEADS_GAP_MS (pause between API calls, default 5500).
import { dirname, join } from "node:path";
import { XLeadStore, formatLead, leadsFromTweets, runXLeads, type XProviders } from "./leads.ts";
import type { Tweet } from "./contracts.ts";

function liveXProviders(): XProviders {
  const key = process.env.TWITTERAPI_KEY?.trim();
  if (!key) throw new Error("TWITTERAPI_KEY_REQUIRED");
  // The API allows few requests per second on small plans: space calls out and wait out a 429.
  const gap = Number(process.env.XLEADS_GAP_MS ?? 5500);
  let last = 0;
  return {
    async search(query, cursor) {
      const url = `https://api.twitterapi.io/twitter/tweet/advanced_search?${new URLSearchParams({ query, queryType: "Latest", cursor })}`;
      for (let attempt = 0; ; attempt++) {
        await Bun.sleep(Math.max(0, last + gap - Date.now()));
        last = Date.now();
        const response = await fetch(url, { headers: { "x-api-key": key }, signal: AbortSignal.timeout(40_000) });
        if (response.status === 429 && attempt < 3) {
          await Bun.sleep(gap * (attempt + 1));
          continue;
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = (await response.json()) as { tweets?: Tweet[]; has_next_page?: boolean; next_cursor?: string };
        return { tweets: body.tweets ?? [], nextCursor: body.has_next_page && body.next_cursor ? body.next_cursor : null };
      }
    },
  };
}

const args = process.argv.slice(2);
const value = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const hours = Number(value("--hours") ?? 72);
const pages = Number(value("--pages") ?? 5);
if (!Number.isFinite(hours) || hours < 1 || hours > 168) throw new Error("--hours must be between 1 and 168");
if (!Number.isInteger(pages) || pages < 1 || pages > 20) throw new Error("--pages must be between 1 and 20");

const dbPath = process.env.XLEADS_DB?.trim() || ".data/radar.db";
const store = new XLeadStore(dbPath);
const out = join(dirname(dbPath), "xleads-latest.json");
if (args.includes("--all")) {
  store.all().forEach((lead, i) => console.log(formatLead(lead, i) + "\n"));
} else if (args.includes("--from")) {
  // Re-judge tweets saved earlier, without spending API requests.
  const files = args.slice(args.indexOf("--from") + 1).filter((a) => !a.startsWith("--"));
  const tweets = new Map<string, Tweet>();
  for (const file of files) for (const tweet of (await Bun.file(file).json()) as Tweet[]) tweets.set(tweet.id, tweet);
  const { leads, dropped } = leadsFromTweets([...tweets.values()], new Date(), hours);
  const fresh = leads.filter((lead) => store.record(lead));
  await Bun.write(out, JSON.stringify({ leads, fresh, tweets: tweets.size, dropped }, null, 2));
  console.log(`${tweets.size} saved tweets: ${leads.length} leads (${fresh.length} new). Dropped: ${JSON.stringify(dropped)}\n`);
  leads.forEach((lead, i) => console.log(formatLead(lead, i) + "\n"));
} else {
  const result = await runXLeads(liveXProviders(), store, { hours, pages });
  const { raw, ...summary } = result;
  await Bun.write(out, JSON.stringify(summary, null, 2));
  await Bun.write(join(dirname(dbPath), "xleads-raw.json"), JSON.stringify(raw));
  console.log(`${result.requests} searches, ${result.tweets} tweets: ${result.leads.length} leads (${result.fresh.length} new). Dropped: ${JSON.stringify(result.dropped)}\n`);
  result.leads.forEach((lead, i) => console.log(formatLead(lead, i) + "\n"));
  for (const failure of result.failures) console.error(`failed: ${failure}`);
  console.log(`Full result: ${out}`);
}
store.close();
