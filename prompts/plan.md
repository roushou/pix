---
description: Produce a numbered implementation plan under a "Plan:" header
argument-hint: "[goal]"
---

Produce a concrete, ordered implementation plan for: ${@:-the current task}.

1. Investigate first: read the relevant files and understand the current state.
2. Break the work into small, verifiable, independently-testable steps.
3. Output the plan in exactly this shape so it can be tracked:

   Plan:
   1. First step
   2. Second step
      ...

4. Keep each step specific (name files, functions, or commands), not vague.
5. Prefer steps that leave the code working and compiling at the end of each step.
6. After the plan, note risks, open questions, or decisions that need input.

Do NOT make any changes yet — this is planning only.
