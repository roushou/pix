---
name: conventional-commits
description: Writes and validates git commit messages following the Conventional Commits spec (type, optional scope, imperative subject, breaking-change markers). Use when committing changes, staging work, or writing, fixing, or improving a commit message.
---

# Conventional Commits

Write commit messages that follow the [Conventional Commits](https://www.conventionalcommits.org/) specification.

## Format

```
<type>(<scope>)?(!)?: <subject>

<body>

<footer>
```

### Header

- **type** — exactly one of: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`
- **scope** — optional noun for the affected area (e.g. `api`, `cli`, `deps`). Include it when the area isn't obvious from the subject.
- **!** — mark a breaking change (also add a `BREAKING CHANGE:` footer explaining what breaks and how to migrate)
- **subject** — imperative mood, lowercase, no trailing period, ≤ 50 chars (whole header ≤ 72 chars)

### Body (optional)

Explain _what_ and _why_, not _how_. Wrap lines at 72 chars. Include it for anything non-trivial.

### Footer (optional)

- `BREAKING CHANGE: <description>` — required for breaking changes
- `Closes #123`, `Fixes #123`, `Refs #456` — issue references

## Workflow

1. Inspect the changes: run `git diff --cached` if files are staged, otherwise `git diff` (and `git status` for untracked files).
2. Determine the single primary type. If a change spans multiple types, pick the dominant one (prefer `feat`/`fix` over `chore`).
3. Pick a scope only if the affected area isn't already obvious.
4. Write the subject in imperative mood: "add" not "added", "fix" not "fixed", "update" not "updated".
5. Add a body for non-trivial changes, and footers for breaking changes or issue references.
6. Validate before committing by piping the draft message to the validator (paths are relative to this skill's directory):

   ```bash
   printf '%s\n' 'feat(api): add rate limiting' | ./scripts/validate.sh
   ```

   Or validate the last commit after committing:

   ```bash
   ./scripts/validate.sh "$(git log -1 --format=%B)"
   ```

See [references/examples.md](references/examples.md) for detailed examples and edge cases.
