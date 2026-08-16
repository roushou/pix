/**
 * notify — desktop notification when the agent finishes its task.
 *
 * Fires on `agent_settled`, which is emitted once the agent will not continue
 * running on its own (no pending retries, compaction retries, or queued
 * follow-ups). Instead of a fixed "ready for input" string, it summarizes the
 * run that just finished:
 *
 *   title    — session name (or project dir)
 *   subtitle — outcome + duration (e.g. "✓ Done · 3m 12s")
 *   body     — one metrics line (files, tools, cost, context %), then the
 *              final assistant message as a one-line excerpt on its own line
 *
 * The same summary is also shown in the TUI footer via `setStatus` until the
 * next run starts.
 *
 * Supported platforms:
 * - macOS: native notification via `osascript` (AppleScript), with per-outcome
 *   sounds and a subtitle line
 * - Linux: `notify-send` (libnotify) with urgency + icon, otherwise terminal
 *   OSC escape sequences (OSC 99 for Kitty, OSC 777 for Ghostty/iTerm2/WezTerm/rxvt)
 * - Other: terminal OSC escape fallback
 *
 * Config (best-effort, optional) — read from `~/.pi/agent/settings.json` and
 * `<project>/.pi/settings.json` under a `notify` key:
 *
 *   {
 *     "notify": {
 *       "mode": "rich" | "compact",   // default "rich"
 *       "notifyOnStart": false,       // also notify when a run begins
 *       "sound": true,                // vary sounds by outcome
 *       "excerptLength": 100          // max chars of the final-message excerpt
 *     }
 *   }
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { AssistantMessage, TextContent } from "@earendil-works/pi-ai";
import {
  CONFIG_DIR_NAME,
  getAgentDir,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const execFileAsync = promisify(execFile);

const STATUS_KEY = "notify";

interface NotifyConfig {
  mode: "rich" | "compact";
  notifyOnStart: boolean;
  sound: boolean;
  excerptLength: number;
}

const DEFAULT_CONFIG: NotifyConfig = {
  mode: "rich",
  notifyOnStart: false,
  sound: true,
  excerptLength: 100,
};

function loadConfig(cwd: string): NotifyConfig {
  const paths = [join(getAgentDir(), "settings.json"), join(cwd, CONFIG_DIR_NAME, "settings.json")];
  let merged: Record<string, unknown> = {};

  for (const path of paths) {
    try {
      if (!existsSync(path)) continue;
      const raw = readFileSync(path, "utf8");
      const parsed = JSON.parse(raw) as { notify?: Record<string, unknown> };
      if (parsed.notify) Object.assign(merged, parsed.notify);
    } catch {
      // Settings are best-effort; fall back to defaults on any parse error.
    }
  }

  return {
    mode: merged.mode === "compact" ? "compact" : DEFAULT_CONFIG.mode,
    notifyOnStart:
      typeof merged.notifyOnStart === "boolean"
        ? merged.notifyOnStart
        : DEFAULT_CONFIG.notifyOnStart,
    sound: typeof merged.sound === "boolean" ? merged.sound : DEFAULT_CONFIG.sound,
    excerptLength:
      typeof merged.excerptLength === "number" && merged.excerptLength > 0
        ? merged.excerptLength
        : DEFAULT_CONFIG.excerptLength,
  };
}

interface Totals {
  input: number;
  output: number;
  cost: number;
}

function branchTotals(ctx: ExtensionContext): Totals {
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
  return { input, output, cost };
}

interface Run {
  startMs: number;
  baseline: Totals;
  toolCount: number;
  errors: number;
  errorTools: Set<string>;
  filesChanged: Set<string>;
  excerpt: string;
  stopReason: string;
}

type Outcome = "success" | "warning" | "error" | "aborted";

const OUTCOMES: Record<
  Outcome,
  { label: string; mark: string; sound: string; urgency: string; icon: string }
> = {
  success: {
    label: "Done",
    mark: "✓",
    sound: "Glass",
    urgency: "normal",
    icon: "dialog-information",
  },
  warning: {
    label: "Done with errors",
    mark: "⚠",
    sound: "Glass",
    urgency: "normal",
    icon: "dialog-warning",
  },
  error: { label: "Failed", mark: "✗", sound: "Basso", urgency: "critical", icon: "dialog-error" },
  aborted: {
    label: "Aborted",
    mark: "■",
    sound: "Basso",
    urgency: "critical",
    icon: "dialog-error",
  },
};

// AppleScript: display a notification with args passed separately (avoids any
// shell/quote-escaping issues in the title/subtitle/body).
function macosScript(withSound: boolean): string {
  const lines = [
    "on run argv",
    "  set theTitle to item 1 of argv",
    "  set theSubtitle to item 2 of argv",
    "  set theBody to item 3 of argv",
  ];
  if (withSound) {
    lines.push("  set theSound to item 4 of argv");
    lines.push(
      "  display notification theBody with title theTitle subtitle theSubtitle sound name theSound",
    );
  } else {
    lines.push("  display notification theBody with title theTitle subtitle theSubtitle");
  }
  lines.push("end run");
  return lines.join("\n");
}

const MACOS_NOTIFY_WITH_SOUND = macosScript(true);
const MACOS_NOTIFY_SILENT = macosScript(false);

async function commandExists(command: string): Promise<boolean> {
  try {
    await execFileAsync("sh", ["-c", `command -v ${command}`]);
    return true;
  } catch {
    return false;
  }
}

function oscSafe(value: string): string {
  return value.replaceAll("\x1b", "").replaceAll("\x07", "").replace(/;/g, "：");
}

/** Kitty OSC 99 */
function notifyOSC99(title: string, body: string): void {
  process.stdout.write(`\x1b]99;i=1:d=0;${oscSafe(title)}\x1b\\`);
  process.stdout.write(`\x1b]99;i=1:p=body;${oscSafe(body)}\x1b\\`);
}

