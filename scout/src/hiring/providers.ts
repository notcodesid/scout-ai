import Exa from "exa-js";
import { publicURL } from "../research/contracts.ts";
import { HIRING_LIMITS, type Page } from "./contracts.ts";
import type { HiringProviders } from "./check.ts";

export function liveHiringProviders(): HiringProviders {
  if (!process.env.EXA_API_KEY?.trim()) throw new Error("EXA_API_KEY_REQUIRED");
  const exa = new Exa(process.env.EXA_API_KEY);
  const text = { maxCharacters: HIRING_LIMITS.excerptCharacters };
  const pages = (response: { results: any[] }): Page[] =>
    response.results.flatMap((r): Page[] => {
      try {
        return [{
          url: publicURL(r.url), title: r.title || r.url, publishedDate: r.publishedDate ?? null, text: r.text ?? "",
          links: r.extras?.links ?? [], author: typeof r.author === "string" && r.author.trim() ? r.author.trim() : null,
        }];
      } catch {
        return [];
      }
    });
  return {
    companies: async (query) => pages(await exa.search(query, { category: "company", numResults: HIRING_LIMITS.siteResults, contents: { text } })),
    web: async (query) => pages(await exa.search(query, { numResults: HIRING_LIMITS.careerResults, contents: { text, extras: { links: 60 } } })),
    // Posts are read in full: the reaction and comment counts sit at the very end of the text.
    posts: async (query, since) =>
      pages(await exa.search(query, {
        numResults: HIRING_LIMITS.postResults,
        includeDomains: ["linkedin.com", "x.com"],
        startPublishedDate: since.toISOString(),
        contents: { text: { maxCharacters: HIRING_LIMITS.postCharacters } },
      })),
    contents: async (urls) =>
      pages(await exa.getContents(urls.map((url) => publicURL(url)), { text: { maxCharacters: HIRING_LIMITS.careersCharacters }, extras: { links: 80 } })),
    async json(url) {
      const response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    },
  };
}
