import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detect } from "../extensions/auto-format/index.ts";

const roots: string[] = [];
const makeRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), "af-test-"));
  roots.push(root);
  return root;
};

const addBin = (root: string, name: string): void => {
  const dir = join(root, "node_modules", ".bin");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), "#!/bin/sh\n");
};

const addFile = (root: string, name: string, content = ""): void => {
  const parts = name.split("/");
  if (parts.length > 1) mkdirSync(join(root, parts.slice(0, -1).join("/")), { recursive: true });
  writeFileSync(join(root, name), content);
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const fmt = (d: { format: { name: string } | null }) => d.format?.name ?? null;
const lnt = (d: { lint: { name: string } | null }) => d.lint?.name ?? null;

describe("web toolchains (priority order)", () => {
  test("biome configured and installed -> format + lint", () => {
    const root = makeRoot();
    addFile(root, "biome.json", "{}");
    addBin(root, "biome");
    const d = detect(root, "/x/src/a.ts");
    expect([fmt(d), lnt(d)]).toEqual(["biome", "biome"]);
  });

  test("prettier only -> format, no lint", () => {
    const root = makeRoot();
    addFile(root, ".prettierrc", "{}");
    addBin(root, "prettier");
    const d = detect(root, "/x/src/a.ts");
    expect([fmt(d), lnt(d)]).toEqual(["prettier", null]);
  });

  test("eslint only -> lint, no format", () => {
    const root = makeRoot();
    addFile(root, ".eslintrc", "{}");
    addBin(root, "eslint");
    const d = detect(root, "/x/src/a.ts");
    expect([fmt(d), lnt(d)]).toEqual([null, "eslint"]);
  });

  test("biome wins over prettier when both are configured", () => {
    const root = makeRoot();
    addFile(root, "biome.json", "{}");
    addFile(root, ".prettierrc", "{}");
    addBin(root, "biome");
    addBin(root, "prettier");
    const d = detect(root, "/x/src/a.ts");
    expect([fmt(d), lnt(d)]).toEqual(["biome", "biome"]);
  });

  test("biome configured but not installed falls through to prettier", () => {
    const root = makeRoot();
    addFile(root, "biome.json", "{}");
    addFile(root, ".prettierrc", "{}");
    addBin(root, "prettier");
    const d = detect(root, "/x/src/a.ts");
    expect([fmt(d), lnt(d)]).toEqual(["prettier", null]);
  });

  test("prettier via package.json key", () => {
    const root = makeRoot();
    addFile(root, "package.json", JSON.stringify({ prettier: {} }));
    addBin(root, "prettier");
    const d = detect(root, "/x/src/a.ts");
    expect(fmt(d)).toBe("prettier");
  });
});

describe("python toolchains", () => {
  test("ruff via [tool.ruff] in pyproject.toml", () => {
    const root = makeRoot();
    addFile(root, "pyproject.toml", "\n[tool.ruff]\n");
    const d = detect(root, "/x/src/a.py");
    expect([fmt(d), lnt(d)]).toEqual(["ruff", "ruff"]);
  });

  test("black via [black] in setup.cfg (no ruff)", () => {
    const root = makeRoot();
    addFile(root, "setup.cfg", "\n[black]\n");
    const d = detect(root, "/x/src/a.py");
    expect([fmt(d), lnt(d)]).toEqual(["black", null]);
  });
});

describe("native toolchains", () => {
  test("gofmt requires go.mod", () => {
    const root = makeRoot();
    addFile(root, "go.mod", "module x\n");
    const d = detect(root, "/x/src/a.go");
    expect(fmt(d)).toBe("gofmt");
  });

  test("rustfmt requires Cargo.toml", () => {
    const root = makeRoot();
    addFile(root, "Cargo.toml", "[package]\n");
    const d = detect(root, "/x/src/a.rs");
    expect(fmt(d)).toBe("rustfmt");
  });
});

describe("isolation", () => {
  test("unknown extension -> no toolchain", () => {
    const root = makeRoot();
    const d = detect(root, "/x/src/whatever.txt");
    expect([fmt(d), lnt(d)]).toEqual([null, null]);
  });

  test("a .ts file ignores python toolchains", () => {
    const root = makeRoot();
    addFile(root, "pyproject.toml", "\n[tool.ruff]\n");
    const d = detect(root, "/x/a.ts");
    expect(fmt(d)).toBeNull();
  });

  test("args templates substitute {file}", () => {
    const root = makeRoot();
    addFile(root, "biome.json", "{}");
    addBin(root, "biome");
    const d = detect(root, "/x/src/a.ts");
    expect(d.format?.args).toEqual(["format", "--write", "/x/src/a.ts"]);
  });
});
