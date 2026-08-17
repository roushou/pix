import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadExtensionSettings } from "../extensions/shared/settings.ts";

// Isolate the "global" settings file via PI_CODING_AGENT_DIR so tests never
// touch the real ~/.pi/agent/settings.json.
let globalDir: string;
let projectDir: string;
const writeProjectSettings = (contents: string): void => {
  mkdirSync(join(projectDir, ".pi"), { recursive: true });
  writeFileSync(join(projectDir, ".pi", "settings.json"), contents);
};

// Global settings live directly in the agent dir (no .pi subdirectory).
const writeGlobalSettings = (contents: string): void => {
  writeFileSync(join(globalDir, "settings.json"), contents);
};

beforeAll(() => {
  globalDir = mkdtempSync(join(tmpdir(), "settings-global-"));
  projectDir = mkdtempSync(join(tmpdir(), "settings-project-"));
  process.env.PI_CODING_AGENT_DIR = globalDir;
});

// Each test starts from an empty global + project settings state.
beforeEach(() => {
  rmSync(join(globalDir, "settings.json"), { force: true });
  rmSync(join(projectDir, ".pi"), { recursive: true, force: true });
});

afterAll(() => {
  delete process.env.PI_CODING_AGENT_DIR;
  rmSync(globalDir, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
});

describe("loadExtensionSettings", () => {
  test("project settings are read", () => {
    writeProjectSettings(JSON.stringify({ zzTestKey: { enabled: true, mode: "rich" } }));
    expect(loadExtensionSettings(projectDir, "zzTestKey")).toEqual({
      enabled: true,
      mode: "rich",
    });
  });

  test("keys are isolated", () => {
    writeProjectSettings(JSON.stringify({ zzTestKey: { a: 1 }, otherKey: { b: 2 } }));
    expect(loadExtensionSettings(projectDir, "otherKey")).toEqual({ b: 2 });
  });

  test("project overrides global", () => {
    writeGlobalSettings(JSON.stringify({ zzTestKey: { mode: "compact", sound: false } }));
    writeProjectSettings(JSON.stringify({ zzTestKey: { mode: "rich" } }));
    expect(loadExtensionSettings(projectDir, "zzTestKey")).toEqual({ mode: "rich", sound: false });
  });

  test("missing key returns empty object", () => {
    expect(loadExtensionSettings(projectDir, "nope")).toEqual({});
  });

  test("malformed settings file is tolerated", () => {
    writeProjectSettings("{ not json !!");
    expect(loadExtensionSettings(projectDir, "zzTestKey")).toEqual({});
  });

  test("non-object section is ignored", () => {
    writeProjectSettings(JSON.stringify({ zzTestKey: "just a string" }));
    expect(loadExtensionSettings(projectDir, "zzTestKey")).toEqual({});
  });

  test("no settings file at all returns empty", () => {
    rmSync(join(projectDir, ".pi"), { recursive: true, force: true });
    expect(loadExtensionSettings(projectDir, "zzTestKey")).toEqual({});
  });
});
