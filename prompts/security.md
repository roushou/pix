---
description: Audit the current changes for security vulnerabilities
argument-hint: "[scope]"
---

Security-audit ${@:-all pending changes}.

1. See what changed: `git status --short`, `git diff`, and `git diff --cached`.
2. Read changed files in context, then assess:
   - **Injection** — command, SQL, code, template, or prompt injection
   - **Secrets** — hardcoded keys/tokens/passwords, credentials in logs or diffs
   - **Path handling** — traversal, symlink races, unsafe writes (e.g. to `.env`, `~/.ssh`)
   - **Input validation** — untrusted input reaching dangerous sinks without validation
   - **Dependencies** — new deps with known CVEs or excessive privileges
3. Rank findings by severity (critical/high/medium/low) with file:line, impact, and a concrete fix.
4. If clean, say so and note any residual risk (e.g. trust assumptions).
5. Do NOT modify files — report only.
