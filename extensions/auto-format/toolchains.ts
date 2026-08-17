/**
 * Toolchain policy — declarative data for the auto-format extension.
 *
 * Pure data, no logic: the engine in index.ts interprets this file. Each
 * entry describes one formatter/linter and when it applies:
 *
 *   name     — binary name (resolved from node_modules/.bin for "local"
 *              tools, or from PATH for "path" tools)
 *   files    — file extensions this toolchain applies to
 *   bin      - "local": resolve from <root>/node_modules/.bin
 *              "path":  resolve from PATH (availability checked at exec time)
 *   config   — config file names at the project root that enable the tool
 *   pkgKey   — package.json top-level key that enables the tool (web only)
 *   sections — config sections inside a file (e.g. `[tool.ruff]` in
 *              pyproject.toml) that enable the tool
 *   format   — args template for formatting ("{file}" is substituted)
 *   lint     — args template for linting ("{file}" is substituted)
 *
 * Array order is priority order: each slot (format, lint) goes to the first
 * spec that is both configured AND installed. A tool without a `format` or
 * `lint` field cannot fill that slot.
 */

/** Project-root markers, checked bottom-up to locate a project boundary. */
export const PROJECT_ROOT_MARKERS = [
  "package.json",
  "pyproject.toml",
  "go.mod",
  "Cargo.toml",
  ".git",
];

const WEB = /\.(tsx?|jsx?|mjs|cjs|jsonc?|mdx?|css|scss|less|html|vue|svelte|ya?ml)$/i;
const PY = /\.(py|pyi)$/i;
const GO = /\.go$/i;
const RS = /\.rs$/i;

export interface ToolchainSpec {
  name: string;
  files: RegExp;
  bin: "local" | "path";
  config?: string[];
  pkgKey?: string;
  sections?: Array<{ file: string; pattern: RegExp }>;
  format?: string[];
  lint?: string[];
}

export const TOOLCHAINS: ToolchainSpec[] = [
  {
    name: "biome",
    files: WEB,
    bin: "local",
    config: ["biome.json", "biome.jsonc"],
    format: ["format", "--write", "{file}"],
    lint: ["check", "{file}"],
  },
  {
    name: "prettier",
    files: WEB,
    bin: "local",
    config: [
      ".prettierrc",
      ".prettierrc.json",
      ".prettierrc.yaml",
      ".prettierrc.yml",
      ".prettierrc.js",
      ".prettierrc.cjs",
      ".prettierrc.mjs",
      ".prettierrc.toml",
      "prettier.config.js",
      "prettier.config.cjs",
      "prettier.config.mjs",
    ],
    pkgKey: "prettier",
    format: ["--write", "{file}"],
  },
  {
    name: "dprint",
    files: WEB,
    bin: "local",
    config: ["dprint.json", ".dprint.json", "dprint.jsonc", ".dprint.jsonc"],
    format: ["fmt", "{file}"],
  },
  {
    name: "oxfmt",
    files: WEB,
    bin: "local",
    config: [".oxfmtrc.json"],
    format: ["--write", "{file}"],
  },
  {
    name: "oxlint",
    files: WEB,
    bin: "local",
    config: [".oxlintrc.json"],
    lint: ["{file}"],
  },
  {
    name: "eslint",
    files: WEB,
    bin: "local",
    config: [
      ".eslintrc",
      ".eslintrc.json",
      ".eslintrc.js",
      ".eslintrc.cjs",
      ".eslintrc.yaml",
      ".eslintrc.yml",
      "eslint.config.js",
      "eslint.config.mjs",
      "eslint.config.cjs",
      "eslint.config.ts",
    ],
    lint: ["{file}"],
  },
  {
    name: "ruff",
    files: PY,
    bin: "path",
    config: ["ruff.toml", ".ruff.toml"],
    sections: [{ file: "pyproject.toml", pattern: /^\s*\[tool\.ruff\]/m }],
    format: ["format", "{file}"],
    lint: ["check", "{file}"],
  },
  {
    name: "black",
    files: PY,
    bin: "path",
    config: [".black"],
    sections: [
      { file: "pyproject.toml", pattern: /^\s*\[tool\.black\]/m },
      { file: "setup.cfg", pattern: /^\s*\[black\]/m },
      { file: "tox.ini", pattern: /^\s*\[black\]/m },
    ],
    format: ["{file}"],
  },
  {
    name: "gofmt",
    files: GO,
    bin: "path",
    config: ["go.mod"],
    format: ["-w", "{file}"],
  },
  {
    name: "rustfmt",
    files: RS,
    bin: "path",
    config: ["Cargo.toml"],
    format: ["{file}"],
  },
];
