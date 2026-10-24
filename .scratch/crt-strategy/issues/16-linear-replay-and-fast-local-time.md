# 16: Linear replay & fast local time

**What to build:** Make multi-year replays feasible: remove the per-bar and per-day prefix re-reads from the replay loop (the O(n²) shape), and the per-bar Luxon timezone tax behind every local-time read — without changing a single decision the engine makes.

**Blocked by:** nothing for the work (fixtures exercise it); its final acceptance runs on 02's real store.

**Status:** done

## Why

Measured on the real store (ticket 02), before any fix:

- one month (GBPUSD 2024-01, 2116 M15 bars, 17 trades): 45s end to end — 22.5s loading the two instruments, 28.8s in the run;
- the shape is quadratic, so a year ≈ 75 min and 25 years ≈ days. The engine had never met real data.

A CPU profile of one week (`--cpu-prof`): Luxon's `partsOffset` alone is **45% self time** (with `offset`, `DateTime`, `set`, `tsToObj` the timezone machinery is ~63%) — every prefix re-aggregation pays Luxon once per bar, per call, and the call count grows with the prefix.

The prefix re-reads, all "read the world as of now":

- `backtest.ts` — `biasSnapshot(series.bars.slice(0, i + 1))` per session day: three aggregations of the prefix (MN1/W1/D1) plus structure, inside a loop that itself consumes the prefix;
- `backtest.ts` — `aggregate(series.bars.slice(0, i + 1), "MN1")` per month turn: same shape;
- `context.ts` — `aggregate(bars.slice(0, index + 1), "H4")` **per bar**, then `findSignificantPoints` over the result;
- `smt.ts` — `findSignificantPoints(pairBars.slice(0, pairIndex + 1))` per bar;
- and the constant per-bar Luxon calls the loop already pays (`sessionDayStart` twice, `bucketStart`, killzone/news/macro reads), plus `loadSeries`'s M1→M15 aggregation (~370µs/bar ≈ 39 min per instrument over 25 years of M1).

## Acceptance criteria

- [x] Local-time reads are arithmetic on constant-offset days: a per-session-day zone-offset cache backs `sessionDayStart`, sub-day `bucketStart` and the killzone/news reads, falling back to Luxon on DST transition days; a property test over random instants across several years (transition days included) proves equality with the Luxon references.
- [x] Every as-of read in the replay loop is O(1) amortized — no prefix re-aggregation per bar or per day, no per-bar `findSignificantPoints` over a prefix; cross-timeframe series are folded forward, not recomputed.
- [x] The rolling reads equal the prefix reference **at every bar** on crafted fixtures (property test), so decision-time behaviour is unchanged by construction; all fixture tests stay green (130 = 116 + `test/rolling.test.ts`'s 14).
- [x] The golden real run reproduces exactly: GBPUSD 2024-01-01..2024-01-31 on the real store with the demo config = 17 trades, expectancyR −0.319, same `configHash` and `dataHash`.
- [x] Ticket 02's AC3 lands here: the 25-year GBPUSD+EURUSD run completes end to end, and its report/time is recorded in the Notes.

## Notes

### Stage 1: fast local time (done)

- `time.ts` sits on a per-UTC-day offset cache (`offsetOnDay`, NaN on DST transition days) with
  arithmetic fast paths (`localWallMs`, `wallMsToInstant`, `mod`, memoized `parseClock`) and
  Luxon fallbacks kept for transition days; `candles.ts`'s `subDayBucketStart` was rebuilt on the
  same primitives with `luxonSubDayBucketStart` as the fallback.
- Behaviour lock: `test/time.test.ts` — every helper against its old Luxon body, sampled across
  both DST transitions ±36h in 15-minute steps, plus 400 seeded random instants over 2000–2025.
  116 tests green (114 + 2).
- Golden month (GBPUSD 2024-01, real store): load 22.5s → 3.0s (11.6s → 1.7s, 10.9s → 1.3s),
  run 28.8s → 1.5s; 17 trades, winRate 0.235, expectancyR −0.319, same `configHash` and
  `dataHash`. The timezone tax was in the run loop too, not only in the loader.
- Remaining (Stage 2): the prefix re-reads — context H4 per bar, bias per session day, macro per
  month, SMT pair per qualifying bar — plus the point-set scans inside `liquidityEventAt`,
  `structureSnapshot` and the upfront point-set builds (`findSignificantPoints`' high
  confirmation is itself O(series × swings)).

### Stage 2: linear replay (done)

- `src/rolling.ts` (new): `RollingPoints` — `findSignificantPoints` as one forward pass (a pivot
  settles once its right edge is frozen, a high confirms when a later low breaks its prior low,
  the still-open last bar re-evaluates on `update`); `RunningCandles` (`candles.ts`),
  `ContextReader` (`context.ts`), `RollingStructuralBias` + `BiasReader` (`bias.ts`) fold each
  window forward instead of re-aggregating prefixes. `foldPoints` gives the whole series' points
  in one pass, replacing the upfront `findSignificantPoints` (its high confirmation was
  O(series × swings) via `bars.slice(index + 1).some(...)` per swing).
- Query surfaces for the reads that are *not* true prefixes: `PointSet` (liquidity —
  `liquidityEventAtOf`, the relative DOL resolves across the whole series, and
  `findOrderBlocksOf`'s per-candle reads) and `ActivePoints` (structure — cursor-scoped
  `structureSnapshotOf`, matching the old full-series points filtered by index).
  `smtDivergenceOf` reads the folded pair's `maxLow`/`minHigh` (the reference's
  `nearestPool(prefix, index < pairIndex)` — the predicate is redundant for a true prefix).
