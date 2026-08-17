/**
 * permission-gate — engine that enforces the permission policy.
 *
 * The policy is declarative data in policy.ts: the rule table,
 * scratch directories, and eval/remote triggers. Edit that file to add or
 * tune rules without touching engine code; this file only interprets it.
 *
 * Two severity levels:
 * - block:   catastrophic commands are always blocked (rm -rf /, mkfs, ...).
 * - confirm: risky commands prompt for confirmation (sudo, force push,
 *            recursive rm, ...). In non-interactive mode (no UI) they are
 *            blocked by default.
 *
 * A confirm rule is scope-aware (see policy.ts): when every target
 * resolves inside a scratch directory the confirmation is skipped —
 * destructive commands on throwaway paths are routine and harmless. A
 * paths-scoped rule is skipped only if EVERY target arg is scratch
 * (`rm -rf /tmp/x ~/important` still prompts). Compound commands are tracked:
 * in `cd /tmp && rm -rf x`, `x` resolves against /tmp.
 *
 * Rules match a quote-masked command so prose inside strings (commit
 * messages, echo output) can never trigger a confirmation; substitutions and
 * string-eval args stay visible because they execute code.
 *
 * Scratch directories are symlink-resolved (macOS maps /tmp -> /private/tmp),
 * plus os.tmpdir() and extra dirs from the PI_SCRATCH_DIRS env var
 * (colon-separated, `~` allowed). Block rules are never waived.
 *
 * Config (optional, best-effort) — read from `~/.pi/agent/settings.json` and
 * `<project>/.pi/settings.json` under a `permissionGate` key:
 *
 *   {
 *     "permissionGate": {
 *       "notifyOnConfirm": "off"   // desktop notification before the dialog: "always" (default) | "off"
 *     }
 *   }
 *
 * Blocking a tool call returns a reason that is surfaced to the model, so the
 * agent can explain and retry with a safer command.
 */

import {
  isToolCallEventType,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, resolve, sep } from "node:path";
import { realpathSync } from "node:fs";
import {
  EVAL_TRIGGERS,
  NOTIFY_SPEC,
  REMOTE_TRIGGERS,
  RULES,
  SCRATCH_DIRS_SPEC,
  type Rule,
} from "./policy.ts";
import { sendNotification } from "../notify.ts";
import { resolveSpec } from "../shared/config.ts";
import { loadExtensionSettings } from "../shared/settings.ts";

// ---------------------------------------------------------------------------
// Scratch directories
// ---------------------------------------------------------------------------

const SCRATCH_ROOTS: string[] = [];

/** Expand ~, $HOME, $TMPDIR, and make absolute against `base` if needed. */
function expandPath(path: string, base?: string): string {
  const expanded = path
    .replace(/^\$TMPDIR(?=$|[/\\])/, tmpdir())
    .replace(/^\$HOME(?=$|[/\\])/, homedir())
    .replace(/^~(?=$|[/\\])/, homedir());
  return isAbsolute(expanded) ? expanded : resolve(base ?? homedir(), expanded);
}

function addScratchRoot(raw: string): void {
  const abs = expandPath(raw);
  SCRATCH_ROOTS.push(abs);
  try {
    SCRATCH_ROOTS.push(realpathSync(abs)); // /tmp -> /private/tmp on macOS
  } catch {
    // Path may not exist yet; the lexical form above still works.
  }
}

for (const dir of resolveSpec(SCRATCH_DIRS_SPEC, {}, process.env)) addScratchRoot(dir);
addScratchRoot(tmpdir());

/** True when `candidate` (relative to `base`) is inside a scratch directory. */
export function isScratchPath(candidate: string, base: string): boolean {
  const abs = expandPath(candidate, base);
  const forms = [abs];
  try {
    forms.push(realpathSync(abs)); // resolve symlinks on the target side too
  } catch {
    // Target may not exist yet (mkdir, fresh rm target) — lexical check below.
  }
  return forms.some((f) => SCRATCH_ROOTS.some((root) => f === root || f.startsWith(root + sep)));
}

// ---------------------------------------------------------------------------
// Command parsing
// ---------------------------------------------------------------------------

const EVAL_TRIGGER_SET = new Set(EVAL_TRIGGERS);
const REMOTE_TRIGGER_SET = new Set(REMOTE_TRIGGERS);

/**
 * Length-preserving mask of quoted text, so prose inside quotes can never
 * form a rule pattern while real code stays visible:
 *
 * - `'...'` and `"..."` inner text is replaced with spaces (offsets kept),
 *   except `$(...)` and backtick substitutions, which are code even inside
 *   double quotes (`echo "$(rm -rf /tmp)"` must still match).
 * - Quoted arguments to string-eval commands (see EVAL/REMOTE_TRIGGERS) are
 *   left visible: `bash -c 'rm -rf /tmp'` and `ssh host 'rm -rf /tmp'`
 *   execute their strings, so they must still match.
 * - Unterminated quotes are left unmasked (fail closed: prompt rather than
 *   miss). Newlines inside quotes are masked so a multi-line quoted string
 *   stays one segment.
 */
