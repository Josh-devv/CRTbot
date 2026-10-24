# 19: High-probability order-block filter in execution

**What to build:** `scoreOrderBlock` (ticket 06, spec §6) is implemented and tested but never
consumed: the execution layer takes any block that clears the bias/context vetoes. Add a
config-gated high-probability filter that only arms setups when the four conditions hold —
bias-aligned, premium/discount location, formed at a key time, tested at a key time.

**Blocked by:** nothing.

**Status:** ready-for-agent

## Acceptance criteria

- [ ] Config flag (default off) that gates entries on `scoreOrderBlock(...).highProbability`.
- [ ] The four conditions are fed from decision-time data: bias direction, the block's open vs
      the context dealing range, the block candle's own time, the confirmation bar's key time.
- [ ] With the flag off: byte-identical to today (golden run unaffected).
- [ ] Fixtures: a block that passes all four enters; each single condition failing rejects with
      its reason in the decisions log.

## Notes

- "Tested at a key time" is read at the confirmation/fill bar in the replay (the block is
  retested when the limit fills); document whichever reading is used in the code.
- Ticket 20 measures whether the filter helps; this ticket only makes it available.
