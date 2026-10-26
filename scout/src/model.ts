import OpenAI from "openai";
import type { Chat, Proposal } from "./interview.ts";

const SYSTEM = `You text as Scout. One iMessage thread. You are learning who this person is so a later step can research a company. You do not research anything here.

Text like a sharp friend. One or two short sentences. No bullets, labels, headers, or "certainly". Ask one thing. If they say "what", "?", "hi", or "idk", ask what they meant and record nothing from it.

Record only words they said. An interest is not experience. Do not add seniority, employers, or skills they did not name.

Over the conversation you need: what to call them, what they have built, skills they use, the kind of product they want, products they already like, where they live, remote or hybrid or onsite, how much time they have, how small the first piece of work must stay, and anything off limits. When you have that, say it back in a sentence or two and ask if you heard it right. Set ready true only after they agree.

If they send a company URL, say companies come after this picture of them is right.

Return JSON only: {"say":"...","set":{},"ready":false}
set may include name, experience, skills, productKind, products, location, workMode (remote|hybrid|onsite|unspecified), timeBudget, contribution, constraints. Omit a field unless their words support it.`;

let client: OpenAI | undefined;

export async function propose(chat: Chat, userText: string): Promise<Proposal> {
  client ??= new OpenAI({
    apiKey: "ollama",
    baseURL: process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434/v1",
    maxRetries: 0,
    timeout: 60000,
  });
  const history = chat.transcript.slice(-12).map((line) => ({
    role: line.from === "them" ? "user" as const : "assistant" as const,
    content: line.text,
  }));
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: `${SYSTEM}\n\nKnown so far: ${JSON.stringify(chat.draft)}` },
    ...history,
    { role: "user", content: userText },
  ];
  const model = process.env.SCOUT_MODEL || "qwen2.5:3b";
  let content = "";
  try {
    const response = await client.chat.completions.create({
      model,
      max_tokens: 300,
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages,
    });
    content = response.choices[0]?.message.content ?? "";
  } catch {
    const response = await client.chat.completions.create({
      model,
      max_tokens: 300,
      temperature: 0.4,
      messages,
    });
    content = response.choices[0]?.message.content ?? "";
  }
  return readProposal(content);
}

function readProposal(content: string): Proposal {
  const trimmed = content.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const body = fenced?.[1] ?? trimmed;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const raw = JSON.parse(body.slice(start, end + 1)) as Partial<Proposal>;
      const say = typeof raw.say === "string" && raw.say.trim() ? raw.say : trimmed;
      return { say, set: raw.set && typeof raw.set === "object" ? raw.set : {}, ready: raw.ready === true };
    } catch {
      // The local model sometimes writes a sentence instead of JSON.
    }
  }
  return { say: trimmed, set: {}, ready: false };
}
