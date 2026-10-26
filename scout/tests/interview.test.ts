import { expect, test } from "bun:test";
import { acceptProposal, freshChat, spokenText, type Chat } from "../src/interview.ts";

function talking(draft: Chat["draft"], scoutSaid = "What have you actually built?"): Chat {
  return { status: "talking", draft, warnedFile: false, transcript: [{ from: "scout", text: scoutSaid }] };
}

test("a one-word name is kept even if the model forgets the field", () => {
  const turn = acceptProposal(talking({}), "Sid", { say: "What do I call you?", set: {}, ready: false });
  expect(turn.chat.draft.name).toBe("Sid");
  expect(turn.say).toBe("What have you actually built?");
});

test("a thin reply is not stored as experience", () => {
  const turn = acceptProposal(talking({ name: "Sid" }), "What", {
    say: "What have you actually built?",
    set: { experience: "Staff engineer at a large company" },
    ready: false,
  });
  expect(turn.chat.draft.experience).toBeUndefined();
  expect(turn.say).toBe("What have you actually built?");
});

test("skills they did not say are dropped", () => {
  const turn = acceptProposal(talking({ name: "Sid" }), "I use TypeScript and React on small sites.", {
    say: "What kind of product do you want to be in?",
    set: { experience: "small sites", skills: ["TypeScript", "React", "Kubernetes"] },
    ready: false,
  });
  expect(turn.chat.draft.skills).toEqual(["TypeScript", "React"]);
  expect(turn.chat.draft.experience).toBe("small sites");
});

test("yes does not lock an unfinished profile", () => {
  const turn = acceptProposal(talking({ name: "Sid" }), "yes", {
    say: "Locked.",
    set: {},
    ready: true,
  });
  expect(turn.chat.status).toBe("talking");
});

test("yes locks only after they agree and the picture is full", () => {
  const draft: Chat["draft"] = {
    name: "Sid",
    experience: "small sites",
    skills: ["TypeScript"],
    productKind: "developer tools",
    products: "Linear",
    location: "Bengaluru",
    workMode: "remote",
    timeBudget: "twenty hours",
    contribution: "a few hours",
    constraints: "none",
  };
  const chat = talking(draft, "Small sites, TypeScript, devtools, Linear, Bengaluru, remote, twenty hours, a few hours, nothing off limits. That right?");
  const turn = acceptProposal(chat, "yes that's right", { say: "Good.", set: {}, ready: true });
  expect(turn.chat.status).toBe("locked");
  expect(turn.say).toContain("Locked.");
});

test("protocol events are not conversation", () => {
  expect(spokenText({ type: "read" })).toBeNull();
  expect(spokenText({ type: "reaction" })).toBeNull();
  expect(spokenText({ type: "typing" })).toBeNull();
  expect(spokenText({ type: "text", text: "  hi " })).toBe("hi");
  expect(spokenText({ type: "reply", content: { type: "text", text: "remote" } })).toBe("remote");
});

test("two questions collapse to one", () => {
  const turn = acceptProposal(freshChat(), "Sid", {
    say: "What have you built? And where do you live? Also how senior are you?",
    set: { name: "Sid" },
    ready: false,
  });
  expect(turn.say).toBe("What have you built?");
  expect(turn.chat.draft.name).toBe("Sid");
});
