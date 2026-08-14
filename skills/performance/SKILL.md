---
name: performance
description: Optimizes performance by measuring first — profile, identify the bottleneck, make one change, re-measure. Use when asked to optimize, speed up, or profile code.
---

# Performance

Measure before you optimize; prove the win after.

## Workflow

1. **Baseline** — capture current behavior with a representative workload (time, memory, throughput).
2. **Profile** — find where time actually goes; don't guess.
3. **Target** — fix the biggest bottleneck first, one change at a time.
4. **Re-measure** — compare against the baseline; keep the change only if it's a real, repeatable win.
5. **Guard** — add a benchmark/regression check if the code is hot.

## Tools

- Node/Bun: `bun --inspect`, `node --prof`, `console.time`
- Python: `cProfile`, `time.perf_counter`
- Rust/Go: built-in benchmarks (`cargo bench`, `go test -bench`)
- General: `time`, `hyperfine`, `perf`

## Where to look

- Repeated work in loops (hoist invariant computation)
- Accidental O(n²) — nested loops, string concatenation in loops
- Unbounded allocations / GC pressure
- Blocking I/O on hot paths (cache, batch, parallelize)
- N+1 queries / redundant re-reads

## Rules

- Never optimize without a measurement that shows it matters (avoid premature optimization).
- Keep a benchmark for anything you optimize so regressions are caught.
- Prefer algorithmic wins (complexity) over micro-optimizations.
- Keep readability unless the gain is significant and measured.
- If the change isn't a clear win, revert and say so.
