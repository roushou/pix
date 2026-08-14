---
name: testing
description: Writes tests following TDD (red-green-refactor) with a coverage bar — happy path, edge cases, boundaries, and error paths. Use when asked to write, add, fix, or improve tests or coverage.
---

# Testing

Write tests that are fast, deterministic, and prove behavior — not implementation.

## Workflow (TDD)

1. **Red** — write the smallest failing test that captures the desired behavior.
2. **Green** — make it pass with the minimal change.
3. **Refactor** — clean up with tests green.

For existing code without tests, characterize current behavior with tests first, then change it.

## Discover the runner

Check `package.json` scripts or the project's docs, and follow whatever the repo already uses:

- Node/Bun: `bun test`, `npm test`, `vitest`, `jest`
- Python: `pytest`
- Rust: `cargo test`
- Go: `go test`

## What to cover

- **Happy path** — the expected input produces the expected output.
- **Edge cases** — empty input, null/undefined, single element, min/max values.
- **Boundaries** — off-by-one, limits, thresholds.
- **Error paths** — invalid input fails with the right error; no silent corruption.
- **Concurrency/ordering** — if relevant.

## Style

- One behavior per test; name it `describe + it` or `test("does X")`.
- No shared mutable state between tests; use setup/teardown hooks.
- Assert on outcomes, not internal calls. Mock at the boundary only (I/O, network, clock).
- A test must fail for exactly one reason.

## Coverage bar

- Cover new/changed behavior; don't chase 100% blindly.
- Focus where bugs are likely: parsers, validation, state transitions, boundary logic.

See [references/patterns.md](references/patterns.md) for common patterns and anti-patterns.
