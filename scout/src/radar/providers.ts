import Exa from "exa-js";
import OpenAI from "openai";
import { createHash } from "node:crypto";
import { publicURL } from "../research/contracts.ts";
import { DEFAULT_MODELS } from "../research/providers.ts";
import { INDIA_DOMAINS, RADAR_LIMITS, type Article } from "./contracts.ts";
import type { RadarProviders } from "./radar.ts";

export function liveRadarProviders(): RadarProviders {
  for (const name of ["EXA_API_KEY", "OPENROUTER_API_KEY"]) {
    if (!process.env[name]?.trim()) throw new Error(`${name}_REQUIRED`);
  }
  const exa = new Exa(process.env.EXA_API_KEY);
  const domains = process.env.RADAR_DOMAINS?.split(",").map((d) => d.trim()).filter(Boolean) ?? INDIA_DOMAINS;
  // The radar's own client: a long roundup can take over a minute to extract,
  // longer than the research client's timeout allows.
  const client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
    maxRetries: 0,
    timeout: RADAR_LIMITS.modelTimeoutMs,
    defaultHeaders: { "X-Title": "scout" },
  });
  const effort = process.env.RADAR_REASONING_EFFORT?.trim();
  let lastCall = 0;
  return {
    async news(query, since) {
      const response = await exa.search(query, {
        category: "news",
        startPublishedDate: since.toISOString(),
        numResults: RADAR_LIMITS.resultsPerQuery,
        ...(domains.length ? { includeDomains: domains } : {}),
        // Enough for a roundup; runRadar trims single stories to their shorter limit.
        contents: { text: { maxCharacters: Math.max(RADAR_LIMITS.articleCharacters, RADAR_LIMITS.roundupCharacters) } },
      });
      return response.results.flatMap((r): Article[] => {
        let url: string;
        try {
          url = publicURL(r.url);
        } catch {
          return [];
        }
        return [{
          id: `a-${createHash("sha256").update(url).digest("hex").slice(0, 10)}`,
          url,
          title: r.title || url,
          publishedDate: r.publishedDate ?? null,
          text: r.text ?? "",
        }];
      });
    },
    async model(messages) {
      // Free tiers allow only a few requests a minute, so calls are spaced out.
      const wait = lastCall + RADAR_LIMITS.callGapMs - Date.now();
      if (wait > 0) await Bun.sleep(wait);
      lastCall = Date.now();
      const response = await client.chat.completions.create({
        model: process.env.RESEARCH_MODEL || DEFAULT_MODELS.research,
        messages,
        // Reasoning models spend output tokens on thinking, so a list of rounds needs headroom.
        max_tokens: RADAR_LIMITS.maxTokensPerCall,
        response_format: { type: "json_object" },
        ...(effort ? { reasoning_effort: effort as OpenAI.ReasoningEffort } : {}),
      });
      if (response.choices[0]?.finish_reason === "length") throw new Error("MODEL_OUTPUT_TRUNCATED");
      const message = response.choices[0]?.message;
      if (!message) throw new Error("MODEL_EMPTY_RESPONSE");
      return { message };
    },
  };
}
