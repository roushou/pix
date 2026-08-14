/**
 * titlebar-spinner — braille spinner in the terminal title while working.
 *
 * Shows an animated braille glyph in the terminal window/tab title while the
 * agent is running, so activity is visible even when pi is in the background.
 * The title resets to "π - <session> - <dir>" when the agent settles.
 */

import { basename } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function baseTitle(pi: ExtensionAPI, cwd: string): string {
  const dir = basename(cwd);
  const session = pi.getSessionName();
  return session ? `π - ${session} - ${dir}` : `π - ${dir}`;
}

export default function (pi: ExtensionAPI) {
  let timer: ReturnType<typeof setInterval> | null = null;
  let frame = 0;

  const stop = (ctx: ExtensionContext) => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    frame = 0;
    ctx.ui.setTitle(baseTitle(pi, ctx.cwd));
  };

  const start = (ctx: ExtensionContext) => {
    stop(ctx);
    timer = setInterval(() => {
      const glyph = FRAMES[frame % FRAMES.length] ?? "⠋";
      ctx.ui.setTitle(`${glyph} ${baseTitle(pi, ctx.cwd)}`);
      frame++;
    }, 80);
  };

  pi.on("agent_start", (_event, ctx) => start(ctx));
  pi.on("agent_end", (_event, ctx) => stop(ctx));
  pi.on("session_shutdown", (_event, ctx) => stop(ctx));
}
