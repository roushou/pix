/**
 * interactive-shell — run interactive commands with full terminal access.
 *
 * Intercepts user `!` commands and runs interactive programs (editors,
 * pagers, git rebase, htop, psql, ...) by suspending the TUI while the
 * command runs. Use `!i <command>` to force interactive mode. Configure via
 * INTERACTIVE_COMMANDS (add) and INTERACTIVE_EXCLUDE (remove) env vars.
 * The default command list is declarative data in commands.ts.
 *
 * This only intercepts user `!` commands, not agent bash tool calls — if the
 * agent runs an interactive command it will fail, which is the desired
 * behavior.
 */

import { spawnSync } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  ADDITIONAL_COMMANDS_SPEC,
  DEFAULT_INTERACTIVE_COMMANDS,
  EXCLUDE_COMMANDS_SPEC,
} from "./commands.ts";
import { resolveSpec } from "../shared/config.ts";

function getInteractiveCommands(): string[] {
  const additional = resolveSpec(ADDITIONAL_COMMANDS_SPEC, {}, process.env);
  const excluded = new Set(resolveSpec(EXCLUDE_COMMANDS_SPEC, {}, process.env));
  return [...DEFAULT_INTERACTIVE_COMMANDS, ...additional].filter(
    (cmd) => !excluded.has(cmd.toLowerCase()),
  );
}

export function isInteractiveCommand(command: string): boolean {
  const trimmed = command.trim().toLowerCase();

  for (const cmd of getInteractiveCommands()) {
    const cmdLower = cmd.toLowerCase();
    // Match at the start of the command.
    if (
      trimmed === cmdLower ||
      trimmed.startsWith(`${cmdLower} `) ||
      trimmed.startsWith(`${cmdLower}\t`)
    ) {
      return true;
    }
    // Match after a pipe: "cat file | less".
    const pipeIdx = trimmed.lastIndexOf("|");
    if (pipeIdx !== -1) {
      const afterPipe = trimmed.slice(pipeIdx + 1).trim();
      if (afterPipe === cmdLower || afterPipe.startsWith(`${cmdLower} `)) {
        return true;
      }
    }
  }
  return false;
}

export default function (pi: ExtensionAPI) {
  pi.on("user_bash", async (event, ctx) => {
    let command = event.command;
    let forceInteractive = false;

    // !i prefix forces interactive mode (the command arrives without the
    // leading !, so we check for a leading "i ").
    if (command.startsWith("i ") || command.startsWith("i\t")) {
      forceInteractive = true;
      command = command.slice(2).trim();
    }

    if (!forceInteractive && !isInteractiveCommand(command)) {
      return; // Not interactive — let normal handling proceed.
    }

    // No UI available (print mode, RPC, etc.).
    if (ctx.mode !== "tui") {
      return {
        result: {
          output: "(interactive commands require TUI)",
          exitCode: 1,
          cancelled: false,
          truncated: false,
        },
      };
    }

    // Suspend the TUI, run the command with full terminal access, then resume.
    const exitCode = await ctx.ui.custom<number | null>((tui, _theme, _kb, done) => {
      tui.stop();
      process.stdout.write("\x1b[2J\x1b[H");

      const shell = process.env.SHELL || "/bin/sh";
      const result = spawnSync(shell, ["-c", command], {
        stdio: "inherit",
        env: process.env,
      });

      tui.start();
      tui.requestRender(true);
      done(result.status);

      return { render: () => [], invalidate: () => {} };
    });

    const output =
      exitCode === 0
        ? "(interactive command completed successfully)"
        : `(interactive command exited with code ${exitCode})`;

    return {
      result: {
        output,
        exitCode: exitCode ?? 1,
        cancelled: false,
        truncated: false,
      },
    };
  });
}
