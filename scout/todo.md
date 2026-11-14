# Scout build plan

Product: Scout lives in iMessage. You text it; a squad of four agents learns who you
are, finds companies worth approaching, researches them deeply with sourced evidence,
and texts back dossiers and outreach drafts. Nothing is ever sent to employers.

## Agent squad

| # | Agent | Job | State |
|---|-------|-----|-------|
| 1 | Interview | Text conversation that builds the candidate profile | exists in `src/interview.ts` + `src/model.ts` (wired in `src/index.ts`) |
| 2 | Discovery | Funded startups → who is hiring → who to write to | built as CLIs: `src/radar/`, `src/hiring/`, tied together by `bun run daily` (`src/daily/`); the stored digest is texted back on "jobs" / "radar" / "digest" / "who's hiring" |
| 3 | Research | Per company: bounded evidence loop → sourced dossier | Phase 1 (port from `hackathon/scout`) |
| 4 | Reviewer | Adversarial check of claims vs sources before anything reaches the user | Phase 1 (extract from research loop) |

## Decisions made

- One repo, one Bun process: merge research into `scout/`; retire `hackathon/scout` after the port.
- No Inngest, no Redis: SQLite step journal + background worker in the same process. Steps are
  memoized by `runId:stepName`; restarts resume from the last completed step.
