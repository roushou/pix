/**
 * custom-header — compact startup header.
 *
 * Replaces the built-in header (logo + keybinding hints) with a minimal
 * banner: pix branding, pi version, and the most useful shortcuts.
 * `/builtin-header` restores the default header.
 */

import { VERSION, type ExtensionAPI, type Theme } from "@earendil-works/pi-coding-agent";

const HINTS = "/hotkeys  /model  /plan  /handoff  ·  ctrl+l model · ctrl+o expand · ctrl+d exit";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    ctx.ui.setHeader((_tui, theme: Theme) => ({
      render(width: number): string[] {
        const rule = theme.fg("dim", "─".repeat(Math.max(0, width)));
        return [
          "",
          `${theme.fg("accent", theme.bold("pix"))} ${theme.fg("dim", `v${VERSION} · personal pi setup`)}`,
          theme.fg("muted", HINTS),
          rule,
        ];
      },
      invalidate() {},
    }));
  });

  pi.registerCommand("builtin-header", {
    description: "Restore the built-in header",
    handler: async (_args, ctx) => {
      ctx.ui.setHeader(undefined);
      ctx.ui.notify("Built-in header restored", "info");
    },
  });
}
