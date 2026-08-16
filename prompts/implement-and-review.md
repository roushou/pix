---
description: Worker implements, reviewer reviews, worker applies the feedback
argument-hint: "[goal]"
---

Implement and self-review ${@:-the requested change} using the `subagent` tool in chain mode so each phase runs in an isolated context.

Execute as a single chain, passing output between steps via the `{previous}` placeholder:

1. `worker` — implement the goal.
2. `reviewer` — review the implementation from the previous step.
3. `worker` — apply the review feedback from the previous step.

After the chain completes, summarize what was implemented, what the review found, and what was fixed.
