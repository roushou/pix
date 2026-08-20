/**
 * ast-grep — structural search, rewrite, and symbol rename via the ast-grep CLI
 * and, when available, the @ast-grep/napi in-process binding.
 *
 * Progressive enhancement: requires `ast-grep` on PATH — the tools report a
 * clear "not available" result otherwise, and the rest of pix keeps working.
 * The adapter is a thin, safe wrapper: spawn with an args array (never a
 * shell string), preview via `--json=compact`, and re-record touched files
 * into the session SnapshotStore so subsequent anchor-based `patch` calls
 * verify against fresh content.
 *
 * Apply path: when @ast-grep/napi is installed, matched files in the five
 * bundled languages (TypeScript, JavaScript, Tsx, Html, Css) are rewritten
 * in-process (parse -> findAll -> expand fix template -> commitEdits), which
 * drops the CLI's re-scan-and-apply spawn. Files in other languages fall
 * back to the CLI `-U` path per file. Discovery stays on the CLI so
 * .gitignore is respected (napi's findInFiles does NOT honor it).
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
 * Capability probes: `ast-grep --version` and a lazy @ast-grep/napi import,
 * both once per session.
 */

import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withFileMutationQueue, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { SnapshotStore } from "./shared/snapshots.ts";
import { truncateOutput } from "./shared/text.ts";
import { asText } from "./shared/tools.ts";

const MAX_APPLY_MATCHES = 2000;
const DIFF_MAX_LINES = 2000;
const DIFF_MAX_BYTES = 50 * 1024;
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
  /** ast-grep's language name for the file, e.g. "TypeScript", "Python". */
  language: string;
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
    language?: string;
    range?: {
      start?: { line?: number; column?: number };
      end?: { line?: number; column?: number };
    };
    text?: string;
    replacement?: string;
  }>;
  return parsed.map((m) => ({
    file: m.file ?? "(unknown)",
    language: m.language ?? "",
    startLine: m.range?.start?.line ?? 0,
    startColumn: m.range?.start?.column ?? 0,
    endLine: m.range?.end?.line ?? 0,
    endColumn: m.range?.end?.column ?? 0,
    text: m.text ?? "",
    replacement: m.replacement,
  }));
}

/** One symbol entry from `ast-grep outline --json=stream` output. */
export interface OutlineSymbol {
  name: string;
  symbolType: string; // function | class | interface | constant | struct | ...
  file: string;
  /** 1-indexed line of the declaration. */
  line: number;
  /** 0-indexed last line of the node (for slicing the full declaration). */
  endLine: number;
  /** The declaration's leading line (from outline's `signature` field). */
  signature: string;
  /** True when the entry is an import binding, not a declaration. */
  isImport: boolean;
}

/**
 * Parse `ast-grep outline --json=stream` (one JSON object per file, NDJSON)
 * into a flat symbol list. Skips anonymous entries; duplicates by name keep
 * the declaration over an import. Malformed lines are skipped.
 */
export function parseOutlineStream(raw: string): OutlineSymbol[] {
  const byName = new Map<string, OutlineSymbol>();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let entry: {
      path?: string;
      items?: Array<{
        name?: string;
        symbolType?: string;
        isImport?: boolean;
        signature?: string;
        range?: { start?: { line?: number }; end?: { line?: number } };
      }>;
    };
    try {
      entry = JSON.parse(trimmed) as typeof entry;
    } catch {
      continue;
    }
    const file = entry.path ?? "(unknown)";
    for (const item of entry.items ?? []) {
      if (!item.name || !item.symbolType) continue;
      const symbol: OutlineSymbol = {
        name: item.name,
        symbolType: item.symbolType,
        file,
        line: (item.range?.start?.line ?? 0) + 1,
        endLine: item.range?.end?.line ?? item.range?.start?.line ?? 0,
        signature: (item.signature ?? "").trim(),
        isImport: item.isImport === true,
      };
      const existing = byName.get(symbol.name);
      if (existing === undefined || (existing.isImport && !symbol.isImport)) {
        byName.set(symbol.name, symbol);
      }
    }
  }
  return [...byName.values()];
}

/**
 * ast-grep's `outline --json=stream` leaves the `signature` field EMPTY when
 * scanning a directory (verified on 0.45.1) — only single-file scans
 * populate it. Since the index scans the whole project, derive each symbol's
 * signature from the first line of its declaration instead, reading each
 * referenced file once. Mutates `symbols` in place.
 */
