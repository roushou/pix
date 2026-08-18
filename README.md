# pix

A personal [pi](https://pi.dev) setup, packaged as a pi package: extensions, skills, and prompt templates.

## Install

From git:

```bash
pi install git:github.com/roushou/pix
```

Or, for local development (loads straight from disk, no copy):

```bash
pi install /path/to/pix
```

Then `/reload` (or restart pi). Uninstall with `pi remove <source>`.

## Contents

### Extensions (`extensions/`)

| Extension                                            | What it does                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`notify`](extensions/notify.ts)                     | Desktop notification (macOS + Linux) when the agent finishes a task, with outcome, duration, files changed, and cost. Optional `notifyOnStart` config.                                                                                                                                                                             |
| [`footer`](extensions/footer.ts)                     | Custom TUI footer: model + thinking level, context-usage bar, token/cost totals, git branch, and a dirty indicator (⚑).                                                                                                                                                                                                            |
| [`permission-gate`](extensions/permission-gate/)     | Blocks catastrophic bash (`rm -rf /`, `mkfs`) and confirms risky commands (`sudo`, force push, `rm -rf`, `git reset --hard`, …). Fails closed in non-interactive mode. Rules live in [`extensions/permission-gate/policy.ts`](extensions/permission-gate/policy.ts); config via `permissionGate.notifyOnConfirm` in settings.json. |
| [`protected-paths`](extensions/protected-paths.ts)   | Blocks `write`/`edit` to sensitive paths (`.env`, `*.key`, `node_modules/`, `.git/`, `.ssh/`, …).                                                                                                                                                                                                                                  |
| [`todo`](extensions/todo.ts)                         | Persistent todo list: LLM-managed `todo` tool, widget above the editor, `/todos` toggle.                                                                                                                                                                                                                                           |
| [`session-name`](extensions/session-name.ts)         | Auto-names sessions from their first user message (stopword-aware). `/rename [name]` to override.                                                                                                                                                                                                                                  |
| [`plan-mode`](extensions/plan-mode.ts)               | Read-only exploration + plan/execute: `/plan` (or `Ctrl+Alt+P`) disables write tools and restricts bash; parses `Plan:` steps, tracks `[DONE:n]` progress in a widget.                                                                                                                                                             |
| [`handoff`](extensions/handoff.ts)                   | `/handoff <goal>` distills the current branch into a self-contained prompt, lets you edit it, and opens a new session pre-filled with it.                                                                                                                                                                                          |
| [`bookmark`](extensions/bookmark.ts)                 | `/bookmark [label]` / `/unbookmark` label session entries for `/tree` navigation.                                                                                                                                                                                                                                                  |
| [`interactive-shell`](extensions/interactive-shell/) | Runs interactive commands (`!vim`, `!git rebase -i`, `!htop`, …) with full terminal access via the `!` prefix. Command list lives in [`extensions/interactive-shell/commands.ts`](extensions/interactive-shell/commands.ts).                                                                                                       |
| [`summarize`](extensions/summarize.ts)               | `/summarize` renders a conversation summary in a scrollable Markdown overlay.                                                                                                                                                                                                                                                      |
| [`titlebar-spinner`](extensions/titlebar-spinner.ts) | Braille spinner in the terminal title while the agent works; resets to `π - session - dir` when done.                                                                                                                                                                                                                              |
| [`minimal-mode`](extensions/minimal-mode.ts)         | Compact rendering for built-in tools: collapsed output shows only the call + a one-line summary (e.g. `grep → N matches`); `Ctrl+O` expands.                                                                                                                                                                                       |
| [`custom-header`](extensions/custom-header.ts)       | Compact startup header with pix branding, pi version, and key shortcuts; `/builtin-header` restores the default.                                                                                                                                                                                                                   |
| [`preset`](extensions/preset.ts)                     | Named model/thinking/tools/instructions configs from `presets.json`: `/preset`, `Ctrl+Shift+U`, or `--preset`.                                                                                                                                                                                                                     |
| [`charts`](extensions/charts.ts)                     | Native inline `chart` and `diagram` tools (TypeScript, zero deps): Unicode bar/line/scatter/histogram/sparkline plots plus architecture/flow/tree diagrams.                                                                                                                                                                        |
| [`subagent`](extensions/subagent.ts)                 | `subagent` tool: delegate tasks to specialized agents (single / parallel / chain) in isolated `pi` processes. Ships `scout`, `planner`, `reviewer`, `worker` agents.                                                                                                                                                               |
| [`web`](extensions/web.ts)                           | `web_fetch` + `web_search` tools: fetch URLs (HTML→text, JSON pretty-printed), search via Tavily/Brave/Serper or DuckDuckGo fallback.                                                                                                                                                                                              |
| [`auto-format`](extensions/auto-format/)             | Runs each project's own formatter/linter after `write`/`edit` (biome, prettier, dprint, oxfmt, oxlint, eslint, ruff, black, gofmt, rustfmt). Toolchain specs live in [`extensions/auto-format/toolchains.ts`](extensions/auto-format/toolchains.ts).                                                                               |
| [`dirty-repo-guard`](extensions/dirty-repo-guard.ts) | Confirms before `/new`, `/resume`, `/fork`, `/clone` when the tree has uncommitted changes; warns the agent at start so it keeps its edits separate.                                                                                                                                                                               |

