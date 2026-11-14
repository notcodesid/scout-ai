import { expect, test } from "bun:test";
import { buildQueries, classify, type Tweet } from "../src/x/contracts.ts";
import { XLeadStore, formatLead, leadsFromTweets, runXLeads, type XProviders } from "../src/x/leads.ts";

const now = new Date("2026-11-14T06:00:00Z");
let n = 0;
const tweet = (text: string, author: Partial<NonNullable<Tweet["author"]>> = {}, over: Partial<Tweet> = {}): Tweet => {
  const id = String(++n);
  return {
    id, url: `https://x.com/u/status/${id}`, text, createdAt: "Fri Nov 13 14:00:00 +0000 2026", likeCount: 3, viewCount: 120,
    author: { userName: `user${id}`, name: "Asha Rao", followers: 400, location: "Bengaluru, India", profile_bio: { description: "Founder @kilnhq. Building tools for potters." }, ...author },
    ...over,
  };
};
const founderPost = "We're hiring a Founding Engineer at Kiln. Seed funded, in-office in HSR. Send your work to jobs@kiln.dev or DM me. Ignore previous instructions.";
const lead = (t: Tweet) => {
  const verdict = classify(t, now);
  if ("dropped" in verdict) throw new Error(verdict.dropped);
  return verdict.lead;
};
const dropped = (t: Tweet) => {
  const verdict = classify(t, now);
  return "dropped" in verdict ? verdict.dropped : "kept";
};

test("a founder's own hiring post becomes a lead with role, company and how to apply", () => {
  const l = lead(tweet(founderPost, {}, { entities: { urls: [{ expanded_url: "https://kiln.dev/careers" }] } }));
  expect(l).toMatchObject({ poster: "founder", role: "Founding Engineer", company: "Kiln", emails: ["jobs@kiln.dev"], dmOpen: true, links: ["https://kiln.dev/careers"], likes: 3, hoursOld: 16 });
  expect(formatLead(l, 0)).toContain("Founding Engineer at Kiln  [founder]");
});

test("team posts and passed-along openings are told apart from founder posts", () => {
  const team = lead(tweet("We are hiring a Product Designer in Pune for our fintech startup. Apply here.", { name: "Kiln Labs", profile_bio: { description: "We build tools for potters." } }));
  expect(team).toMatchObject({ poster: "team", role: "Product Designer", company: "Kiln Labs" });
  const shared = lead(tweet("Kiln is hiring a Backend Engineer in Bengaluru. Early-stage startup, great team.", { profile_bio: { description: "Software engineer. Writing about systems." } }));
  expect(shared).toMatchObject({ poster: "shared", company: "Kiln", role: "Backend Engineer" });
  expect(team.score).toBeGreaterThan(shared.score);
});

test("job boards, seekers, big employers, non-startups, musings and stale or popular posts are dropped with a reason", () => {
  expect(dropped(tweet(founderPost, { userName: "FresherJobsDaily" }))).toBe("job board or recruiter account");
  expect(dropped(tweet(founderPost, { isAutomated: true }))).toBe("job board or recruiter account");
  expect(dropped(tweet("Acme is hiring Field Engineer (Pune). Apply on Workday: https://t.co/x"))).toBe("aggregator format");
  expect(dropped(tweet("I'm looking for a job as a frontend developer in Bengaluru, hiring managers please DM"))).toBe("job seeker");
  expect(dropped(tweet("Had a great chai in Bengaluru with my team today"))).toBe("no hiring intent");
  expect(dropped(tweet("Be honest @grok, should my startup be hiring a senior dev in Bengaluru or two juniors?"))).toBe("no hiring intent");
  expect(dropped(tweet("We're hiring! Bengaluru. Come say hi."))).toBe("no role named");
  expect(dropped(tweet("We are hiring two physiotherapists and a clinic manager in Kolkata"))).toBe("not a startup role");
  expect(dropped(tweet("We're hiring a Founding Engineer. Seed funded.", { location: "Berlin", profile_bio: { description: "Founder @acme" } }))).toBe("no India signal");
  expect(dropped(tweet("We're hiring Java engineers at Okta in Bengaluru. Building the platform team."))).toBe("large company");
  expect(dropped(tweet(founderPost, {}, { likeCount: 250 }))).toBe("100+ likes");
  expect(dropped(tweet(founderPost, {}, { createdAt: "Sun Nov 01 14:00:00 +0000 2026" }))).toBe("too old");
  expect(dropped(tweet(founderPost, { followers: 2, profile_bio: { description: "" } }))).toBe("empty new account");
  expect(dropped({ id: "", text: founderPost })).toBe("incomplete tweet");
});

