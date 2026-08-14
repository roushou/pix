# Testing — Patterns & Anti-patterns

## Patterns

- **Arrange-Act-Assert** — set up, run, verify; keep the three phases visible.
- **Table-driven tests** — for pure functions, a table of inputs → expected outputs.
- **Test doubles** — stub (canned data), mock (asserts interactions), fake (in-memory impl). Prefer fakes over mocks.
- **Golden files** — for serializers/parsers, snapshot a known-good output.

## Anti-patterns

| Bad                               | Good                             | Why                                          |
| --------------------------------- | -------------------------------- | -------------------------------------------- |
| testing private methods directly  | test public behavior             | private methods are an implementation detail |
| tests that depend on order/timing | independent, deterministic tests | flaky suites erode trust                     |
| asserting every mock call         | assert outcomes                  | over-mocking pins implementation             |
| `sleep()` to wait                 | await conditions / inject clock  | slow and flaky                               |
| one giant `test("everything")`    | one behavior per test            | a failure should point at one thing          |
| only happy-path coverage          | include edge + error paths       | most bugs live at the edges                  |