### Skills (`skills/`)

| Skill                                                          | What it does                                                                                                                                    |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| [`conventional-commits`](skills/conventional-commits/SKILL.md) | Conventional Commits rules plus a `validate.sh` linter. Auto-loads when committing; force with `/skill:conventional-commits`.                   |
| [`api-design`](skills/api-design/SKILL.md)                     | API design principles + review checklist (REST, function signatures, schemas). Auto-loads when designing or reviewing interfaces.               |
| [`git-rebase`](skills/git-rebase/SKILL.md)                     | Interactive rebase workflow (squash/reword/reorder/drop) for a clean, Conventional Commits-compliant history.                                   |
| [`testing`](skills/testing/SKILL.md)                           | TDD red-green-refactor + coverage guidance: happy path, edge cases, boundaries, and error paths.                                                |
| [`debugging`](skills/debugging/SKILL.md)                       | Systematic bug workflow: reproduce → locate → hypothesize → confirm → fix → verify.                                                             |
| [`performance`](skills/performance/SKILL.md)                   | Measure-first optimization: profile, fix the bottleneck, re-measure, and guard with benchmarks.                                                 |
| [`ascii-art`](skills/ascii-art/SKILL.md)                       | ASCII/Unicode art: text banners, image-to-ASCII, boxes, dividers, and speech bubbles.                                                           |
| [`diagram-maker`](skills/diagram-maker/SKILL.md)               | SVG/HTML and Excalidraw diagrams for concepts, architecture, flows, and whiteboards (from openclaw, MIT).                                       |
| [`cartographer`](skills/cartographer/SKILL.md)                 | Interactive isometric architecture map of a codebase as a self-contained HTML page (blocks sized by line count, colored zones, animated edges). |

### Prompts (`prompts/`)

| Prompt                                                     | What it does                                                                                                     |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [`/commit`](prompts/commit.md)                             | One-command workflow: stage changes, write a Conventional Commits message, validate it, and commit (local only). |
| [`/review`](prompts/review.md)                             | Review pending changes for bugs, security issues, error-handling gaps, and missing tests.                        |
| [`/plan`](prompts/plan.md)                                 | Produce a numbered implementation plan under a `Plan:` header (feeds into `plan-mode`).                          |
| [`/explain`](prompts/explain.md)                           | Explain a file, function, or subsystem: architecture, data flow, and gotchas.                                    |
| [`/debug`](prompts/debug.md)                               | Structured bug workflow: reproduce → diagnose → fix → verify.                                                    |
| [`/refactor`](prompts/refactor.md)                         | Refactor while preserving behavior, in small test-green steps.                                                   |
| [`/security`](prompts/security.md)                         | Security audit of the current changes.                                                                           |
| [`/docs`](prompts/docs.md)                                 | Write or refresh documentation for code.                                                                         |
| [`/pr`](prompts/pr.md)                                     | Generate a pull request title and description from the current changes.                                          |
| [`/implement`](prompts/implement.md)                       | Full workflow via `subagent` chain: scout → planner → worker.                                                    |
| [`/scout-and-plan`](prompts/scout-and-plan.md)             | `subagent` chain: scout → planner, returns a plan without implementing.                                          |
| [`/implement-and-review`](prompts/implement-and-review.md) | `subagent` chain: worker → reviewer → worker (implement, review, apply feedback).                                |