- Also inside `findOrderBlocks`: the "liquidity taken later" scan became suffix min-low/max-high
  arrays, one O(n) pass instead of an O(n) `.slice().some()` per source candle.
- Behaviour lock: `test/rolling.test.ts` (14 tests) pins every rolling read against its prefix
  reference **at every bar/prefix** on crafted fixtures and seeded random walks — candles,
  points, context (winter + summer), liquidity (full-set + cursor), structure, bias (folds and
  live-candle updates, plus a 60-day DST-spanning walk read at every session day), SMT (every
  bar × every sweep shape), order blocks. Two real bugs were caught by it during the work: a
  Fenwick binary-lifting step in `ActiveSide.pick` that wasn't a power of two, and
  `RollingStructuralBias` storing the live candle's high/low as the newest pivot's price.
  130 tests green (116 + 14).
- Golden month re-run: 17 trades, winRate 0.235, expectancyR −0.319, profitFactor 0.63, London
  15 / New York 2, `configHash 2c4642c3…` and `dataHash 1cdd4d75…` unchanged. Run 1.5s → 0.7s
  (loads unchanged at ~3s; the one-month run is now dominated by fixed costs).
- 25-year run (ticket 02's AC3): `npm run backtest -- --instrument GBPUSD --from 2000-01-01
  --to 2024-12-31` (EURUSD loaded alongside for SMT) completes end to end in **773s ≈ 12.9 min**:
  595,381 M15 bars, 3,606 trades, winRate 0.240, expectancyR −0.343, profitFactor 0.62,
  `dataHash 4bcdbab2…` — versus the pre-ticket extrapolation of "days". The replay loop itself
  is ~10.5 min of that; the rest is parquet loads + per-year aggregation.
- Remaining superlinearity (follow-up, not an as-of read): `findOrderBlocks`' `testsPrior` scans
  every prior block per engulfing candle, so the upfront block pass still grows a little faster
  than n over very long series (2y → 16s, 25y → ~10.5 min of run). An interval-query block index
  would flatten it; it is outside this ticket's acceptance.

## Follow-ups

- The `dataHash`-style determinism harness is not part of this ticket: equality is proven per-read (below), not per-hash.
