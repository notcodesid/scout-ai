# scout

Scout is a job-search agent that lives in iMessage, plus a set of command-line tools that do the daily legwork of one
specific job-hunt method:

1. find Indian startups that **just raised an early round** (pre-seed to Series A, where founders still hire directly),
2. see which of them are **hiring right now**, ideally a fresh "we're hiring" post by a founder that still has under 100 likes,
3. get the **one best address to write to**, with the page it was published on.

You write the email yourself. **Nothing is ever sent to a company**: these tools only search, collect and show. Every
claim comes with its source URL, and text from web pages is treated as untrusted data, never as instructions.

Built on Bun, `bun:sqlite`, [Exa](https://exa.ai) for search and [Spectrum](https://photon.codes/docs/spectrum-ts) for iMessage.

## Setup

```sh
bun install
cp .env.example .env   # then fill in the keys you need
```

| To run | You need |
| --- | --- |
| `bun run hiring`, `bun run contacts`, `bun run daily --skip-radar` | `EXA_API_KEY` |
| `bun run radar`, `bun run daily` | `EXA_API_KEY` and a model: `OPENROUTER_API_KEY` (plus `OPENROUTER_BASE_URL` / `RESEARCH_MODEL` for another OpenAI-compatible endpoint such as Gemini) |
| `bun start` (iMessage) | `PROJECT_ID`, `PROJECT_SECRET` from the [Photon dashboard](https://app.photon.codes), and a local Ollama model for the interview |

`.env.example` lists every setting with a one-line explanation.

## The daily digest: `bun run daily`

One command runs the three tools below in order and prints one digest:

```sh
bun run daily                                   # radar -> hiring -> contacts -> digest
bun run daily --skip-radar --limit 8            # no news search, no model calls
bun run daily --roles backend,engineer --sectors software-ai,fintech --cities Bengaluru
bun run daily --stored --imessage               # print what is stored; searches nothing
```

| Flag | Meaning | Default |
| --- | --- | --- |
| `--days N` | radar window: funding news from the last N days | 14 |
| `--fresh-days N` | a hiring post this recent is FRESH | 2 |
| `--post-days N` | how old a hiring post may be and still count as evidence | 30 |
| `--skip-radar` | skip the radar (no model needed); work from companies already stored | off |
| `--limit N` | most companies checked per stage on one run | 20 |
| `--recheck-hours N` | skip the hiring check for companies checked within N hours (`0` rechecks all) | 20 |
| `--roles a,b` | role keywords matched against role titles ("backend", "full-stack", "engineer", "product", "design") | none |
| `--sectors x,y` | wanted sectors: `software-ai`, `fintech`, `deeptech-hardware`, `healthcare-biotech`, `consumer-brand`, `gaming-media`, `climate-energy`, `other` | all |
| `--cities a,b` | preferred cities (rank only, never exclude) | none |
| `--work-mode m` | `remote`, `hybrid` or `onsite`; with hybrid/onsite a matching city counts for more | none |
| `--guesses` | also show guessed addresses (unverified unless `HUNTER_API_KEY` is set) | off |
| `--stored` | build the digest from the stores only; no searches | off |
| `--imessage` | also print the short text-message version | off |

How it behaves:

- **Stages are isolated.** If the radar fails (for example the model's daily quota is spent), the hiring and contact
  stages still run on the companies already stored, and the digest says what failed. A hiring or contact lookup that
  fails part-way never overwrites evidence an earlier run found.
- **Reruns are cheap.** A company whose hiring check is younger than `--recheck-hours` is not checked again. The contact
  finder runs only for companies with hiring evidence, and only when that evidence is newer than the last lookup.
  The run prints how many Exa requests it made.
- **Fit profile** (deterministic, no model), from the first source that says anything: the flags above; else
  `SCOUT_ROLES` / `SCOUT_SECTORS` / `SCOUT_CITIES` / `SCOUT_WORK_MODE`; else a locked interview profile when exactly one
  interview is stored (skills, wanted product kind and location are mapped to keywords, unrecognised words are ignored);
  else no filter, ranked by hiring evidence only. A company is left out only for a different sector, or when it states
  role titles and none match. **Nothing is hidden silently**: the digest counts and names what the filter left out.
- **Order:** fresh founder posts, other fresh posts, older hiring evidence, then funded companies with no hiring
  evidence (names only). Per company: stage, amount, sector, what it does, the post (date, poster, role, reactions,
  "under 100 likes" when known, URL), matching roles, and the recommended address with its reason, its source, and
  whether the company published it or a third-party page did.
- **Output:** the text is printed and saved to `.data/daily-latest.txt`; the full data goes to `.data/daily-latest.json`.

### Running it every day

Nothing is installed for you. On a machine that stays on, add a cron line (`crontab -e`), here for 08:30 India time:

```cron
CRON_TZ=Asia/Kolkata
30 8 * * * cd /path/to/scout-ai/scout && /path/to/bun run daily >> .data/daily.log 2>&1
```

Use the full path to `bun` (`which bun`): cron has a short `PATH`. Bun reads `.env` from the `scout` directory, so the
keys stay there. On macOS a launchd agent does the same job. A cloud sandbox or CI container is ephemeral: `.data/` (the
SQLite stores that make reruns cheap and remember what was already surfaced) disappears with it, so schedule this on
your own computer or a small always-on server, or keep `.data/` on a persistent volume.

## The three tools it is made of

Each also runs alone. All of them keep their results in `.data/radar.db` (SQLite).

### `bun run radar`: who just raised

Exa news search over Indian startup outlets, then a model extracts funding rounds. A round is kept only if its quote
is verbatim in the saved article, names the company, and states the raise as that page's news; only early stages are kept.
Reruns report only new companies and do not re-read articles.

| Flag | Meaning |
| --- | --- |
| `--days N` | news from the last N days (default 14, max 90) |
| `--sectors a,b` | report only new companies in these sectors (all rounds are stored); also `RADAR_SECTORS` |
| `--all` | list everything stored; no search, no model |

Needs a model. A default run makes about 12 to 15 model calls; Gemini's free tier allows about 20 requests a day per
model, so one run a day fits and a second usually does not. Tune with the `RADAR_*` settings in `.env.example`.

### `bun run hiring`: who is hiring

For each radar company, with no model calls: finds the website and careers page, reads role titles from the careers
page, reads public Greenhouse / Lever / Ashby boards when the site links one, notes links to boards Indian startups
use (Keka, Zoho Recruit, Wellfound, ...), and collects LinkedIn / X hiring posts that name the company.

| Flag | Meaning |
| --- | --- |
| `--days N` | how far back a hiring post may be (default 30) |
| `--fresh-days N` | a post within N days is FRESH (default 2) |
| `--fresh` | print only companies with a fresh post |
| `--limit N` | how many radar companies to check (default 20) |
| `--company "Name"` | check one company (on the radar or not) |
| `--no-read` | skip reading the careers / home page (fewer Exa requests) |
| `--why` | also print posts that were found but not counted, with the reason |
| `--all` | print stored checks; no search |

### `bun run contacts`: who to write to

For companies with hiring evidence, with no model calls: reads their hiring posts, careers page and site for published
addresses (each kept with its page and surrounding words), names the people who posted, checks that the domain
accepts mail, and recommends one address with the reason.

| Flag | Meaning |
| --- | --- |
| `--limit N` | how many companies (default 20) |
| `--company "Name"` | one company |
| `--guesses` | also offer pattern guesses for people with no published address (unverified; off by default) |
| `--verify` | with `HUNTER_API_KEY`: verify the published address that would be recommended |
| `--all` | print stored lookups; no search |

## The iMessage agent: `bun start`

`src/index.ts` listens on Spectrum (iMessage, direct messages only) and runs the interview agent (`src/interview.ts`,
`src/model.ts`, `src/store.ts`): a short text conversation that builds your profile and locks it when you confirm.

Texting exactly `radar`, `jobs`, `digest` or `who's hiring` gets the latest digest back as a few short plain-text
messages, ranked by your locked profile when you have one. The reply is read from the stores the daily run filled: the
message loop never searches, never calls a paid API and never runs the pipeline. Any other text goes to the interview
as before.

`src/research/` (sourced company dossier with a separate reviewer model) and `src/runs.ts` (run store with a resumable
step journal) are built and tested but not wired into iMessage yet. See `todo.md`.

## Development

```sh
bun test            # unit tests, all with fake providers; no network
bunx tsc --noEmit   # typecheck
RUN_LIVE=1 EXA_API_KEY=... bun test tests/live.test.ts   # opt-in: one real hiring check + contact lookup (about 6 Exa requests)
```

Layout: `src/radar/`, `src/hiring/` (hiring check and contact finder), `src/daily/` (pipeline, fit, digest, iMessage
command), `src/research/`, `tests/`. `AGENTS.md` has the rules for coding agents; `todo.md` has the plan, what has been
verified live and the known limits.

## Known limits

- Exa dates posts by day, not hour, which is why "fresh" defaults to 2 days.
- LinkedIn reaction counts are read from the post text Exa returns; when the text does not carry them the digest says "likes unknown".
- None of about 20 Indian startups checked used Greenhouse, Lever or Ashby, so open roles mostly come from posts and careers pages.
- Guessed addresses are off by default. Hunter verification is implemented but has never been run against the live service.
- Companies stored by early radar runs have no sector or founders recorded; they show as sector `other`.

## X hiring leads

`bun run xleads [--hours 72] [--pages 5] [--from tweets.json ...] [--all]`

Searches X (through twitterapi.io, `TWITTERAPI_KEY`) for recent hiring posts and keeps the ones that look like an
opening at an Indian startup: the poster's own opening ("we're hiring", "I am hiring", "Hiring: X") or a named
opening passed along ("Acme is hiring a ..."), with a role, an India signal, a startup signal, and under 100 likes.
Job boards, recruiters, job seekers, large employers, non-startup roles and accounts that pass on three or more
openings are dropped, each with a counted reason. Each lead shows who posted (founder, team, or shared), the role,
age in hours, likes and views, and how the post says to apply (email, DM, link). Leads are stored, so a rerun
reports only new ones; raw tweets are saved to `xleads-raw.json` so the filter can be re-run with `--from` at no
API cost. Read-only: it never replies, follows or messages anyone.
