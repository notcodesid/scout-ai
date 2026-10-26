export type WorkMode = "remote" | "hybrid" | "onsite" | "unspecified";

export type Draft = {
  name?: string;
  experience?: string;
  skills?: string[];
  productKind?: string;
  products?: string;
  location?: string;
  workMode?: WorkMode;
  timeBudget?: string;
  contribution?: string;
  constraints?: string;
};

export type Chat = {
  status: "talking" | "locked";
  draft: Draft;
  transcript: { from: "them" | "scout"; text: string }[];
  warnedFile: boolean;
};

export type Proposal = {
  say: string;
  set: Partial<Draft>;
  ready: boolean;
};

const REQUIRED: (keyof Draft)[] = ["name", "experience", "skills", "productKind", "products", "location", "workMode", "timeBudget", "contribution", "constraints"];

const ASKS: Record<keyof Draft, string> = {
  name: "What do I call you?",
  experience: "What have you actually built?",
  skills: "What do you use when you build?",
  productKind: "What kind of product do you want to be in?",
  products: "Which products do you already like?",
  location: "Where are you based?",
  workMode: "Remote, hybrid, or in an office?",
  timeBudget: "How much time can you give this?",
  contribution: "How small should the first piece of work be?",
  constraints: "Anything you won't do?",
};

export function freshChat(): Chat {
  return { status: "talking", draft: {}, transcript: [], warnedFile: false };
}

export function spokenText(content: { type: string; text?: string; content?: { type: string; text?: string } }): string | null {
  if (content.type === "text" && content.text?.trim()) return content.text.trim();
  if (content.type === "reply" && content.content?.type === "text" && content.content.text?.trim()) return content.content.text.trim();
  return null;
}

export function nextAsk(draft: Draft): string {
  for (const key of REQUIRED) {
    const value = draft[key];
    if (key === "skills" ? !value || (value as string[]).length === 0 : value == null || value === "") return ASKS[key];
  }
  return "Does that match what you meant?";
}

export function acceptProposal(chat: Chat, userText: string, proposal: Proposal): { chat: Chat; say: string } {
  const them = userText.trim();
  const set = { ...proposal.set };
  if (!chat.draft.name && !set.name) {
    const name = plainName(them);
    if (name) set.name = name;
  }
  const draft = ground(chat.draft, them, chat.transcript, set);
  const ready = proposal.ready && affirms(them) && complete(draft) && chat.transcript.some((line) => line.from === "scout");
  let say = oneBeat(proposal.say) || nextAsk(draft);
  if (say.length > 280 || (draft.name && /call you/i.test(say))) say = nextAsk(draft);
  const previous = [...chat.transcript].reverse().find((line) => line.from === "scout");
  if (previous?.text === say) say = nextAsk(draft);
  const status = ready ? "locked" as const : "talking" as const;
  const text = ready ? `${say} Locked. Companies come after this.` : say;
  return {
    say: text,
    chat: {
      status,
      draft,
      warnedFile: chat.warnedFile,
      transcript: [...chat.transcript, { from: "them" as const, text: them }, { from: "scout" as const, text }].slice(-40),
    },
  };
}

export function toResearchProfile(draft: Draft) {
  if (!draft.name || !draft.experience || !draft.skills?.length) return null;
  return {
    name: draft.name,
    skills: draft.skills,
    experience: draft.experience,
    interests: [draft.productKind, draft.products].filter(Boolean).join(". ").slice(0, 600),
    constraints: [
      draft.location && `Based in ${draft.location}`,
      draft.workMode && draft.workMode !== "unspecified" && `Wants ${draft.workMode} work`,
      draft.timeBudget && `Time: ${draft.timeBudget}`,
      draft.contribution && `First contribution: ${draft.contribution}`,
      draft.constraints && draft.constraints.toLowerCase() !== "none" && draft.constraints,
    ].filter(Boolean).join(". ").slice(0, 600),
    fictional: false,
  };
}

