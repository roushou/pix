/**
 * ast-grep — structural search, rewrite, and symbol rename via the ast-grep CLI.
 *
 * Progressive enhancement: requires `ast-grep` on PATH — the tools report a
 * tools report a clear "not available" result otherwise, and the rest of
 * pix keeps working. The adapter is a thin, safe wrapper: spawn with an args
 * array (never a shell string), preview via `--json=compact`, apply with
 * `-U`, and re-record touched files into the session SnapshotStore so
 * subsequent anchor-based `patch` calls verify against fresh content.
 *
 * Two tools:
 *
 *   ast_grep_rewrite — pattern -> replacement (structural; `$NAME` single metas and
 *                `$$$A` multi-metas expand like regex captures). Anonymous
 *                `$$$` is auto-named to `$$$M1..N` because ast-grep 0.45
 *                does not expand the anonymous form in fix strings.
 *   ast_grep_rename  — rename an identifier across files. Matches identifier nodes
 *                only (function/variable/parameter/type names), never
 *                property accesses (`obj.foo`), string literals, or comments.
 *
 * Capability probe: `ast-grep --version` once per session.
 */

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { SnapshotStore } from "./shared/snapshots.ts";
import { asText } from "./shared/tools.ts";

const MAX_APPLY_MATCHES = 2000;
const BINARY = "ast-grep";

// --------------------------------------------------------------------------- //
// Pure helpers (exported for tests)
// --------------------------------------------------------------------------- //

/**
 * ast-grep rewrites only expand *named* multi-metas (`$$$A`); the anonymous
 * `$$$` form is echoed literally in fix strings (verified on 0.45.1). Rewrite
 * anonymous multi-metas to `$$$M1..N` consistently in pattern and fix, in
 * positional order — the convention the ast-grep docs use.
 */
export function normalizeMultiMetas(
  pattern: string,
  rewrite: string,
): {
  pattern: string;
  rewrite: string;
} {
  const anon = /\$\$\$(?![\w-])/g;
  // Positional, independent per string: ast-grep matches meta variables by
  // name, so the rewrite's first anonymous $$$ must become $$$M1 to refer
  // to the pattern's first capture.
  const count = (s: string): string => {
    let n = 0;
    return s.replace(anon, () => `$$$M${++n}`);
  };
  return {
    pattern: count(pattern),
    rewrite: count(rewrite),
  };
}

/** One match from ast-grep's `--json=compact` output. */
export interface SgMatch {
  file: string;
  startLine: number; // 0-indexed, like ast-grep
  startColumn: number;
  endLine: number;
  endColumn: number;
  text: string;
  replacement?: string;
}

/**
 * Parse ast-grep `--json[=compact]` stdout into matches. Empty output (no
 * matches — exit code 1) yields `[]`; malformed non-empty output throws.
 */
export function parseSgJson(raw: string): SgMatch[] {
  const trimmed = raw.trim();
  if (trimmed === "") return [];
  const parsed = JSON.parse(trimmed) as Array<{
    file?: string;
    range?: {
      start?: { line?: number; column?: number };
      end?: { line?: number; column?: number };
    };
    text?: string;
    replacement?: string;
  }>;
  return parsed.map((m) => ({
    file: m.file ?? "(unknown)",
    startLine: m.range?.start?.line ?? 0,
    startColumn: m.range?.start?.column ?? 0,
    endLine: m.range?.end?.line ?? 0,
    endColumn: m.range?.end?.column ?? 0,
    text: m.text ?? "",
    replacement: m.replacement,
  }));
}

/** Build the ast-grep run arguments for a rewrite. Pure, so tests can pin it. */
export function buildSgArgs(
  pattern: string,
  rewrite: string,
  opts: { lang?: string; path?: string; json?: boolean; updateAll?: boolean } = {},
): string[] {
  const args = ["-p", pattern, "-r", rewrite];
  if (opts.lang) args.push("-l", opts.lang);
  if (opts.json) args.push("--json=compact");
  if (opts.updateAll) args.push("-U");
  if (opts.path) args.push(opts.path);
  return args;
}

// --------------------------------------------------------------------------- //
// CLI plumbing
// --------------------------------------------------------------------------- //

let sgVersion: string | null | undefined;

/** Probe the ast-grep CLI once per session; null when unavailable. */
export async function findSgVersion(): Promise<string | null> {
  if (sgVersion !== undefined) return sgVersion;
  try {
    const { stdout } = await runSg(["--version"], process.cwd());
    const match = /ast-grep\s+(\d+\.\d+\.\d+)/.exec(stdout);
    sgVersion = match ? match[1]! : "unknown";
  } catch {
    sgVersion = null;
  }
  return sgVersion;
}

