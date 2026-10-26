import OpenAI from "openai";
import Exa from "exa-js";
import { createHash } from "node:crypto";
import { ExaRetrieval } from "./exa-retrieval.ts";
import { LIMITS, publicURL, type Source } from "./contracts.ts";

export type Retrieval = { sources: Source[]; requestId: string; costDollars: number; failures: number };

export type ModelPurpose = "research" | "review";

export interface Providers {
  model(
    messages: OpenAI.ChatCompletionMessageParam[],
    tools?: OpenAI.ChatCompletionTool[],
    submitOnly?: boolean,
    purpose?: ModelPurpose,
  ): Promise<{ message: OpenAI.ChatCompletionMessage; tokens: number; costDollars: number | null }>;
  read(url: string): Promise<Retrieval>;
  search(query: string, objective: string): Promise<Retrieval>;
}

export const DEFAULT_MODELS: Record<ModelPurpose, string> = {
  // Free tier while unfunded: 50 requests/day is ~6 full company runs.
  // With credits, swap to "openai/gpt-5.6-luna" for stronger research.
  research: "nvidia/nemotron-3-ultra-550b-a55b:free",
  // Deliberately a different family than the researcher so review is not self-approval.
  // With credits, swap to "google/gemini-3.1-pro-preview".
  review: "thinkingmachines/inkling:free",
};

export function liveProviders(): Providers {
  const exa = new Exa(process.env.EXA_API_KEY);
  const retrieval = new ExaRetrieval(exa);
  const models: Record<ModelPurpose, string> = {
    research: process.env.RESEARCH_MODEL || DEFAULT_MODELS.research,
    review: process.env.REVIEWER_MODEL || DEFAULT_MODELS.review,
  };
  let lastCost: number | null = null;
  const client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
    maxRetries: 0,
    timeout: 45000,
    defaultHeaders: { "X-Title": "scout" },
  });
  const normalize = (response: any): Retrieval => ({
    sources: response.results.flatMap((r: any) => {
      let url: string;
      try {
        url = publicURL(r.url);
      } catch {
        return [];
      }
      const excerpt = (r.highlights ?? []).join("\n").slice(0, 4000);
      if (!excerpt.trim()) return [];
      return [{
        id: `s-${createHash("sha256").update(url + "\n" + excerpt).digest("hex").slice(0, 12)}`,
        url,
        title: r.title || url,
        retrievedAt: new Date().toISOString(),
        excerpt,
      }];
    }),
    requestId: response.requestId || "",
    costDollars: response.costDollars?.total ?? 0,
    failures: response.failures?.length ?? 0,
  });
  return {
    async model(messages, tools, submitOnly, purpose = "research") {
      lastCost = null;
      // `usage.include` is an OpenRouter extension: ask it to report actual cost.
      const params = {
        model: models[purpose],
        messages,
        max_tokens: LIMITS.maxTokensPerCall,
        usage: { include: true },
        ...(tools
          ? { tools, tool_choice: submitOnly ? { type: "function", function: { name: "submit_dossier" } } : "required", parallel_tool_calls: false }
          : { response_format: { type: "json_object" } }),
      } as OpenAI.ChatCompletionCreateParamsNonStreaming & { usage?: { include: boolean } };
      const response = await client.chat.completions.create(params);
      const cost = (response.usage as { cost?: number } | undefined)?.cost;
      lastCost = typeof cost === "number" && Number.isFinite(cost) ? cost : null;
      if (response.choices[0]?.finish_reason === "length") throw new Error("MODEL_OUTPUT_TRUNCATED");
      const message = response.choices[0]?.message;
      if (!message) throw new Error("MODEL_EMPTY_RESPONSE");
      return { message, tokens: response.usage?.total_tokens ?? 0, costDollars: lastCost };
    },
    read: async (url) => normalize(await retrieval.contents([url])),
    search: async (query, objective) =>
      normalize(await exa.search(query, { objective, numResults: LIMITS.searchResults, contents: { highlights: true } })),
  };
}
