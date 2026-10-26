import { Spectrum } from "spectrum-ts";
import { imessage } from "@spectrum-ts/imessage";
import { acceptProposal, freshChat, nextAsk, spokenText } from "./interview.ts";
import { propose } from "./model.ts";
import { openStore } from "./store.ts";

const store = openStore();
const started = Date.now();
const generation = new Map<string, number>();
const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; parts: string[] }>();
const toldGroup = new Set<string>();

const app = await Spectrum({
  projectId: process.env.PROJECT_ID!,
  projectSecret: process.env.PROJECT_SECRET!,
  providers: [imessage.config()],
});

console.log("scout listening");

for await (const [space, message] of app.messages) {
  if (message.direction === "outbound" || message.platform !== "imessage") continue;
  if (message.timestamp.getTime() < started - 15_000) continue;
  if (imessage(space).type === "group") {
    if (!toldGroup.has(space.id)) {
      toldGroup.add(space.id);
      await space.send("Text me directly.");
    }
    continue;
  }

  const row = store.load(space.id);
  if (row.seen.includes(message.id)) continue;
  row.seen.push(message.id);
  store.save(space.id, row);
  console.log(`in ${message.content.type}`);

  const text = spokenText(message.content);
  if (!text) {
    if (message.content.type === "attachment" && !row.chat.warnedFile) {
      row.chat.warnedFile = true;
      store.save(space.id, row);
      await space.send("Type the part you want me to know. I can't read the file.");
    }
    continue;
  }

  const slot = pending.get(space.id) ?? { timer: setTimeout(() => undefined, 0), parts: [] as string[] };
  clearTimeout(slot.timer);
  slot.parts.push(text);
  const turn = (generation.get(space.id) ?? 0) + 1;
  generation.set(space.id, turn);
  slot.timer = setTimeout(() => {
    pending.delete(space.id);
    const said = slot.parts.join("\n");
    void space.responding(async () => {
      if (generation.get(space.id) !== turn) return;
      const current = store.load(space.id);
      const reply = await answer(current.chat, said);
      if (generation.get(space.id) !== turn) return;
      store.save(space.id, { chat: reply.chat, seen: current.seen });
      await space.send(reply.say);
      console.log(`out ${reply.chat.status}`);
    }).catch((error: unknown) => {
      console.log(`turn failed ${error instanceof Error ? error.name : "Error"}`);
    });
  }, 1200);
  pending.set(space.id, slot);
}

async function answer(chat: ReturnType<typeof freshChat>, said: string) {
  if (chat.status === "locked") {
    if (/^unlock\b/i.test(said)) {
      const next = { ...chat, status: "talking" as const, transcript: [...chat.transcript, { from: "them" as const, text: said }, { from: "scout" as const, text: "Unlocked. What should I change?" }] };
      return { chat: next, say: "Unlocked. What should I change?" };
    }
    const say = /^https:\/\//i.test(said)
      ? "Not the company yet. I want this picture of you right first."
      : "That's locked. Say unlock if I got something wrong.";
    return { chat, say };
  }
  try {
    const proposal = await propose(chat, said);
    return acceptProposal(chat, said, proposal);
  } catch (error) {
    console.log(`model failed ${error instanceof Error ? error.name : "Error"}`);
    const say = nextAsk(chat.draft);
    return {
      say,
      chat: { ...chat, transcript: [...chat.transcript, { from: "them" as const, text: said }, { from: "scout" as const, text: say }].slice(-40) },
    };
  }
}
