import { describe, expect, test } from "bun:test";
import { buildSgArgs, normalizeMultiMetas, parseSgJson } from "../extensions/ast-grep.ts";

describe("normalizeMultiMetas", () => {
  test("renames anonymous $$$ to $$$M1 in both pattern and rewrite", () => {
    expect(normalizeMultiMetas("function $N($$$) { $$$ }", "function hello($$$) { $$$ }")).toEqual({
      pattern: "function $N($$$M1) { $$$M2 }",
      rewrite: "function hello($$$M1) { $$$M2 }",
    });
  });

  test("assigns positions independently in pattern and rewrite", () => {
    expect(normalizeMultiMetas("$A($$$)", "($$$)")).toEqual({
      pattern: "$A($$$M1)",
      rewrite: "($$$M1)",
    });
  });

  test("leaves named multi-metas untouched", () => {
    expect(normalizeMultiMetas("f($$$ARGS) { $$$BODY }", "g($$$ARGS) { $$$BODY }")).toEqual({
      pattern: "f($$$ARGS) { $$$BODY }",
      rewrite: "g($$$ARGS) { $$$BODY }",
    });
  });

  test("no metas means no change", () => {
    const input = "const x = 1;";
    expect(normalizeMultiMetas(input, input)).toEqual({ pattern: input, rewrite: input });
  });

  test("mixed named and anonymous metas coexist", () => {
    expect(normalizeMultiMetas("$NAME($$$) { $$$BODY }", "hello($$$) { $$$BODY }")).toEqual({
      pattern: "$NAME($$$M1) { $$$BODY }",
      rewrite: "hello($$$M1) { $$$BODY }",
    });
  });
});

describe("parseSgJson", () => {
  const match = {
    text: "function greet(name) {\n  return name;\n}",
    range: {
      byteOffset: { start: 7, end: 48 },
      start: { line: 0, column: 7 },
      end: { line: 2, column: 1 },
    },
    file: "a.ts",
    lines: "function greet(name) {\n  return name;\n}",
    charCount: { leading: 7, trailing: 0 },
    language: "TypeScript",
  };

  test("parses compact JSON output", () => {
    const parsed = parseSgJson(JSON.stringify([match]));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      file: "a.ts",
      startLine: 0,
      startColumn: 7,
      endLine: 2,
      endColumn: 1,
      text: "function greet(name) {\n  return name;\n}",
    });
  });

  test("parses pretty-printed (multiline) JSON output", () => {
    const pretty = JSON.stringify([match], null, 2);
    expect(parseSgJson(pretty)).toHaveLength(1);
  });

  test("empty output yields no matches", () => {
    expect(parseSgJson("")).toEqual([]);
    expect(parseSgJson("   \n  ")).toEqual([]);
  });

  test("a replacement field is preserved", () => {
    const parsed = parseSgJson(JSON.stringify([{ ...match, replacement: "hello($$$)" }]));
    expect(parsed[0]?.replacement).toBe("hello($$$)");
  });

  test("missing fields fall back to defaults", () => {
    const parsed = parseSgJson(JSON.stringify([{}]));
    expect(parsed[0]).toEqual({
      file: "(unknown)",
      startLine: 0,
      startColumn: 0,
      endLine: 0,
      endColumn: 0,
      text: "",
      replacement: undefined,
    });
  });

  test("malformed non-empty output throws", () => {
    expect(() => parseSgJson("not json at all")).toThrow();
  });
});

describe("buildSgArgs", () => {
  test("base rewrite args include pattern, fix, and path", () => {
    expect(buildSgArgs("p", "r", { path: "src" })).toEqual(["-p", "p", "-r", "r", "src"]);
  });

  test("language flag is inserted before the path", () => {
    expect(buildSgArgs("p", "r", { lang: "rust", path: "src" })).toEqual([
      "-p",
      "p",
      "-r",
      "r",
      "-l",
      "rust",
      "src",
    ]);
  });

  test("json and updateAll flags are mutually exclusive calls from the caller", () => {
    expect(buildSgArgs("p", "r", { path: "src", json: true })).toContain("--json=compact");
    expect(buildSgArgs("p", "r", { path: "src", updateAll: true })).toContain("-U");
    expect(buildSgArgs("p", "r", { path: "src" })).not.toContain("--json=compact");
    expect(buildSgArgs("p", "r", { path: "src" })).not.toContain("-U");
  });

  test("no path leaves the arg list without a positional", () => {
    expect(buildSgArgs("p", "r")).toEqual(["-p", "p", "-r", "r"]);
  });
});
