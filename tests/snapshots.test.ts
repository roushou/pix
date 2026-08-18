import { describe, expect, test } from "bun:test";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_PATHS,
  DEFAULT_MAX_VERSIONS_PER_PATH,
  SnapshotStore,
  contentTag,
  normalizeText,
} from "../extensions/shared/snapshots.ts";

describe("normalizeText", () => {
  test("converts CRLF to LF", () => {
    expect(normalizeText("a\r\nb\r\nc")).toBe("a\nb\nc");
  });

  test("converts lone CR to LF", () => {
    expect(normalizeText("a\rb\rc")).toBe("a\nb\nc");
  });

  test("strips a UTF-8 BOM", () => {
    expect(normalizeText("\uFEFFconst x = 1;")).toBe("const x = 1;");
  });

  test("leaves LF-only text alone", () => {
    expect(normalizeText("a\nb")).toBe("a\nb");
  });
});

describe("contentTag", () => {
  test("is stable for identical content", () => {
    expect(contentTag("const x = 1;")).toBe(contentTag("const x = 1;"));
  });

  test("changes when content changes", () => {
    expect(contentTag("const x = 1;")).not.toBe(contentTag("const x = 2;"));
  });

  test("is 4 uppercase hex chars", () => {
    expect(contentTag("anything at all")).toMatch(/^[0-9A-F]{4}$/);
  });

  test("ignores line-ending differences", () => {
    expect(contentTag("a\nb\nc")).toBe(contentTag("a\r\nb\r\nc"));
  });
});

describe("SnapshotStore", () => {
  test("record returns a tag and latest returns content + tag", () => {
    const store = new SnapshotStore();
    const tag = store.record("a.ts", "line1\nline2")!;
    expect(tag).toMatch(/^[0-9A-F]{4}$/);
    expect(store.latest("a.ts")).toEqual({ content: "line1\nline2", tag });
  });

  test("verify accepts the recorded tag and rejects wrong or unknown ones", () => {
    const store = new SnapshotStore();
    const tag = store.record("a.ts", "content")!;
    expect(store.verify("a.ts", tag)).toBe(true);
    expect(store.verify("a.ts", "0000")).toBe(false);
    expect(store.verify("never-read.ts", tag)).toBe(false);
  });

  test("a later record invalidates the earlier tag (stale-anchor detection)", () => {
    const store = new SnapshotStore();
    const first = store.record("a.ts", "v1")!;
    const second = store.record("a.ts", "v2")!;
    expect(first).not.toBe(second);
    expect(store.verify("a.ts", first)).toBe(false);
    expect(store.verify("a.ts", second)).toBe(true);
  });

  test("versions are capped per path, newest first", () => {
    const store = new SnapshotStore({ maxVersionsPerPath: 3 });
    store.record("a.ts", "v1");
    store.record("a.ts", "v2");
    store.record("a.ts", "v3");
    store.record("a.ts", "v4");
    const versions = store.versions("a.ts");
    expect(versions.map((v) => v.content)).toEqual(["v4", "v3", "v2"]);
  });

  test("paths are LRU-evicted past maxPaths", () => {
    const store = new SnapshotStore({ maxPaths: 2 });
    store.record("a.ts", "a");
    store.record("b.ts", "b");
    expect(store.size).toBe(2);
    store.record("c.ts", "c");
    expect(store.size).toBe(2);
    // "a" was the oldest — evicted; "b" and "c" remain.
    expect(store.latest("a.ts")).toBeUndefined();
    expect(store.latest("b.ts")).toBeDefined();
    expect(store.latest("c.ts")).toBeDefined();
  });

  test("re-recording an existing path refreshes LRU order", () => {
    const store = new SnapshotStore({ maxPaths: 2 });
    store.record("a.ts", "a");
    store.record("b.ts", "b");
    store.record("a.ts", "a2"); // refresh a — now b is oldest
    store.record("c.ts", "c");
    expect(store.latest("a.ts")).toBeDefined();
    expect(store.latest("b.ts")).toBeUndefined();
  });

  test("files over maxBytes are not snapshotted", () => {
    const store = new SnapshotStore({ maxBytes: 10 });
    expect(store.record("big.ts", "x".repeat(100))).toBeUndefined();
    expect(store.latest("big.ts")).toBeUndefined();
    expect(store.verify("big.ts", "0000")).toBe(false);
  });

  test("clear drops all snapshots", () => {
    const store = new SnapshotStore();
    store.record("a.ts", "a");
    store.clear();
    expect(store.size).toBe(0);
    expect(store.latest("a.ts")).toBeUndefined();
  });

  test("defaults match omp-style bounds", () => {
    const store = new SnapshotStore();
    expect(store.size).toBe(0);
    expect(DEFAULT_MAX_PATHS).toBe(30);
    expect(DEFAULT_MAX_VERSIONS_PER_PATH).toBe(4);
    expect(DEFAULT_MAX_BYTES).toBe(4 * 1024 * 1024);
  });
});
