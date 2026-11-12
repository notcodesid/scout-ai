import Exa from "exa-js";
import { createHash } from "node:crypto";
import { publicURL } from "../research/contracts.ts";
import { liveProviders } from "../research/providers.ts";
import { INDIA_DOMAINS, RADAR_LIMITS, type Article } from "./contracts.ts";
import type { RadarProviders } from "./radar.ts";

export function liveRadarProviders(): RadarProviders {
  for (const name of ["EXA_API_KEY", "OPENROUTER_API_KEY"]) {
    if (!process.env[name]?.trim()) throw new Error(`${name}_REQUIRED`);
  }
  const exa = new Exa(process.env.EXA_API_KEY);
  const domains = process.env.RADAR_DOMAINS?.split(",").map((d) => d.trim()).filter(Boolean) ?? INDIA_DOMAINS;
  const { model } = liveProviders();
  return {
    async news(query, since) {
      const response = await exa.search(query, {
        category: "news",
        startPublishedDate: since.toISOString(),
        numResults: RADAR_LIMITS.resultsPerQuery,
        ...(domains.length ? { includeDomains: domains } : {}),
        contents: { text: { maxCharacters: RADAR_LIMITS.articleCharacters } },
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
    // Reasoning models spend output tokens on thinking, so a list of rounds needs headroom.
    model: (messages) => model(messages, undefined, false, "research", RADAR_LIMITS.maxTokensPerCall),
  };
}
