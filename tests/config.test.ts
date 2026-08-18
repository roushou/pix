import { describe, expect, test } from "bun:test";
import {
  resolveConfigObject,
  resolveSpec,
  splitColon,
  splitComma,
  type ConfigObjectSpec,
  type ConfigSpec,
} from "../extensions/shared/config.ts";

const alwaysOff: ConfigSpec<"always" | "off"> = {
  key: "notifyOnConfirm",
  channel: "settings",
  merge: "override",
  default: "always",
  parse: (raw) => (raw === "off" ? "off" : "always"),
};

const scratchDirs: ConfigSpec<string[]> = {
  key: "PI_SCRATCH_DIRS",
  channel: "env",
  merge: "union",
  default: ["/tmp", "/var/tmp"],
  parse: splitColon,
};

describe("resolveSpec", () => {
  test("settings channel: absent value uses default", () => {
    expect(resolveSpec(alwaysOff, {}, {})).toBe("always");
  });
  test("settings channel: explicit value overrides", () => {
    expect(resolveSpec(alwaysOff, { notifyOnConfirm: "off" }, {})).toBe("off");
  });
  test("settings channel: unknown value falls back to default", () => {
    expect(resolveSpec(alwaysOff, { notifyOnConfirm: "sometimes" }, {})).toBe("always");
  });

  test("env channel: absent value uses default", () => {
    expect(resolveSpec(scratchDirs, {}, {})).toEqual(["/tmp", "/var/tmp"]);
  });
  test("env channel: union appends to default", () => {
    expect(resolveSpec(scratchDirs, {}, { PI_SCRATCH_DIRS: "~/scratch:/tmp/other" })).toEqual([
      "/tmp",
      "/var/tmp",
      "~/scratch",
      "/tmp/other",
    ]);
  });
  test("env channel: empty string is treated as absent", () => {
    expect(resolveSpec(scratchDirs, {}, { PI_SCRATCH_DIRS: "" })).toEqual(["/tmp", "/var/tmp"]);
  });
});

describe("env list splitters", () => {
  test("splitColon trims and drops empties", () => {
    expect(splitColon("a: b : :c")).toEqual(["a", "b", "c"]);
  });
  test("splitComma trims and drops empties", () => {
    expect(splitComma("a, b,,c")).toEqual(["a", "b", "c"]);
  });
});

describe("resolveConfigObject", () => {
  const specs: ConfigObjectSpec<{ mode: string; dirs: string[]; retries: number }> = {
    mode: {
      key: "mode",
      channel: "settings",
      merge: "override",
      default: "compact",
      parse: (raw: unknown) => (raw === "rich" ? "rich" : "compact"),
    },
    dirs: {
      key: "PI_DIRS",
      channel: "env",
      merge: "union",
      default: ["/tmp"],
      parse: splitColon,
    },
    retries: {
      key: "retries",
      channel: "settings",
      merge: "override",
      default: 3,
      parse: (raw: unknown) => (typeof raw === "number" && raw > 0 ? raw : 3),
    },
  };

  test("absent values resolve to defaults", () => {
    expect(resolveConfigObject(specs, {}, {})).toEqual({
      mode: "compact",
      dirs: ["/tmp"],
      retries: 3,
    });
  });

  test("mixed settings and env channels resolve independently", () => {
    expect(resolveConfigObject(specs, { mode: "rich", retries: 7 }, { PI_DIRS: "/x:/y" })).toEqual({
      mode: "rich",
      dirs: ["/tmp", "/x", "/y"],
      retries: 7,
    });
  });

  test("invalid values fall back per key without affecting others", () => {
    expect(resolveConfigObject(specs, { mode: "bogus", retries: -1 }, { PI_DIRS: "" })).toEqual({
      mode: "compact",
      dirs: ["/tmp"],
      retries: 3,
    });
  });
});
