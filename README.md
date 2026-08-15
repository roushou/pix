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

| Extension                                              | What it does                                                                                                                                                           |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`notify`](extensions/notify.ts)                       | Desktop notification (macOS + Linux) when the agent finishes a task, with outcome, duration, files changed, and cost. Optional `notifyOnStart` config.                 |
| [`footer`](extensions/footer.ts)                       | Custom TUI footer: model + thinking level, context-usage bar, token/cost totals, git branch, and a dirty indicator (⚑).                                                |
| [`permission-gate`](extensions/permission-gate.ts)     | Blocks catastrophic bash (`rm -rf /`, `mkfs`) and confirms risky commands (`sudo`, force push, `rm -rf`, `git reset --hard`, …). Fails closed in non-interactive mode. |
| [`protected-paths`](extensions/protected-paths.ts)     | Blocks `write`/`edit` to sensitive paths (`.env`, `*.key`, `node_modules/`, `.git/`, `.ssh/`, …).                                                                      |
| [`todo`](extensions/todo.ts)                           | Persistent todo list: LLM-managed `todo` tool, widget above the editor, `/todos` toggle.                                                                               |
| [`session-name`](extensions/session-name.ts)           | Auto-names sessions from their first user message (stopword-aware). `/rename [name]` to override.                                                                      |
| [`plan-mode`](extensions/plan-mode.ts)                 | Read-only exploration + plan/execute: `/plan` (or `Ctrl+Alt+P`) disables write tools and restricts bash; parses `Plan:` steps, tracks `[DONE:n]` progress in a widget. |
| [`handoff`](extensions/handoff.ts)                     | `/handoff <goal>` distills the current branch into a self-contained prompt, lets you edit it, and opens a new session pre-filled with it.                              |
| [`bookmark`](extensions/bookmark.ts)                   | `/bookmark [label]` / `/unbookmark` label session entries for `/tree` navigation.                                                                                      |
| [`interactive-shell`](extensions/interactive-shell.ts) | Runs interactive commands (`!vim`, `!git rebase -i`, `!htop`, …) with full terminal access via the `!` prefix.                                                         |
| [`summarize`](extensions/summarize.ts)                 | `/summarize` renders a conversation summary in a scrollable Markdown overlay.                                                                                          |
| [`titlebar-spinner`](extensions/titlebar-spinner.ts)   | Braille spinner in the terminal title while the agent works; resets to `π - session - dir` when done.                                                                  |
| [`minimal-mode`](extensions/minimal-mode.ts)           | Compact rendering for built-in tools: collapsed output shows only the call + a one-line summary (e.g. `grep → N matches`); `Ctrl+O` expands.                           |
| [`custom-header`](extensions/custom-header.ts)         | Compact startup header with pix branding, pi version, and key shortcuts; `/builtin-header` restores the default.                                                       |
| [`preset`](extensions/preset.ts)                       | Named model/thinking/tools/instructions configs from `presets.json`: `/preset`, `Ctrl+Shift+U`, or `--preset`.                                                         |
| [`charts`](extensions/charts.ts)                       | Native inline `chart` and `diagram` tools (TypeScript, zero deps): Unicode bar/line/scatter/histogram/sparkline plots plus architecture/flow/tree diagrams.            |

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

| Prompt                             | What it does                                                                                                     |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [`/commit`](prompts/commit.md)     | One-command workflow: stage changes, write a Conventional Commits message, validate it, and commit (local only). |
| [`/review`](prompts/review.md)     | Review pending changes for bugs, security issues, error-handling gaps, and missing tests.                        |
| [`/plan`](prompts/plan.md)         | Produce a numbered implementation plan under a `Plan:` header (feeds into `plan-mode`).                          |
| [`/explain`](prompts/explain.md)   | Explain a file, function, or subsystem: architecture, data flow, and gotchas.                                    |
| [`/debug`](prompts/debug.md)       | Structured bug workflow: reproduce → diagnose → fix → verify.                                                    |
| [`/refactor`](prompts/refactor.md) | Refactor while preserving behavior, in small test-green steps.                                                   |
| [`/security`](prompts/security.md) | Security audit of the current changes.                                                                           |
| [`/docs`](prompts/docs.md)         | Write or refresh documentation for code.                                                                         |
| [`/pr`](prompts/pr.md)             | Generate a pull request title and description from the current changes.                                          |

### Themes (`themes/`)

| Theme                                        | What it does                                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [`kanagawa-wave`](themes/kanagawa-wave.json) | The [Kanagawa](https://github.com/rebelot/kanagawa.nvim) Wave palette. Select via `/settings` → Theme. |

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
