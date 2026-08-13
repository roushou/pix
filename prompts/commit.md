---
description: Commit the current changes with a Conventional Commits message
argument-hint: "[message-hint]"
---

Create a commit for the current changes, following the conventional-commits skill.

1. Review what changed: `git status --short`, `git diff`, and `git diff --cached`.
2. Follow the conventional-commits skill's workflow and rules (type, optional scope, imperative lowercase subject).
3. Stage all relevant changes with `git add`.
4. Write the commit message.
5. Validate the message with the skill's validator before committing.
6. Run `git commit` (local only — do not push).

Optional hint for the commit message: ${1:-none}
