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

| Extension         | What it does                                                                                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `notify`          | Desktop notification (macOS + Linux) when the agent finishes a task. Also registers `/notify-test`.                                                                    |
| `footer`          | Custom TUI footer: model + thinking level, context-usage bar, token/cost totals, and git branch.                                                                       |
| `permission-gate` | Blocks catastrophic bash (`rm -rf /`, `mkfs`) and confirms risky commands (`sudo`, force push, `rm -rf`, `git reset --hard`, …). Fails closed in non-interactive mode. |
| `protected-paths` | Blocks `write`/`edit` to sensitive paths (`.env`, `*.key`, `node_modules/`, `.git/`, `.ssh/`, …).                                                                      |
| `todo`            | Persistent todo list: LLM-managed `todo` tool, widget above the editor, `/todos` toggle.                                                                               |
| `session-name`    | Auto-names sessions from their first user message (stopword-aware). `/rename [name]` to override.                                                                      |
| `plan-mode`       | Read-only exploration + plan/execute: `/plan` (or `Ctrl+Alt+P`) disables write tools and restricts bash; parses `Plan:` steps, tracks `[DONE:n]` progress in a widget. |

### Skills (`skills/`)

- **`conventional-commits`** — Conventional Commits rules plus a `validate.sh` linter. Auto-loads when committing; force with `/skill:conventional-commits`.

### Prompts (`prompts/`)

- **`/commit`** — one-command workflow: stage changes, write a Conventional Commits message, validate it, and commit (local only).

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
