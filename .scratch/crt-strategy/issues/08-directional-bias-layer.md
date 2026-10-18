# 08: Directional bias layer (M/W/D)

**What to build:** The top-down directional-bias layer (Monthly → Weekly → Daily) built from structure and narrative, which gates the direction of the trades the engine is allowed to take. The daily bias governs the day.

**Blocked by:** 07 (First real trade — execution & risk)

**Status:** done

- [x] Bias is derived top-down (Monthly → Weekly → Daily) and the daily bias governs the day
- [x] Trades against the bias are rejected with a clear reason
- [x] Bias output is visible in the decisions log per day
- [x] Scenario tests assert bullish, bearish and no-bias cases

## Notes

Landed in `src/bias.ts`: `structuralBias`, `resolveBias`, `biasSnapshot`, `biasVetoes`.
`BiasDirection = "bullish" | "bearish" | "none"` added to `src/types.ts`, plus `Decision.bias`
and `StrategyContext.bias`.

**Reading a timeframe (§3.1.2).** Bullish = price breaks highs and rejects lows; bearish = the
converse. A swing counts as broken once a bar **closes** beyond it (the "price cannot close
twice below the lows" rule), and whichever side was broken most recently sets the read. A pivot
only becomes usable `swingWidth` bars after it forms, so the read never looks ahead. Anything
else is `"none"` — the hypothesis is dumped rather than guessed.

**Top-down refinement (§3).** Each of MN1, W1, D1 is aggregated from the execution series with
`aggregate`, read independently, then resolved: the daily read governs, but a higher timeframe
pointing the other way dumps it (`resolveBias`). This is the first production consumer of the
ticket-03 `aggregate`.

**Gating.** `axisSystem` calls `biasVetoes` after the killzone check; an opposed setup is
declined with "against the daily bias". **A neutral (`"none"`) bias does not veto** — a
judgement call for Tier A: with no directional read there is nothing to trade against, whereas
making `"none"` a stand-down would block every series shorter than a few months. Ticket 11
(exception protocols) is where a missing bias becomes a stand-down.

**Decisions log.** The engine reads the bias once per session-day rollover, from structure up to
and including that bar, and stamps it on every decision that day (AC3).

**Tests** (`test/bias.test.ts`, 7): bullish/bearish/none structural reads; the `resolveBias`
table covering weekly and monthly vetoes and the no-daily-read case; a `biasSnapshot`
end-to-end bullish read across M/W/D; a no-bias snapshot; the veto rules. Plus two in
`test/execution.test.ts`: every decision carries the bias, and `axisSystem` refuses an opposed
long while allowing it under a neutral bias.

## Follow-ups

- Tier B is absent by design: the Quarterly Shift framework and seasonal tendencies (§3.1.1) and
  market profiles (§3.1.3). Until they land, bias is structure-only, so it is a *veto*, not the
  full hypothesis.
- `biasSnapshot` re-aggregates `bars.slice(0, i + 1)` at each day rollover — O(days × bars).
  Fine for the synthetic fixtures; a running aggregation is needed before a real multi-year run.
- The narrative component (§3.2: active dealing range → key levels → origin-to-destination) is
  not represented in the bias layer yet; ticket 09's H4 context carries the range and DOL.
- The key-level predicate for significant highs (`StructureRules.testedKeyLevel`) is still
  injected by nobody — ticket 09.