function plainName(text: string) {
  if (!/^[A-Za-z][A-Za-z.'-]{1,30}$/.test(text)) return;
  const skip = new Set(["yo", "hi", "hey", "hello", "sup", "what", "ok", "okay", "yes", "no", "nah", "yep", "yeah", "yup"]);
  if (skip.has(text.toLowerCase())) return;
  return text;
}

function complete(draft: Draft) {
  return REQUIRED.every((key) => {
    const value = draft[key];
    return key === "skills" ? Array.isArray(value) && value.length > 0 : typeof value === "string" && value.length > 0;
  });
}

function affirms(text: string) {
  return /^(yes|yep|yeah|yup|correct|right|lock|that's right|thats right|sounds right|that matches)\b/i.test(text.trim());
}

function ground(current: Draft, latest: string, transcript: Chat["transcript"], set: Partial<Draft>): Draft {
  const corpus = [latest, ...transcript.filter((line) => line.from === "them").map((line) => line.text)].join("\n");
  const next: Draft = { ...current };
  if (set.name && borrowed(set.name, corpus) && set.name.length <= 80) next.name = set.name.trim();
  if (set.experience && borrowed(set.experience, corpus)) next.experience = set.experience.trim().slice(0, 1500);
  if (Array.isArray(set.skills) && set.skills.length) {
    const skills = set.skills.map((skill) => skill.trim()).filter((skill) => skill && skill.length <= 80 && borrowed(skill, corpus));
    if (skills.length) next.skills = [...new Set(skills)].slice(0, 12);
  }
  if (set.productKind && borrowed(set.productKind, corpus)) next.productKind = set.productKind.trim().slice(0, 600);
  if (set.products && borrowed(set.products, corpus)) next.products = set.products.trim().slice(0, 600);
  if (set.location && borrowed(set.location, corpus)) next.location = set.location.trim().slice(0, 600);
  const heard = workMode(corpus);
  const mode = typeof set.workMode === "string" ? set.workMode.toLowerCase() : undefined;
  if (heard && mode === heard) next.workMode = heard;
  if (set.timeBudget && borrowed(set.timeBudget, corpus)) next.timeBudget = set.timeBudget.trim().slice(0, 600);
  if (set.contribution && borrowed(set.contribution, corpus)) next.contribution = set.contribution.trim().slice(0, 600);
  if (set.constraints && (set.constraints.toLowerCase() === "none" || borrowed(set.constraints, corpus))) next.constraints = set.constraints.trim().slice(0, 600);
  return next;
}

function borrowed(value: string, corpus: string) {
  const hay = corpus.toLowerCase();
  const words = value.toLowerCase().match(/[a-z0-9][a-z0-9+.#-]{2,}/g) ?? [];
  const meaningful = words.filter((word) => !STOP.has(word));
  if (!meaningful.length) return hay.includes(value.toLowerCase().trim());
  return meaningful.every((word) => hay.includes(word));
}

function workMode(corpus: string): WorkMode | undefined {
  const text = corpus.toLowerCase();
  if (/\bhybrid\b/.test(text)) return "hybrid";
  if (/\bremote\b|\banywhere\b/.test(text)) return "remote";
  if (/\bonsite\b|\bon-site\b|\boffice\b/.test(text)) return "onsite";
  if (/\bflexible\b|\beither\b|\bno preference\b/.test(text)) return "unspecified";
  return undefined;
}

function oneBeat(say: string) {
  const clean = say.replace(/\s+/g, " ").replace(/[*_#]/g, "").trim();
  if (!clean || /tell me in text/i.test(clean)) return "";
  const parts = clean.split(/(?<=[.!?])\s+/).filter(Boolean);
  const questions = parts.filter((part) => part.includes("?"));
  if (questions.length > 1) return questions[0]!.slice(0, 280);
  return parts.slice(0, 2).join(" ").slice(0, 280);
}

const STOP = new Set(["the", "and", "for", "with", "you", "your", "that", "this", "have", "has", "was", "are", "but", "not", "from", "they", "them", "just", "about", "into", "what", "when", "where", "who", "how", "can", "will", "want", "like", "some", "any", "really", "actually", "been", "its", "it's"]);
