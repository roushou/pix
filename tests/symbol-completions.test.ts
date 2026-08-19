import { describe, expect, test } from "bun:test";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import {
  createSymbolAutocompleteProvider,
  extractCompletionQuery,
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
});

describe("applyCompletion", () => {
  test("replaces the @@prefix with the value, no trailing space", () => {
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
    expect(result.lines).toEqual(["rename sendNotification"]);
    expect(result.cursorLine).toBe(0);
    expect(result.cursorCol).toBe("rename sendNotification".length);
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
    expect(result.lines).toEqual(["sendNotification()"]);
    expect(result.cursorCol).toBe("sendNotification".length);
  });
});

describe("parseOutlineStream", () => {
  test("parses declarations across files", () => {
    const raw = [
      outlineLine("./a.ts", [
        { symbolType: "function", name: "greet", range: { start: { line: 0, column: 0 } } },
        { symbolType: "constant", name: "MAX", range: { start: { line: 3, column: 0 } } },
      ]),
      outlineLine("./b.ts", [
        { symbolType: "class", name: "Greeter", range: { start: { line: 1, column: 0 } } },
      ]),
    ].join("\n");
    expect(parseOutlineStream(raw)).toEqual([
      { name: "greet", symbolType: "function", file: "./a.ts", line: 1, isImport: false },
      { name: "MAX", symbolType: "constant", file: "./a.ts", line: 4, isImport: false },
      { name: "Greeter", symbolType: "class", file: "./b.ts", line: 2, isImport: false },
    ]);
  });

  test("skips anonymous entries and malformed lines", () => {
    const raw = [
      '{"path":"./a.ts","items":[{"symbolType":"function","name":"ok"},{"symbolType":"class"}]}',
      "not json",
      "",
    ].join("\n");
    expect(parseOutlineStream(raw)).toEqual([
      { name: "ok", symbolType: "function", file: "./a.ts", line: 1, isImport: false },
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
      [{ name: "X", symbolType: "class", file: "./a.ts", line: 1, isImport: false }],
    );
  });
});
