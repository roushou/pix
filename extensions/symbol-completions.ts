/**
 * symbol-completions — `@@name` symbol completion in the input editor.
 *
 * Type `@@` and start typing a symbol: the editor pops suggestions from the
 * current project's declarations, right at the cursor. Powered by
 * `ast-grep outline --json=stream`, indexed lazily on first trigger and
 * cached per session with a short TTL, then filtered locally per keystroke.
 *
 * Prefix disambiguation: the built-in editor already completes files after
 * a single `@`; `@@` routes to symbols here, and anything else falls through
 * to the built-in provider unchanged.
 *
 * Progressive enhancement: requires `ast-grep` on PATH; the provider silently
 * defers to the built-in (and notifies once) when it is missing.
 */

import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  fuzzyFilter,
  type AutocompleteItem,
  type AutocompleteProvider,
  type AutocompleteSuggestions,
} from "@earendil-works/pi-tui";
import { findSgVersion, parseOutlineStream, runAstGrep } from "./ast-grep.ts";

const INDEX_TTL_MS = 30_000;
const MAX_SUGGESTIONS = 20;
const MAX_SYMBOLS = 5000;

interface SymbolIndex {
  builtAt: number;
  symbols: AutocompleteItem[];
}

const indexes = new Map<string, SymbolIndex>();
const inflight = new Map<string, Promise<SymbolIndex | null>>();

/**
 * Extract the partial symbol name after `@@` at the cursor. Returns undefined
 * when the cursor is not directly after an `@@token` boundary.
 */
export function extractSymbolToken(textBeforeCursor: string): string | undefined {
  const match = textBeforeCursor.match(/(?:^|[ \t"'(,;=])@@([A-Za-z0-9_$]*)$/);
  return match?.[1];
}

/** Format an outline symbol as an autocomplete item. */
function toItem(symbol: {
  name: string;
  symbolType: string;
  file: string;
  line: number;
}): AutocompleteItem {
  return {
    value: symbol.name,
    label: symbol.name,
    description: `${symbol.symbolType} · ${symbol.file}:${symbol.line}`,
  };
}

async function buildIndex(
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<SymbolIndex | null> {
  const cached = indexes.get(cwd);
  if (cached && Date.now() - cached.builtAt < INDEX_TTL_MS) return cached;

  const pending = inflight.get(cwd);
  if (pending) return pending;

  const build = (async (): Promise<SymbolIndex | null> => {
    const version = await findSgVersion();
    if (version === null) return null;
    const result = await runAstGrep(["outline", "--json=stream", "."], cwd, signal);
    if (result.code !== 0) return null;
    const symbols = parseOutlineStream(result.stdout);
    if (symbols.length > MAX_SYMBOLS) symbols.length = MAX_SYMBOLS;
    const index: SymbolIndex = { builtAt: Date.now(), symbols: symbols.map(toItem) };
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

/**
 * Build the stacked autocomplete provider. Exported for live probes and tests;
 * `current` is the built-in provider the editor passes through the factory.
 */
export function createSymbolAutocompleteProvider(
  current: AutocompleteProvider,
  cwd: string,
): AutocompleteProvider {
  let missingNotified = false;

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
      const query = extractSymbolToken(textBeforeCursor);

      if (query === undefined) {
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
      }

      const index = await buildIndex(cwd, options.signal);
      if (options.signal.aborted || index === null) {
        if (index === null && !missingNotified) {
          missingNotified = true;
        }
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
      }

      const items = fuzzyFilter(index.symbols, query, (item) => item.label).slice(
        0,
        MAX_SUGGESTIONS,
      );
      if (items.length === 0) {
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
      }

      return { items, prefix: `@@${query}` };
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
