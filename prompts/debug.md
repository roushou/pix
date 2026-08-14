---
description: Work through a bug systematically — reproduce, diagnose, fix, and verify
argument-hint: "[problem]"
---

Debug ${@:-the reported issue} without guessing.

1. **Reproduce** — capture the exact error/output and the minimal steps that trigger it.
2. **Locate** — trace from the symptom to the likely cause using reads, logs, and tests; form a hypothesis.
3. **Confirm** — validate the hypothesis with a targeted check (log, test, or reproducer) before fixing.
4. **Fix** — make the smallest change that addresses the root cause, not the symptom.
5. **Verify** — run the failing case plus related tests; confirm nothing else regressed.
6. Summarize root cause → fix → verification in your reply.

If a step cannot be completed (e.g. can't reproduce), say so and ask for the missing input.
