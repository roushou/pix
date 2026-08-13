/**
 * footer — custom status footer for the TUI.
 *
 * Replaces the default footer with a dashboard line:
 *
 *   model thinking · ext-statuses   ██████░░░░ 62%   ↑in ↓out $cost branch
 *
 * Left  = active model + thinking level (colored by level)
 * Mid   = context usage bar (color escalates near the context window)
 * Right = session token usage + cost + current git branch
 *
 * The footer re-renders on model/thinking changes, turn completion, agent
 * settle, and git branch changes. Other extensions' setStatus() texts are
 * preserved via footerData.getExtensionStatuses().
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, type TUI } from "@earendil-works/pi-tui";

// Short labels + theme color tokens for each thinking level.
const THINKING: Record<string, { label: string; color: ThemeColor }> = {
  off: { label: "off", color: "thinkingOff" },
  minimal: { label: "min", color: "thinkingMinimal" },
  low: { label: "low", color: "thinkingLow" },
  medium: { label: "med", color: "thinkingMedium" },
  high: { label: "high", color: "thinkingHigh" },
  xhigh: { label: "xhi", color: "thinkingXhigh" },
  max: { label: "max", color: "thinkingMax" },
};

function fmtCount(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}m`;
}

function fmtCost(c: number): string {
  if (c === 0) return "$0.00";
  if (c < 0.01) return `$${c.toFixed(4)}`;
  return `$${c.toFixed(2)}`;
}

function contextBar(
  usage: { percent: number | null } | undefined,
  theme: Theme,
  maxBlocks: number,
): string {
  if (!usage || usage.percent == null) return "";
  const pct = Math.max(0, Math.min(100, Math.round(usage.percent)));
  const color = pct < 60 ? "success" : pct < 85 ? "warning" : "error";
  const label = ` ${pct}%`;
  if (maxBlocks <= 0) return theme.fg(color, `ctx${label}`);
  const filled = Math.round((pct / 100) * maxBlocks);
  const bar = "█".repeat(filled) + "░".repeat(maxBlocks - filled);
  return theme.fg(color, `${bar}${label}`);
}

function assemble(left: string, mid: string, right: string, width: number): string {
  const parts = [left, mid, right].filter((p) => visibleWidth(p) > 0);
  const total = parts.reduce((sum, p) => sum + visibleWidth(p), 0);
  const gaps = parts.length - 1;
  const gapSize = gaps > 0 ? Math.max(1, Math.floor((width - total) / gaps)) : 0;
  let line = "";
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) line += " ".repeat(gapSize);
    line += parts[i];
  }
  return truncateToWidth(line, width);
}

export default function (pi: ExtensionAPI) {
  let activeTui: TUI | undefined;
  const requestRender = () => activeTui?.requestRender();

  // Re-render the footer when the values it displays change.
  pi.on("model_select", requestRender);
  pi.on("thinking_level_select", requestRender);
  pi.on("turn_end", requestRender);
  pi.on("agent_settled", requestRender);

  pi.on("session_start", (_event, ctx) => {
    ctx.ui.setFooter((tui, theme, footerData) => {
      activeTui = tui;
      const unsubscribeBranch = footerData.onBranchChange(() => tui.requestRender());

      return {
        dispose() {
          unsubscribeBranch();
          if (activeTui === tui) activeTui = undefined;
        },
        invalidate() {},
        render(width: number): string[] {
          // Left: model + thinking level.
          const model = ctx.model;
          const modelText = model ? model.id : "no model";
          const think: { label: string; color: ThemeColor } = THINKING[ctx.thinkingLevel ?? ""] ?? {
            label: ctx.thinkingLevel ?? "off",
            color: "thinkingOff",
          };
          const left = `${theme.fg("accent", modelText)} ${theme.fg(think.color, think.label)}`;

          // Other extensions' setStatus() segments.
          const statuses = [...footerData.getExtensionStatuses().values()]
            .filter((s) => s.length > 0)
            .map((s) => theme.fg("dim", s))
            .join(theme.fg("dim", " · "));
          const leftFull = statuses ? `${left}${theme.fg("dim", " · ")}${statuses}` : left;

          // Middle: context usage bar.
          const usage = ctx.getContextUsage();
          const midFull = contextBar(usage, theme, 10);
          const midCompact = contextBar(usage, theme, 0);

          // Right: session tokens + cost + branch.
          let input = 0;
          let output = 0;
          let cost = 0;
          for (const entry of ctx.sessionManager.getBranch()) {
            if (entry.type === "message" && entry.message.role === "assistant") {
              const msg = entry.message as AssistantMessage;
              input += msg.usage.input;
              output += msg.usage.output;
              cost += msg.usage.cost.total;
            }
          }
          const tokens = theme.fg(
            "dim",
            `↑${fmtCount(input)} ↓${fmtCount(output)} ${fmtCost(cost)}`,
          );
          const branch = footerData.getGitBranch();
          const right = branch ? `${tokens} ${theme.fg("muted", branch)}` : tokens;

          // Prefer the full layout; fall back to compact on narrow terminals.
          let l = leftFull;
          let m = midFull;
          if (visibleWidth(l) + visibleWidth(m) + visibleWidth(right) > width) {
            l = left;
            m = midCompact;
          }
          return [assemble(l, m, right, width)];
        },
      };
    });
  });
}