export function maskQuoted(command: string): string {
  const chars = [...command];
  const n = chars.length;
  const mask = (a: number, b: number) => {
    for (let i = a; i < b; i++) chars[i] = " ";
  };

  // Index just past a $(...) or `...` region starting at `start`.
  const skipSubstitution = (start: number): number => {
    if (chars[start] === "$" && chars[start + 1] === "(") {
      let depth = 1;
      let i = start + 2;
      while (i < n && depth > 0) {
        if (chars[i] === "(") depth++;
        else if (chars[i] === ")") depth--;
        i++;
      }
      return i;
    }
    let i = start + 1;
    while (i < n && chars[i] !== "`") i += chars[i] === "\\" ? 2 : 1;
    return i < n ? i + 1 : n;
  };

  // Unquoted token immediately before `at` (`bash -c '...'` → "-c").
  const prevToken = (at: number): string => {
    let j = at - 1;
    while (j >= 0 && /[\s&|;()<>]/.test(chars[j]!)) j--; // skip the gap
    const end = j + 1;
    while (j >= 0 && !/[\s&|;()<>]/.test(chars[j]!)) j--; // walk the token
    return command.slice(j + 1, end);
  };

  // First token of the enclosing segment (`ssh host '...'` → "ssh").
  const segmentStartToken = (at: number): string => {
    const before =
      command
        .slice(0, at)
        .split(/(?:&&|\|\||;|\n|\|)+/)
        .pop() ?? "";
    return before.trim().split(/\s+/)[0] ?? "";
  };

  const keptVisible = (at: number): boolean =>
    EVAL_TRIGGER_SET.has(prevToken(at)) || REMOTE_TRIGGER_SET.has(segmentStartToken(at));

  let i = 0;
  while (i < n) {
    const c = chars[i];
    if (c === "\\") {
      i += 2; // escaped char — code, keep both
      continue;
    }
    if (c === "$" && chars[i + 1] === "(") {
      i = skipSubstitution(i); // unquoted $() — code
      continue;
    }
    if (c === "`") {
      i = skipSubstitution(i); // unquoted backticks — code
      continue;
    }
    if (c !== "'" && c !== '"') {
      i++;
      continue;
    }

    // Find the closing quote, skipping escapes and substitutions inside.
    let j = i + 1;
    while (j < n) {
      if (c === '"' && chars[j] === "\\") {
        j += 2;
        continue;
      }
      if (c === '"' && chars[j] === "$" && chars[j + 1] === "(") {
        j = skipSubstitution(j);
        continue;
      }
      if (c === '"' && chars[j] === "`") {
        j = skipSubstitution(j);
        continue;
      }
      if (chars[j] === c) break;
      j++;
    }
    if (j >= n) break; // unterminated — leave the rest visible (fail closed)

    if (!keptVisible(i)) {
      // Mask prose, keeping $()/backtick substitutions visible.
      let k = i + 1;
      let cursor = i + 1;
      while (k < j) {
        if (c === '"' && chars[k] === "\\") {
          k += 2;
          continue;
        }
        if (c === '"' && chars[k] === "$" && chars[k + 1] === "(") {
          const s = skipSubstitution(k);
          mask(cursor, k);
          k = s;
          cursor = s;
          continue;
        }
        if (c === '"' && chars[k] === "`") {
          const s = skipSubstitution(k);
          mask(cursor, k);
          k = s;
          cursor = s;
          continue;
        }
        k++;
      }
      mask(cursor, j);
    }
    i = j + 1;
  }
  return chars.join("");
}

/** Quote-aware tokenizer, so paths with spaces survive. */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const token = m[1] ?? m[2] ?? m[3];
    if (token !== undefined) tokens.push(token);
  }
  return tokens;
}

/** Collect non-flag, non-mode arguments (the target paths) from a segment. */
export function pathArgs(segment: string, { dropMode = false } = {}): string[] {
  const args: string[] = [];
  let inOptions = true;
  for (const token of tokenize(segment).slice(1)) {
    if (inOptions && token === "--") {
      inOptions = false;
      continue;
    }
    if (inOptions && token.startsWith("-")) continue;
    inOptions = false;
    if (dropMode && /^(?:[0-7]{3,4}|[ugoa]*[+-=][rwxXstugo]+)$/.test(token)) continue;
    args.push(token);
  }
  return args;
}

interface SegmentHit {
  text: string;
  cwd: string;
}

/**
 * Every segment matching `pattern`, paired with the working directory in
 * effect at that point — later segments may run after a `cd` in the same
 * command (`cd /tmp && rm -rf x` runs in /tmp, not the session cwd).
 */
