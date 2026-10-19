# 02: Real market data ingestion

**What to build:** An `ingest` CLI command that reads HistData M1 CSV files for GBPUSD and EURUSD, validates them (gaps, duplicates, OHLC consistency, non-positive prices), writes Parquet partitioned by symbol and year with UTC timestamps, and lets the backtester load a real date range and run.

**Blocked by:** 01 (Walking skeleton & seam)

**Status:** done

- [x] Ingesting HistData M1 files for GBPUSD and EURUSD produces Parquet data
- [x] Invalid rows (duplicates, OHLC violations, non-positive prices) are detected and reported, not silently stored
- [ ] A backtest runs over a real multi-year date range for both instruments — the path runs real data (2024-01: 17 trades, 45s), but the multi-year range is gated by the engine's read pattern; ticket 16 owns that evidence
- [x] Stored timestamps are UTC and round-trip correctly
- [x] Tests cover the validation rules with crafted bad input

## Notes

Landed in the new `src/ingest.ts` (`parseHistDataCsv`, `instrumentFromFileName`, `ingestHistDataFiles`, `loadBars`, `loadSeries`, `DEFAULT_DATA_DIR`), wired into `src/cli.ts` as `crtbot ingest <csv...> [--data <dir>]` and a real-data `backtest` path (`--instrument GBPUSD|EURUSD|both`, `--from`, `--to`, `--data`); the demo path (no `--from`) is unchanged. `EXECUTION_TIMEFRAME` moved to `candles.ts` so the data layer does not import the engine, and `loadSeries` reads each stored year on its own and aggregates it to M15, so a multi-year range never sits in memory at once.

**The store, for real.** All 50 downloaded HistData files (GBPUSD + EURUSD, 2000–2024) ingest to `data/parquet/<INSTRUMENT>/<year>.parquet`: **16,583,045 bars in 3.5 minutes, 226 MB** (GBPUSD 117.9 MB, EURUSD 108.5 MB). Row counts run 322k–373k per year; every file reports **60 duplicated minutes** — HistData writes an hour's rows twice, seen identically in every report — and zero malformed, zero bad-price, zero out-of-order rows. Gap summaries (~150k–199k missing minutes a year, largest stretch ~3–5.6k) match weekends and holidays; no file needed more than the sanity read.

**Memory shaped the batch design.** Two earlier batch builds died at the 2 GB heap: first accumulating every bar before writing, then keeping every file's parsed bars in the report. The final shape parses one file at a time, merges it into its year file(s), and keeps only counts — and the merge replaces by timestamp, so re-ingesting a file (or a corrected one) is idempotent. HistData timestamps are EST with no DST, a fixed UTC-5 offset; `toUtcMs` shifts them once and rejects dates the calendar rolls over (31 February, hour 25) instead of silently normalising them. `instrumentFromFileName` accepts both yearly (`…_M1_2024.csv`) and monthly (`…_M1_202401.csv`) exports; monthly zips are the only split HistData offers for older years, so refusing them would have been a data-shaped decision rather than a code one.

**`dataHash` closed its loop here.** Ticket 01 deferred `BacktestResult.dataHash` and ticket 13 recorded it still missing: the result now carries a SHA-256 over the instrument's bars plus any dataset series SMT measures against, `RunSummary`/`formatReport` print it beside `configHash`, and the determinism test asserts stability and bar-sensitivity. Spec §Determinism asked for both hashes; saved reports now certify their dataset too.

**Spec deviations recorded in `spec.md`.** The Implementation Decisions section now states the route actually built: hyparquet reads Parquet directly (no DuckDB), layout `data/parquet/{INSTRUMENT}/{year}.parquet`, columns `(time, open, high, low, close)` with `time` as INT64 UTC ms, and — against the old "no fixed offsets" line — the five-hour EST shift happens **once, at ingest**, with no fixed offsets in the trading logic.

