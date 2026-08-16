---
description: Scout gathers context, planner creates an implementation plan (no code changes)
argument-hint: "[goal]"
---

Produce an implementation plan for ${@:-the requested change} using the `subagent` tool in chain mode. Do NOT implement — just return the plan.

Execute as a single chain, passing output between steps via the `{previous}` placeholder:

1. `scout` — find all code relevant to the goal.
2. `planner` — using the scout's context, produce a concrete implementation plan.

Then present the resulting plan to the user, and ask whether they want to proceed to implementation.
