import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Dossier, Input, parseJSON, publicURL, validateEvidence, type ScoutDossier } from "../src/research/contracts.ts";
import { runScout, type StepRunner } from "../src/research/agent.ts";
import type { Providers } from "../src/research/providers.ts";
import { RunStore } from "../src/runs.ts";

const input = Input.parse({
  profile: { name: "Fictional Candidate", skills: ["TypeScript"], experience: "Fictional beginner; no work accomplishments.", interests: "Developer tools", constraints: "Junior", fictional: true },
  companyURL: "https://example.com",
});
const source = { id: "s-fixture", url: "https://example.com", title: "Fixture", retrievedAt: "2026-10-12", excerpt: "We build developer tools using TypeScript." };
const cited = { text: "The company builds developer tools.", citations: [{ sourceId: source.id, quote: "We build developer tools" }] };
const dossier: ScoutDossier = {
  companyName: "Fixture",
  brief: [cited],
  fit: [{ skill: "TypeScript", reasoning: "The supplied skill may fit the documented tools.", citations: [{ sourceId: source.id, quote: "using TypeScript." }] }],
  hiringSignals: [],
  contribution: { hypothesis: "A docs improvement may help.", basis: cited, nextStep: "Validate a documentation gap before proposing a change." },
  outreachDraft: "Hello, I am learning TypeScript and would like to validate a small documentation contribution.",
  unknowns: ["Hiring and eligibility are unknown."],
};

function setup(reviewApproved = true, invalidCitation = false, store: RunStore = new RunStore(":memory:")) {
  const id = store.create(input);
  let reads = 0;
  let models = 0;
  const providers: Providers = {
    async read() {
      reads++;
      return { sources: [source], requestId: "fixture", costDollars: 0, failures: 0 };
    },
    async search(): Promise<never> {
      throw new Error("Unexpected search");
    },
    async model(_messages, tools) {
      models++;
      return {
        tokens: 30,
        costDollars: 0,
        message: tools
          ? {
              role: "assistant" as const,
              refusal: null,
              content: null,
              tool_calls: [{
                id: "call-fixture",
                type: "function" as const,
                function: {
                  name: "submit_dossier",
                  arguments: JSON.stringify(
                    invalidCitation
                      ? { ...dossier, brief: [{ ...cited, citations: [{ sourceId: source.id, quote: "Unrelated fabricated quotation" }] }] }
                      : dossier,
                  ),
                },
              }],
            }
          : { role: "assistant" as const, refusal: null, content: JSON.stringify({ approved: reviewApproved, issues: reviewApproved ? [] : ["The contribution is unsupported."] }) },
      };
    },
  };
  const journal: StepRunner = (name, work) => store.step(id, name, work);
  return { store, id, providers, journal, counts: () => ({ reads, models }) };
}

const memoryStep: StepRunner = (_name, work) => work();

test("completed fixture run requires citations, supplied skills and reviewer approval", async () => {
  const f = setup();
  try {
    const state = await runScout(f.id, input, f.store, f.providers, f.journal);
    expect(f.store.get(f.id)?.status).toBe("completed");
    expect(state.dossier?.companyName).toBe("Fixture");
    expect(f.counts()).toEqual({ reads: 1, models: 2 });
    expect(state.tokens).toBe(60);
  } finally {
    f.store.close();
  }
});

test("fabricated quotations never produce a completed dossier", async () => {
  const f = setup(true, true);
  try {
    const state = await runScout(f.id, input, f.store, f.providers, f.journal);
    expect(f.store.get(f.id)?.status).toBe("partial");
    expect(state.dossier).toBeUndefined();
    expect(f.counts().models).toBe(6);
  } finally {
    f.store.close();
  }
});

test("reviewer rejection remains incomplete within model limit", async () => {
  const f = setup(false);
  try {
    await runScout(f.id, input, f.store, f.providers, f.journal);
    expect(f.store.get(f.id)?.status).toBe("partial");
    expect(f.counts().models).toBeLessThanOrEqual(8);
  } finally {
    f.store.close();
  }
});

test("cancellation prevents provider calls and retains cancelled status", async () => {
  const f = setup();
  try {
    f.store.cancel(f.id);
    await runScout(f.id, input, f.store, f.providers, f.journal);
    expect(f.store.get(f.id)?.status).toBe("cancelled");
    expect(f.counts()).toEqual({ reads: 0, models: 0 });
  } finally {
    f.store.close();
  }
});

test("reject unsafe URLs and unsupported candidate skills", () => {
  for (const url of ["http://example.com", "https://localhost", "https://127.0.0.1", "https://[::1]", "https://a.internal", "https://user:pass@example.com", "https://example.com:3000"]) {
    expect(() => publicURL(url)).toThrow();
  }
  expect(publicURL("https://example.com/docs#section")).toBe("https://example.com/docs");
  expect(validateEvidence({ ...dossier, fit: [{ ...dossier.fit[0]!, skill: "Rust" }] }, [source], input).length).toBeGreaterThan(0);
  expect(Dossier.safeParse(dossier).success).toBe(true);
});

