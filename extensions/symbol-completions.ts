/**
 * symbol-completions — `@@` symbol completion in the input editor.
 *
 * Type `@@` and start typing a symbol: the editor pops declarations from the
 * current project at the cursor. Powered by `ast-grep outline --json=stream`
 * for top-level symbols, plus an in-process @ast-grep/napi pass for class and
 * interface members. Indexes are built lazily on first trigger, cached with a
 * short TTL, then filtered locally per keystroke via pi-tui's fuzzyFilter.
 *
 * Three modes, disambiguated from the built-in single-`@` file completion:
 *
 *   @@foo            top-level symbols; on an empty hit, falls through to
 *                    members (the "I don't recall the owner" case) when the
 *                    query is long enough.
 *   @@Class.foo      members of one class/interface.
 *   @@.foo           every method/field across the repo (explicit broad mode).
 *
 * Members resolve their owner by walking the napi ancestor chain, so
 * object-literal methods are excluded and never pollute the list.
 *
 * Progressive enhancement: requires `ast-grep` on PATH (and, for members,
 * @ast-grep/napi); the provider silently defers to the built-in otherwise.
 */

import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  fuzzyFilter,
  type AutocompleteItem,
  type AutocompleteProvider,
  type AutocompleteSuggestions,
} from "@earendil-works/pi-tui";
import {
  extractMembersFromFiles,
  findSgVersion,
  getNapi,
  parseOutlineStream,
  runAstGrep,
  type OutlineSymbol,
} from "./ast-grep.ts";

const INDEX_TTL_MS = 30_000;
const MAX_SUGGESTIONS = 20;
const MAX_SYMBOLS = 5000;
const MAX_MEMBERS = 10_000;
/** Below this query length the member fallback does not fire (avoids typo noise). */
const MEMBER_FALLBACK_MIN_QUERY = 2;

interface RepoIndex {
  builtAt: number;
  symbols: OutlineSymbol[];
  members: AutocompleteItem[] | null; // null = not built yet
}

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
    /(?:^|[ \t"'(,;=])(@@)([A-Za-z0-9_$]*)(?:\.([A-Za-z0-9_$]*))?$/,
  );
  if (!match) return undefined;
  const beforeDot = match[2] ?? "";
  const afterDot = match[3];
  if (afterDot === undefined) {
    return { mode: "top", query: beforeDot, rawPrefix: `@@${beforeDot}` };
  }
  if (beforeDot === "") {
    return { mode: "members", query: afterDot, rawPrefix: `@@.${afterDot}` };
  }
  return {
    mode: "class",
    owner: beforeDot,
    query: afterDot,
    rawPrefix: `@@${beforeDot}.${afterDot}`,
  };
}

/** Format an outline symbol as an autocomplete item. */
function toItem(symbol: OutlineSymbol): AutocompleteItem {
  return {
    value: symbol.name,
    label: symbol.name,
    description: `${symbol.symbolType} · ${symbol.file}:${symbol.line}`,
  };
}

/** Format a member as an item; the owner is the answer, so it leads the label. */
function memberToItem(member: {
  name: string;
  owner: string;
  symbolType: string;
  file: string;
  line: number;
}): AutocompleteItem {
  return {
    value: member.name,
    label: `${member.owner}.${member.name}`,
    description: `${member.symbolType} · ${member.file}:${member.line}`,
  };
}

const indexes = new Map<string, RepoIndex>();
const inflight = new Map<string, Promise<RepoIndex | null>>();
const memberInflight = new Map<string, Promise<AutocompleteItem[] | null>>();

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
    const index: RepoIndex = { builtAt: Date.now(), symbols, members: null };
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
async function ensureMembers(index: RepoIndex, cwd: string): Promise<AutocompleteItem[] | null> {
  if (index.members !== null) return index.members;

  const pending = memberInflight.get(cwd);
  if (pending) return pending;

  const build = (async (): Promise<AutocompleteItem[] | null> => {
    const napi = await getNapi();
    if (napi === null) return null;
    const files = [...new Set(index.symbols.map((s) => s.file))];
    const members = await extractMembersFromFiles(files, cwd, napi);
    if (members.length > MAX_MEMBERS) members.length = MAX_MEMBERS;
    const items = members.map(memberToItem);
    index.members = items;
    return items;
  })();

  memberInflight.set(cwd, build);
  try {
    return await build;
  } finally {
    memberInflight.delete(cwd);
  }
}

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
            items = fuzzyFilter(members, q.query, (i) => i.label);
          }
        }
      } else if (q.mode === "members") {
        if (q.query.length === 0)
          return current.getSuggestions(lines, cursorLine, cursorCol, options);
        const members = await ensureMembers(index, cwd);
        if (members !== null) {
          items = fuzzyFilter(members, q.query, (i) => i.label);
        }
      } else {
        // class mode: owner scoped, so an empty query is fine.
        const members = await ensureMembers(index, cwd);
        if (members !== null) {
          const scoped = members.filter((i) => i.label.startsWith(`${q.owner}.`));
          items = fuzzyFilter(scoped, q.query, (i) => i.label.slice(q.owner!.length + 1));
        }
      }

      items = items.slice(0, MAX_SUGGESTIONS);
      if (items.length === 0) {
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
      }

      return { items, prefix: q.rawPrefix };
    },

    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      // Symbol references replace the @@query inline — unlike the built-in's
      // @-attachment path, no trailing space is added.
      const currentLine = lines[cursorLine] ?? "";
      const beforePrefix = currentLine.slice(0, cursorCol - prefix.length);
      const afterCursor = currentLine.slice(cursorCol);
      const newLines = [...lines];
      newLines[cursorLine] = beforePrefix + item.value + afterCursor;
      return {
        lines: newLines,
        cursorLine,
        cursorCol: beforePrefix.length + item.value.length,
      };
    },

    shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
      return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
    },
  };
}

export default function (pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    const cwd = ctx.cwd;
    ctx.ui.addAutocompleteProvider((current) => createSymbolAutocompleteProvider(current, cwd));
  });
}
