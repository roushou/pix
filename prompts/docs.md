---
description: Write or refresh documentation for code
argument-hint: "[target]"
---

Write clear documentation for ${@:-the relevant code}.

1. Read the target code and understand its public surface and behavior.
2. Document:
   - **Purpose** — what it does and why
   - **Usage** — how callers use it, with a short example
   - **Parameters & return** — types, units, defaults, nullability, errors
   - **Side effects & gotchas** — anything surprising or easy to misuse
3. Match the project's existing documentation style and conventions.
4. Keep it concise and accurate; document behavior, not implementation.
5. Update any stale docs rather than only adding new ones.