interface SgResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runSg(
  args: string[],
  cwd: string,
  signal?: AbortSignal,
  timeoutMs = 30_000,
): Promise<SgResult> {
  return new Promise((resolve, reject) => {
    let proc;
    try {
      proc = spawn(BINARY, args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      reject(new Error(`${BINARY} could not be spawned`));
      return;
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) proc.kill("SIGTERM");
    }, timeoutMs);
    const done = (result: SgResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(result);
    };
    const onAbort = () => {
      if (!settled) proc.kill("SIGTERM");
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    proc.on("error", () => done({ code: 127, stdout, stderr }));
    proc.on("close", (code) => done({ code: code ?? 0, stdout, stderr }));
  });
}

// --------------------------------------------------------------------------- //
// Shared execution
// --------------------------------------------------------------------------- //

interface RewriteOutcome {
  matches: SgMatch[];
  diff: string;
}

/**
 * Preview (JSON + unified diff) then optionally apply a rewrite. Returns the
 * structured matches, the human-readable diff, and — when applied — the
 * freshly recorded snapshot tags for every touched file.
 */
async function executeRewrite(
  pattern: string,
  rewrite: string,
  opts: {
    lang?: string;
    path: string;
    cwd: string;
    apply: boolean;
    signal?: AbortSignal;
  },
  snapshots: SnapshotStore,
): Promise<{ outcome: RewriteOutcome; applied: boolean; tags: Record<string, string> }> {
  const { pattern: p, rewrite: r } = normalizeMultiMetas(pattern, rewrite);
  const common = { lang: opts.lang, path: opts.path };

  // Spawn cwd must be a directory; the scan path may be a file or ".".
  const dir = opts.path === "." ? opts.cwd : opts.path;
  const scanCwd = opts.path !== "." && !opts.path.includes("/") ? opts.cwd : opts.cwd;
  const spawnCwd = opts.path === "." || opts.path.startsWith("./") ? opts.cwd : opts.cwd;
  void dir;
  void scanCwd;
  void spawnCwd;

  // 1. Structured preview: match metadata via JSON.
  const preview = await runSg(buildSgArgs(p, r, { ...common, json: true }), opts.cwd, opts.signal);
  if (preview.code !== 0 && preview.code !== 1) {
    throw new Error(`${BINARY} failed (exit ${preview.code}): ${preview.stderr.trim()}`);
  }
  const matches = parseSgJson(preview.stdout);

  // 2. Human-readable diff (unified), same pattern.
  const diffRun = await runSg(buildSgArgs(p, r, common), opts.path, opts.signal);
  const diff = diffRun.code === 0 ? diffRun.stdout : "(no diff output)";

  if (matches.length === 0 || !opts.apply) {
    return { outcome: { matches, diff }, applied: false, tags: {} };
  }
  if (matches.length > MAX_APPLY_MATCHES) {
    throw new Error(
      `${matches.length} matches exceeds the apply cap of ${MAX_APPLY_MATCHES}. Narrow the pattern or scope first.`,
    );
  }

  // 3. Apply in place, then re-record snapshots so patch anchors stay fresh.
  const applyRun = await runSg(
    buildSgArgs(p, r, { ...common, updateAll: true }),
    opts.path,
    opts.signal,
  );
  if (applyRun.code !== 0) {
    throw new Error(`${BINARY} apply failed (exit ${applyRun.code}): ${applyRun.stderr.trim()}`);
  }

  const tags: Record<string, string> = {};
  const files = [...new Set(matches.map((m) => m.file))];
  const recorded = await Promise.all(
    files.map(async (file) => {
      const content = await readFile(file, "utf8").catch(() => null);
      if (content === null) return null;
      const tag = snapshots.record(file, content);
      return tag === undefined ? null : ([file, tag] as const);
    }),
  );
  for (const entry of recorded) {
    if (entry !== null) tags[entry[0]] = entry[1];
  }
  return { outcome: { matches, diff }, applied: true, tags };
}

function formatRewriteResult(
  result: Awaited<ReturnType<typeof executeRewrite>>,
  pattern: string,
): string {
  const { matches, diff } = result.outcome;
  if (matches.length === 0)
    return `No matches for pattern: ${pattern}\n\nStructural patterns match exact AST shape — if the code has return types, decorators, or type arguments, include them in the pattern (e.g. 'function $N($$$): $T { $$$ }').`;
  const files = new Set(matches.map((m) => m.file)).size;
  const head = result.applied
    ? `Rewrote ${matches.length} match${matches.length > 1 ? "es" : ""} across ${files} file${files > 1 ? "s" : ""}:`
    : `Preview: ${matches.length} match${matches.length > 1 ? "es" : ""} across ${files} file${files > 1 ? "s" : ""}:`;
  const tagLines = Object.entries(result.tags)
    .map(([file, tag]) => `  [${file}#${tag}]`)
    .join("\n");
  return `${head}\n\n${diff.trimEnd()}\n${tagLines ? `\nFresh snapshot tags (for patch anchors):\n${tagLines}` : ""}`;
}

// --------------------------------------------------------------------------- //
// Tool registration
// --------------------------------------------------------------------------- //

