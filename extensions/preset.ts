/**
 * preset — named model/thinking/tools/instructions configurations.
 *
 * Presets are defined in JSON, merged from ~/.pi/agent/presets.json (global)
 * and .pi/presets.json (project, takes precedence). Apply them with
 * /preset <name>, pick one with /preset, cycle with Ctrl+Shift+U, or start
 * with --preset <name>. Active preset instructions are appended to the
 * system prompt.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import {
  CONFIG_DIR_NAME,
  DynamicBorder,
  getAgentDir,
  type CustomEntry,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Container, Key, type SelectItem, SelectList, Text } from "@earendil-works/pi-tui";

interface Preset {
  provider?: string;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  tools?: string[];
  instructions?: string;
}

interface PresetsConfig {
  [name: string]: Preset;
}

function loadPresets(cwd: string): PresetsConfig {
  const globalPath = join(getAgentDir(), "presets.json");
  const projectPath = join(cwd, CONFIG_DIR_NAME, "presets.json");

  let globalPresets: PresetsConfig = {};
  let projectPresets: PresetsConfig = {};

  if (existsSync(globalPath)) {
    try {
      globalPresets = JSON.parse(readFileSync(globalPath, "utf-8")) as PresetsConfig;
    } catch (error) {
      console.error(`Failed to load global presets from ${globalPath}: ${error}`);
    }
  }

  if (existsSync(projectPath)) {
    try {
      projectPresets = JSON.parse(readFileSync(projectPath, "utf-8")) as PresetsConfig;
    } catch (error) {
      console.error(`Failed to load project presets from ${projectPath}: ${error}`);
    }
  }

  return { ...globalPresets, ...projectPresets };
}

interface OriginalState {
  model: Model<Api> | undefined;
  thinkingLevel: ThinkingLevel;
  tools: string[];
}

function buildPresetDescription(preset: Preset): string {
  const parts: string[] = [];
  if (preset.provider && preset.model) parts.push(`${preset.provider}/${preset.model}`);
  if (preset.thinkingLevel) parts.push(`thinking:${preset.thinkingLevel}`);
  if (preset.tools) parts.push(`tools:${preset.tools.join(",")}`);
  if (preset.instructions) {
    parts.push(
      `"${preset.instructions.length > 30 ? `${preset.instructions.slice(0, 27)}...` : preset.instructions}"`,
    );
  }
  return parts.join(" | ");
}

export default function (pi: ExtensionAPI) {
  let presets: PresetsConfig = {};
  let activePresetName: string | undefined;
  let activePreset: Preset | undefined;
  let originalState: OriginalState | undefined;

  pi.registerFlag("preset", {
    description: "Preset configuration to use",
    type: "string",
  });

  async function applyPreset(
    name: string,
    preset: Preset,
    ctx: ExtensionContext,
  ): Promise<boolean> {
    if (activePresetName === undefined) {
      originalState = {
        model: ctx.model,
        thinkingLevel: pi.getThinkingLevel(),
        tools: pi.getActiveTools(),
      };
    }

    if (preset.provider && preset.model) {
      const model = ctx.modelRegistry.find(preset.provider, preset.model);
      if (model) {
        const ok = await pi.setModel(model);
        if (!ok) {
          ctx.ui.notify(
            `Preset "${name}": no API key for ${preset.provider}/${preset.model}`,
            "warning",
          );
        }
      } else {
        ctx.ui.notify(
          `Preset "${name}": model ${preset.provider}/${preset.model} not found`,
          "warning",
        );
      }
    }

    if (preset.thinkingLevel) {
      pi.setThinkingLevel(preset.thinkingLevel);
    }

    if (preset.tools && preset.tools.length > 0) {
      const allToolNames = new Set(pi.getAllTools().map((t) => t.name));
      const validTools = preset.tools.filter((t) => allToolNames.has(t));
      const invalidTools = preset.tools.filter((t) => !allToolNames.has(t));

      if (invalidTools.length > 0) {
        ctx.ui.notify(`Preset "${name}": unknown tools: ${invalidTools.join(", ")}`, "warning");
      }
      if (validTools.length > 0) {
        pi.setActiveTools(validTools);
      }
    }

    activePresetName = name;
    activePreset = preset;
    return true;
  }

  async function showPresetSelector(ctx: ExtensionContext): Promise<void> {
    const entries = Object.entries(presets);

    if (entries.length === 0) {
      ctx.ui.notify(
        `No presets defined. Add presets to ${join(getAgentDir(), "presets.json")} or ${join(ctx.cwd, CONFIG_DIR_NAME, "presets.json")}`,
        "warning",
      );
      return;
    }

    const items: SelectItem[] = entries.map(([name, preset]) => ({
      value: name,
      label: name === activePresetName ? `${name} (active)` : name,
      description: buildPresetDescription(preset),
    }));

    items.push({
      value: "(none)",
      label: "(none)",
      description: "Clear active preset, restore defaults",
    });

    const result = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
      const container = new Container();
      container.addChild(new DynamicBorder((s) => theme.fg("accent", s)));
      container.addChild(new Text(theme.fg("accent", theme.bold("Select Preset"))));

      const selectList = new SelectList(items, Math.min(items.length, 10), {
        selectedPrefix: (text) => theme.fg("accent", text),
        selectedText: (text) => theme.fg("accent", text),
        description: (text) => theme.fg("muted", text),
        scrollInfo: (text) => theme.fg("dim", text),
        noMatch: (text) => theme.fg("warning", text),
      });

      selectList.onSelect = (item) => done(item.value);
      selectList.onCancel = () => done(null);

      container.addChild(selectList);
      container.addChild(new Text(theme.fg("dim", "↑↓ navigate · enter select · esc cancel")));
      container.addChild(new DynamicBorder((s) => theme.fg("accent", s)));

      return {
        render(width: number) {
          return container.render(width);
        },
        invalidate() {
          container.invalidate();
        },
        handleInput(data: string) {
          selectList.handleInput(data);
          tui.requestRender();
        },
      };
    });

    if (!result) return;

    if (result === "(none)") {
      activePresetName = undefined;
      activePreset = undefined;
      if (originalState) {
        if (originalState.model) await pi.setModel(originalState.model);
        pi.setThinkingLevel(originalState.thinkingLevel);
        pi.setActiveTools(originalState.tools);
      } else {
        pi.setActiveTools(["read", "bash", "edit", "write"]);
      }
      ctx.ui.notify("Preset cleared, defaults restored", "info");
      updateStatus(ctx);
      return;
    }

    const preset = presets[result];
    if (preset) {
      await applyPreset(result, preset, ctx);
      ctx.ui.notify(`Preset "${result}" activated`, "info");
      updateStatus(ctx);
    }
  }

  function updateStatus(ctx: ExtensionContext): void {
    if (activePresetName) {
      ctx.ui.setStatus("preset", ctx.ui.theme.fg("accent", `preset:${activePresetName}`));
    } else {
      ctx.ui.setStatus("preset", undefined);
    }
  }

  async function cyclePreset(ctx: ExtensionContext): Promise<void> {
    const presetNames = Object.keys(presets).toSorted();
    if (presetNames.length === 0) {
      ctx.ui.notify(
        `No presets defined. Add presets to ${join(getAgentDir(), "presets.json")} or ${join(ctx.cwd, CONFIG_DIR_NAME, "presets.json")}`,
        "warning",
      );
      return;
    }

    const cycleList = ["(none)", ...presetNames];
    const currentName = activePresetName ?? "(none)";
    const currentIndex = cycleList.indexOf(currentName);
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % cycleList.length;
    const nextName = cycleList[nextIndex];
    if (!nextName) return;

    if (nextName === "(none)") {
      activePresetName = undefined;
      activePreset = undefined;
      if (originalState) {
        if (originalState.model) await pi.setModel(originalState.model);
        pi.setThinkingLevel(originalState.thinkingLevel);
        pi.setActiveTools(originalState.tools);
      } else {
        pi.setActiveTools(["read", "bash", "edit", "write"]);
      }
      ctx.ui.notify("Preset cleared, defaults restored", "info");
      updateStatus(ctx);
      return;
    }

    const preset = presets[nextName];
    if (!preset) return;
    await applyPreset(nextName, preset, ctx);
    ctx.ui.notify(`Preset "${nextName}" activated`, "info");
    updateStatus(ctx);
  }

  pi.registerShortcut(Key.ctrlShift("u"), {
    description: "Cycle presets",
    handler: async (ctx) => cyclePreset(ctx),
  });

  pi.registerCommand("preset", {
    description: "Switch preset configuration",
    handler: async (args, ctx) => {
      const name = args.trim();
      if (name) {
        const preset = presets[name];
        if (!preset) {
          const available = Object.keys(presets).join(", ") || "(none defined)";
          ctx.ui.notify(`Unknown preset "${name}". Available: ${available}`, "error");
          return;
        }
        await applyPreset(name, preset, ctx);
        ctx.ui.notify(`Preset "${name}" activated`, "info");
        updateStatus(ctx);
        return;
      }
      await showPresetSelector(ctx);
    },
  });

  pi.on("before_agent_start", (event) => {
    if (activePreset?.instructions) {
      return {
        systemPrompt: `${event.systemPrompt}\n\n${activePreset.instructions}`,
      };
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    presets = loadPresets(ctx.cwd);

    const presetFlag = pi.getFlag("preset");
    if (typeof presetFlag === "string" && presetFlag) {
      const preset = presets[presetFlag];
      if (preset) {
        await applyPreset(presetFlag, preset, ctx);
        ctx.ui.notify(`Preset "${presetFlag}" activated`, "info");
      } else {
        const available = Object.keys(presets).join(", ") || "(none defined)";
        ctx.ui.notify(`Unknown preset "${presetFlag}". Available: ${available}`, "warning");
      }
    }

    const entries = ctx.sessionManager.getEntries();
    const presetEntry = entries
      .toReversed()
      .find(
        (e): e is CustomEntry<{ name: string }> =>
          e.type === "custom" && e.customType === "preset-state",
      );

    if (presetEntry?.data?.name && typeof presetFlag !== "string") {
      const preset = presets[presetEntry.data.name];
      if (preset) {
        activePresetName = presetEntry.data.name;
        activePreset = preset;
      }
    }

    updateStatus(ctx);
  });

  pi.on("turn_start", () => {
    if (activePresetName) {
      pi.appendEntry("preset-state", { name: activePresetName });
    }
  });
}