/** OSC 777: Ghostty, iTerm2, WezTerm, rxvt-unicode */
function notifyOSC777(title: string, body: string): void {
  process.stdout.write(`\x1b]777;notify;${oscSafe(title)};${oscSafe(body)}\x07`);
}

function notifyTerminal(title: string, body: string): void {
  if (process.env.KITTY_WINDOW_ID) {
    notifyOSC99(title, body);
  } else {
    notifyOSC777(title, body);
  }
}

interface NotificationPayload {
  title: string;
  subtitle: string;
  body: string;
  sound: string;
  urgency: string;
  icon: string;
}

async function notifyMacOS(payload: NotificationPayload): Promise<void> {
  const { title, subtitle, body, sound } = payload;
  if (sound) {
    await execFileAsync("osascript", ["-e", MACOS_NOTIFY_WITH_SOUND, title, subtitle, body, sound]);
  } else {
    await execFileAsync("osascript", ["-e", MACOS_NOTIFY_SILENT, title, subtitle, body]);
  }
}

async function notifyLinux(payload: NotificationPayload): Promise<void> {
  const { title, body, urgency, icon } = payload;
  if (await commandExists("notify-send")) {
    const args = ["--app-name", "pi"];
    if (icon) args.push("--icon", icon);
    if (urgency) args.push("--urgency", urgency);
    args.push(title, body);
    await execFileAsync("notify-send", args);
    return;
  }
  notifyTerminal(title, payload.subtitle ? `${payload.subtitle} · ${body}` : body);
}

async function sendNotification(payload: NotificationPayload): Promise<void> {
  try {
    if (process.platform === "darwin") {
      await notifyMacOS(payload);
    } else if (process.platform === "linux") {
      await notifyLinux(payload);
    } else {
      notifyTerminal(
        payload.title,
        payload.subtitle ? `${payload.subtitle} · ${payload.body}` : payload.body,
      );
    }
  } catch {
    // Notifications are best-effort. If the native path fails, fall back to a
    // terminal OSC escape so something still surfaces in supported terminals.
    notifyTerminal(
      payload.title,
      payload.subtitle ? `${payload.subtitle} · ${payload.body}` : payload.body,
    );
  }
}

function formatDuration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 1) return `${Math.round(ms)}ms`;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}

