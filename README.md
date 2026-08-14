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

| Extension           | What it does                                                                                                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `notify`            | Desktop notification (macOS + Linux) when the agent finishes a task. Also registers `/notify-test`.                                                                    |
| `footer`            | Custom TUI footer: model + thinking level, context-usage bar, token/cost totals, git branch, and a dirty indicator (⚑).                                                |
| `permission-gate`   | Blocks catastrophic bash (`rm -rf /`, `mkfs`) and confirms risky commands (`sudo`, force push, `rm -rf`, `git reset --hard`, …). Fails closed in non-interactive mode. |
| `protected-paths`   | Blocks `write`/`edit` to sensitive paths (`.env`, `*.key`, `node_modules/`, `.git/`, `.ssh/`, …).                                                                      |
| `todo`              | Persistent todo list: LLM-managed `todo` tool, widget above the editor, `/todos` toggle.                                                                               |
| `session-name`      | Auto-names sessions from their first user message (stopword-aware). `/rename [name]` to override.                                                                      |
| `plan-mode`         | Read-only exploration + plan/execute: `/plan` (or `Ctrl+Alt+P`) disables write tools and restricts bash; parses `Plan:` steps, tracks `[DONE:n]` progress in a widget. |
| `handoff`           | `/handoff <goal>` distills the current branch into a self-contained prompt, lets you edit it, and opens a new session pre-filled with it.                              |
| `bookmark`          | `/bookmark [label]` / `/unbookmark` label session entries for `/tree` navigation.                                                                                      |
| `interactive-shell` | Runs interactive commands (`!vim`, `!git rebase -i`, `!htop`, …) with full terminal access via the `!` prefix.                                                         |
| `summarize`         | `/summarize` renders a conversation summary in a scrollable Markdown overlay.                                                                                          |
| `titlebar-spinner`  | Braille spinner in the terminal title while the agent works; resets to `π - session - dir` when done.                                                                  |
| `minimal-mode`      | Compact rendering for built-in tools: collapsed output shows only the call + a one-line summary (e.g. `grep → N matches`); `Ctrl+O` expands.                           |
| `custom-header`     | Compact startup header with pix branding, pi version, and key shortcuts; `/builtin-header` restores the default.                                                       |

### Skills (`skills/`)

- **`conventional-commits`** — Conventional Commits rules plus a `validate.sh` linter. Auto-loads when committing; force with `/skill:conventional-commits`.
- **`api-design`** — API design principles + review checklist (REST, function signatures, schemas). Auto-loads when designing or reviewing interfaces.

### Prompts (`prompts/`)

- **`/commit`** — one-command workflow: stage changes, write a Conventional Commits message, validate it, and commit (local only).
- **`/review`** — review pending changes for bugs, security issues, error-handling gaps, and missing tests.
- **`/plan`** — produce a numbered implementation plan under a `Plan:` header (feeds into `plan-mode`).
- **`/explain`** — explain a file, function, or subsystem: architecture, data flow, and gotchas.
- **`/debug`** — structured bug workflow: reproduce → diagnose → fix → verify.
- **`/refactor`** — refactor while preserving behavior, in small test-green steps.
- **`/security`** — security audit of the current changes.

### Themes (`themes/`)

- **`kanagawa-wave`** — the [Kanagawa](https://github.com/rebelot/kanagawa.nvim) Wave palette. Select via `/settings` → Theme.

### Keybindings (`config/`)

Vim-style keybindings ship as `config/keybindings.vim.json` (pi loads keybindings from `~/.pi/agent/keybindings.json`, not from packages). To use them:

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
