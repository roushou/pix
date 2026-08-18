/**
 * Shared text utilities — byte-aware truncation and one-line formatting.
 *
 * The same truncation rules were previously copy-pasted into web.ts,
 * subagent.ts, auto-format and permission-gate with slightly different
 * notes and boundaries. This module is the single source of truth:
 *
 *   truncateBytes   — byte-safe truncation (never splits a UTF-8 code point)
 *   truncateOutput  — line cap, then byte cap, each with a visible note
 *   truncateChars   — character-based truncation that preserves structure
 *   oneLine         — collapse whitespace, optionally truncate with an ellipsis
 *
 * Everything here is pure and tested (tests/text.test.ts). Callers keep their
 * own policy constants (caps, note wording) and compose these primitives.
 */

export interface TruncateOutputOptions {
  /** Maximum number of lines to keep from the head. Default: 2000. */
  maxLines?: number;
  /** Maximum byte length of the result. Default: 50 KiB. */
  maxBytes?: number;
}

const DEFAULT_MAX_LINES = 2000;
const DEFAULT_MAX_BYTES = 50 * 1024;

/**
 * Truncate `text` to at most `max` bytes without splitting a UTF-8 code
 * point. Returns the input unchanged when it already fits.
 */
export function truncateBytes(text: string, max: number): string {
  if (Buffer.byteLength(text, "utf8") <= max) return text;
  let out = text.slice(0, max);
  while (Buffer.byteLength(out, "utf8") > max) out = out.slice(0, -1);
  return out;
}

/**
 * Truncate tool output for the model: first cap lines from the head, then
 * cap bytes. When either limit is hit a `[Truncated...]` note is appended so
 * the model knows the view is partial.
 */
export function truncateOutput(text: string, options: TruncateOutputOptions = {}): string {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  const lines = text.split("\n");
  let note = "";
  if (lines.length > maxLines) {
    lines.length = maxLines;
    note = `\n\n[Truncated: showing first ${maxLines} lines]`;
  }

  let out = lines.join("\n");
  if (Buffer.byteLength(out, "utf8") > maxBytes) {
    out = truncateBytes(out, maxBytes);
    note = `\n\n[Truncated to ${maxBytes} bytes]`;
  }
  return out + note;
}

/**
 * Character-based truncation that keeps the text's structure: newlines and
 * indentation are preserved, only the tail is cut with an ellipsis. Use for
 * error output and lint findings where collapsing whitespace would hide
 * line-based messages.
 */
export function truncateChars(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Collapse runs of whitespace (newlines, tabs, repeated spaces) into single
 * spaces and trim. With `max`, the result is truncated to `max` characters
 * with a trailing ellipsis. Used for notification bodies, one-line previews,
 * and error summaries.
 */
export function oneLine(text: string, max?: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (max === undefined || collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max - 1).trimEnd()}…`;
}
