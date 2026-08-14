---
description: Explain a file, function, or subsystem — architecture, data flow, and gotchas
argument-hint: "<path-or-topic>"
---

Explain ${@:-the current project}.

1. Read the target plus the code it directly depends on.
2. Cover:
   - **Purpose** — what it does and why it exists
   - **Structure** — key files, functions, or components and how they fit together
   - **Data flow** — how data and control move through it
   - **Dependencies** — what it calls and what calls it
   - **Gotchas** — edge cases, assumptions, and places it is easy to break
3. Prefer the simplest accurate mental model; include an ASCII diagram when it helps.
4. Stay focused on the target, not the whole repo, unless asked.
