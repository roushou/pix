/**
 * session-name — auto-name sessions after their first user message.
 *
 * After the agent settles, if the session has no name yet, the first user
 * message is slugified into a short, readable name (e.g.
 * "add a bash permission gate" → "add-a-bash-permission-gate"). This makes
 * `/resume` and the session selector show intent instead of timestamps.
 *
 * `/rename [name]` sets a custom name (or shows the current one), overriding
 * auto-naming for the rest of the session.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const MAX_WORDS = 6;
const MAX_LEN = 48;
const MIN_LEN = 6;

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "of",
  "to",
  "in",
  "on",
  "for",
  "with",
  "at",
  "by",
  "from",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its",
  "my",
  "our",
  "your",
  "please",
  "just",
  "can",
  "could",
  "should",
  "would",
  "will",
  "we",
  "i",
  "me",
  "us",
  "them",
  "him",
  "her",
]);

function firstUserText(ctx: ExtensionContext): string | null {
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type !== "message" || entry.message.role !== "user") continue;
    const parts: string[] = [];
    for (const block of entry.message.content as Array<{ type: string; text?: string }>) {
      if (block.type === "text" && block.text) parts.push(block.text);
    }
    const text = parts.join(" ").trim();
    if (text) return text;
  }
  return null;
}

function slugify(text: string): string | null {
  const cleaned = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;

  const words = cleaned
    .split(" ")
    .filter((w) => w.length > 0 && !STOPWORDS.has(w))
    .slice(0, MAX_WORDS);
  if (words.length === 0) return null;

  let slug = words.join("-");
  if (slug.length < MIN_LEN) return null;

  // Truncate at word boundaries until it fits.
  while (slug.length > MAX_LEN) {
    const cut = slug.lastIndexOf("-");
    if (cut <= 0) {
      slug = slug.slice(0, MAX_LEN);
      break;
    }
    slug = slug.slice(0, cut);
  }
  return slug.replace(/-+$/, "") || null;
}

export default function (pi: ExtensionAPI) {
  let named = false;

  const tryAutoName = (ctx: ExtensionContext) => {
    if (named) return;
    if (pi.getSessionName()) {
      named = true; // already named (manually or persisted)
      return;
    }
    const text = firstUserText(ctx);
    if (!text) return;
    const slug = slugify(text);
    if (!slug) return;
    pi.setSessionName(slug);
    named = true;
  };

  pi.on("agent_settled", (_event, ctx) => tryAutoName(ctx));

  pi.registerCommand("rename", {
    description: "Set or show the session name (usage: /rename [new name])",
    handler: async (args, ctx) => {
      const name = args.trim();
      if (name) {
        pi.setSessionName(name);
        named = true; // don't overwrite a manual name
        ctx.ui.notify(`Session named: ${name}`, "info");
      } else {
        const current = pi.getSessionName();
        ctx.ui.notify(current ? `Session: ${current}` : "No session name set", "info");
      }
    },
  });
}
