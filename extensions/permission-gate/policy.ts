/**
 * Permission policy — declarative data for the permission gate.
 *
 * Pure data, no logic: the engine in index.ts interprets this file.
 * Adding or tuning a rule here never requires touching engine code. A rule is
 * a single line-ish entry:
 *
 *   name    — human-readable label (shown in prompts and block reasons)
 *   pattern — regex tested against the quote-masked command
 *   level   - "block":   always rejected, even in scratch dirs
 *             "confirm": prompt the user, unless every target is scratch
 *   scope   - absent:    never scratch-exempted (danger is not path-bound)
 *             "paths":   targets are the command's path arguments
 *             "cwd":     target is the (effective) working directory
 *   targets - "paths" rules only: extraction tuning, e.g. { dropMode: true }
 *             drops mode arguments (777, u+x) before checking paths
 *   reason  — why the rule exists / why it isn't path-scoped (documentation)
 *
 * A "paths" rule is exempted only if EVERY target arg resolves inside a
 * scratch directory (`rm -rf /tmp/x ~/important` still prompts).
 */

/** Directories where destructive commands are routine and harmless. */
export const SCRATCH_DIRS = ["/tmp", "/var/tmp"];

/** Quoted arguments to these are code for an inner interpreter (`bash -c '...'`). */
export const EVAL_TRIGGERS = ["-c", "eval", "sudo"];

/** Segments starting with these run their quoted args elsewhere (`ssh host '...'`). */
export const REMOTE_TRIGGERS = ["ssh", "scp", "sftp", "docker", "podman"];

/**
 * When the gate is about to prompt the user, also fire a desktop
 * notification ("always") or keep it purely in-terminal ("off"). The
 * notification reuses the platform plumbing from the notify extension.
 */
export const NOTIFY_ON_CONFIRM: "always" | "off" = "always";

export interface Rule {
  name: string;
  pattern: RegExp;
  level: "block" | "confirm";
  scope?: "paths" | "cwd";
  targets?: { dropMode?: boolean };
  reason?: string;
}

export const RULES: Rule[] = [
  // --- Catastrophic — never run, regardless of scratch. ---
  {
    name: "rm -rf on root/home",
    pattern: /\brm\s+(-[a-z]*r[a-z]*f?|--recursive)\s+(\/|~|\$HOME|\.\.?)(\s|\*|$)/i,
    level: "block",
    reason: "rm -rf /, ~, or .. is catastrophic in any directory",
  },
  {
    name: "format filesystem",
    pattern: /\bmkfs(\.\w+)?\b/i,
    level: "block",
    reason: "destroying a filesystem is never a scratch operation",
  },

  // --- Risky — confirm first, unless every target is inside a scratch dir. ---
  {
    name: "recursive rm",
    pattern: /\brm\s+(-[a-z]*r[a-z]*f?|--recursive)\b/i,
    level: "confirm",
    scope: "paths",
  },
  {
    name: "sudo",
    pattern: /\bsudo\b/i,
    level: "confirm",
    reason: "privilege escalation — never path-bound",
  },
  {
    name: "force push",
    pattern: /\bgit\s+push\b[^\n|;&]*(-f\b|--force(?!-with-lease)\b)/i,
    level: "confirm",
    reason: "the target is the remote repository — never path-bound",
  },
  {
    name: "git reset --hard",
    pattern: /\bgit\s+reset\s+--hard\b/i,
    level: "confirm",
    scope: "cwd",
    reason: "destroys the checkout containing the working directory",
  },
  {
    name: "git clean -f",
    pattern: /\bgit\s+clean\b[^\n|;&]*(--force|-[a-z]*f[a-z]*)\b/i,
    level: "confirm",
    scope: "cwd",
    reason: "destroys untracked files in the checkout containing the working directory",
  },
  {
    name: "chmod/chown 777 or -R",
    pattern: /\b(chmod|chown)\b[^\n|;&]*(\b-R\b|\b777\b)/i,
    level: "confirm",
    scope: "paths",
    targets: { dropMode: true },
  },
  {
    name: "pipe curl/wget to shell",
    pattern: /\b(curl|wget)\b[^\n|;&]*\|\s*(ba)?sh\b/i,
    level: "confirm",
    reason: "remote code execution — never path-bound",
  },
  {
    name: "dd to device",
    pattern: /\bdd\b[\s\S]*\bof=\/dev\//i,
    level: "confirm",
    reason: "writes to a device — /dev is never scratch",
  },
  {
    name: "shutdown/reboot",
    pattern: /\b(shutdown|reboot|poweroff|halt)\b/i,
    level: "confirm",
    reason: "affects the whole machine — never path-bound",
  },
];