function fmtCount(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}m`;
}

function formatCost(c: number): string {
  if (c === 0) return "$0.00";
  if (c < 0.01) return `$${c.toFixed(4)}`;
  return `$${c.toFixed(2)}`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function assistantText(message: AssistantMessage): string {
  return message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleFor(pi: ExtensionAPI, cwd: string): string {
  return pi.getSessionName() ?? basename(cwd);
}

export default function (pi: ExtensionAPI) {
  let config: NotifyConfig | undefined;
  let run: Run | null = null;

  const getConfig = (ctx: ExtensionContext): NotifyConfig => {
    if (!config) config = loadConfig(ctx.cwd);
    return config;
  };

  const beginRun = (ctx: ExtensionContext): Run => {
    run = {
      startMs: Date.now(),
      baseline: branchTotals(ctx),
      toolCount: 0,
      errors: 0,
      errorTools: new Set(),
      filesChanged: new Set(),
      excerpt: "",
      stopReason: "",
    };
    return run;
  };

  pi.on("agent_start", (_event, ctx) => {
    const cfg = getConfig(ctx);
    // Accumulate across retries/compaction/follow-ups: only start a fresh run
    // when the previous one has already been reported.
    if (!run) beginRun(ctx);

    if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);

    if (cfg.notifyOnStart) {
      void sendNotification({
        title: titleFor(pi, ctx.cwd),
        subtitle: "Working…",
        body: "Agent started",
        sound: "",
        urgency: "low",
        icon: "dialog-information",
      });
    }
  });

  pi.on("tool_result", (event) => {
    if (!run) return;
    run.toolCount += 1;
    if (event.isError) {
      run.errors += 1;
      run.errorTools.add(event.toolName);
    }
    const path = event.input?.path;
    if (typeof path === "string" && !event.isError) {
      if (event.toolName === "edit" || event.toolName === "write") {
        run.filesChanged.add(path);
      }
    }
  });

  pi.on("message_end", (event) => {
    if (!run || event.message.role !== "assistant") return;
    const msg = event.message as AssistantMessage;
    run.excerpt = assistantText(msg);
    run.stopReason = msg.stopReason;
  });

  pi.on("agent_settled", (_event, ctx) => {
    const cfg = getConfig(ctx);
    if (!run) return;

    const totals = branchTotals(ctx);
    const delta: Totals = {
      input: Math.max(0, totals.input - run.baseline.input),
      output: Math.max(0, totals.output - run.baseline.output),
      cost: Math.max(0, totals.cost - run.baseline.cost),
    };

    const duration = formatDuration(Date.now() - run.startMs);

    // Determine outcome from the final assistant stop reason, falling back to
    // whether any tool errored.
    let outcome: Outcome = "success";
    if (run.stopReason === "aborted") outcome = "aborted";
    else if (run.stopReason === "error") outcome = "error";
    else if (run.errors > 0) outcome = "warning";

    const out = OUTCOMES[outcome];
    const metrics = metricsLine(cfg, run, delta, ctx);
    const summary = [duration, metrics].filter(Boolean).join(" · ");

    if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, `${out.mark} ${summary}`);

    const meaningful = run.toolCount > 0 || run.excerpt.length > 0 || run.errors > 0;
    if (meaningful) {
      const excerpt =
        cfg.mode === "rich" && run.excerpt ? truncate(run.excerpt, cfg.excerptLength) : "";
      // Metrics on one line, the final message excerpt on its own line.
      const body = [metrics, excerpt].filter(Boolean).join("\n") || duration;

      void sendNotification({
        title: titleFor(pi, ctx.cwd),
        subtitle: `${out.mark} ${out.label} · ${duration}`,
        body,
        sound: cfg.sound ? out.sound : "",
        urgency: out.urgency,
        icon: out.icon,
      });
    }

    run = null;
  });

  function metricsLine(
    cfg: NotifyConfig,
    state: Run,
    delta: Totals,
    ctx: ExtensionContext,
  ): string {
    const parts: string[] = [];
    const changed = state.filesChanged.size;
    if (changed > 0) parts.push(`${changed} file${changed === 1 ? "" : "s"} changed`);
    if (state.toolCount > 0) {
      parts.push(`${state.toolCount} tool${state.toolCount === 1 ? "" : "s"}`);
    }
    if (cfg.mode === "rich") {
      if (delta.cost > 0) parts.push(formatCost(delta.cost));
      else if (delta.input + delta.output > 0) {
        parts.push(`${fmtCount(delta.input + delta.output)} tokens`);
      }
      const usage = ctx.getContextUsage();
      if (usage?.percent != null) parts.push(`ctx ${Math.round(usage.percent)}%`);
      if (state.errors > 0) {
        const tools = [...state.errorTools].slice(0, 2).join(", ");
        parts.push(
          `${state.errors} error${state.errors === 1 ? "" : "s"}${tools ? ` (${tools})` : ""}`,
        );
      }
    }
    return parts.join(" · ");
  }
}
