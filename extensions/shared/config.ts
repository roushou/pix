/**
 * Config resolution — the code-enforced rule for where specs live and how
 * they merge.
 *
 * Every configurable spec is declared in a policy file as a ConfigSpec:
 *
 *   key     — settings.json key or env var name
 *   channel - "settings": read from settings.json; the value OVERRIDES
 *             the default (per user/project).
 *             "env":      read from the environment; the value AUGMENTS
 *             the default (process-scoped additions).
 *   merge   - "override": the channel value replaces the default.
 *             "union":    the channel value is appended to the default
 *             (lists only — env additions like extra scratch dirs or
 *             interactive commands).
 *   default — the policy default, used when the channel has nothing.
 *   parse   — converts the raw channel value (JSON value for settings,
 *             string for env) into the spec's type.
 *
 * The rule is enforced here, not in prose: a spec that reads settings
 * always overrides; a spec that reads env always augments; which channel
 * a spec uses and how its raw value parses are declared data. An empty
 * or absent channel value falls back to the default.
 */

export interface ConfigSpec<T> {
  key: string;
  channel: "settings" | "env";
  merge: "override" | "union";
  default: T;
  parse: (raw: unknown) => T;
}

export function resolveSpec<T>(
  spec: ConfigSpec<T>,
  settings: Record<string, unknown>,
  env: Record<string, string | undefined>,
): T {
  const raw = spec.channel === "settings" ? settings[spec.key] : env[spec.key];
  if (raw === undefined || raw === "") return spec.default;

  if (spec.merge === "union") {
    // Lists only: the channel value is appended to the default.
    const base = spec.default as unknown[];
    const added = spec.parse(raw) as unknown[];
    return [...base, ...added] as T;
  }
  return spec.parse(raw);
}

/** Split an env var's colon-separated list (e.g. PI_SCRATCH_DIRS). */
export function splitColon(raw: unknown): string[] {
  return String(raw)
    .split(":")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Split an env var's comma-separated list (e.g. INTERACTIVE_COMMANDS). */
export function splitComma(raw: unknown): string[] {
  return String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
