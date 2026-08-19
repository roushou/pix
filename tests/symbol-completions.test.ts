import { describe, expect, test } from "bun:test";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import {
  applyMru,
  createSymbolAutocompleteProvider,
  extractCompletionQuery,
  extractSymbolReferences,
  formatSymbolDescription,
  renderSymbolBlock,
} from "../extensions/symbol-completions.ts";
import { parseOutlineStream } from "../extensions/ast-grep.ts";

const outlineLine = (path: string, items: unknown[]) =>
  JSON.stringify({ path, language: "TypeScript", items });

const dummyProvider: AutocompleteProvider = {
  async getSuggestions() {
    return null;
  },
  applyCompletion(lines, cursorLine, cursorCol) {
    return { lines, cursorLine, cursorCol };
  },
};

describe("extractCompletionQuery", () => {
  test("top mode at line start", () => {
    expect(extractCompletionQuery("@@sendNotif")).toEqual({
      mode: "top",
      query: "sendNotif",
      rawPrefix: "@@sendNotif",
    });
    expect(extractCompletionQuery("@@")).toEqual({ mode: "top", query: "", rawPrefix: "@@" });
  });

  test("top mode after a delimiter", () => {
    expect(extractCompletionQuery('refactor the "@@foo')).toEqual({
      mode: "top",
      query: "foo",
      rawPrefix: "@@foo",
    });
    expect(extractCompletionQuery("call ( @@compute")).toEqual({
      mode: "top",
      query: "compute",
      rawPrefix: "@@compute",
    });
  });

  test("class mode", () => {
    expect(extractCompletionQuery("@@Greeter.gre")).toEqual({
      mode: "class",
      owner: "Greeter",
      query: "gre",
      rawPrefix: "@@Greeter.gre",
    });
    expect(extractCompletionQuery("@@Greeter.")).toEqual({
      mode: "class",
      owner: "Greeter",
      query: "",
      rawPrefix: "@@Greeter.",
    });
  });

  test("members mode", () => {
    expect(extractCompletionQuery("@@.get")).toEqual({
      mode: "members",
      query: "get",
      rawPrefix: "@@.get",
    });
    expect(extractCompletionQuery("@@.")).toEqual({
      mode: "members",
      query: "",
      rawPrefix: "@@.",
    });
  });

  test("does not match mid-identifier", () => {
    expect(extractCompletionQuery("myVar@@x")).toBeUndefined();
    expect(extractCompletionQuery("abc@@x")).toBeUndefined();
  });

  test("does not match a lone @", () => {
    expect(extractCompletionQuery("@path/to")).toBeUndefined();
  });

  test("allows $ in symbol names", () => {
    expect(extractCompletionQuery("@@$ready")).toEqual({
      mode: "top",
      query: "$ready",
      rawPrefix: "@@$ready",
    });
  });

  test("supports the @@! expand sigil in top and class modes", () => {
    expect(extractCompletionQuery("@@!sendNotif")).toEqual({
      mode: "top",
      query: "sendNotif",
      rawPrefix: "@@!sendNotif",
    });
    expect(extractCompletionQuery("@@!Greeter.gre")).toEqual({
      mode: "class",
      owner: "Greeter",
      query: "gre",
      rawPrefix: "@@!Greeter.gre",
    });
  });
});

describe("applyCompletion", () => {
  test("keeps the @@ sigil so the reference resolves on submit", () => {
    const provider = createSymbolAutocompleteProvider(dummyProvider, "/tmp");
    const lines = ["rename @@sendNotif"];
    const cursorLine = 0;
    const cursorCol = "rename @@sendNotif".length;
    const result = provider.applyCompletion(
      lines,
      cursorLine,
      cursorCol,
      { value: "sendNotification", label: "sendNotification" },
      "@@sendNotif",
    );
    expect(result.lines).toEqual(["rename @@sendNotification"]);
    expect(result.cursorLine).toBe(0);
    expect(result.cursorCol).toBe("rename @@sendNotification".length);
  });

  test("keeps text after the cursor", () => {
    const provider = createSymbolAutocompleteProvider(dummyProvider, "/tmp");
    const lines = ["@@send()"];
    const cursorLine = 0;
    const cursorCol = 6; // after "@@send"
    const result = provider.applyCompletion(
      lines,
      cursorLine,
      cursorCol,
      { value: "sendNotification", label: "sendNotification" },
      "@@send",
    );
    expect(result.lines).toEqual(["@@sendNotification()"]);
    expect(result.cursorCol).toBe("@@sendNotification".length);
  });

  test("preserves the @@! sigil so the reference expands on submit", () => {
    const provider = createSymbolAutocompleteProvider(dummyProvider, "/tmp");
    const lines = ["fix @@!sendNotif"];
    const cursorCol = "fix @@!sendNotif".length;
    const result = provider.applyCompletion(
      lines,
      0,
      cursorCol,
      { value: "sendNotification", label: "sendNotification" },
      "@@!sendNotif",
    );
    expect(result.lines).toEqual(["fix @@!sendNotification"]);
    expect(result.cursorCol).toBe("fix @@!sendNotification".length);
  });

  test("delegates non-@@ completions (slash commands) to the built-in", () => {
    const sentinel = { lines: ["DELEGATED"], cursorLine: 9, cursorCol: 9 };
    const current: AutocompleteProvider = {
      async getSuggestions() {
        return null;
      },
      applyCompletion() {
        return sentinel;
      },
    };
    const provider = createSymbolAutocompleteProvider(current, "/tmp");
    const result = provider.applyCompletion(
      ["/reload"],
      0,
      7,
      { value: "/reload", label: "/reload" },
      "/reload",
    );
    expect(result).toBe(sentinel);
  });
});

