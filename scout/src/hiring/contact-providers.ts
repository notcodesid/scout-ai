// Live providers for the contact finder (Exa page reads and search, MX lookup, optional Hunter).
// Shared by `bun run contacts` and `bun run daily`.
import Exa from "exa-js";
import { resolveMx } from "node:dns/promises";
import { publicURL } from "../research/contracts.ts";
import { hunterProviders, mxOverHttps, type ContactProviders, type HttpGet } from "./contacts.ts";
import type { Page } from "./contracts.ts";

let dnsWorks: Promise<boolean> | undefined;

const get: HttpGet = async (url, headers) => {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  return { status: response.status, body: await response.json().catch(() => null) };
};

export function liveContactProviders(): ContactProviders {
  if (!process.env.EXA_API_KEY?.trim()) throw new Error("EXA_API_KEY_REQUIRED");
  const exa = new Exa(process.env.EXA_API_KEY);
  const text = { maxCharacters: 6000 };
  const pages = (response: { results: any[] }): Page[] =>
    response.results.flatMap((r): Page[] => {
      try {
        return [{ url: publicURL(r.url), title: r.title || r.url, publishedDate: r.publishedDate ?? null, text: r.text ?? "", links: [] }];
      } catch {
        return [];
      }
    });
  const hunterKey = process.env.HUNTER_API_KEY?.trim();
  return {
    read: async (urls) => pages(await exa.getContents(urls, { text })),
    web: async (query) => pages(await exa.search(query, { numResults: 5, contents: { text } })),
    async hasMail(domain) {
      // Plain DNS first; where the network blocks it, ask a public resolver over HTTPS instead.
      dnsWorks ??= resolveMx("gmail.com").then((records) => records.length > 0, () => false);
      if (await dnsWorks) {
        try {
          return (await resolveMx(domain)).some((record) => record.exchange && record.exchange !== ".");
        } catch (error) {
          if (["ENODATA", "ENOTFOUND"].includes((error as { code?: string }).code ?? "")) return false;
        }
      }
      return mxOverHttps(domain, get);
    },
    ...(hunterKey ? hunterProviders(hunterKey, get) : {}),
  };
}
