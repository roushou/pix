import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildSgArgs,
  deriveSignatures,
  expandTemplate,
  keepOutermost,
  langFromSgName,
  memberNameFromText,
  normalizeMultiMetas,
  parseSgJson,
  type OutlineSymbol,
} from "../extensions/ast-grep.ts";

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
      language: "TypeScript",
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
      language: "",
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

  test("an array of paths is expanded to positionals", () => {
    expect(buildSgArgs("p", "r", { path: ["a.ts", "b.ts"] })).toEqual([
      "-p",
      "p",
      "-r",
      "r",
      "a.ts",
      "b.ts",
    ]);
  });
});

describe("langFromSgName", () => {
  test("maps the five bundled napi languages", () => {
    expect(langFromSgName("TypeScript")).toBe("TypeScript");
    expect(langFromSgName("JavaScript")).toBe("JavaScript");
    expect(langFromSgName("Tsx")).toBe("Tsx");
    expect(langFromSgName("Html")).toBe("Html");
    expect(langFromSgName("Css")).toBe("Css");
  });

  test("rejects languages the napi binding cannot parse", () => {
    expect(langFromSgName("Python")).toBeNull();
    expect(langFromSgName("Rust")).toBeNull();
    expect(langFromSgName("Jsx")).toBeNull();
    expect(langFromSgName("")).toBeNull();
  });
});

const resolveTemplateMeta = (name: string, multi: boolean) => `${multi ? "<<" : "<"}${name}>`;
const onlyKnownTemplateMeta = (name: string) => (name === "KNOWN" ? "x" : "");

describe("expandTemplate", () => {
  test("expands single and multi metas", () => {
    expect(expandTemplate("f($NAME, $$$ARGS) { $$$BODY }", resolveTemplateMeta)).toBe(
      "f(<NAME>, <<ARGS>) { <<BODY> }",
    );
  });

  test("leaves literal text and lone $ untouched", () => {
    expect(expandTemplate("cost $5 and $, done", resolveTemplateMeta)).toBe("cost $5 and $, done");
  });

  test("no metas passes through unchanged", () => {
    expect(expandTemplate("const x = 1;", resolveTemplateMeta)).toBe("const x = 1;");
  });

  test("unmatched metas resolve to empty string", () => {
    expect(expandTemplate("a $KNOWN b $UNKNOWN c", onlyKnownTemplateMeta)).toBe("a x b  c");
  });
});

describe("keepOutermost", () => {
  test("keeps disjoint ranges", () => {
    expect(
      keepOutermost([
        { start: 0, end: 5 },
        { start: 10, end: 15 },
      ]),
    ).toEqual([
      { start: 0, end: 5 },
      { start: 10, end: 15 },
    ]);
  });

  test("drops ranges nested inside a kept one (outermost wins)", () => {
    expect(
      keepOutermost([
        { start: 0, end: 20 },
        { start: 2, end: 8 },
        { start: 12, end: 15 },
      ]),
    ).toEqual([{ start: 0, end: 20 }]);
  });

  test("handles overlapping-but-not-nested by keeping the first", () => {
    expect(
      keepOutermost([
        { start: 0, end: 10 },
        { start: 5, end: 15 },
      ]),
    ).toEqual([{ start: 0, end: 10 }]);
  });

  test("empty input stays empty", () => {
    expect(keepOutermost([])).toEqual([]);
  });
});

describe("memberNameFromText", () => {
  test("method name up to the paren", () => {
    expect(memberNameFromText("greet(name: string): string {")).toBe("greet");
  });

  test("optional method signature", () => {
    expect(memberNameFromText("render?(): void")).toBe("render");
  });

  test("strips access and decorator modifiers", () => {
    expect(memberNameFromText('private prefix: string = "hi"')).toBe("prefix");
    expect(memberNameFromText("static readonly COUNT = 1")).toBe("COUNT");
    expect(memberNameFromText("get foo() {")).toBe("foo");
    expect(memberNameFromText("set foo(v) {")).toBe("foo");
  });

  test("interface field", () => {
    expect(memberNameFromText("timeoutMs: number")).toBe("timeoutMs");
  });

  test("private #field", () => {
    expect(memberNameFromText("#items: string[]")).toBe("items");
  });

  test("computed names are rejected", () => {
    expect(memberNameFromText("[Symbol.iterator]()")).toBeNull();
    expect(memberNameFromText('["key"]()')).toBeNull();
  });
});

describe("deriveSignatures", () => {
  test("derives each symbol's signature from its declaration's first line", async () => {
    const dir = mkdtempSync(join(tmpdir(), "derive-sig-"));
    try {
      writeFileSync(
        join(dir, "a.ts"),
        "export async function greet(name: string): string {\n  return name;\n}\n",
      );
      const symbols: OutlineSymbol[] = [
        {
          name: "greet",
          symbolType: "function",
          file: "a.ts",
          line: 1,
          endLine: 2,
          signature: "",
          isImport: false,
        },
      ];
      await deriveSignatures(symbols, dir);
      expect(symbols[0]!.signature).toBe("export async function greet(name: string): string {");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("missing files leave the signature untouched", async () => {
    const symbols: OutlineSymbol[] = [
      {
        name: "x",
        symbolType: "function",
        file: "nope.ts",
        line: 1,
        endLine: 1,
        signature: "",
        isImport: false,
      },
    ];
    await deriveSignatures(symbols, "/nonexistent");
    expect(symbols[0]!.signature).toBe("");
  });
});
