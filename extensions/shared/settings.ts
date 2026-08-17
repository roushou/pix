/**
 * Shared settings loading for extensions.
 *
 * Every extension's config lives under its own key in
 * `~/.pi/agent/settings.json` and `<project>/.pi/settings.json` (global
 * first, project overrides win). This returns the merged raw record for a
 * key; each extension maps it to its own typed config with defaults.
 *
 *   const merged = loadExtensionSettings(cwd, "notify");
 *   const sound = typeof merged.sound === "boolean" ? merged.sound : true;
 *
 * Best-effort: missing or unparseable settings files are ignored.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";

export function loadExtensionSettings(cwd: string, key: string): Record<string, unknown> {
  const paths = [join(getAgentDir(), "settings.json"), join(cwd, CONFIG_DIR_NAME, "settings.json")];
  let merged: Record<string, unknown> = {};

  for (const path of paths) {
    try {
      if (!existsSync(path)) continue;
      const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
      const section = parsed[key];
      if (section && typeof section === "object") Object.assign(merged, section);
    } catch {
      // Settings are best-effort; fall back to defaults on any parse error.
    }
  }

  return merged;
}
