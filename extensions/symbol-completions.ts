/**
 * symbol-completions — `@@` symbol completion and `@@!` reference expansion.
 *
 * Two surfaces over one project index:
 *
 * 1. Completion (`@@`, `@@Class.`, `@@.`) — pops declarations/members in the
 *    input editor, with signatures in the description and most-recently-used
 *    ranking so your frequent symbols float up.
 * 2. Reference expansion (`@@!name`, `@@!Owner.member`) — on submit, the
 *    `input` event rewrites these tokens into inline `<symbol>` blocks with
 *    the declaration's source, so the model gets ground truth without a read
 *    round-trip. Plain `@@name` stays a bare reference; `@@!` is the explicit
 *    "inject the body" directive.
 *
 * Index: `ast-grep outline --json=stream` for top-level symbols, plus an
 * in-process @ast-grep/napi pass for class/interface members (owner resolved
 * via the ancestor chain, object-literal methods excluded). Built lazily on
 * first trigger, cached with a short TTL, filtered locally per keystroke.
 *
 * Progressive enhancement: requires `ast-grep` on PATH (and napi for
 * members); completion and expansion silently defer when unavailable.
 */

import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  fuzzyFilter,
  type AutocompleteItem,
  type AutocompleteProvider,
  type AutocompleteSuggestions,
} from "@earendil-works/pi-tui";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  deriveSignatures,
  extractMembersFromFiles,
  findSgVersion,
  getNapi,
  parseOutlineStream,
  runAstGrep,
  type MemberSymbol,
  type OutlineSymbol,
} from "./ast-grep.ts";

const INDEX_TTL_MS = 30_000;
const MAX_SUGGESTIONS = 20;
const MAX_SYMBOLS = 5000;
const MAX_MEMBERS = 10_000;
const MAX_DESCRIPTION_LEN = 72;
/** Below this query length the member fallback does not fire (avoids typo noise). */
const MEMBER_FALLBACK_MIN_QUERY = 2;

interface RepoIndex {
  builtAt: number;
  symbols: OutlineSymbol[];
  members: MemberSymbol[] | null; // null = not built yet
  mru: Map<string, number>; // item label -> recency counter
}

let mruCounter = 0;

// --------------------------------------------------------------------------- //
// Pure helpers (exported for tests)
// --------------------------------------------------------------------------- //

export type CompletionMode = "top" | "members" | "class";

export interface CompletionQuery {
  mode: CompletionMode;
  /** Partial symbol/member text the user has typed. */
  query: string;
  /** Class/interface name for `@@Class.member` mode. */
  owner?: string;
  /** The full matched token, used as the applyCompletion prefix. */
  rawPrefix: string;
}

/**
 * Parse the text before the cursor for a `@@` completion token. Handles all
 * three modes; returns undefined when the cursor is not after one.
 */
