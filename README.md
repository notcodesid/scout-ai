# Scout

Scout helps a candidate research a few companies deeply and approach them with concrete evidence of value. Depth over application volume: choose carefully, bring something specific.

## What's in this repo

Two things, deliberately:

- **`app/`** — the thesis landing page. "How to get hired without playing the volume game." Next.js, run with `bun run dev`.
- **`scout/`** — the product: an iMessage agent squad. Text Scout and it:
  1. **Interviews** you (learns skills, experience, constraints) — `scout/src/interview.ts`
  2. **Discovers** companies worth approaching
  3. **Researches** each one with sourced evidence — `scout/src/research/`
  4. **Reviews** every claim against its sources before it reaches you — `scout/src/research/reviewer.ts`

  It texts back a sourced dossier, fit reasoning, one bounded contribution hypothesis, and an outreach draft to review. Nothing is ever sent to employers.

## Run it

Landing page:

```sh
bun install
bun run dev
```

The iMessage agent (needs Spectrum + provider keys in `scout/.env`):

```sh
cd scout
bun install
bun start
```

## Where the plan lives

- `scout/todo.md` — agent squad, decisions, phases, ops notes.

Design rules the code enforces: every company claim carries a verbatim quote from a saved source; fit skills must match the supplied profile; a separate reviewer model (different family than the researcher) gates completion; page text is untrusted data; runs are bounded by call, time, and budget limits and resume after a restart.
