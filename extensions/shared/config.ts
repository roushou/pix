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

/**
 * A whole config object declared as one spec table: one `ConfigSpec` per key.
 * Resolving the table yields a fully typed, defaulted config. This is the
 * single pattern for multi-key extension config (previously web.ts and
 * auto-format hand-rolled `typeof x === "boolean"` loaders that drifted from
 * the channel rule enforced here).
 */
export type ConfigObjectSpec<T extends object> = {
  [K in keyof T]: ConfigSpec<T[K]>;
};

/** Resolve every spec in `specs` into a typed config object. */
export function resolveConfigObject<T extends object>(
  specs: ConfigObjectSpec<T>,
  settings: Record<string, unknown>,
  env: Record<string, string | undefined>,
): T {
  const out = {} as Record<keyof T, unknown>;
  for (const key of Object.keys(specs) as Array<keyof T>) {
    out[key] = resolveSpec(specs[key]!, settings, env);
  }
  return out as T;
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