describe("parseOutlineStream", () => {
  test("parses declarations across files", () => {
    const raw = [
      outlineLine("./a.ts", [
        {
          symbolType: "function",
          name: "greet",
          signature: "function greet(name) {",
          range: { start: { line: 0, column: 0 }, end: { line: 2, column: 1 } },
        },
        { symbolType: "constant", name: "MAX", range: { start: { line: 3, column: 0 } } },
      ]),
      outlineLine("./b.ts", [
        { symbolType: "class", name: "Greeter", range: { start: { line: 1, column: 0 } } },
      ]),
    ].join("\n");
    expect(parseOutlineStream(raw)).toEqual([
      {
        name: "greet",
        symbolType: "function",
        file: "./a.ts",
        line: 1,
        endLine: 2,
        signature: "function greet(name) {",
        isImport: false,
      },
      {
        name: "MAX",
        symbolType: "constant",
        file: "./a.ts",
        line: 4,
        endLine: 3,
        signature: "",
        isImport: false,
      },
      {
        name: "Greeter",
        symbolType: "class",
        file: "./b.ts",
        line: 2,
        endLine: 1,
        signature: "",
        isImport: false,
      },
    ]);
  });

  test("skips anonymous entries and malformed lines", () => {
    const raw = [
      '{"path":"./a.ts","items":[{"symbolType":"function","name":"ok"},{"symbolType":"class"}]}',
      "not json",
      "",
    ].join("\n");
    expect(parseOutlineStream(raw)).toEqual([
      {
        name: "ok",
        symbolType: "function",
        file: "./a.ts",
        line: 1,
        endLine: 0,
        signature: "",
        isImport: false,
      },
    ]);
  });

  test("dedupes by name preferring declarations over imports", () => {
    const raw = [
      outlineLine("./a.ts", [{ symbolType: "function", name: "util", isImport: true }]),
      outlineLine("./b.ts", [{ symbolType: "function", name: "util" }]),
    ].join("\n");
    const symbols = parseOutlineStream(raw);
    expect(symbols).toHaveLength(1);
    expect(symbols[0]).toMatchObject({ file: "./b.ts", isImport: false });
  });

  test("empty input yields no symbols", () => {
    expect(parseOutlineStream("")).toEqual([]);
  });

  test("missing range defaults to line 1", () => {
    expect(parseOutlineStream(outlineLine("./a.ts", [{ symbolType: "class", name: "X" }]))).toEqual(
      [
        {
          name: "X",
          symbolType: "class",
          file: "./a.ts",
          line: 1,
          endLine: 0,
          signature: "",
          isImport: false,
        },
      ],
    );
  });
});

describe("formatSymbolDescription", () => {
  test("signature leads, file/line trails", () => {
    expect(
      formatSymbolDescription({
        symbolType: "function",
        signature: "function greet(name) {",
        file: "./a.ts",
        line: 3,
      }),
    ).toBe("function greet(name) { · ./a.ts:3");
  });

  test("falls back to symbol type when no signature", () => {
    expect(
      formatSymbolDescription({ symbolType: "class", signature: "", file: "./a.ts", line: 1 }),
    ).toBe("class · ./a.ts:1");
  });

  test("truncates long signatures", () => {
    const sig = `function extremelyLongFunctionNameThatGoesOnAndOnAndOnAndOnAndOn(a: string, b: number) {`;
    const out = formatSymbolDescription({
      symbolType: "function",
      signature: sig,
      file: "x.ts",
      line: 1,
    });
    expect(out.endsWith("… · x.ts:1")).toBe(true);
  });
});

describe("applyMru", () => {
  const a = { label: "a" };
  const b = { label: "b" };
  const c = { label: "c" };

  test("used items float to the top by recency", () => {
    const mru = new Map([
      ["a", 1],
      ["b", 2],
    ]);
    expect(applyMru([a, b, c], mru)).toEqual([b, a, c]);
  });

  test("no mru entries preserve order", () => {
    expect(applyMru([a, b], new Map())).toEqual([a, b]);
  });
});

describe("extractSymbolReferences", () => {
  test("finds @@ and @@! top-level and member references", () => {
    expect(extractSymbolReferences("fix @@!sendNotification and @@Greeter.greet please")).toEqual([
      { raw: "@@!sendNotification", name: "sendNotification", expand: true },
      { raw: "@@Greeter.greet", name: "Greeter.greet", expand: false },
    ]);
  });

  test("flags expand only for the ! sigil", () => {
    expect(extractSymbolReferences("call @@foo and @@!bar")).toEqual([
      { raw: "@@foo", name: "foo", expand: false },
      { raw: "@@!bar", name: "bar", expand: true },
    ]);
  });
});

describe("renderSymbolBlock", () => {
  test("wraps the body in a symbol block", () => {
    expect(renderSymbolBlock("greet", "a.ts", 3, "function greet() {\n  return 1;\n}")).toBe(
      '<symbol name="greet" file="a.ts:3">\nfunction greet() {\n  return 1;\n}\n</symbol>',
    );
  });
});
