# 03: Candles, sessions & killzones

**What to build:** Aggregation of M1 bars into M15, H4, D1, W1 and MN1 candles using session-anchored boundaries; DST-correct conversion to `America/New_York` via Luxon; configurable London and New York killzones, the 3:00 AM and 9:00 AM key macros, and a news-day list. Session labels are available to the engine and visible in the decisions log.

**Blocked by:** 01 (Walking skeleton & seam)

**Status:** done

- [x] M1 fixtures aggregate into correct higher-timeframe candles at session-anchored boundaries
- [x] Session and killzone labels are DST-correct across both US DST transitions
- [x] Killzones, key macros and news days are config-driven (no code changes to tune)
- [x] Candle and session output is visible in the decisions log for a scenario
- [x] Tests cover boundary cases and DST transitions

## Notes

Delivered `src/time.ts` (`DEFAULT_SESSION_CONFIG`, window/session/killzone helpers,
`sessionDayStart`/`weekStart`/`monthStart`) and `src/candles.ts` (`bucketStart`, `aggregate`);
`Decision` now carries `session`/`killzone`/`candle`, wired in `src/backtest.ts`.

Two-axis review (2021-xx) surfaced two real defects, both fixed:
- **H4 grid drifted on the DST transition day.** Bucketing by elapsed ms from the day
  start put spring-forward candles at 01:00/06:00/10:00/14:00 local instead of the
  01:00/05:00/09:00 grid. `bucketStart` now advances sub-day buckets on the *wall clock*
  inside the configured timezone. Regression test: "H4 buckets stay on local clock time
  through the spring-forward transition".
- **Candle output never reached the decisions log.** `aggregate`/`bucketStart` had test-only
  consumers. `Decision.candle` now records the M15 execution candle (the Axis System fixes
  execution at M15). Test: "the execution candle is visible in the decisions log".

Scope note: the max-one-trade-per-day rollover moved from UTC midnight to the configured
session day (`sessionDayStart`). Ticket 03 introduces the session boundary; formalising the
risk rule against it belongs to the risk ticket, so this is a deliberate, minimal coupling.

Follow-ups (not blocking):
- `aggregate` has no production consumer yet — the strategy layers (H4 context / M15
  execution) will consume it.
- W1/MN1 aggregation is exercised via `bucketStart` only; no multi-week `aggregate` fixture.
