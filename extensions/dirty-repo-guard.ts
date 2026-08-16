/**
 * dirty-repo-guard — protect uncommitted work when the agent changes context.
 *
 * Two protections:
 *
 *   1. Session transitions — before `/new`, `/resume`, `/fork`, and `/clone`,
 *      confirm when the working tree has uncommitted changes, so work is not
 *      stranded on an abandoned branch. Non-interactive runs fail closed
 *      (block) unless configured otherwise.
 *
 *   2. Agent-start warning — on the first prompt of a session, if the tree is
 *      already dirty, inject a note telling the agent those changes are not
 *      its own, so it keeps its edits separate and does not `git add -A`.
 *
 * Config (optional, best-effort) — read from `~/.pi/agent/settings.json` and
 * `<project>/.pi/settings.json` under a `dirtyRepoGuard` key:
 *
 *   {
 *     "dirtyRepoGuard": {
 *       "enabled": true,          // master switch
 *       "guardSwitch": true,      // confirm on /new and /resume
 *       "guardFork": true,        // confirm on /fork and /clone
 *       "warnAtAgentStart": true, // inject a one-time heads-up for the agent
 *       "nonInteractive": "block" // "block" | "allow" when there is no UI
 *     }
 *   }
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CONFIG_DIR_NAME,
  getAgentDir,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

interface DirtyRepoGuardConfig {
  enabled: boolean;
  guardSwitch: boolean;
  guardFork: boolean;
  warnAtAgentStart: boolean;
  nonInteractive: "block" | "allow";
}

const DEFAULT_CONFIG: DirtyRepoGuardConfig = {
  enabled: true,
  guardSwitch: true,
  guardFork: true,
  warnAtAgentStart: true,
  nonInteractive: "block",
};

function loadConfig(cwd: string): DirtyRepoGuardConfig {
  const paths = [join(getAgentDir(), "settings.json"), join(cwd, CONFIG_DIR_NAME, "settings.json")];
  let merged: Record<string, unknown> = {};

  for (const path of paths) {
    try {
      if (!existsSync(path)) continue;
      const raw = readFileSync(path, "utf8");
      const parsed = JSON.parse(raw) as { dirtyRepoGuard?: Record<string, unknown> };
      if (parsed.dirtyRepoGuard) Object.assign(merged, parsed.dirtyRepoGuard);
    } catch {
      // Settings are best-effort; fall back to defaults on any parse error.
    }
  }

  return {
    enabled: typeof merged.enabled === "boolean" ? merged.enabled : DEFAULT_CONFIG.enabled,
    guardSwitch:
      typeof merged.guardSwitch === "boolean" ? merged.guardSwitch : DEFAULT_CONFIG.guardSwitch,
    guardFork: typeof merged.guardFork === "boolean" ? merged.guardFork : DEFAULT_CONFIG.guardFork,
    warnAtAgentStart:
      typeof merged.warnAtAgentStart === "boolean"
        ? merged.warnAtAgentStart
        : DEFAULT_CONFIG.warnAtAgentStart,
    nonInteractive: merged.nonInteractive === "allow" ? "allow" : DEFAULT_CONFIG.nonInteractive,
  };
}

// --------------------------------------------------------------------------- //
// Git dirty-state detection
// --------------------------------------------------------------------------- //

interface DirtyState {
  dirty: boolean;
  staged: string[];
  unstaged: string[];
  untracked: string[];
  total: number;
}

const CLEAN: DirtyState = { dirty: false, staged: [], unstaged: [], untracked: [], total: 0 };

function parsePorcelain(stdout: string): DirtyState {
  const staged: string[] = [];
  const unstaged: string[] = [];
  const untracked: string[] = [];

  for (const line of stdout.split("\n")) {
    if (line.length === 0) continue;

    if (line.startsWith("??")) {
      untracked.push(line.slice(3).trim());
      continue;
    }

    const x = line[0] ?? " ";
    const y = line[1] ?? " ";
    let path = line.slice(3).trim();
    const arrow = path.indexOf(" -> ");
    if (arrow !== -1) path = path.slice(arrow + 4);
    if (path.length === 0) continue;

    if (x !== " " && x !== "!") staged.push(path);
    if (y !== " " && y !== "!") unstaged.push(path);
  }

  const total = staged.length + unstaged.length + untracked.length;
  return { dirty: total > 0, staged, unstaged, untracked, total };
}

async function getDirty(pi: ExtensionAPI, cwd: string): Promise<DirtyState> {
  try {
    const result = await pi.exec("git", ["status", "--porcelain"], { cwd });
    if (result.code !== 0) return CLEAN;
    return parsePorcelain(result.stdout);
  } catch {
    return CLEAN;
  }
}

function describeState(state: DirtyState): string {
  const parts: string[] = [];
  if (state.staged.length > 0) parts.push(`${state.staged.length} staged`);
  if (state.unstaged.length > 0) parts.push(`${state.unstaged.length} unstaged`);
  if (state.untracked.length > 0) parts.push(`${state.untracked.length} untracked`);

  const samples = [...state.staged, ...state.unstaged, ...state.untracked].slice(0, 6);
  const lines = [
    `Working tree has ${state.total} uncommitted file(s)${parts.length > 0 ? ` (${parts.join(", ")})` : ""}.`,
    ...samples.map((p) => `  ${p}`),
  ];
  if (state.total > samples.length) lines.push(`  … and ${state.total - samples.length} more`);
  return lines.join("\n");
}

// --------------------------------------------------------------------------- //
// Guards
// --------------------------------------------------------------------------- //

async function confirmOrBlock(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  config: DirtyRepoGuardConfig,
  action: string,
): Promise<boolean> {
  const state = await getDirty(pi, ctx.cwd);
  if (!state.dirty) return false;

  if (!ctx.hasUI) {
    return config.nonInteractive === "block";
  }

  const ok = await ctx.ui.confirm(
    `Uncommitted changes — ${action}`,
    `${describeState(state)}\n\n${action} anyway?`,
  );
  if (!ok) ctx.ui.notify("Commit your changes first", "warning");
  return !ok;
}

// --------------------------------------------------------------------------- //
// Extension
// --------------------------------------------------------------------------- //

export default function (pi: ExtensionAPI) {
  let config: DirtyRepoGuardConfig | undefined;
  let warnedThisSession = false;

  const getConfig = (ctx: ExtensionContext): DirtyRepoGuardConfig => {
    if (!config) config = loadConfig(ctx.cwd);
    return config;
  };

  pi.on("session_start", () => {
    warnedThisSession = false;
  });

  pi.on("session_before_switch", async (event, ctx) => {
    const cfg = getConfig(ctx);
    if (!cfg.enabled || !cfg.guardSwitch) return;
    const action = event.reason === "new" ? "start a new session" : "switch session";
    const cancel = await confirmOrBlock(pi, ctx, cfg, action);
    if (cancel) return { cancel: true };
  });

  pi.on("session_before_fork", async (_event, ctx) => {
    const cfg = getConfig(ctx);
    if (!cfg.enabled || !cfg.guardFork) return;
    const cancel = await confirmOrBlock(pi, ctx, cfg, "fork or clone");
    if (cancel) return { cancel: true };
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const cfg = getConfig(ctx);
    if (!cfg.enabled || !cfg.warnAtAgentStart || warnedThisSession) return;

    const state = await getDirty(pi, ctx.cwd);
    if (!state.dirty) return;
    warnedThisSession = true;

    const note =
      `[dirty-repo-guard] The working tree already had ${state.total} uncommitted file(s) ` +
      `before this task. Those changes are not yours: do not run \`git add -A\` or ` +
      `\`git commit -a\`. Keep your edits separate and stage/commit only what you changed.`;

    return { systemPrompt: `${event.systemPrompt}\n\n${note}` };
  });
}
