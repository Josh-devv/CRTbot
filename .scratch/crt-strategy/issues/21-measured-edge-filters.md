# 21: Measured edge filters — risk floor, purge-only, block part, fill timing

**What to build:** The four filters the ticket-20 phase-1 study (10 years, GBPUSD, 1,584 filled
arms) says carry the edge, each config-gated and off by default so the ticket-16 golden run is
untouched:

1. `execution.minRiskPips` — skip setups whose stop distance is under N pips. The study's
   decisive finding: blocks under 2 pips of risk (605 of 1,584 trades) carry **-596R of the
   -652R net**. `risk >= 3` alone takes the run from -0.411R to -0.010R expectancy per trade.
2. `execution.purgeOnly` — only blocks whose behaviour is exactly `["purge"]` (no liquidity
   generation). `wick + risk>=3 + purge only`: +0.044R on n=241.
3. `execution.blockPart` — only body or only wick zone resolution (data: body -0.717R vs wick
   -0.153R, though most of that gap collapses once the risk floor is applied).
4. `execution.fillOutsideKillzoneOnly` — resting limits may not fill while inside a killzone.
   The raw slice: fills that happened outside the killzone: n=132, win 35.6%, +0.083R;
   at `risk>=3`: n=82, win 41.5%, **+0.444R**.

**Blocked by:** nothing.

**Status:** done

## Acceptance criteria

- [x] `ExecutionFilters` in `types.ts`, wired through `StrategyConfig.execution?`, consumed by
      `axisSystem(filters)` (block selection + risk floor) and the engine (fill timing).
- [x] All four filters default off; ticket-16 behaviour byte-identical when unset (golden run
      unaffected; full suite green).
- [x] Rejection reasons recorded in the decisions log, so a filtered run explains itself.
- [x] Per-filter fixture tests: rejected and accepted cases for each.
- [x] A/B results recorded in the Notes (ticket 20 phase 2).

## Notes

- The A/B matrix and the winner's longer run are ticket 20 phase 2.
- Study context: the true breakeven win rate under the engine's cost model is ~35%, not 25% —
  R is normalised to the adverse-filled distance while the spread is charged per side, so wins
  average +2.28R and losses -1.23R.
- **Verdicts** (10y 2015–2024 / 5y 2020–2024 / out-of-sample 2015–2019):
  - `minRiskPips` is the only robust lever. `3` takes 10y from -0.411R to -0.046R (n=1478) and
    5y from -0.336R to -0.075R (n=516); `2` is close; `>=5` adds nothing.
  - `purgeOnly` interacts positively with the risk floor on 10y (`risk>=3 + purgeOnly`: n=1100,
    win 28.2%, -0.042R, netR -45.8, PF 0.946, maxDD 0.594) but is negative alone (5y -0.319R).
    Keep as an option, not a default.
  - `blockPart` adds nothing once the risk floor is on (wick alone was only a proxy for wider
    blocks).
  - `fillOutsideKillzoneOnly` is **refuted as an intervention**. As a gate every fill becomes
    "outside" and results get worse (10y: V4 -0.527, V5 -0.490, V6 -0.488, V7 -0.575). The
    +0.444R slice that motivated it was selection, not treatment. Implemented because it is a
    real mechanism; not recommended.
- The best measured combination (risk>=3 + purgeOnly) is flat, not profitable: 10y -0.042R,
  5y -0.075R, 2015–2019 -0.002R.
- `requireCrt` / `crtLookbackBars` were added here as the ticket-17 trigger probe; measured in
  ticket 17's Notes and refuted out-of-sample.
