---
description: Review pending changes for bugs, logic errors, security issues, and error-handling gaps
argument-hint: "[focus]"
---

Review the current changes with a critical eye. Focus: ${@:-all pending changes}.

1. Inspect what changed: `git status --short`, then `git diff` (working tree) and `git diff --cached` (staged).
2. Read the surrounding context for each changed file so you judge behavior, not just the diff.
3. Report findings grouped by severity:
   - **Bugs** — logic errors, off-by-one, wrong types, race conditions
   - **Security** — injection, path traversal, secret exposure, unsafe deserialization
   - **Error handling** — swallowed errors, missing validation, partial-failure states
   - **Edge cases** — empty/null input, boundaries, concurrency, large inputs
   - **Tests** — missing coverage for new or changed behavior
4. For each finding: cite the file and line, explain the impact, and suggest a concrete fix.
5. If there are no issues, say so explicitly and summarize what the change does.
6. Do NOT modify files — report only. Offer to fix if asked.