- Models via OpenRouter (one key, per-agent models), Ollama for the interview agent.
  Budget reality: free-first. OpenRouter free tier = 50 requests/day (~6 full company runs):
  - Interview: local Ollama `qwen2.5:3b` (free, unlimited; stays local so it doesn't burn quota)
  - Research: `nvidia/nemotron-3-ultra-550b-a55b:free`
  - Reviewer: `thinkingmachines/inkling:free` (different family than researcher on purpose)
  - When ~$10 credits are loaded (lifts limit to 1,000/day): swap to `openai/gpt-5.6-luna` +
    `google/gemini-3.1-pro-preview` via env, no code change.
- Limits per research run (from contracts): 8 model calls, 4 source calls, 12k source chars,
  4 min, $0.50 provisional budget reservation.

## Phases

- [x] **Phase 1 — research core in Bun** (this session)
  - [x] `src/research/contracts.ts`, `exa-retrieval.ts`, `providers.ts` (OpenRouter), `agent.ts`, `reviewer.ts`
  - [x] `src/runs.ts`: run store + event log + SQLite step journal (`bun:sqlite`)
  - [x] Port `tests-node/agent.test.ts` to `bun test`, including a real restart-resume test on a file DB
  - [x] `bun test` + `tsc --noEmit` green; old app still compiles (also fixed a pre-existing type error in `interview.ts:83`)
- [ ] **Phase 2 — iMessage wiring** (partly done)
  - [x] Digest on demand: texting exactly `radar`, `jobs`, `digest` or `who's hiring` returns the stored daily digest
        as a few short plain-text messages (`src/daily/command.ts`, called from `src/index.ts`). It reads the stores
        only: no search, no model, no pipeline run from the message loop. Other texts go to the interview unchanged.
        Unit-tested; NOT verified on a real phone (no Spectrum credentials in the build sandbox).
  - [ ] Router in `src/index.ts`: talking → locked → choosing companies → researching
  - [ ] Background worker loop picks queued runs; texts progress and results per company
  - [ ] Dossier → iMessage digest formatter; async ack ("on it, ~N min")
  - [ ] Interview agent on OpenRouter when key present, Ollama fallback
  - [ ] Live end-to-end test from a real phone: text → profile → URL → dossier texts back
- [ ] **Phase 3 — discovery agent** (the daily job-hunt loop works from the command line)
  - [x] Funding radar (`bun run radar [--days 14] [--sectors a,b] [--all]`): Exa news search over Indian startup
        outlets → model extracts rounds → each kept only if its quote is verbatim in the article, names the company
        and states the raise as that page's news → SQLite remembers companies and read articles, so reruns do only
        new work. Verified live (Exa + Gemini through its OpenAI-compatible endpoint): 20 companies stored.
  - [x] Hiring check (`bun run hiring [--days 30] [--fresh-days 2] [--fresh] [--limit 20] [--company "Name"] [--no-read] [--why] [--all]`),
        no model calls: website, careers page and its role titles, public Greenhouse/Lever/Ashby JSON when linked,
        links to other boards, LinkedIn/X hiring posts with poster, role, freshness and reaction counts.
        Verified live on 20 companies: 12 with hiring evidence, none on those three boards.
  - [x] Contact finder (`bun run contacts [--limit 20] [--company "Name"] [--guesses] [--verify] [--all]`), no model
        calls: published addresses with page and surrounding words, the people who posted, a mail-server check, and
        one recommended address with its reason. Verified live on 12 companies.
  - [x] Daily pipeline (`bun run daily`, flags in `README.md`): radar → hiring (only companies new or not checked in
        the last 20h) → contacts (only companies with hiring evidence newer than their last lookup) → one digest,
        saved to `.data/daily-latest.txt` / `.json`. Stages are isolated; a failed lookup never overwrites stored
        evidence. Verified live with `--skip-radar` (hiring + contacts stages, 41 Exa requests over two runs).
        NOT verified live: the radar stage inside the pipeline (model quota was in use; it calls the same `runRadar`
        the standalone command uses, and its failure path is unit-tested).
  - [x] Fit ranking (`src/daily/fit.ts`), deterministic: sectors + role keywords + cities + work mode, from flags,
        `SCOUT_*` settings or a single locked interview profile. The digest names every company the filter left out.
  - [ ] Scheduling: documented (cron line in `README.md`), not installed anywhere. Needs an always-on machine; a
        cloud sandbox loses `.data/` between sessions.
  - [ ] Hunter: Email Finder and Verifier are implemented and unit-tested, never run against the live service.
  - [ ] Profile → 3–5 ranked candidates with one-line reasons → user picks → research run (joins Phase 2)

### Known limits of the discovery loop

- Radar needs a model. A default run makes about 12–15 model calls; Gemini's free tier allows about 20 requests a day
  per model, so one run a day fits. When the quota is spent the radar stage fails and the rest of `daily` carries on.
- Exa dates posts by day, not hour, so "fresh" defaults to 2 days.
- LinkedIn reaction counts come from the post text Exa returns; when absent the digest says "likes unknown".
  Hiring checks stored before roles and reactions were collected show "role not stated; likes unknown" until rechecked.
- None of about 20 Indian startups checked used Greenhouse, Lever or Ashby; roles come from posts and careers pages.
- Guessed addresses are off by default (`--guesses`), and unverified without `HUNTER_API_KEY`.
- Companies stored by the first radar runs have no sector or founders, so they read as sector `other` and a sector
  filter leaves them out (the digest names them). They are not re-extracted: their articles are marked as read.
- Fit is keyword matching, not judgement: "engineer" matches any engineering title; a post that states no role is kept.
- The iMessage digest is rebuilt from the stores on each request, so it reflects the last `bun run daily`, not today's web.
- [ ] **Phase 4 — polish**
  - [ ] Per-run cost recording from OpenRouter usage; display in digest
  - [ ] Cancellation from iMessage ("stop" command)
  - [ ] Clean up: retire `hackathon/scout`, decide fate of root Next.js app

## Ops notes

- Keys live in `scout/.env` (never read or committed); `.env.example` lists every setting. Required: `PROJECT_ID`,
  `PROJECT_SECRET` (Spectrum, `bun start` only), `EXA_API_KEY` (all job-hunt commands), `OPENROUTER_API_KEY` (radar
  and research; with `OPENROUTER_BASE_URL` + `RESEARCH_MODEL` for Gemini or another OpenAI-compatible endpoint).
  Optional: `HUNTER_API_KEY`, `REVIEWER_MODEL`, `OLLAMA_BASE_URL`, `SCOUT_MODEL`, `SCOUT_ROLES` / `SCOUT_SECTORS` /
  `SCOUT_CITIES` / `SCOUT_WORK_MODE`, `RADAR_*`, `HIRING_DB`, `CONTACTS_DB`.
- Runtime: `bun start` (Spectrum app), `bun run daily` (once a day, see `README.md` for the cron line), `bun test`,
  `bunx tsc --noEmit`, `RUN_LIVE=1 bun test tests/live.test.ts` (opt-in, about 6 Exa requests).

## Radar follow-up (latest)

- Facts are merged across articles and into stored rows (stated stage, founders, sector win over blanks);
  confirmed live: a full 30-article run with 0 failures, and a rerun that skipped all 34 processed articles.
- Known limits: a model-given stage is not verified against the page (Two Point O Capital flipped between
  unknown and series-a across runs); founder names are only checked to appear on the page, so a reporter's
  byline can slip in (seen: Dispatch Network); news pages rarely state a website, so the hiring check still
  looks it up; the Peptris-style background-mention rejection is covered by tests only.

## X hiring leads (latest)

- `bun run xleads` run live: 60 searches over 7 days returned 856 tweets and about 20 leads after filtering.
  Timestamps are exact and like counts are on every tweet, so "under a day old, under 100 likes" is measurable on X.
- Known limits: filtering is by wording, so some leads are off-target and some real ones are dropped (an India
  signal is required in the text, bio or location); company names come from "at X" / "@handle" patterns and are
  often missing; twitterapi.io rate-limits small plans (HTTP 429), so calls are spaced 5.5s apart.
- Not yet joined to the funding radar (no check that the poster's company recently raised).