export function extractCompletionQuery(textBeforeCursor: string): CompletionQuery | undefined {
  const match = textBeforeCursor.match(
    /(?:^|[ \t"'(,;=])(@@)(!?)([A-Za-z0-9_$]*)(?:\.([A-Za-z0-9_$]*))?$/,
  );
  if (!match) return undefined;
  const sigil = match[1]! + (match[2] ?? "");
  const beforeDot = match[3] ?? "";
  const afterDot = match[4];
  if (afterDot === undefined) {
    return { mode: "top", query: beforeDot, rawPrefix: `${sigil}${beforeDot}` };
  }
  if (beforeDot === "") {
    return { mode: "members", query: afterDot, rawPrefix: `${sigil}.${afterDot}` };
  }
  return {
    mode: "class",
    owner: beforeDot,
    query: afterDot,
    rawPrefix: `${sigil}${beforeDot}.${afterDot}`,
  };
}

/** Description for a symbol completion item: signature leads, file/line trails. */
export function formatSymbolDescription(symbol: {
  symbolType: string;
  signature?: string;
  file: string;
  line: number;
}): string {
  const sig = (symbol.signature ?? "").trim();
  const lead = sig.length > 0 ? sig : symbol.symbolType;
  const truncated =
    lead.length > MAX_DESCRIPTION_LEN ? `${lead.slice(0, MAX_DESCRIPTION_LEN - 1)}…` : lead;
  return `${truncated} · ${symbol.file}:${symbol.line}`;
}

/** Stable reorder: previously-used items first (by recency), then fuzzy order. */
export function applyMru<T extends { label: string }>(
  items: T[],
  mru: ReadonlyMap<string, number>,
): T[] {
  const used = items
    .filter((i) => mru.has(i.label))
    .toSorted((a, b) => (mru.get(b.label) ?? 0) - (mru.get(a.label) ?? 0));
  const fresh = items.filter((i) => !mru.has(i.label));
  return [...used, ...fresh];
}

/** One reference (`@@name` or `@@!name`) extracted from an outgoing prompt. */
export interface SymbolReference {
  raw: string;
  /** Top-level name, or `Owner.member` for members. */
  name: string;
  /** True for `@@!name` (full body); false for `@@name` (signature only). */
  expand: boolean;
}

const REFERENCE_RE = /@@(!?)([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)?)/g;

/** Extract `@@name` / `@@!name` / `@@Owner.member` tokens from a prompt. */
export function extractSymbolReferences(text: string): SymbolReference[] {
  const refs: SymbolReference[] = [];
  for (const match of text.matchAll(REFERENCE_RE)) {
    refs.push({ raw: match[0]!, name: match[2]!, expand: match[1] === "!" });
  }
  return refs;
}

/** Render a resolved symbol as an inline `<symbol>` context block. */
export function renderSymbolBlock(name: string, file: string, line: number, body: string): string {
  return `<symbol name="${name}" file="${file}:${line}">\n${body.trim()}\n</symbol>`;
}

/** Slice a declaration out of a file by 0-indexed line range. */
function sliceLines(source: string, startLine: number, endLine: number): string {
  const lines = source.split("\n");
  const start = Math.max(0, Math.min(startLine, lines.length - 1));
  const end = Math.max(start, Math.min(endLine, lines.length - 1));
  return lines.slice(start, end + 1).join("\n");
}

// --------------------------------------------------------------------------- //
// Item formatting
// --------------------------------------------------------------------------- //

function toItem(symbol: OutlineSymbol): AutocompleteItem {
  return {
    value: symbol.name,
    label: symbol.name,
    description: formatSymbolDescription(symbol),
  };
}

function memberToItem(member: MemberSymbol): AutocompleteItem {
  return {
    value: member.name,
    label: `${member.owner}.${member.name}`,
    description: formatSymbolDescription(member),
  };
}

// --------------------------------------------------------------------------- //
// Index
// --------------------------------------------------------------------------- //

const indexes = new Map<string, RepoIndex>();
const inflight = new Map<string, Promise<RepoIndex | null>>();
const memberInflight = new Map<string, Promise<MemberSymbol[] | null>>();

async function buildIndex(cwd: string, signal: AbortSignal | undefined): Promise<RepoIndex | null> {
  const cached = indexes.get(cwd);
  if (cached && Date.now() - cached.builtAt < INDEX_TTL_MS) return cached;

  const pending = inflight.get(cwd);
  if (pending) return pending;

  const build = (async (): Promise<RepoIndex | null> => {
    const version = await findSgVersion();
    if (version === null) return null;
    const result = await runAstGrep(["outline", "--json=stream", "."], cwd, signal);
    if (result.code !== 0) return null;
    const symbols = parseOutlineStream(result.stdout);
    if (symbols.length > MAX_SYMBOLS) symbols.length = MAX_SYMBOLS;
    await deriveSignatures(symbols, cwd);
    const index: RepoIndex = { builtAt: Date.now(), symbols, members: null, mru: new Map() };
    indexes.set(cwd, index);
    return index;
  })();

  inflight.set(cwd, build);
  try {
    return await build;
  } finally {
    inflight.delete(cwd);
  }
}

/** Build the member index lazily, once per cached index. Null when napi is absent. */
async function ensureMembers(index: RepoIndex, cwd: string): Promise<MemberSymbol[] | null> {
  if (index.members !== null) return index.members;

  const pending = memberInflight.get(cwd);
  if (pending) return pending;

  const build = (async (): Promise<MemberSymbol[] | null> => {
    const napi = await getNapi();
    if (napi === null) return null;
    const files = [...new Set(index.symbols.map((s) => s.file))];
    const members = await extractMembersFromFiles(files, cwd, napi);
    if (members.length > MAX_MEMBERS) members.length = MAX_MEMBERS;
    index.members = members;
    return members;
  })();

  memberInflight.set(cwd, build);
  try {
    return await build;
  } finally {
    memberInflight.delete(cwd);
  }
}

// --------------------------------------------------------------------------- //
// Completion provider
// --------------------------------------------------------------------------- //

/**
 * Build the stacked autocomplete provider. Exported for live probes and tests;
 * `current` is the built-in provider the editor passes through the factory.
 */
export function createSymbolAutocompleteProvider(
  current: AutocompleteProvider,
  cwd: string,
): AutocompleteProvider {
  return {
    triggerCharacters: ["@"],

    async getSuggestions(
      lines,
      cursorLine,
      cursorCol,
      options,
    ): Promise<AutocompleteSuggestions | null> {
      const currentLine = lines[cursorLine] ?? "";
      const textBeforeCursor = currentLine.slice(0, cursorCol);
      const q = extractCompletionQuery(textBeforeCursor);

      if (q === undefined) {
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
      }

      const index = await buildIndex(cwd, options.signal);
      if (options.signal.aborted || index === null) {
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
      }

      let items: AutocompleteItem[] = [];

      if (q.mode === "top") {
        items = fuzzyFilter(index.symbols.map(toItem), q.query, (i) => i.label);
        // "I don't recall the owner": top-level came up empty, so look inside
        // classes/interfaces — but only for a query long enough to be real.
        if (items.length === 0 && q.query.length >= MEMBER_FALLBACK_MIN_QUERY) {
          const members = await ensureMembers(index, cwd);
          if (members !== null) {
            items = fuzzyFilter(members.map(memberToItem), q.query, (i) => i.label);
          }
        }
      } else if (q.mode === "members") {
        if (q.query.length === 0)
          return current.getSuggestions(lines, cursorLine, cursorCol, options);
        const members = await ensureMembers(index, cwd);
        if (members !== null) {
          items = fuzzyFilter(members.map(memberToItem), q.query, (i) => i.label);
        }
      } else {
        // class mode: owner scoped, so an empty query is fine.
        const members = await ensureMembers(index, cwd);
        if (members !== null) {
          const scoped = members.filter((m) => m.owner === q.owner).map(memberToItem);
          items = fuzzyFilter(scoped, q.query, (i) => i.label.slice(q.owner!.length + 1));
        }
      }

      items = applyMru(items, index.mru).slice(0, MAX_SUGGESTIONS);
      if (items.length === 0) {
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
      }

      return { items, prefix: q.rawPrefix };
    },

    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      // Only @@ / @@! references are ours; delegate slash commands and file
      // completions to the built-in provider so their insert semantics
      // survive (e.g. `/reload` must stay `/reload`, not become `@@reload`).
      if (!prefix.startsWith("@@")) {
        return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
      }

      // Record the pick so MRU ordering floats it up next time.
      const index = indexes.get(cwd);
      if (index) index.mru.set(item.label, ++mruCounter);

      // Keep the @@ / @@! sigil so the reference resolves on submit (the
      // input transform expands @@name to a signature and @@!name to the body).
      const sigil = prefix.startsWith("@@!") ? "@@!" : "@@";
      const insert = sigil + item.value;
      const currentLine = lines[cursorLine] ?? "";
      const beforePrefix = currentLine.slice(0, cursorCol - prefix.length);
      const afterCursor = currentLine.slice(cursorCol);
      const newLines = [...lines];
      newLines[cursorLine] = beforePrefix + insert + afterCursor;
      return {
        lines: newLines,
        cursorLine,
        cursorCol: beforePrefix.length + insert.length,
      };
    },

    shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
      return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
    },
  };
}

