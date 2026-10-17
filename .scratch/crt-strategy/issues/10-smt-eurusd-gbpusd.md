# 10: SMT (EURUSD ↔ GBPUSD)

**What to build:** SMT divergence detection between EURUSD and GBPUSD against the three criteria (aligned with HTF bias, forms at an HTF key level, forms at a key time), and confirmation of the divergence via a follow-on valid CSD or valid order block.

**Blocked by:** 09 (H4 context layer)

**Status:** ready-for-agent

- [ ] Divergence is flagged only when it meets all three criteria
- [ ] Divergence alone does not fire a trade; confirmation via a CSD or order block is required
- [ ] Detection runs across both instruments in a multi-instrument dataset
- [ ] Tests cover aligned and unaligned divergences
