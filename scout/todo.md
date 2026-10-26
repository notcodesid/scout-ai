# Scout build plan

Product: Scout lives in iMessage. You text it; a squad of four agents learns who you
are, finds companies worth approaching, researches them deeply with sourced evidence,
and texts back dossiers and outreach drafts. Nothing is ever sent to employers.

## Agent squad

| # | Agent | Job | State |
|---|-------|-----|-------|
| 1 | Interview | Text conversation that builds the candidate profile | exists in `src/interview.ts` + `src/model.ts` (wired in `src/index.ts`) |
| 2 | Discovery | Profile → candidate companies | not built |
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
- [ ] **Phase 2 — iMessage wiring** (next)
  - [ ] Router in `src/index.ts`: talking → locked → choosing companies → researching
  - [ ] Background worker loop picks queued runs; texts progress and results per company
  - [ ] Dossier → iMessage digest formatter; async ack ("on it, ~N min")
  - [ ] Interview agent on OpenRouter when key present, Ollama fallback
  - [ ] Live end-to-end test from a real phone: text → profile → URL → dossier texts back
- [ ] **Phase 3 — discovery agent**
  - [ ] Decide provider: CrustData if access survives the hackathon, else Exa search
  - [ ] Profile → 3–5 ranked candidates with one-line reasons → user picks
- [ ] **Phase 4 — polish**
  - [ ] Per-run cost recording from OpenRouter usage; display in digest
  - [ ] Cancellation from iMessage ("stop" command)
  - [ ] Clean up: retire `hackathon/scout`, decide fate of root Next.js app

## Ops notes

- Keys live in `scout/.env` (never read or committed): `PROJECT_ID`, `PROJECT_SECRET` (Spectrum),
  `OPENROUTER_API_KEY`, `EXA_API_KEY`. Optional: `INTERVIEW_MODEL`, `RESEARCH_MODEL`,
  `REVIEWER_MODEL`, `OLLAMA_BASE_URL`, `SCOUT_MODEL`.
- Runtime: `bun start` (Spectrum app), `bun test`, `bunx tsc --noEmit`.
