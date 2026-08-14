/**
 * bookmark — label session entries for easy navigation in /tree.
 *
 * /bookmark [label] marks the last assistant message (defaults to a
 * timestamped label); /unbookmark removes the most recent label. Labels
 * appear in the session tree and help you find important points.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("bookmark", {
    description: "Bookmark the last message (usage: /bookmark [label])",
    handler: async (args, ctx) => {
      const label = args.trim() || `bookmark-${Date.now()}`;

      const entries = ctx.sessionManager.getEntries();
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        if (!entry || entry.type !== "message") continue;
        if (entry.message.role === "assistant") {
          pi.setLabel(entry.id, label);
          ctx.ui.notify(`Bookmarked as: ${label}`, "info");
          return;
        }
      }

      ctx.ui.notify("No assistant message to bookmark", "warning");
    },
  });

  pi.registerCommand("unbookmark", {
    description: "Remove the most recent bookmark",
    handler: async (_args, ctx) => {
      const entries = ctx.sessionManager.getEntries();
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        if (!entry) continue;
        const label = ctx.sessionManager.getLabel(entry.id);
        if (label) {
          pi.setLabel(entry.id, undefined);
          ctx.ui.notify(`Removed bookmark: ${label}`, "info");
          return;
        }
      }

      ctx.ui.notify("No bookmarked entry found", "warning");
    },
  });
}
