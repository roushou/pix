---
name: debugging
description: Systematically finds and fixes bugs — reproduce, locate, hypothesize, confirm, fix, verify — without guessing. Use when asked to debug, diagnose, or fix a failure.
---

# Debugging

Find the root cause, not the symptom.

## Workflow

1. **Reproduce** — capture the exact error/output and the minimal steps that trigger it.
2. **Locate** — trace from the symptom to the likely cause: read the code path, check logs, run the failing test.
3. **Hypothesize** — form a specific, falsifiable theory about the cause.
4. **Confirm** — prove the hypothesis with a targeted check (log, test, reproducer) before changing anything.
5. **Fix** — make the smallest change that addresses the root cause.
6. **Verify** — run the failing case plus related tests; confirm no regression.

## Techniques

- **Bisect** — `git bisect` to find the commit that introduced the bug.
- **Narrow** — reduce the input/case until the failure is minimal.
- **Instrument** — add a temporary log or assertion at the boundary to observe actual vs. expected.
- **Read the stack** — start at the topmost frame you own; libraries are usually innocent.
- **Check the diff** — if it worked before, what changed? (`git log`, `git diff`).

## Rules

- One hypothesis at a time; don't change multiple things at once.
- If you can't reproduce, say so and ask for the missing input instead of guessing.
- Fix the cause, not the symptom (don't swallow the exception — handle or propagate it properly).
- After the fix, explain root cause → fix → verification in your reply.
