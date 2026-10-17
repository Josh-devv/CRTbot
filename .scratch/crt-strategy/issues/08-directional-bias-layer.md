# 08: Directional bias layer (M/W/D)

**What to build:** The top-down directional-bias layer (Monthly → Weekly → Daily) built from structure and narrative, which gates the direction of the trades the engine is allowed to take. The daily bias governs the day.

**Blocked by:** 07 (First real trade — execution & risk)

**Status:** ready-for-agent

- [ ] Bias is derived top-down (Monthly → Weekly → Daily) and the daily bias governs the day
- [ ] Trades against the bias are rejected with a clear reason
- [ ] Bias output is visible in the decisions log per day
- [ ] Scenario tests assert bullish, bearish and no-bias cases
