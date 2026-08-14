/**
 * summarize — render a conversation summary in a scrollable overlay.
 *
 * /summarize gathers the current branch's user/assistant text (plus tool
 * calls), asks the active model to summarize it, and shows the result in a
 * Markdown overlay. Press Enter or Esc to close.
 */

import { uuidv7 } from "@earendil-works/pi-ai";
import {
  DynamicBorder,
  getMarkdownTheme,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { Container, Markdown, matchesKey, Text } from "@earendil-works/pi-tui";

interface ContentBlock {
  type?: string;
  text?: string;
  name?: string;
  arguments?: Record<string, unknown>;
}

function extractText(content: unknown): string[] {
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];

  const parts: string[] = [];
  for (const part of content) {
    if (part && typeof part === "object") {
      const block = part as ContentBlock;
      if (block.type === "text" && typeof block.text === "string") {
        parts.push(block.text);
      }
    }
  }
  return parts;
}

function extractToolCalls(content: unknown): string[] {
  if (!Array.isArray(content)) return [];

  const calls: string[] = [];
  for (const part of content) {
    if (part && typeof part === "object") {
      const block = part as ContentBlock;
      if (block.type === "toolCall" && typeof block.name === "string") {
        calls.push(
          `Tool ${block.name} was called with args ${JSON.stringify(block.arguments ?? {})}`,
        );
      }
    }
  }
  return calls;
}

function buildConversationText(entries: SessionEntry[]): string {
  const sections: string[] = [];
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const message = entry.message;
    if (message.role !== "user" && message.role !== "assistant") continue;

    const lines: string[] = [];
    const text = extractText(message.content).join("\n").trim();
    if (text.length > 0) {
      lines.push(`${message.role === "user" ? "User" : "Assistant"}: ${text}`);
    }
    if (message.role === "assistant") {
      lines.push(...extractToolCalls(message.content));
    }
    if (lines.length > 0) sections.push(lines.join("\n"));
  }
  return sections.join("\n\n");
}

function buildSummaryPrompt(conversationText: string): string {
  return [
    "Summarize this conversation so I can resume it later.",
    "Include goals, key decisions, progress, open questions, and next steps.",
    "Keep it concise and structured with headings.",
    "",
    "<conversation>",
    conversationText,
    "</conversation>",
  ].join("\n");
}

async function showSummaryUi(summary: string, ctx: ExtensionCommandContext): Promise<void> {
  if (ctx.mode !== "tui") return;

  await ctx.ui.custom((_tui, theme, _kb, done) => {
    const container = new Container();
    const border = new DynamicBorder((s: string) => theme.fg("accent", s));
    const mdTheme = getMarkdownTheme();

    container.addChild(border);
    container.addChild(new Text(theme.fg("accent", theme.bold("Conversation Summary")), 1, 0));
    container.addChild(new Markdown(summary, 1, 1, mdTheme));
    container.addChild(new Text(theme.fg("dim", "Press Enter or Esc to close"), 1, 0));
    container.addChild(border);

    return {
      render: (width: number) => container.render(width),
      invalidate: () => container.invalidate(),
      handleInput: (data: string) => {
        if (matchesKey(data, "enter") || matchesKey(data, "escape")) {
          done(undefined);
        }
      },
    };
  });
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("summarize", {
    description: "Summarize the current conversation in a scrollable overlay",
    handler: async (_args, ctx) => {
      const conversationText = buildConversationText(ctx.sessionManager.getBranch());

      if (!conversationText.trim()) {
        if (ctx.hasUI) ctx.ui.notify("No conversation text found", "warning");
        return;
      }

      const model = ctx.model;
      if (!model) {
        if (ctx.hasUI) ctx.ui.notify("No model selected", "error");
        return;
      }

      if (ctx.hasUI) ctx.ui.notify("Preparing summary...", "info");

      const summaryMessages = [
        {
          role: "user" as const,
          content: [{ type: "text" as const, text: buildSummaryPrompt(conversationText) }],
          timestamp: Date.now(),
        },
      ];

      const response = await ctx.modelRegistry.complete(
        model,
        { messages: summaryMessages },
        {
          reasoningEffort: "high",
          cacheRetention: "none",
          sessionId: uuidv7(),
        },
      );

      const summary = response.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("\n");

      await showSummaryUi(summary, ctx);
    },
  });
}