const baseParams = {
  path: Type.Optional(
    Type.String({
      description: "File or directory to scan. Default: session cwd (respects .gitignore).",
    }),
  ),
  lang: Type.Optional(
    Type.String({
      description:
        "Optional language override (ts, tsx, js, jsx, python, go, rust, ...). Default: auto-detect per file.",
    }),
  ),
  apply: Type.Optional(
    Type.Boolean({
      description: "Apply rewrites to disk. Default: true. Set false for a preview-only diff.",
      default: true,
    }),
  ),
} as const;

export default function (pi: ExtensionAPI) {
  // Session-scoped: snapshot tags recorded here are the same store the
  // anchor-based patch tool will verify against (shared module, one instance).
  const snapshots = new SnapshotStore();

  pi.registerTool({
    name: "ast_grep_rewrite",
    label: "Structural Rewrite",
    description: [
      "Structural pattern rewrite via ast-grep: replace AST nodes matched by a pattern, not regex text.",
      "Meta variables: $NAME (single node) and $$$A (zero+ nodes) expand like capture groups in the rewrite.",
      "Anonymous $$$ is auto-named to $$$M1..N, so 'function $N($$$) { $$$ }' works as written.",
      "Patterns match exact AST shape: include optional annotations (return types, decorators, type args).",
      "Property accesses, string literals, and comments are never touched.",
    ].join(" "),
    promptSnippet: "Structural rewrite via ast-grep (pattern -> replacement)",
    promptGuidelines: [
      "Use ast_grep_rewrite for structural transformations (rename APIs, change call shapes, add/remove wrappers) where regex grep+edit would be fragile.",
      "Structural patterns are exact: a pattern without a return type does not match a typed function. Include optional annotations, or use kind-based rules.",
      "Requires the ast-grep CLI on PATH (cargo install ast-grep). The tool reports clearly when unavailable.",
    ],
    parameters: Type.Object({
      pattern: Type.String({
        description: "Structural pattern with meta variables, e.g. 'function $NAME($$$) { $$$ }'.",
      }),
      rewrite: Type.String({
        description: "Replacement template; meta variables expand to captured nodes.",
      }),
      ...baseParams,
    }),

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const version = await findSgVersion();
      if (version === null) {
        return asText(
          `ast-grep is not on PATH. Install it (cargo install ast-grep, brew install ast-grep, or npm i -g @ast-grep/cli) to enable structural rewrites.`,
          { available: false },
        );
      }
      try {
        const result = await executeRewrite(
          params.pattern,
          params.rewrite,
          {
            lang: params.lang,
            path: params.path ?? ctx.cwd,
            cwd: ctx.cwd,
            apply: params.apply ?? true,
            signal,
          },
          snapshots,
        );
        return asText(formatRewriteResult(result, params.pattern), {
          available: true,
          version,
          applied: result.applied,
          matchCount: result.outcome.matches.length,
          files: [...new Set(result.outcome.matches.map((m) => m.file))],
          tags: result.tags,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`ast_grep_rewrite failed: ${message}`, { cause: error });
      }
    },
  });

  pi.registerTool({
    name: "ast_grep_rename",
    label: "Structural Rename",
    description: [
      "Rename an identifier across the workspace via ast-grep. Matches identifier nodes only:",
      "function/variable/parameter/class/type names and their references.",
      "Never touches property accesses (obj.foo), object keys, string literals, or comments.",
    ].join(" "),
    promptSnippet: "Rename a symbol across files (identifier-safe)",
    promptGuidelines: [
      "Use ast_grep_rename to rename a symbol everywhere instead of edit+read loops; it is structural, so comments and property accesses are safe.",
      "Preview with apply:false when unsure of the blast radius.",
    ],
    parameters: Type.Object({
      symbol: Type.String({
        description: "The identifier to rename (bare name, no $ or wildcards).",
      }),
      as: Type.String({ description: "The new name." }),
      ...baseParams,
    }),

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const version = await findSgVersion();
      if (version === null) {
        return asText(
          `ast-grep is not on PATH. Install it (cargo install ast-grep, brew install ast-grep, or npm i -g @ast-grep/cli) to enable structural renames.`,
          { available: false },
        );
      }
      if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(params.symbol)) {
        return asText(
          `"${params.symbol}" is not a valid identifier. ast_grep_rename takes a bare symbol name, e.g. ast_grep_rename({symbol: "foo", as: "bar"}).`,
          { available: true, version },
        );
      }
      try {
        const result = await executeRewrite(
          params.symbol,
          params.as,
          {
            lang: params.lang,
            path: params.path ?? ctx.cwd,
            cwd: ctx.cwd,
            apply: params.apply ?? true,
            signal,
          },
          snapshots,
        );
        const files = [...new Set(result.outcome.matches.map((m) => m.file))];
        const text = formatRewriteResult(result, params.symbol);
        return asText(text, {
          available: true,
          version,
          applied: result.applied,
          symbol: params.symbol,
          renamedTo: params.as,
          matchCount: result.outcome.matches.length,
          files,
          tags: result.tags,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`ast_grep_rename failed: ${message}`, { cause: error });
      }
    },
  });
}
