/**
 * permission-gate — confirm or block dangerous bash commands.
 *
 * Two severity levels:
 * - block:   catastrophic commands are always blocked (rm -rf /, mkfs, ...).
 * - confirm: risky commands prompt for confirmation (sudo, force push,
 *            recursive rm, ...). In non-interactive mode (no UI) they are
 *            blocked by default.
 *
 * Blocking a tool call returns a reason that is surfaced to the model, so the
 * agent can explain and retry with a safer command.
 */

import { isToolCallEventType, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface Rule {
  name: string;
  pattern: RegExp;
  level: "block" | "confirm";
}

const RULES: Rule[] = [
  // Catastrophic — never run.
  {
    name: "rm -rf on root/home",
    pattern: /\brm\s+(-[a-z]*r[a-z]*f?|--recursive)\s+(\/|~|\$HOME|\.\.?)(\s|\*|$)/i,
    level: "block",
  },
  { name: "format filesystem", pattern: /\bmkfs(\.\w+)?\b/i, level: "block" },

  // Risky — confirm first.
  { name: "recursive rm", pattern: /\brm\s+(-[a-z]*r[a-z]*f?|--recursive)\b/i, level: "confirm" },
  { name: "sudo", pattern: /\bsudo\b/i, level: "confirm" },
  {
    name: "force push",
    pattern: /\bgit\s+push\b[^\n|;&]*(-f\b|--force(?!-with-lease)\b)/i,
    level: "confirm",
  },
  { name: "git reset --hard", pattern: /\bgit\s+reset\s+--hard\b/i, level: "confirm" },
  {
    name: "git clean -f",
    pattern: /\bgit\s+clean\b[^\n|;&]*(--force|-[a-z]*f[a-z]*)\b/i,
    level: "confirm",
  },
  {
    name: "chmod/chown 777 or -R",
    pattern: /\b(chmod|chown)\b[^\n|;&]*(\b-R\b|\b777\b)/i,
    level: "confirm",
  },
  {
    name: "pipe curl/wget to shell",
    pattern: /\b(curl|wget)\b[^\n|;&]*\|\s*(ba)?sh\b/i,
    level: "confirm",
  },
  { name: "dd to device", pattern: /\bdd\b[\s\S]*\bof=\/dev\//i, level: "confirm" },
  { name: "shutdown/reboot", pattern: /\b(shutdown|reboot|poweroff|halt)\b/i, level: "confirm" },
];

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) return;

    const command = event.input.command;
    if (!command) return;

    // Block rules win over confirm rules.
    const block = RULES.find((rule) => rule.level === "block" && rule.pattern.test(command));
    if (block) {
      return { block: true, reason: `Blocked: ${block.name}` };
    }

    const confirm = RULES.find((rule) => rule.level === "confirm" && rule.pattern.test(command));
    if (!confirm) return;

    // Non-interactive: fail closed.
    if (!ctx.hasUI) {
      return {
        block: true,
        reason: `Blocked (${confirm.name}) — no UI available for confirmation`,
      };
    }

    const ok = await ctx.ui.confirm(`⚠️ ${confirm.name}`, `Allow this command?\n\n  ${command}`);
    if (!ok) {
      return { block: true, reason: `Blocked by user: ${confirm.name}` };
    }
  });
}