export function matchingSegments(command: string, pattern: RegExp, start: string): SegmentHit[] {
  // Match against the quote-masked text so prose never matches, and split on
  // the masked separators so `&&`/`;` inside quoted strings don't fragment
  // the command. The original text is sliced by the same indices, so target
  // extraction still sees quoted paths like "/tmp/my dir".
  const masked = maskQuoted(command);
  const hits: SegmentHit[] = [];
  let cwd = start;
  let segStart = 0;
  const sepRe = /(?:&&|\|\||;|\n)+/g;
  let m: RegExpExecArray | null;
  while ((m = sepRe.exec(masked))) {
    const seg = masked.slice(segStart, m.index);
    const origSeg = command.slice(segStart, m.index);
    if (pattern.test(seg)) hits.push({ text: origSeg, cwd });
    applyCd(seg, origSeg, (dir) => {
      cwd = expandPath(dir, cwd);
    });
    segStart = m.index + m[0].length;
  }
  const tail = masked.slice(segStart);
  if (pattern.test(tail)) hits.push({ text: command.slice(segStart), cwd });
  return hits;
}

/**
 * If a segment is a `cd` (detected on the masked text, so prose `cd`s in
 * quotes are ignored), resolve its target from the original text — quoted
 * targets like `cd "/tmp/foo"` come out clean through the tokenizer.
 */
function applyCd(maskedSeg: string, origSeg: string, apply: (dir: string) => void): void {
  if (!maskedSeg.trim().match(/^cd(?:\s+(.+))?$/)) return;
  const target = tokenize(origSeg)
    .slice(1)
    .find((t) => !t.startsWith("-") && t !== "-");
  if (target) apply(target);
}

// ---------------------------------------------------------------------------
// Rule interpretation
// ---------------------------------------------------------------------------

/**
 * True when the rule's targets are all inside scratch directories, so the
 * confirmation can be skipped. Fail-safe: an unparseable or mixed target set
 * (or a rule with no scope) returns false and still prompts.
 */
export function inScratchScope(rule: Rule, command: string, start: string): boolean {
  const scope = rule.scope;
  if (scope !== "paths" && scope !== "cwd") return false;

  const hits = matchingSegments(command, rule.pattern, start);
  if (hits.length === 0) return false;

  const dropMode = rule.targets?.dropMode ?? false;
  const allScratch = (text: string, cwd: string): boolean => {
    const targets = pathArgs(text, { dropMode });
    return targets.length > 0 && targets.every((t) => isScratchPath(t, cwd));
  };

  return hits.every(({ text, cwd }) =>
    scope === "cwd" ? isScratchPath(cwd, start) : allScratch(text, cwd),
  );
}

const NOTIFY_BODY_MAX = 140;

/** One-line, truncated command for the notification body. */
function notifyBody(command: string): string {
  const oneLine = command.replace(/\s+/g, " ").trim();
  if (oneLine.length <= NOTIFY_BODY_MAX) return oneLine;
  return `${oneLine.slice(0, NOTIFY_BODY_MAX - 1).trimEnd()}…`;
}

/**
 * Resolve the notify mode from the `permissionGate` settings section via the
 * declarative NOTIFY_SPEC (see policy.ts / shared/config.ts).
 */
export function resolveNotifyOnConfirm(settings: Record<string, unknown>): "always" | "off" {
  return resolveSpec(NOTIFY_SPEC, settings, process.env);
}

export default function (pi: ExtensionAPI) {
  let notifyOnConfirm: "always" | "off" | undefined;

  const shouldNotify = (ctx: ExtensionContext): boolean => {
    if (notifyOnConfirm === undefined) {
      notifyOnConfirm = resolveNotifyOnConfirm(loadExtensionSettings(ctx.cwd, "permissionGate"));
    }
    return notifyOnConfirm !== "off";
  };
  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) return;

    const command = event.input.command;
    if (!command) return;

    // Match rules against the quote-masked command so prose inside quotes
    // (commit messages, echo strings) can never trigger a confirmation.
    const masked = maskQuoted(command);

    // Block rules win over confirm rules.
    const block = RULES.find((rule) => rule.level === "block" && rule.pattern.test(masked));
    if (block) {
      return { block: true, reason: `Blocked: ${block.name}` };
    }

    const confirm = RULES.find((rule) => rule.level === "confirm" && rule.pattern.test(masked));
    if (!confirm) return;

    // Everything the command touches is scratch — no need to ask.
    if (inScratchScope(confirm, command, ctx.cwd)) return;

    // Non-interactive: fail closed.
    if (!ctx.hasUI) {
      return {
        block: true,
        reason: `Blocked (${confirm.name}) — no UI available for confirmation`,
      };
    }

    // The user is about to be interrupted with a dialog — surface it as a
    // desktop notification too, so it isn't missed when the terminal is not
    // in focus. Best-effort and non-blocking. Behavior follows
    // settings.json `permissionGate.notifyOnConfirm` ("always" | "off").
    if (shouldNotify(ctx)) {
      void sendNotification({
        title: "Permission needed",
        subtitle: confirm.name,
        body: notifyBody(command),
        sound: "Sosumi",
        urgency: "critical",
        icon: "dialog-question",
      });
    }

    const ok = await ctx.ui.confirm(`⚠️ ${confirm.name}`, `Allow this command?\n\n  ${command}`);
    if (!ok) {
      return { block: true, reason: `Blocked by user: ${confirm.name}` };
    }
  });
}