test("a restart resumes from the SQLite step journal without repeating completed work", async () => {
  const dir = mkdtempSync(join(tmpdir(), "scout-journal-"));
  const dbPath = join(dir, "runs.db");
  let store = new RunStore(dbPath);
  const f = setup(true, false, store);
  let failed = false;
  const original = f.providers.model;
  f.providers.model = async (...args) => {
    if (!failed) {
      failed = true;
      throw new Error("Injected transient failure");
    }
    return original(...args);
  };
  try {
    await expect(runScout(f.id, input, f.store, f.providers, f.journal)).rejects.toThrow("Injected transient failure");
    store.close();
    // Simulated process restart: reopen the same database and replay the run.
    store = new RunStore(dbPath);
    const journal: StepRunner = (name, work) => store.step(f.id, name, work);
    await runScout(f.id, input, store, f.providers, journal);
    expect(store.get(f.id)?.status).toBe("completed");
    expect(f.counts().reads).toBe(1);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("citation validation tolerates only whitespace formatting differences", () => {
  const spaced = { ...source, excerpt: "We build\n developer tools using TypeScript." };
  expect(validateEvidence(dossier, [spaced], input)).toEqual([]);
  expect(validateEvidence({ ...dossier, brief: [{ ...cited, citations: [{ sourceId: source.id, quote: "We build excellent developer tools" }] }] }, [spaced], input).length).toBeGreaterThan(0);
});

test("research loop forwards the exact tool call ID with saved source results", async () => {
  const f = setup();
  let phase = 0;
  const original = f.providers.model;
  f.providers.search = async () => ({ sources: [source], requestId: "fixture-search", costDollars: 0, failures: 0 });
  f.providers.model = async (messages, tools, submitOnly) => {
    if (tools && phase++ === 0) {
      return {
        tokens: 10,
        costDollars: 0,
        message: {
          role: "assistant" as const,
          refusal: null,
          content: null,
          tool_calls: [{ id: "search-call-123", type: "function" as const, function: { name: "search_company_evidence", arguments: JSON.stringify({ query: "Fixture developer tools", objective: "Find supported facts" }) } }],
        },
      };
    }
    if (tools) {
      const tool = messages.find((m) => m.role === "tool");
      expect(tool?.tool_call_id).toBe("search-call-123");
    }
    return original(messages, tools, submitOnly);
  };
  try {
    await runScout(f.id, input, f.store, f.providers, f.journal);
    expect(f.store.get(f.id)?.status).toBe("completed");
  } finally {
    f.store.close();
  }
});

test("untrusted page instructions cannot grant an unauthorized tool", async () => {
  const f = setup();
  f.providers.model = async () => ({
    tokens: 10,
    costDollars: 0,
    message: {
      role: "assistant" as const,
      refusal: null,
      content: null,
      tool_calls: [{ id: "injected", type: "function" as const, function: { name: "send_email", arguments: "{}" } }],
    },
  });
  try {
    await runScout(f.id, input, f.store, f.providers, f.journal);
    expect(f.store.get(f.id)?.status).toBe("partial");
    expect(f.counts().reads).toBe(1);
    expect(f.store.events(f.id).some((e) => (e as { name: string }).name === "validation-feedback")).toBe(true);
  } finally {
    f.store.close();
  }
});

test("rendered citation comparison accepts bold formatting but not changed claims", () => {
  expect(validateEvidence(dossier, [{ ...source, excerpt: "We build **developer tools** using TypeScript." }], input)).toEqual([]);
  expect(validateEvidence(dossier, [{ ...source, excerpt: "We build developer toys using TypeScript." }], input).length).toBeGreaterThan(0);
});

test("straight apostrophe matches a curly apostrophe in the source", () => {
  const curly = { ...source, excerpt: "We build developer tools using TypeScript. The World’s Largest Prediction Market™" };
  const quoted = { ...dossier, brief: [{ ...cited, citations: [{ sourceId: source.id, quote: "The World's Largest Prediction Market™" }] }] };
  expect(validateEvidence(quoted, [curly], input)).toEqual([]);
  expect(validateEvidence({ ...quoted, brief: [{ ...cited, citations: [{ sourceId: source.id, quote: "The Worlds Largest Prediction Market" }] }] }, [curly], input).length).toBeGreaterThan(0);
});

test("fenced reviewer JSON with an escaped apostrophe still parses", () => {
  expect(parseJSON('```json\n{"approved":false,"issues":["World\\\'s"]}\n```')).toEqual({ approved: false, issues: ["World's"] });
});

test("unreadable reviewer JSON does not fail the run", async () => {
  const f = setup(false);
  let reviews = 0;
  const original = f.providers.model;
  f.providers.model = async (messages, tools, submitOnly) => {
    if (!tools && reviews++ === 0) {
      return { tokens: 10, costDollars: 0, message: { role: "assistant" as const, refusal: null, content: "not json" } };
    }
    return original(messages, tools, submitOnly);
  };
  try {
    await runScout(f.id, input, f.store, f.providers, f.journal);
    expect(f.store.get(f.id)?.status).toBe("partial");
    expect(f.store.events(f.id).some((e) => (e as { name: string }).name === "validation-feedback")).toBe(true);
  } finally {
    f.store.close();
  }
});

test("a plain step runner still works when no journal is available", async () => {
  const f = setup();
  try {
    const state = await runScout(f.id, input, f.store, f.providers, memoryStep);
    expect(f.store.get(f.id)?.status).toBe("completed");
    expect(state.dossier?.companyName).toBe("Fixture");
  } finally {
    f.store.close();
  }
});
