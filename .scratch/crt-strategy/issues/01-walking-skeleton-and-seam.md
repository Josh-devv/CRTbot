# 01: Walking skeleton & seam

**What to build:** A runnable TypeScript/Node project whose single seam, `runBacktest(dataset, config)`, accepts a bar series plus a config and returns `{ trades, equityCurve, stats, decisions }`. A bar-replay loop fills entries and exits with spread and commission applied per side. A placeholder strategy (e.g. one entry per day in a fixed window) proves the whole path works. A `backtest` CLI command runs an end-to-end backtest and prints/saves a report. Output is deterministic and recorded with a config hash. This ticket establishes the repo's testing pattern.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] `runBacktest` accepts a synthetic dataset + config and returns trades, equity curve, stats and a decisions log
- [x] Entries and exits are filled with spread and commission applied per side
- [x] A `backtest` CLI command runs an end-to-end backtest and prints/saves a report
- [x] Identical input + config produce identical output, recorded with a config hash
- [x] Fixture-based tests run via Node's built-in test runner and pass

## Comments

Completed 2026-10-17. Seam implemented at `runBacktest(series, config, { strategy }) → BacktestResult`.
Files: `src/types.ts`, `src/stats.ts`, `src/strategy.ts`, `src/backtest.ts`, `src/cli.ts`;
tests in `test/backtest.test.ts`. `npm test` → 5 passing; `npm run typecheck` → clean;
`npx tsx src/cli.ts backtest` prints a report. Placeholder strategy is temporary (real Axis System
execution arrives in tickets 05–09).

Code review (two-axis) fixed the cost model to charge spread **and** commission on both sides, and
removed a dead `strategy.kind` field. Deferred findings, tracked against later tickets:

- `BacktestResult.dataHash` not yet recorded (spec §Determinism) → ticket 02.
- Seam takes a single `BarSeries`, not `BarSeries[]` (spec §Interfaces) → needed for multi-instrument
  work in ticket 10 (SMT).
- `sessionTz` is a declared-but-unused knob, and day-bucketing logic is duplicated in
  `backtest.ts`/`cli.ts`/tests → to be unified by the time module in ticket 03.
- `StrategyContext` re-lists OHLC instead of embedding `Bar`; `Decision.action` carries unused
  members; commission is flat rather than per-lot → revisit when the real execution/cost work lands
  (tickets 07, 13).
