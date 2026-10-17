# 03: Candles, sessions & killzones

**What to build:** Aggregation of M1 bars into M15, H4, D1, W1 and MN1 candles using session-anchored boundaries; DST-correct conversion to `America/New_York` via Luxon; configurable London and New York killzones, the 3:00 AM and 9:00 AM key macros, and a news-day list. Session labels are available to the engine and visible in the decisions log.

**Blocked by:** 01 (Walking skeleton & seam)

**Status:** ready-for-agent

- [ ] M1 fixtures aggregate into correct higher-timeframe candles at session-anchored boundaries
- [ ] Session and killzone labels are DST-correct across both US DST transitions
- [ ] Killzones, key macros and news days are config-driven (no code changes to tune)
- [ ] Candle and session output is visible in the decisions log for a scenario
- [ ] Tests cover boundary cases and DST transitions
