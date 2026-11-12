// iMessage side of the digest: which texts ask for it, and what to text back.
// Pure and Spectrum-free so it can be tested. It only reads what the daily run
// stored; it never searches, never calls a model and never contacts anyone.
import { formatDigestMessages, type Digest } from "./digest.ts";

/** The whole message must be one of these (case, apostrophe style and end punctuation aside). */
export const DIGEST_COMMANDS = ["radar", "jobs", "digest", "who's hiring", "whos hiring", "who is hiring"] as const;

export function isDigestCommand(text: string) {
  const said = text.trim().toLowerCase().replace(/[’‘`]/g, "'").replace(/[\s?.!]+$/, "").replace(/\s+/g, " ");
  return (DIGEST_COMMANDS as readonly string[]).includes(said);
}

export const NO_DIGEST = "No digest yet. It gets built by the daily run on the computer (bun run daily), not from here.";

/**
 * The texts to send back for a digest command, or null when the message is not
 * one (the caller then carries on with the interview exactly as before).
 * `load` reads the stored digest; null or a throw means there is nothing to show.
 */
export function digestReply(text: string, load: () => Digest | null): string[] | null {
  if (!isDigestCommand(text)) return null;
  let digest: Digest | null = null;
  try {
    digest = load();
  } catch {
    return ["I couldn't read the stored digest. Run bun run daily again on the computer."];
  }
  if (!digest || !(digest.entries.length + digest.leftOut.length)) return [NO_DIGEST];
  return formatDigestMessages(digest);
}
