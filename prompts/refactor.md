---
description: Refactor code without changing behavior — small steps, tests green throughout
argument-hint: "[target]"
---

Refactor ${@:-the code in question} while preserving behavior exactly.

1. State the goal first: clarity, deduplication, testability, or performance.
2. Establish a green baseline by running the existing tests.
3. Make changes in small, mechanical steps; the code must compile and pass tests after each step.
4. Do not mix behavior changes into the refactor — keep fixes for a separate pass.
5. After refactoring, run the full relevant test suite and any linters/formatters.
6. Report what changed and why, and confirm tests pass.
