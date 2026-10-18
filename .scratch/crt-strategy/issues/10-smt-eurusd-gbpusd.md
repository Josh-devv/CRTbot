# 10: SMT (EURUSD ↔ GBPUSD)

**What to build:** SMT divergence detection between EURUSD and GBPUSD against the three criteria (aligned with HTF bias, forms at an HTF key level, forms at a key time), and confirmation of the divergence via a follow-on valid CSD or valid order block.

**Blocked by:** 09 (H4 context layer)

**Status:** done

- [x] Divergence is flagged only when it meets all three criteria
- [x] Divergence alone does not fire a trade; confirmation via a CSD or order block is required
- [ ] Detection runs across both instruments in a multi-instrument dataset *(partial — see notes)*
- [x] Tests cover aligned and unaligned divergences

## Notes

Landed in `src/smt.ts`: `smtDivergence`, `correlatedPair`, `SmtPair`, `SmtInput`. `SmtDivergence`
and `SmtConfig` added to `src/types.ts`, plus `StrategyConfig.smt`, `Decision.smt` and
`StrategyContext.smt`. The engine takes `BacktestOptions.dataset` and reads the divergence per bar.

**Detection (§7.3, AC1).** `smtDivergence` requires, in the ruleset's order: the sweep agrees with the
HTF bias (a low sweep is bullish, a high sweep bearish); `keyLevel === sweep.level`, i.e. the swept
level *is* the context's key level; and `atKeyTime`. Then the divergence itself: the correlated
instrument must have **failed** to take its own liquidity — its nearest prior pool on the same side
(`nearestPool`, i.e. the highest low / lowest high) is still intact. If the pair undercut that pool too
the move was correlated, so nothing is reported. All three criteria are unit-tested individually, so a
regression that drops one shows up as a specific failing test.

**Confirmation (§7.3, AC2).** `confirmedBy` is computed on the same bar: `"csd"` when the sweep is
classified as a CSD, `"order-block"` when an order block was engulfed here, otherwise `null`. An
unconfirmed divergence is still reported (the shape records it) but cannot trade: `axisSystem` asks
`contextVetoes(ctx.context, ctx.smt)`, and only a divergence with `confirmedBy !== null` lifts the
premium/discount veto. Entry geometry is still an order block, so a divergence never fires a trade on
its own in either direction.

**Pairing (§7.3, AC3).** `correlatedPair(cfg, traded, dataset)` returns the first dataset series tied to
the traded instrument by a configured pair — only when `cfg.smt.enabled` and the pair is listed. Advice
never comes from an unlisted instrument; a single-instrument run never looks for divergence at all. The
pair's bars are indexed by time once (`indexByTime`), so each bar is an O(1) lookup and a pair without a
bar at that time yields no divergence rather than a misaligned comparison.

**Tests** (`test/smt.test.ts`, 10): each of the three criteria gated (plus the full textbook case), both
instruments required on the same bar, a correlated instrument taking its own liquidity, an unconfirmed
divergence still being detected, pair selection (absent/disabled/unlisted/listed) with time alignment,
and two run-level tests — no dataset means no divergence, and a dataset with no divergence is inert.
Plus three in `test/execution.test.ts`: an unconfirmed divergence does not stand in for the map, a
confirmed one does, and neither overrules the day's bias.

## Follow-ups

- **AC3 is partial.** Pair selection, time alignment and inertness are tested, but no fixture yet drives
  a divergence all the way into the decisions log: that needs a multi-week, two-instrument M15 series
  with a bullish D1 bias, an H4 key-level sweep inside a killzone, and the pair holding above its pool.
  Real data (ticket 02) is the natural source; the unit tests cover the detector itself in the meantime.
- **Same-bar confirmation.** §7.3 confirms an SMT when it is *followed by* a valid CSD or order block;
  this reads the confirmation off the sweep bar itself. A follow-on window (flag the divergence, then
  watch the next N bars) is the faithful version and is a behaviour change, not a refactor.
- **Spec signature deviation.** `BacktestOptions.dataset` rather than the spec's
  `runBacktest(dataset, cfg)`; and `StrategyConfig.smt` is optional (absent = disabled) rather than
  required. Both avoid churning every existing test's `cfg()`; unify when the CLI loads a dataset.
- **Key-level equality, not proximity.** `keyLevel === sweep.level` is exact. The ruleset lists
  "key-level *around* tolerance; SMT tolerance/threshold" as an open Tier B parameter, so a tolerance
  belongs with the same sweep when it lands.
- **DXY.** `SmtConfig.useDxy` is carried but unused (ADR-0001, spec's "off by default in v1").
- **Bias significance.** The glossary lists "showed SMT" as a way a low can be significant; that rides on
  the deferred `StructureRules.lowQualifies` injection, so SMT does not currently make a swing significant.

## Review

Two-axis review of the working diff at `187e046` (Standards + Spec).

- *Hard (all fixed):* `src/backtest.ts` import out of alphabetical order (`smtDivergence, correlatedPair`);
  `src/execution.ts` `triggerReason` typed through the indexed access `StrategyContext["smt"]` instead of
  importing `SmtDivergence`; `test/smt.test.ts` re-declared a local `"GBPUSD" | "EURUSD"` union instead of
  using the domain `Instrument`; `SmtConfig` was the only exported type without a doc comment;
  `detectSmt` mixed destructured locals with `input.` access.
- Judgement fixes applied: extracted `correlatedPair` out of `runBacktest` so the pairing rule is a
  testable unit; renamed `contextOf` to `decisionReads` (it had grown past context) and gave it a single
  input object; moved the context reprieve into `contextVetoes` as an optional parameter so the map's
  rule stays beside `biasVetoes`; fixture naming squared with the rest of the suite.
- Scope note: SMT lifting the premium/discount veto is an interpretation. §7.3 defines the divergence and
  its confirmation and §5.1 lists SMT among the triggers; using a confirmed divergence to stand in for
  premium/discount location is this ticket's reading, flagged rather than assumed.
- Spec inconsistency, not fixed here: `spec.md` L176 lists SMT under v1.1/Tier B while stories 14–15 and
  the module list (L99) place it in v1; the ticket wins.
