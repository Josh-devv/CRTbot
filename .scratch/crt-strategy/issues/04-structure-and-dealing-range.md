# 04: Structure & dealing range

**What to build:** The engine derives swings, significant highs and lows (per the ruleset definitions), the active dealing range, premium/discount positioning, and the long-term and short-term DOL. All of it is surfaced per scenario in the decisions log.

**Blocked by:** 03 (Candles, sessions & killzones)

**Status:** ready-for-agent

- [ ] Significant highs and lows are identified per the defined rules (high: tested an HTF key level or led to a low being broken; low: purged liquidity, reacted to a key level, filled an FVG, or showed SMT)
- [ ] The active dealing range is selected from the most recent expansion swing
- [ ] Premium/discount classification of a given price is correct
- [ ] Long-term and short-term DOL are identified and visible in the decisions log
- [ ] Scenario fixture tests assert range, premium/discount and DOL
