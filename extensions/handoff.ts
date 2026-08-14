/**
 * handoff — transfer context to a new focused session.
 *
 * Instead of compacting (which is lossy), `/handoff <goal>` distills the
 * current branch into a self-contained prompt, lets you review/edit it, and
 * opens a new session pre-filled with it. Compaction summaries are preserved
 * so long histories still hand off cleanly.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { uuidv7, type Message } from "@earendil-works/pi-ai";
import {
  BorderedLoader,
  convertToLlm,
  serializeConversation,
  type ExtensionAPI,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";

const SYSTEM_PROMPT = `You are a context transfer assistant. Given a conversation history and the user's goal for a new thread, generate a focused prompt that:

1. Summarizes relevant context from the conversation (decisions made, approaches taken, key findings)
2. Lists any relevant files that were discussed or modified
3. Clearly states the next task based on the user's goal
4. Is self-contained - the new thread should be able to proceed without the old conversation

Format your response as a prompt the user can send to start the new thread. Be concise but include all necessary context. Do not include any preamble like "Here's the prompt" - just output the prompt itself.

Example output format:
## Context
We've been working on X. Key decisions:
- Decision 1
- Decision 2

Files involved:
- path/to/file1.ts
- path/to/file2.ts

## Task
[Clear description of what to do next based on user's goal]`;

function entryToMessage(entry: SessionEntry): AgentMessage | undefined {
  if (entry.type === "message") {
    return entry.message;
  }
  if (entry.type === "compaction") {
    return {
      role: "compactionSummary",
      summary: entry.summary,
      tokensBefore: entry.tokensBefore,
      timestamp: new Date(entry.timestamp).getTime(),
    };
  }
  return undefined;
}

function getHandoffMessages(branch: SessionEntry[]): AgentMessage[] {
  // Find the latest compaction entry, if any.
  let compactionIndex = -1;
  for (let i = branch.length - 1; i >= 0; i--) {
    if (branch[i]?.type === "compaction") {
      compactionIndex = i;
      break;
    }
  }

  if (compactionIndex < 0) {
    return branch.map(entryToMessage).filter((m) => m !== undefined);
  }

  const compaction = branch[compactionIndex];
  if (compaction?.type !== "compaction") {
    return branch.map(entryToMessage).filter((m) => m !== undefined);
  }

  // Keep the compaction summary plus everything from the first kept entry on.
  const firstKeptIndex = branch.findIndex((entry) => entry.id === compaction.firstKeptEntryId);
  return [
    compaction,
    ...(firstKeptIndex >= 0 ? branch.slice(firstKeptIndex, compactionIndex) : []),
    ...branch.slice(compactionIndex + 1),
  ]
    .map(entryToMessage)
    .filter((m) => m !== undefined);
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("handoff", {
    description: "Transfer context to a new focused session",
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("handoff requires interactive mode", "error");
        return;
      }

      const model = ctx.model;
      if (!model) {
        ctx.ui.notify("No model selected", "error");
        return;
      }

      const goal = args.trim();
      if (!goal) {
        ctx.ui.notify("Usage: /handoff <goal for new thread>", "error");
        return;
      }

      // Gather conversation context from the current branch. If it was
      // compacted, include the summary plus entries from the first kept entry.
      const messages = getHandoffMessages(ctx.sessionManager.getBranch());

      if (messages.length === 0) {
        ctx.ui.notify("No conversation to hand off", "error");
        return;
      }

      const conversationText = serializeConversation(convertToLlm(messages));
      const currentSessionFile = ctx.sessionManager.getSessionFile();

      // Generate the handoff prompt behind a bordered loader.
      const result = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
        const loader = new BorderedLoader(tui, theme, "Generating handoff prompt...");
        loader.onAbort = () => done(null);

        const generate = async () => {
          const userMessage: Message = {
            role: "user",
            content: [
              {
                type: "text",
                text: `## Conversation History\n\n${conversationText}\n\n## User's Goal for New Thread\n\n${goal}`,
              },
            ],
            timestamp: Date.now(),
          };

          const response = await ctx.modelRegistry.complete(
            model,
            { systemPrompt: SYSTEM_PROMPT, messages: [userMessage] },
            {
              signal: loader.signal,
              cacheRetention: "none",
              sessionId: uuidv7(),
            },
          );

          if (response.stopReason === "aborted") {
            return null;
          }

          return response.content
            .filter((c): c is { type: "text"; text: string } => c.type === "text")
            .map((c) => c.text)
            .join("\n");
        };

        generate()
          .then(done)
          .catch((error) => {
            console.error("Handoff generation failed:", error);
            done(null);
          });

        return loader;
      });

      if (result === null) {
        ctx.ui.notify("Cancelled", "info");
        return;
      }

      // Let the user review/edit the generated prompt.
      const editedPrompt = await ctx.ui.editor("Edit handoff prompt", result);

      if (editedPrompt === undefined) {
        ctx.ui.notify("Cancelled", "info");
        return;
      }

      // Open a new session pre-filled with the prompt. The replacement context
      // is used for post-switch UI work; the original ctx is stale after a
      // successful session replacement.
      const newSessionResult = await ctx.newSession({
        parentSession: currentSessionFile,
        withSession: async (replacementCtx) => {
          replacementCtx.ui.setEditorText(editedPrompt);
          replacementCtx.ui.notify("Handoff ready. Submit when ready.", "info");
        },
      });

      if (newSessionResult.cancelled) {
        ctx.ui.notify("New session cancelled", "info");
      }
    },
  });
}
