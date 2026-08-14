---
description: Generate a pull request title and description from the current changes
argument-hint: "[base-branch]"
---

Generate a pull request title and description for the current branch's changes.

1. Determine the diff: list commits on this branch vs `${1:-main}`, then `git diff ${1:-main}...HEAD`.
2. Write a title that is a single imperative sentence, ≤ 72 chars, summarizing the change.
3. Write a description with:
   - **What** — a summary of the change
   - **Why** — the motivation
   - **How** — key implementation decisions
   - **Testing** — what was run
   - **Risks / follow-ups** — if any
4. If the commits follow Conventional Commits, derive the type from the commit subjects.
5. Output the title and description in a copy-pasteable format, noting any checklist items the repo expects.