**The real run works but the engine cannot yet scale.** `backtest --instrument GBPUSD --from 2024-01-01 --to 2024-01-31` on the real store returns a report: 2116 M15 bars, 17 trades, expectancyR −0.319 (winRate 0.235, profitFactor 0.63, London 15 trades). It takes 45s — 22.5s loading the two instruments, 28.8s in the run — and the shape is quadratic: a year extrapolates to ~75 min. That is ticket 16's subject; the numbers above are its baseline and this run is its golden regression (`configHash` + `dataHash` + stats must reproduce).

## Follow-ups

- **The replay loop is quadratic and Luxon-bound** (ticket 16, written from this work): `biasSnapshot` per session day, `aggregate(prefix, "MN1")` per month, `aggregate(prefix, "H4")` per bar in `context.ts`, `findSignificantPoints(pairPrefix)` per bar in `smt.ts`, and ~370µs/bar of Luxon in `loadSeries`'s M1→M15 fold. Profile in ticket 16.
- **One fixture candle is OHLC-inconsistent.** `[9.1, 9.5, 9.2, 9.4]` (low above open) appears in `test/execution.test.ts:56` and the CLI's `SET_UP`; `parseHistDataCsv` correctly rejects that shape, so the crafted ingest fixture uses a corrected low. The two fixtures should be fixed repo-wide (they predate validation), but nothing else depends on it.
- **Cross-file duplicate policy is "replace, don't count."** Within a file, duplicates are rejected and counted; across files (or a re-ingest) the incoming bar replaces the stored one by timestamp, and the report counts nothing. Deliberate — it makes corrected re-downloads safe — but worth a note if a user ever overlaps two different sources.
- **`realConfig` arms SMT by default** (the demo config leaves it off): real runs trade with §7.3 divergence available, which the ticket did not ask for but is the point of having both instruments stored. `--sensitivity` likewise extends to stored runs. Both accepted in review.
- **Volume is dropped** and `Bar` has no field for it; if a future adapter needs HistData tick counts they must be re-read from the CSVs.
- **GLOSSARY.md does not carry the ingestion terms yet** (store, year file, replace-by-timestamp); alongside ticket 14's vocabulary follow-up.

## Review

Two-axis review of the working tree at `cc977ec` (Standards + Spec), parallel sub-agents, reported separately.

- *Standards (fixed):* `IngestIssue`'s doc comment was a copy of `EXAMPLE_LIMIT`'s; the module doc cited a non-existent "(US11)" story — now "(ticket 02)"; nine over-length lines rewrapped across `ingest.ts`, `cli.ts` and the test.
- *Standards (fixed):* extracted `yearRange`, an `others()` dataset helper, one `emit()` for the out/raw output blocks, one `--data` read in `ingestCommand`; `day` → `dayBound` (it returns an epoch boundary); `backtestCommand` no longer claims a promise it never returns.
- *Standards (fixed, ADR-0002):* `ingest.ts` importing `EXECUTION_TIMEFRAME` from `backtest.ts` made the data layer depend on the engine; the constant lives in `candles.ts` now.
- *Spec (fixed):* `loadBars` swallowed **every** read error; only `ENOENT` is "not ingested yet" now, and a corrupt year file throws (regression test writes junk over a year file).
- *Spec (fixed):* invalid calendar dates were silently rolled over by `Date.UTC`; `toUtcMs` round-trips through `Date` and rejects 31 February / hour 25 as malformed, with crafted rows in the validation test.
- *Spec (fixed):* monthly HistData filenames (`…_M1_202401.csv`) were refused; the pattern accepts `\d{4,6}` now, with an assertion.
- *Spec (fixed):* `dataHash` was still deferred here from tickets 01/13 and §Determinism; implemented (see Notes).
- *Spec (fixed):* the spec's Implementation Decisions still named DuckDB, the old layout and "no fixed offsets"; updated to the route built (see Notes).
- *Spec (accepted, recorded above):* SMT armed for real runs; `--sensitivity` extended to stored runs; cross-file replace-not-count dedupe; volume dropped.
- *Spec (deferred, recorded above):* AC3's multi-year run — the path is proven on real data, the range waits on ticket 16.
