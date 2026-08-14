# Git Rebase — Anti-patterns

| Bad                                         | Good                                  | Why                                           |
| ------------------------------------------- | ------------------------------------- | --------------------------------------------- |
| `git push --force`                          | `git push --force-with-lease`         | `--force` can clobber others' work            |
| rebasing pushed/shared branches             | rebase only local commits             | rewriting shared history breaks collaborators |
| squashing unrelated changes into one commit | one logical change per commit         | loses reviewability                           |
| mixing a refactor into a feature commit     | separate refactor and feature commits | pollutes history                              |
| `fixup` when the folded message matters     | use `squash` to keep the message      | fixup discards the message                    |
| forgetting to check the final diff          | `git diff <base>..HEAD` after rebase  | a pure cleanup should not change the diff     |