### Agents (`agents/`)

Agent definitions used by the `subagent` tool — markdown files with YAML frontmatter (`name`, `description`, optional `tools` and `model`) plus a system-prompt body.

| Agent                            | Purpose                                           |
| -------------------------------- | ------------------------------------------------- |
| [`scout`](agents/scout.md)       | Fast codebase recon → compressed handoff context. |
| [`planner`](agents/planner.md)   | Read-only implementation planning.                |
| [`reviewer`](agents/reviewer.md) | Code review for quality/security.                 |
| [`worker`](agents/worker.md)     | General-purpose implementation.                   |

These ship bundled with the package and work out of the box. The tool also discovers `~/.pi/agent/agents/*.md` (user-level) and `.pi/agents/*.md` (project-level, requires `agentScope: "both"`). User/project agents override bundled ones with the same name. Add `model: <id>` to any agent's frontmatter to pin a model (default: inherit the session's active model).

### Themes (`themes/`)

| Theme                                        | What it does                                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [`kanagawa-wave`](themes/kanagawa-wave.json) | The [Kanagawa](https://github.com/rebelot/kanagawa.nvim) Wave palette. Select via `/settings` → Theme. |

### Shared (`extensions/shared/`)

Cross-extension foundations, each pure and unit-tested (`tests/`):

| Module                                           | What it does                                                                                                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`config.ts`](extensions/shared/config.ts)       | Declarative `ConfigSpec` tables: settings channel overrides, env channel augments, `resolveConfigObject` for typed multi-key config.                    |
| [`settings.ts`](extensions/shared/settings.ts)   | Global → project `settings.json` merge per extension key, best-effort.                                                                                  |
| [`text.ts`](extensions/shared/text.ts)           | Byte-safe `truncateBytes`, line/byte `truncateOutput`, structure-preserving `truncateChars`, `oneLine`.                                                 |
| [`snapshots.ts`](extensions/shared/snapshots.ts) | Session snapshot store for anchor-based editing: content-hash tags, stale-anchor verification, bounded LRU versions (30 paths × 4 versions, 4 MiB cap). |
| [`tools.ts`](extensions/shared/tools.ts)         | Standard `asText` result builder and `withTimeout` abort+timeout wrapper for custom tools.                                                              |

### Keybindings (`config/`)

Vim-style keybindings ship as [`config/keybindings.vim.json`](config/keybindings.vim.json) (pi loads keybindings from `~/.pi/agent/keybindings.json`, not from packages). To use them:

```bash
cp config/keybindings.vim.json ~/.pi/agent/keybindings.json
# then /reload
```

Adds `alt+h/j/k/l` movement, `alt+b`/`alt+w` word jumps, `alt+0`/`alt+$` line start/end, `alt+x` delete char, and `alt+o` new line.

## Development

```bash
bun install          # install dependencies
bunx tsc --noEmit    # typecheck
```

Test without installing (loads the whole package for one run):

```bash
pi -e /path/to/pix
```

Or install the local path once, then `/reload` after each edit — changes are live with no copying:

```bash
pi install /path/to/pix
```

Commits follow [Conventional Commits](https://www.conventionalcommits.org/) — enforced by this repo's own `conventional-commits` skill.

# License

This project is licensed under the [MIT](./LICENSE) license.
