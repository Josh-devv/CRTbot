# 16: Linear replay & fast local time

**What to build:** Make multi-year replays feasible: remove the per-bar and per-day prefix re-reads from the replay loop (the O(n²) shape), and the per-bar Luxon timezone tax behind every local-time read — without changing a single decision the engine makes.

**Blocked by:** nothing for the work (fixtures exercise it); its final acceptance runs on 02's real store.

**Status:** ready-for-agent

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

- [ ] Local-time reads are arithmetic on constant-offset days: a per-session-day zone-offset cache backs `sessionDayStart`, sub-day `bucketStart` and the killzone/news reads, falling back to Luxon on DST transition days; a property test over random instants across several years (transition days included) proves equality with the Luxon references.
- [ ] Every as-of read in the replay loop is O(1) amortized — no prefix re-aggregation per bar or per day, no per-bar `findSignificantPoints` over a prefix; cross-timeframe series are folded forward, not recomputed.
- [ ] The rolling reads equal the prefix reference **at every bar** on crafted fixtures (property test), so decision-time behaviour is unchanged by construction; all fixture tests (114) stay green.
- [ ] The golden real run reproduces exactly: GBPUSD 2024-01-01..2024-01-31 on the real store with the demo config = 17 trades, expectancyR −0.319, same `configHash` and `dataHash`.
- [ ] Ticket 02's AC3 lands here: the 25-year GBPUSD+EURUSD run completes end to end, and its report/time is recorded in the Notes.

## Notes

(design, measurements and results while this ticket is built)

## Follow-ups

- The `dataHash`-style determinism harness is not part of this ticket: equality is proven per-read (below), not per-hash.