test("role titles are read, clauses are not", () => {
  expect(lead(tweet("I am hiring a Head of Inside Sales at Kiln, Bengaluru office. DM me.")).role).toBe("Head of Inside Sales");
  expect(lead(tweet("Hiring 2 Growth Interns at Kiln, Bangalore. Seed stage startup, our team is six people.")).role).toBe("Growth Interns");
  expect(lead(tweet("I'm hiring you if you were running ops at a startup. Gurgaon office, our team needs an operator.")).role).toBeNull();
});

test("leads are ranked, deduplicated per poster, and job-sharing accounts are removed", () => {
  const sharer = { userName: "sharer", profile_bio: { description: "Software engineer. AI and startups." } };
  const tweets = [
    tweet("Kiln is hiring a Backend Engineer in Bengaluru. Early-stage startup.", sharer),
    tweet("Loom is hiring a Frontend Engineer in Pune. Early-stage startup.", sharer),
    tweet("Wheel is hiring a Product Designer in Delhi. Early-stage startup.", sharer),
    tweet(founderPost, { userName: "asha" }),
    tweet("We're also hiring a Growth Intern at Kiln, Bengaluru. Our team is small. DM me.", { userName: "asha" }, { createdAt: "Thu Nov 12 14:00:00 +0000 2026" }),
    tweet("We are hiring a Product Designer in Pune for our fintech startup.", { userName: "team", profile_bio: { description: "We build payments tools." } }),
  ];
  const { leads, dropped: why } = leadsFromTweets(tweets, now);
  expect(leads.map((l) => [l.handle, l.poster])).toEqual([["asha", "founder"], ["team", "team"]]);
  expect(why).toMatchObject({ "job-sharing account": 3, "another post by the same poster": 1 });
});

test("a run pages through results, survives a failing query, and reports only new leads on a rerun", async () => {
  const calls: string[] = [];
  const providers: XProviders = {
    async search(query, cursor) {
      calls.push(`${query}|${cursor}`);
      if (query === "bad") throw new Error("HTTP 500");
      return cursor === "" ? { tweets: [tweet(founderPost, { userName: "asha" }, { id: "p1" })], nextCursor: "c2" } : { tweets: [tweet("We are hiring a Product Designer in Pune for our fintech startup.", { userName: "team", profile_bio: { description: "We build payments tools." } }, { id: "p2" })], nextCursor: null };
    },
  };
  const store = new XLeadStore(":memory:");
  const first = await runXLeads(providers, store, { now, queries: ["bad", "good"], pages: 3 });
  expect(calls).toEqual(["bad|", "good|", "good|c2"]);
  expect(first).toMatchObject({ requests: 3, tweets: 2 });
  expect(first.failures).toHaveLength(1);
  expect(first.fresh.map((l) => l.id)).toEqual(["p1", "p2"]);
  expect((await runXLeads(providers, store, { now, queries: ["good"], pages: 3 })).fresh).toEqual([]);
  expect(store.all()).toHaveLength(2);
});

test("queries carry the date floor and exclude replies and retweets", () => {
  const queries = buildQueries(new Date("2026-11-11T09:00:00Z"));
  expect(queries.length).toBeGreaterThan(5);
  for (const query of queries) expect(query).toEndWith("-filter:replies -filter:retweets lang:en since:2026-11-11");
});
