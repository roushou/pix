---
description: Full implementation workflow — scout gathers context, planner creates a plan, worker implements
argument-hint: "[goal]"
---

Implement ${@:-the requested change} using the `subagent` tool in chain mode so the heavy work runs in isolated contexts.

Execute as a single chain, passing output between steps via the `{previous}` placeholder:

1. `scout` — find all code relevant to the goal.
2. `planner` — using the scout's context, produce a concrete implementation plan for the goal.
3. `worker` — implement the plan from the previous step.

After the chain completes, review what the worker changed (`git status`, `git diff`), then report a concise summary of what was done and any follow-ups.
