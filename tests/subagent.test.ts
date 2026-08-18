import { describe, expect, test } from "bun:test";
import type { Message } from "@earendil-works/pi-ai";
import {
  formatTokens,
  getFinalOutput,
  getPiInvocation,
  isFailedResult,
  parseToolList,
  truncateParallelOutput,
} from "../extensions/subagent.ts";

const assistant = (text: string): Message =>
  ({
    role: "assistant",
    content: [{ type: "text", text }],
  }) as Message;

describe("parseToolList", () => {
  test("parses a comma-separated string", () => {
    expect(parseToolList("read, grep, find")).toEqual(["read", "grep", "find"]);
  });

  test("passes arrays through", () => {
    expect(parseToolList(["read", "bash"])).toEqual(["read", "bash"]);
  });

  test("trims and drops empty entries", () => {
    expect(parseToolList(" read ,, bash ")).toEqual(["read", "bash"]);
  });

  test("returns undefined when nothing usable", () => {
    expect(parseToolList("")).toBeUndefined();
    expect(parseToolList([42, ""])).toBeUndefined();
    expect(parseToolList(undefined)).toBeUndefined();
  });
});

describe("formatTokens", () => {
  test("formats small counts verbatim", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
  });

  test("formats thousands with one decimal", () => {
    expect(formatTokens(1500)).toBe("1.5k");
    expect(formatTokens(9999)).toBe("10.0k");
  });

  test("formats tens of thousands rounded", () => {
    expect(formatTokens(12_345)).toBe("12k");
    expect(formatTokens(999_999)).toBe("1000k");
  });

  test("formats millions with one decimal", () => {
    expect(formatTokens(1_500_000)).toBe("1.5M");
  });
});

describe("getFinalOutput", () => {
  test("returns the last assistant text block", () => {
    const messages: Message[] = [
      assistant("first"),
      { role: "user", content: [{ type: "text", text: "prompt" }] } as Message,
      assistant("final answer"),
    ];
    expect(getFinalOutput(messages)).toBe("final answer");
  });

  test("returns empty when no assistant text exists", () => {
    const messages: Message[] = [
      { role: "user", content: [{ type: "text", text: "prompt" }] } as Message,
    ];
    expect(getFinalOutput(messages)).toBe("");
  });

  test("returns empty for no messages", () => {
    expect(getFinalOutput([])).toBe("");
  });
});

describe("isFailedResult", () => {
  const base = {
    agent: "a",
    agentSource: "bundled" as const,
    task: "t",
    messages: [],
    stderr: "",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      contextTokens: 0,
      turns: 0,
    },
  };

  test("non-zero exit code is a failure", () => {
    expect(isFailedResult({ ...base, exitCode: 1 })).toBe(true);
  });

  test("zero exit with error stop reason is a failure", () => {
    expect(isFailedResult({ ...base, exitCode: 0, stopReason: "error" })).toBe(true);
    expect(isFailedResult({ ...base, exitCode: 0, stopReason: "aborted" })).toBe(true);
  });

  test("clean completion is not a failure", () => {
    expect(isFailedResult({ ...base, exitCode: 0 })).toBe(false);
    expect(isFailedResult({ ...base, exitCode: 0, stopReason: "end" })).toBe(false);
  });
});

describe("truncateParallelOutput", () => {
  test("short output passes through unchanged", () => {
    const text = "short output";
    expect(truncateParallelOutput(text)).toBe(text);
  });

  test("long output is truncated with a note", () => {
    const output = "a".repeat(60_000); // > 50 KiB
    const out = truncateParallelOutput(output);
    expect(out).toContain("[Output truncated:");
    expect(out).toContain("Full output preserved in tool details.");
    const body = out.split("\n\n")[0]!;
    expect(Buffer.byteLength(body, "utf8")).toBeLessThanOrEqual(50 * 1024);
  });

  test("multibyte truncation never splits a code point", () => {
    const output = "é".repeat(40_000); // 80 KB in UTF-8
    const out = truncateParallelOutput(output);
    const body = out.split("\n\n")[0]!;
    expect(Buffer.byteLength(body, "utf8")).toBeLessThanOrEqual(50 * 1024);
    expect(body.length % 2).toBe(0); // whole é pairs only
  });
});

describe("getPiInvocation", () => {
  test("returns a command plus the original args appended", () => {
    const inv = getPiInvocation(["--mode", "json", "-p"]);
    expect(typeof inv.command).toBe("string");
    expect(inv.command.length).toBeGreaterThan(0);
    expect(inv.args.slice(-3)).toEqual(["--mode", "json", "-p"]);
  });

  test("works with empty args", () => {
    const inv = getPiInvocation([]);
    expect(typeof inv.command).toBe("string");
    expect(Array.isArray(inv.args)).toBe(true);
  });
});
