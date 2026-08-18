import { describe, expect, test } from "bun:test";
import {
  oneLine,
  truncateBytes,
  truncateChars,
  truncateOutput,
} from "../extensions/shared/text.ts";

describe("truncateBytes", () => {
  test("under the limit returns input unchanged", () => {
    expect(truncateBytes("hello", 10)).toBe("hello");
  });

  test("cuts at the byte limit for ASCII", () => {
    expect(truncateBytes("hello world", 5)).toBe("hello");
  });

  test("never splits a UTF-8 code point", () => {
    // é is 2 bytes in UTF-8; the 3-byte window must keep the whole pair.
    expect(truncateBytes("héllo", 3)).toBe("hé");
    expect(truncateBytes("héllo", 2)).toBe("h");
  });

  test("empty input stays empty", () => {
    expect(truncateBytes("", 10)).toBe("");
  });
});

describe("truncateOutput", () => {
  test("under both limits returns input unchanged", () => {
    const text = "line1\nline2\nline3";
    expect(truncateOutput(text, { maxLines: 10, maxBytes: 1024 })).toBe(text);
  });

  test("line cap keeps head and appends a note", () => {
    const text = Array.from({ length: 5 }, (_, i) => `line${i + 1}`).join("\n");
    const out = truncateOutput(text, { maxLines: 2, maxBytes: 4096 });
    expect(out).toBe("line1\nline2\n\n[Truncated: showing first 2 lines]");
  });

  test("byte cap truncates and appends a note", () => {
    const text = "a".repeat(100);
    const out = truncateOutput(text, { maxLines: 1000, maxBytes: 16 });
    expect(out.endsWith("[Truncated to 16 bytes]")).toBe(true);
    expect(out.split("\n\n")[0]).toHaveLength(16);
  });

  test("byte cap never splits a code point", () => {
    const text = "é".repeat(50); // 100 bytes
    const out = truncateOutput(text, { maxLines: 1000, maxBytes: 20 });
    const body = out.split("\n\n")[0]!;
    expect(Buffer.byteLength(body, "utf8")).toBeLessThanOrEqual(20);
    expect(body.length % 2).toBe(0); // whole é pairs only
  });

  test("defaults match the standard 2000 lines / 50 KiB", () => {
    const text = `${"x".repeat(60_000)}\n`;
    expect(truncateOutput(text)).toContain("[Truncated to");
  });
});

describe("truncateChars", () => {
  test("under the limit returns input unchanged", () => {
    expect(truncateChars("keep\nstructure", 50)).toBe("keep\nstructure");
  });

  test("truncates with ellipsis, preserving newlines", () => {
    expect(truncateChars("a\nb\nc\nd\ne", 7)).toBe("a\nb\nc…");
  });
});

describe("oneLine", () => {
  test("collapses whitespace and trims", () => {
    expect(oneLine("  a\n\t b   c  ")).toBe("a b c");
  });

  test("under max returns unchanged", () => {
    expect(oneLine("hello world", 20)).toBe("hello world");
  });

  test("truncates with ellipsis at max", () => {
    expect(oneLine("hello world", 8)).toBe("hello w…");
  });

  test("empty collapses to empty", () => {
    expect(oneLine("   \n  ")).toBe("");
  });
});
