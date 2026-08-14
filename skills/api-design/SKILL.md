---
name: api-design
description: Designs and reviews APIs — REST endpoints, function signatures, and data schemas — for clarity, consistency, minimal surface, and backward compatibility. Use when creating, changing, or reviewing a public interface.
---

# API Design

Design APIs that are easy to use correctly and hard to use wrong.

## Principles

1. **Minimal surface** — expose the smallest interface that solves the problem. Every public name is a liability you must keep.
2. **Clarity over cleverness** — names must be self-explanatory without reading the implementation.
3. **Consistency** — mirror existing conventions in the codebase (naming, parameter order, error shapes).
4. **Backward compatibility** — adding is safe; renaming, removing, or reordering existing parameters is breaking.
5. **Fail loudly** — invalid input should fail fast with a specific, actionable error, not silently misbehave.
6. **Return values are a contract** — document nullability, error cases, and ownership.

## Workflow

1. State the consumers and their needs before writing the signature.
2. Sketch the interface from the caller's perspective — write the call site first.
3. Apply the checklist in [references/checklist.md](references/checklist.md).
4. For a change to an existing API, classify it (additive vs. breaking) and note migration impact.

## Naming

- Use verbs for functions (`fetchUser`, `cancelOrder`), nouns for data (`User`, `Order`).
- Booleans and predicates read as questions: `isValid`, `hasChildren`, `isEmpty`.
- Avoid abbreviations and generic names (`data`, `info`, `handle`, `process`).
- Keep terminology consistent with the domain and the rest of the codebase.

See [references/checklist.md](references/checklist.md) for the full review checklist and anti-patterns.
