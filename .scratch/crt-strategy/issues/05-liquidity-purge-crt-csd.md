# 05: Liquidity — purge, CRT, CSD vs purge

**What to build:** Liquidity-purge detection (wick through a level that rejects), CRT detection, and the classification of a rejection as a mere liquidity purge versus a valid CSD using the relative-DOL rule (rejection before relative DOL = purge; after = CSD).

**Blocked by:** 04 (Structure & dealing range)

**Status:** ready-for-agent

- [ ] Liquidity purges are detected and labelled
- [ ] A CRT is detected on a crafted candle range
- [ ] A rejection before relative DOL is classified as a purge; a rejection after relative DOL is classified as a CSD
- [ ] Results are visible in the decisions log
- [ ] Tests cover purge-before-DOL and CSD-after-DOL scenarios
