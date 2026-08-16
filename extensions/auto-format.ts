/**
 * auto-format — run each project's own formatter/linter after the agent edits a file.
 *
 * Watches `write` and `edit` tool results. When the agent changes a file, this
 * extension detects the project's toolchain (from config files + locally
 * installed binaries) and:
 *
 *   - formats the file (idempotent, auto-applied), then
 *   - lints the file read-only and surfaces findings back to the LLM.
 *
 * It is a toolchain *adapter*, not a formatter: it only ever runs what the
 * project already declares and has installed, so each repo keeps the style its
 * own maintainers expect.
 *
 * Supported toolchains:
 *   - JS/TS/web: biome, prettier, dprint, oxfmt (format); oxlint, biome, eslint (lint)
 *   - Python:    ruff (format + lint), black (format)
 *   - Go:        gofmt (format; go.mod required)
 *   - Rust:      rustfmt (format; Cargo.toml required)
 *
 * Detection: a formatter runs only when BOTH its config file is present at the
 * project root AND its binary is installed (JS binaries resolve from
 * `node_modules/.bin`; python/go/rust binaries resolve from PATH). Missing
 * binaries are remembered so they are only probed once per session.
 *
 * Config (optional, best-effort) — read from `~/.pi/agent/settings.json` and
 * `<project>/.pi/settings.json` under an `autoFormat` key:
 *
 *   {
 *     "autoFormat": {
 *       "enabled": true,     // master switch
 *       "format": true,      // auto-apply formatters
 *       "lint": true,        // run linters read-only and report findings
 *       "timeoutMs": 10000
 *     }
 *   }
 *
 * Files under node_modules, .git, dist, build, out, coverage, vendor, .next,
 * .nuxt, and target are always skipped.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
  CONFIG_DIR_NAME,
  getAgentDir,
  isEditToolResult,
  isWriteToolResult,
  withFileMutationQueue,
  type ExtensionAPI,
  type ExtensionContext,
  type ExecResult,
} from "@earendil-works/pi-coding-agent";

const MAX_FILE_BYTES = 1_000_000;
const MAX_LINT_CHARS = 2_000;
const DEFAULT_TIMEOUT_MS = 10_000;

const IGNORE_DIRS =
  /(^|\/)(node_modules|\.git|dist|build|out|coverage|vendor|\.next|\.nuxt|target)(\/|$)/;

const WEB_EXT = /\.(tsx?|jsx?|mjs|cjs|jsonc?|mdx?|css|scss|less|html|vue|svelte|ya?ml)$/i;
const PY_EXT = /\.(py|pyi)$/i;
const GO_EXT = /\.go$/i;
const RS_EXT = /\.rs$/i;

interface AutoFormatConfig {
  enabled: boolean;
  format: boolean;
  lint: boolean;
  timeoutMs: number;
}

const DEFAULT_CONFIG: AutoFormatConfig = {
  enabled: true,
  format: true,
  lint: true,
  timeoutMs: DEFAULT_TIMEOUT_MS,
};

function loadConfig(cwd: string): AutoFormatConfig {
  const paths = [join(getAgentDir(), "settings.json"), join(cwd, CONFIG_DIR_NAME, "settings.json")];
  let merged: Record<string, unknown> = {};

  for (const path of paths) {
    try {
      if (!existsSync(path)) continue;
      const raw = readFileSync(path, "utf8");
      const parsed = JSON.parse(raw) as { autoFormat?: Record<string, unknown> };
      if (parsed.autoFormat) Object.assign(merged, parsed.autoFormat);
    } catch {
      // Settings are best-effort; fall back to defaults on any parse error.
    }
  }

  return {
    enabled: typeof merged.enabled === "boolean" ? merged.enabled : DEFAULT_CONFIG.enabled,
    format: typeof merged.format === "boolean" ? merged.format : DEFAULT_CONFIG.format,
    lint: typeof merged.lint === "boolean" ? merged.lint : DEFAULT_CONFIG.lint,
    timeoutMs:
      typeof merged.timeoutMs === "number" && merged.timeoutMs > 0
        ? merged.timeoutMs
        : DEFAULT_CONFIG.timeoutMs,
  };
}

// --------------------------------------------------------------------------- //
// Detection
// --------------------------------------------------------------------------- //

interface ToolCommand {
  name: string;
  command: string;
  args: string[];
  kind: "format" | "lint";
}

interface Detected {
  format: ToolCommand | null;
  lint: ToolCommand | null;
}

function hasAnyFile(root: string, names: string[]): boolean {
  return names.some((n) => existsSync(join(root, n)));
}

function fileContains(root: string, name: string, regex: RegExp): boolean {
  try {
    return regex.test(readFileSync(join(root, name), "utf8"));
  } catch {
    return false;
  }
}

function packageJsonHasKey(root: string, key: string): boolean {
  try {
    const parsed = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Record<
      string,
      unknown
    >;
    return key in parsed;
  } catch {
    return false;
  }
}

function findProjectRoot(start: string): string {
  const markers = ["package.json", "pyproject.toml", "go.mod", "Cargo.toml", ".git"];
  let current = start;
  while (true) {
    for (const marker of markers) {
      if (existsSync(join(current, marker))) return current;
    }
    const parent = dirname(current);
    if (parent === current) return start;
    current = parent;
  }
}

function resolveLocalBin(root: string, name: string): string | null {
  const bin = join(root, "node_modules", ".bin", name);
  return existsSync(bin) ? bin : null;
}

function prettierConfigured(root: string): boolean {
  const files = [
    ".prettierrc",
    ".prettierrc.json",
    ".prettierrc.yaml",
    ".prettierrc.yml",
    ".prettierrc.js",
    ".prettierrc.cjs",
    ".prettierrc.mjs",
    ".prettierrc.toml",
    "prettier.config.js",
    "prettier.config.cjs",
    "prettier.config.mjs",
  ];
  return hasAnyFile(root, files) || packageJsonHasKey(root, "prettier");
}

function eslintConfigured(root: string): boolean {
  const files = [
    ".eslintrc",
    ".eslintrc.json",
    ".eslintrc.js",
    ".eslintrc.cjs",
    ".eslintrc.yaml",
    ".eslintrc.yml",
    "eslint.config.js",
    "eslint.config.mjs",
    "eslint.config.cjs",
    "eslint.config.ts",
  ];
  return hasAnyFile(root, files);
}

function ruffConfigured(root: string): boolean {
  return (
    hasAnyFile(root, ["ruff.toml", ".ruff.toml"]) ||
    fileContains(root, "pyproject.toml", /^\s*\[tool\.ruff\]/m)
  );
}

function blackConfigured(root: string): boolean {
  return (
    hasAnyFile(root, [".black"]) ||
    fileContains(root, "pyproject.toml", /^\s*\[tool\.black\]/m) ||
    fileContains(root, "setup.cfg", /^\s*\[black\]/m) ||
    fileContains(root, "tox.ini", /^\s*\[black\]/m)
  );
}

function detectWeb(root: string, file: string): Detected {
  let format: ToolCommand | null = null;
  let lint: ToolCommand | null = null;

  if (hasAnyFile(root, ["biome.json", "biome.jsonc"])) {
    const biome = resolveLocalBin(root, "biome");
    if (biome) {
      format = { name: "biome", command: biome, args: ["format", "--write", file], kind: "format" };
      lint = { name: "biome", command: biome, args: ["check", file], kind: "lint" };
    }
  }
  if (!format && prettierConfigured(root)) {
    const prettier = resolveLocalBin(root, "prettier");
    if (prettier)
      format = { name: "prettier", command: prettier, args: ["--write", file], kind: "format" };
  }
  if (
    !format &&
    hasAnyFile(root, ["dprint.json", ".dprint.json", "dprint.jsonc", ".dprint.jsonc"])
  ) {
    const dprint = resolveLocalBin(root, "dprint");
    if (dprint) format = { name: "dprint", command: dprint, args: ["fmt", file], kind: "format" };
  }
  if (!format && hasAnyFile(root, [".oxfmtrc.json"])) {
    const oxfmt = resolveLocalBin(root, "oxfmt");
    if (oxfmt) format = { name: "oxfmt", command: oxfmt, args: ["--write", file], kind: "format" };
  }

  if (!lint && hasAnyFile(root, [".oxlintrc.json"])) {
    const oxlint = resolveLocalBin(root, "oxlint");
    if (oxlint) lint = { name: "oxlint", command: oxlint, args: [file], kind: "lint" };
  }
  if (!lint && eslintConfigured(root)) {
    const eslint = resolveLocalBin(root, "eslint");
    if (eslint) lint = { name: "eslint", command: eslint, args: [file], kind: "lint" };
  }

  return { format, lint };
}

function detectPython(root: string, file: string): Detected {
  if (ruffConfigured(root)) {
    return {
      format: { name: "ruff", command: "ruff", args: ["format", file], kind: "format" },
      lint: { name: "ruff", command: "ruff", args: ["check", file], kind: "lint" },
    };
  }
  if (blackConfigured(root)) {
    return {
      format: { name: "black", command: "black", args: [file], kind: "format" },
      lint: null,
    };
  }
  return { format: null, lint: null };
}

function detect(root: string, file: string): Detected {
  if (WEB_EXT.test(file)) return detectWeb(root, file);
  if (PY_EXT.test(file)) return detectPython(root, file);
  if (GO_EXT.test(file) && existsSync(join(root, "go.mod"))) {
    return {
      format: { name: "gofmt", command: "gofmt", args: ["-w", file], kind: "format" },
      lint: null,
    };
  }
  if (RS_EXT.test(file) && existsSync(join(root, "Cargo.toml"))) {
    return {
      format: { name: "rustfmt", command: "rustfmt", args: [file], kind: "format" },
      lint: null,
    };
  }
  return { format: null, lint: null };
}

// --------------------------------------------------------------------------- //
// Execution
// --------------------------------------------------------------------------- //

// PATH-resolved binaries (ruff, black, gofmt, rustfmt) that were not found are
// remembered so we only attempt (and fail) once per session.
const missingBinaries = new Set<string>();

function safeRead(file: string): string | null {
  try {
    if (statSync(file).size > MAX_FILE_BYTES) return null;
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

async function execTool(
  pi: ExtensionAPI,
  cmd: ToolCommand,
  root: string,
  file: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<ExecResult | null> {
  try {
    return await pi.exec(cmd.command, cmd.args, { cwd: root, timeout: timeoutMs, signal });
  } catch {
    return null;
  }
}

function commandMissing(result: ExecResult | null): boolean {
  if (result === null) return true;
  return /command not found|no such file|ENOENT/i.test(result.stderr);
}

async function runFormat(
  pi: ExtensionAPI,
  cmd: ToolCommand,
  root: string,
  file: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  rel: string,
): Promise<string | null> {
  if (missingBinaries.has(cmd.command)) return null;

  const before = safeRead(file);
  if (before === null) return null;

  const result = await execTool(pi, cmd, root, file, timeoutMs, signal);
  if (commandMissing(result)) {
    missingBinaries.add(cmd.command);
    return null;
  }
  if (result === null) return null;
  if (result.code !== 0) {
    const detail = truncate((result.stderr || result.stdout).trim(), 300) || "unknown error";
    return `[auto-format] ${cmd.name} failed on ${rel} (exit ${result.code}): ${detail}`;
  }

  const after = safeRead(file);
  if (after === null || before === after) return null; // unchanged
  return `[auto-format] ${cmd.name} reformatted ${rel}`;
}

async function runLint(
  pi: ExtensionAPI,
  cmd: ToolCommand,
  root: string,
  file: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  rel: string,
): Promise<string | null> {
  if (missingBinaries.has(cmd.command)) return null;

  const result = await execTool(pi, cmd, root, file, timeoutMs, signal);
  if (commandMissing(result)) {
    missingBinaries.add(cmd.command);
    return null;
  }
  if (result === null || result.code === 0) return null;

  const output = `${result.stdout}\n${result.stderr}`.trim();
  if (!output) return null;
  return `[auto-format] ${cmd.name} found issues in ${rel}:\n${truncate(output, MAX_LINT_CHARS)}`;
}

// --------------------------------------------------------------------------- //
// Extension
// --------------------------------------------------------------------------- //

export default function (pi: ExtensionAPI) {
  let config: AutoFormatConfig | undefined;

  const getConfig = (ctx: ExtensionContext): AutoFormatConfig => {
    if (!config) config = loadConfig(ctx.cwd);
    return config;
  };

  pi.on("tool_result", async (event, ctx) => {
    if (!isWriteToolResult(event) && !isEditToolResult(event)) return;
    if (event.isError) return;

    const cfg = getConfig(ctx);
    if (!cfg.enabled || (!cfg.format && !cfg.lint)) return;

    const rawPath = event.input.path;
    if (typeof rawPath !== "string" || rawPath.length === 0) return;

    const absPath = resolve(ctx.cwd, rawPath.replace(/^@/, ""));
    if (IGNORE_DIRS.test(absPath) || !existsSync(absPath)) return;

    const root = findProjectRoot(dirname(absPath));
    const detected = detect(root, absPath);
    if (!detected.format && !detected.lint) return;

    const rel = relative(root, absPath) || rawPath;

    try {
      const note = await withFileMutationQueue(absPath, async () => {
        const notes: string[] = [];
        if (cfg.format && detected.format) {
          const text = await runFormat(
            pi,
            detected.format,
            root,
            absPath,
            cfg.timeoutMs,
            ctx.signal,
            rel,
          );
          if (text) notes.push(text);
        }
        if (cfg.lint && detected.lint) {
          const text = await runLint(
            pi,
            detected.lint,
            root,
            absPath,
            cfg.timeoutMs,
            ctx.signal,
            rel,
          );
          if (text) notes.push(text);
        }
        return notes.join("\n");
      });

      if (!note) return;
      return { content: [...event.content, { type: "text", text: note }] };
    } catch {
      // Formatting is best-effort; never break the underlying tool result.
      return;
    }
  });
}
