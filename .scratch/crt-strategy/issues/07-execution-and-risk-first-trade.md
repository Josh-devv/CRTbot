# 07: First real trade — execution & risk

**What to build:** The execution layer — entry triggers (key-level reaction, liquidity purge, SMT divergence), entry confirmations (order block first, then FVG formation, then MSS), and order placement (entry at the order-block open, stop at the order-block extreme, fixed 3R target) — combined with the risk rules (maximum one trade per day, killzones only, no moving stop/target, no scaling). The result is the first verified CRT trade end-to-end.

**Blocked by:** 06 (Order blocks)

**Status:** ready-for-agent

- [ ] A crafted CRT scenario produces exactly one trade with the expected entry, stop and target
- [ ] The target is always exactly 3R from entry; the stop is at the order-block extreme
- [ ] No more than one trade is taken per day
- [ ] No trade is taken outside a killzone
- [ ] The stop and target are never modified during a trade
- [ ] The decisions log states the rejection reason when no trade is taken
