import Exa from "exa-js";

/** Raw evidence for Scout's own model; synthesis and claim review stay in Scout. */
export class ExaRetrieval {
  constructor(private readonly client: Exa) {}

  search(query: string, options: { numResults?: number } = {}) {
    if (!query.trim()) throw new Error("EXA_QUERY_REQUIRED");
    return this.client.search(query, {
      contents: { highlights: true },
      ...(options.numResults === undefined ? {} : { numResults: options.numResults }),
    });
  }

  async contents(urls: string[]) {
    if (!urls.length) throw new Error("EXA_URLS_REQUIRED");
    const response = await this.client.getContents(urls, { highlights: true });
    // HTTP 200 can contain per-page errors. Return successes and failures so a
    // research run can retain useful evidence and explicitly report gaps.
    return {
      ...response,
      failures: response.statuses?.filter((status) => status.status !== "success") ?? [],
    };
  }
}

export function createExaRetrieval() {
  if (!process.env.EXA_API_KEY?.trim()) throw new Error("EXA_API_KEY_REQUIRED");
  return new ExaRetrieval(new Exa(process.env.EXA_API_KEY));
}