export async function deriveSignatures(symbols: OutlineSymbol[], cwd: string): Promise<void> {
  const byFile = new Map<string, OutlineSymbol[]>();
  for (const symbol of symbols) {
    const list = byFile.get(symbol.file);
    if (list) list.push(symbol);
    else byFile.set(symbol.file, [symbol]);
  }
  await Promise.all(
    [...byFile.entries()].map(async ([file, syms]) => {
      const source = await readFile(join(cwd, file), "utf8").catch(() => null);
      if (source === null) return;
      const lines = source.split("\n");
      for (const symbol of syms) {
        const first = (lines[symbol.line - 1] ?? "").trim();
        if (first) symbol.signature = first;
      }
    }),
  );
}

/** A class/interface member (method or field) with its owner. */
export interface MemberSymbol {
  name: string;
  owner: string;
  /** "method" | "field" */
  symbolType: "method" | "field";
  file: string;
  /** 1-indexed line of the member declaration. */
  line: number;
  /** 0-indexed last line of the member (for slicing the full declaration). */
  endLine: number;
  /** The member declaration's leading line. */
  signature: string;
}

/** ast-grep CLI language name → @ast-grep/napi Lang for the bundled set. */
const MEMBER_LANG_BY_EXT: Record<string, string> = {
  ts: "TypeScript",
  tsx: "Tsx",
  mts: "TypeScript",
  cts: "TypeScript",
  js: "JavaScript",
  jsx: "Tsx",
  mjs: "JavaScript",
  cjs: "JavaScript",
};

const MEMBER_KINDS = [
  "method_definition",
  "public_field_definition",
  "property_signature",
  "method_signature",
] as const;

const MEMBER_MODIFIERS =
  /^(?:public|private|protected|readonly|static|abstract|async|declare|override|get|set|new|export|default|\*)\s+/;

/**
 * Extract the member name from its declaration text. Handles modifiers
 * (`private prefix: string`), getters (`get foo()`), optional sigs
 * (`render?()`), and `#private` fields. Returns null for computed names
 * (`[Symbol.iterator]`) and anything unparseable.
 */
