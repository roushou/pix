/**
 * protected-paths — block writes/edits to sensitive files and directories.
 *
 * Protects secrets, credentials, vendored dependencies, and VCS internals from
 * accidental modification via the `write` and `edit` tools. (Destructive bash
 * commands are covered separately by permission-gate.)
 *
 * Matching is done on path segments, so it works for relative, absolute,
 * `./`-prefixed, and nested paths.
 */

import { isToolCallEventType, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Directory names that must never be written to directly.
const PROTECTED_DIRS = new Set(["node_modules", ".git", ".ssh", ".aws", ".gnupg"]);

// File-name patterns checked against the basename (case-insensitive).
const PROTECTED_FILE_PATTERNS: RegExp[] = [
  /^\.env(?!\.(example|sample|template|dist)$)(\..+)?$/, // .env, .env.local, ... but not .env.example
  /\.pem$/, // certificates / private keys
  /\.key$/, // private keys
  /^id_(rsa|ed25519|ecdsa|dsa)(?!\.pub$)(\..+)?$/, // SSH private keys, not .pub
  /^(credentials|secrets?)(\..+)?$/, // credentials, secret, secrets, secrets.json
  /^\.(npmrc|netrc|pypirc|git-credentials)$/, // credential config files
];

// Extra exact substrings to protect (relative or absolute), e.g. "packages/legacy".
const EXTRA_PROTECTED_PATHS: string[] = [];

function segments(path: string): string[] {
  return path.split(/[\\/]+/).filter(Boolean);
}

function isProtected(path: string): boolean {
  const segs = segments(path);

  if (segs.some((s) => PROTECTED_DIRS.has(s.toLowerCase()))) return true;

  const base = segs[segs.length - 1] ?? "";
  if (PROTECTED_FILE_PATTERNS.some((re) => re.test(base))) return true;

  if (EXTRA_PROTECTED_PATHS.some((p) => path.includes(p))) return true;

  return false;
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    let path: string | undefined;
    if (isToolCallEventType("write", event)) {
      path = event.input.path;
    } else if (isToolCallEventType("edit", event)) {
      path = event.input.path;
    } else {
      return;
    }

    if (!path || !isProtected(path)) return;

    if (ctx.hasUI) {
      ctx.ui.notify(`Blocked write to protected path: ${path}`, "warning");
    }
    return { block: true, reason: `Path "${path}" is protected` };
  });
}