// --------------------------------------------------------------------------- //
// `@@` reference expansion (input transform)
// --------------------------------------------------------------------------- //

/**
 * Resolve `@@name` (signature) and `@@!name` (full body) tokens against the
 * index, rendering inline `<symbol>` blocks. Unresolved symbols and missing
 * index fall back to the bare name (never leave a literal `@@ref` in the
 * prompt, which would be meaningless to the model).
 */
export async function expandSymbolReferences(text: string, cwd: string): Promise<string> {
  const refs = extractSymbolReferences(text);
  if (refs.length === 0) return text;

  const index = await buildIndex(cwd, undefined);

  // No ast-grep: strip sigils so the model sees bare names, not @@refs.
  if (index === null) {
    let out = text;
    for (const ref of refs) out = out.replace(ref.raw, ref.name);
    return out;
  }

  // Build a name -> symbol map and owner.member -> member map once.
  const bySymbol = new Map(index.symbols.map((s) => [s.name, s]));
  const members = index.members ?? (await ensureMembers(index, cwd));
  const byMember = new Map((members ?? []).map((m) => [`${m.owner}.${m.name}`, m]));

  // Resolve and read each referenced file once, in parallel.
  const resolved = await Promise.all(
    refs.map(async (ref) => {
      const symbol = bySymbol.get(ref.name) ?? byMember.get(ref.name);
      if (!symbol) return { ref, symbol: null, body: null as string | null };
      try {
        const source = await readFile(join(cwd, symbol.file), "utf8");
        const body = ref.expand
          ? sliceLines(source, symbol.line - 1, symbol.endLine)
          : symbol.signature || sliceLines(source, symbol.line - 1, symbol.line - 1);
        return { ref, symbol, body };
      } catch {
        return { ref, symbol, body: null as string | null };
      }
    }),
  );

  let out = text;
  for (const { ref, symbol, body } of resolved) {
    if (symbol === null || body === null || body.trim() === "") {
      // Unresolved: fall back to the bare name so the model still sees intent.
      out = out.replace(ref.raw, ref.name);
      continue;
    }
    out = out.replace(ref.raw, renderSymbolBlock(ref.name, symbol.file, symbol.line, body));
  }
  return out;
}

// --------------------------------------------------------------------------- //
// Extension wiring
// --------------------------------------------------------------------------- //

export default function (pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    try {
      const cwd = ctx.cwd;
      ctx.ui?.addAutocompleteProvider((current) => createSymbolAutocompleteProvider(current, cwd));
    } catch {
      // Never let a completion-provider registration break session start/reload.
    }
  });

  pi.on("input", (event, ctx) => {
    // Only pay the lookup cost when the message actually carries a reference.
    if (!event.text.includes("@@")) return { action: "continue" };
    return expandSymbolReferences(event.text, ctx.cwd)
      .then((text) =>
        text === event.text
          ? ({ action: "continue" } as const)
          : { action: "transform" as const, text },
      )
      .catch(() => ({ action: "continue" }) as const);
  });
}