export function memberNameFromText(text: string): string | null {
  let s = text.trim();
  if (s.startsWith("[")) return null; // computed key
  let prev = "";
  while (prev !== s) {
    prev = s;
    s = s.replace(MEMBER_MODIFIERS, "").trim();
  }
  s = s.replace(/^#/, "");
  const match = /^([A-Za-z_$][A-Za-z0-9_$]*)/.exec(s);
  return match ? match[1]! : null;
}

/**
 * Extract class/interface members (methods + fields) with their owners from
 * a list of files, using the in-process napi binding. Files whose extension
 * the bundled napi cannot parse are skipped; object-literal methods are
 * excluded because only members whose ancestor is a class/interface
 * declaration are kept. `files` are cwd-relative paths; `cwd` resolves them.
 */
export async function extractMembersFromFiles(
  files: string[],
  cwd: string,
  napi: typeof import("@ast-grep/napi"),
): Promise<MemberSymbol[]> {
  const perFile = await Promise.all(
    files.map(async (file): Promise<MemberSymbol[]> => {
      const ext = file.split(".").pop()?.toLowerCase() ?? "";
      const langName = MEMBER_LANG_BY_EXT[ext];
      if (!langName) return [];

      const source = await readFile(join(cwd, file), "utf8").catch(() => null);
      if (source === null) return [];

      let root;
      try {
        root = napi.parse((napi.Lang as Record<string, string>)[langName] as never, source);
      } catch {
        return [];
      }

      const members: MemberSymbol[] = [];
      for (const kind of MEMBER_KINDS) {
        let nodes;
        try {
          nodes = root.root().findAll({ rule: { kind } });
        } catch {
          continue;
        }
        for (const node of nodes) {
          let owner: string | null = null;
          for (const ancestor of node.ancestors()) {
            const k = ancestor.kind();
            if (k === "class_declaration" || k === "interface_declaration") {
              owner = ancestor.field("name")?.text() ?? null;
              break;
            }
          }
          if (owner === null || owner === "") continue; // not a class/interface member
          const name = memberNameFromText(node.text());
          if (name === null) continue;
          const text = node.text();
          members.push({
            name,
            owner,
            symbolType:
              kind === "method_definition" || kind === "method_signature" ? "method" : "field",
            file,
            line: node.range().start.line + 1,
            endLine: node.range().end.line,
            signature: text.split("\n")[0]!.trim(),
          });
        }
      }
      return members;
    }),
  );
  return perFile.flat();
}

/** Build the ast-grep run arguments for a rewrite. Pure, so tests can pin it. */
export function buildSgArgs(
  pattern: string,
  rewrite: string,
  opts: {
    lang?: string;
    path?: string | string[];
    json?: boolean;
    updateAll?: boolean;
  } = {},
): string[] {
  const args = ["-p", pattern, "-r", rewrite];
  if (opts.lang) args.push("-l", opts.lang);
  if (opts.json) args.push("--json=compact");
  if (opts.updateAll) args.push("-U");
  const paths = typeof opts.path === "string" ? [opts.path] : (opts.path ?? []);
  for (const p of paths) args.push(p);
  return args;
}

/**
 * Map an ast-grep CLI language name to the bundled @ast-grep/napi Lang value,
 * or null when the napi binding cannot parse it (it bundles only five
 * languages; others require dynamic grammar registration).
 */
export function langFromSgName(name: string): string | null {
  switch (name) {
    case "TypeScript":
    case "JavaScript":
    case "Tsx":
    case "Html":
    case "Css":
      return name;
    default:
      return null;
  }
}

/**
 * Expand an ast-grep fix template: `$NAME` resolves single captures,
 * `$$$NAME` resolves multi captures. Literal text (including lone `$` not
 * followed by a meta name) passes through untouched.
 */
export function expandTemplate(
  template: string,
  resolve: (name: string, multi: boolean) => string,
): string {
  return template.replace(
    /\$\$\$([A-Za-z0-9_]+)|\$([A-Za-z_][A-Za-z0-9_]*)/g,
    (_m, multi: string | undefined, single: string | undefined) => {
      if (multi !== undefined) return resolve(multi, true);
      if (single !== undefined) return resolve(single, false);
      return _m;
    },
  );
}

/**
 * Keep the outermost (first-by-position) items, dropping any whose range
 * overlaps a kept one. ast-grep matches can nest (`function f() { function g() {} }`
 * matches both); rewriting the outer span covers the inner, so only the
 * outermost should produce an edit.
 */
export function keepOutermost<T extends { start: number; end: number }>(items: T[]): T[] {
  const out: T[] = [];
  let lastEnd = -1;
  for (const item of items) {
    if (item.start < lastEnd) continue;
    lastEnd = item.end;
    out.push(item);
  }
  return out;
}

// --------------------------------------------------------------------------- //
// CLI plumbing
// --------------------------------------------------------------------------- //

let sgVersion: string | null | undefined;

/** Probe the ast-grep CLI once per session; null when unavailable. */
export async function findSgVersion(): Promise<string | null> {
  if (sgVersion !== undefined) return sgVersion;
  try {
    const { stdout } = await runAstGrep(["--version"], process.cwd());
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

/**
 * Run the ast-grep CLI with an args array (never a shell string). Exported
 * for the symbol-completions extension and live probes.
 */
export function runAstGrep(
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
 *
 * Apply: files whose language the bundled @ast-grep/napi can parse are
 * rewritten in-process; everything else (or when napi is unavailable)
 * falls back to the CLI `-U` per file. Discovery always runs through the
 * CLI so .gitignore is respected.
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

  // 1. Structured preview: match metadata via JSON (authoritative counts).
  const preview = await runAstGrep(
    buildSgArgs(p, r, { ...common, json: true }),
    opts.cwd,
    opts.signal,
  );
  if (preview.code !== 0 && preview.code !== 1) {
    throw new Error(`${BINARY} failed (exit ${preview.code}): ${preview.stderr.trim()}`);
  }
  const matches = parseSgJson(preview.stdout);

  // 2. Human-readable diff (unified), same pattern.
  const diffRun = await runAstGrep(buildSgArgs(p, r, common), opts.cwd, opts.signal);
  const diff = diffRun.code === 0 ? diffRun.stdout : "(no diff output)";

  if (matches.length === 0 || !opts.apply) {
    return { outcome: { matches, diff }, applied: false, tags: {} };
  }
  if (matches.length > MAX_APPLY_MATCHES) {
    throw new Error(
      `${matches.length} matches exceeds the apply cap of ${MAX_APPLY_MATCHES}. Narrow the pattern or scope first.`,
    );
  }

  // 3. Apply. Prefer the in-process napi path; route each file to the CLI
  //    fallback when its language is not bundled or napi fails on it.
  const tags: Record<string, string> = {};
  const napi = await getNapi();
  const byFile = groupMatchesByFile(matches);
  const cliFiles: string[] = [];

  const routed = await Promise.all(
    [...byFile.entries()].map(async ([file, group]) => {
      if (!napi || langFromSgName(group.language) === null) {
        return { file, cli: true };
      }
      const res = await applyFileViaNapi(file, group.language, p, r, opts, napi, snapshots).catch(
        () => ({ tags: {}, failed: true }),
      );
      if (res.tags) Object.assign(tags, res.tags);
      return { file, cli: res.failed };
    }),
  );
  for (const { file, cli } of routed) {
    if (cli) cliFiles.push(file);
  }

  if (cliFiles.length > 0) {
    const applyRun = await runAstGrep(
      buildSgArgs(p, r, { lang: opts.lang, updateAll: true, path: cliFiles }),
      opts.cwd,
      opts.signal,
    );
    if (applyRun.code !== 0) {
      throw new Error(`${BINARY} apply failed (exit ${applyRun.code}): ${applyRun.stderr.trim()}`);
    }
    const recorded = await Promise.all(
      cliFiles.map(async (file) => {
        const content = await readFile(join(opts.cwd, file), "utf8").catch(() => null);
        if (content === null) return null;
        const tag = snapshots.record(join(opts.cwd, file), content);
        return tag === undefined ? null : ([file, tag] as const);
      }),
    );
    for (const entry of recorded) {
      if (entry !== null) tags[entry[0]] = entry[1];
    }
  }

  return { outcome: { matches, diff }, applied: true, tags };
}

// --------------------------------------------------------------------------- //
// In-process apply via @ast-grep/napi (optional dependency)
// --------------------------------------------------------------------------- //

type NapiModule = typeof import("@ast-grep/napi");

let napiModule: NapiModule | null | undefined;

/** Lazy-import the napi binding once per session; null when not installed. */
export async function getNapi(): Promise<NapiModule | null> {
  if (napiModule !== undefined) return napiModule;
  try {
    napiModule = await import("@ast-grep/napi");
  } catch {
    napiModule = null;
  }
  return napiModule;
}

function groupMatchesByFile(
  matches: SgMatch[],
): Map<string, { language: string; matches: SgMatch[] }> {
  const byFile = new Map<string, { language: string; matches: SgMatch[] }>();
  for (const m of matches) {
    const group = byFile.get(m.file);
    if (group) {
      group.matches.push(m);
    } else {
      byFile.set(m.file, { language: m.language, matches: [m] });
    }
  }
  return byFile;
}

/**
 * Rewrite one file in-process: parse, find matches, expand the fix template
 * per match, filter nested/overlapping edits, commit, and write back. On
 * success the new content is recorded into the snapshot store and the file's
 * fresh tag is returned. Returns `failed: true` when the file should be
 * re-applied via the CLI instead (e.g. a parse error).
 */
async function applyFileViaNapi(
  file: string,
  language: string,
  pattern: string,
  rewrite: string,
  opts: { cwd: string },
  napi: NapiModule,
  snapshots: SnapshotStore,
): Promise<{ tags: Record<string, string>; failed: boolean }> {
  const abs = join(opts.cwd, file);
  const source = await readFile(abs, "utf8").catch(() => null);
  if (source === null) return { tags: {}, failed: true };

  const langName = langFromSgName(language);
  if (langName === null) return { tags: {}, failed: true };

  const root = napi.parse((napi.Lang as Record<string, string>)[langName] as never, source);
  const nodes = root.root().findAll(pattern);
  if (nodes.length === 0) return { tags: {}, failed: true };

  // Build edits, outermost-first, with the fix template expanded from the
  // match's captures. Multi-captures are expanded as the source span between
  // the first and last captured node, so inter-node trivia survives.
  const pending = nodes.map((node) => ({
    start: node.range().start.index,
    end: node.range().end.index,
    node,
  }));
  const edits: Array<{ startPos: number; endPos: number; insertedText: string }> = [];
  for (const { start, end, node } of keepOutermost(pending)) {
    const replacement = expandTemplate(rewrite, (name, multi) => {
      if (multi) {
        const captured = node.getMultipleMatches(name);
        if (captured.length === 0) return "";
        const from = captured[0]!.range().start.index;
        const to = captured[captured.length - 1]!.range().end.index;
        return source.slice(from, to);
      }
      return node.getMatch(name)?.text() ?? "";
    });
    edits.push({ startPos: start, endPos: end, insertedText: replacement });
  }
  if (edits.length === 0) return { tags: {}, failed: true };

  const rewritten = root.root().commitEdits(edits);
  if (rewritten === source) return { tags: {}, failed: false };

  await withFileMutationQueue(abs, async () => {
    await writeFile(abs, rewritten);
  });
  const tag = snapshots.record(abs, rewritten);
  return { tags: tag === undefined ? {} : { [file]: tag }, failed: false };
}

/**
 * Render a rewrite result for the model. The unified diff is capped at
 * `DIFF_MAX_LINES` / `DIFF_MAX_BYTES` (head-first) so a repo-wide rename or
 * rewrite cannot dump an unbounded diff into the conversation context; the
 * match/file summary and any snapshot tags are preserved.
 */
export function formatRewriteResult(
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
  const diffText = truncateOutput(diff.trimEnd(), {
    maxLines: DIFF_MAX_LINES,
    maxBytes: DIFF_MAX_BYTES,
  });
  return `${head}\n\n${diffText}\n${tagLines ? `\nFresh snapshot tags (for patch anchors):\n${tagLines}` : ""}`;
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
