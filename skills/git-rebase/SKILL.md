---
name: git-rebase
description: Cleans up a branch with interactive rebase — squash, reword, reorder, and drop commits into a clean, Conventional Commits-compliant history. Use when asked to squash, rebase, reword, or tidy up commits.
---

# Git Rebase

Rewrite local history into a clean, logical series of commits before sharing.

## Workflow

1. Identify the base: `git rebase -i <base>` (e.g. `origin/main`), or find it with `git merge-base HEAD <base>`.
2. Inspect the commits: `git log --oneline <base>..HEAD`.
3. Reorder/edit the todo list using the commands below.
4. Resolve conflicts as they arise, then `git add` and `git rebase --continue`.
5. Verify: `git log --oneline` and confirm the final diff is unchanged after a pure cleanup.
6. Push with `git push --force-with-lease` — never plain `--force`.

## Rebase commands

- `pick` (p) — keep the commit as-is
- `reword` (r) — keep but edit the message
- `squash` (s) — fold into the previous commit, combine messages
- `fixup` (f) — fold into the previous commit, discard its message
- `drop` (d) — remove the commit entirely
- `edit` (e) — stop to amend the commit

## Rules

- Only rewrite **local, unpushed** commits. Never rewrite history already shared with others.
- Keep each commit small and self-contained; each should compile and be testable.
- Subject lines follow [Conventional Commits](../conventional-commits/SKILL.md): `feat`, `fix`, etc., imperative, lowercase.
- A pure history cleanup must not change the final diff. Confirm with `git diff <base>..HEAD` before and after.

## Aborting

- `git rebase --abort` returns to the pre-rebase state at any point.

See [references/anti-patterns.md](references/anti-patterns.md) for what to avoid.
