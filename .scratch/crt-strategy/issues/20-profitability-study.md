# 20: Profitability study — where the edge is, and which filters find it

**What to build:** The empirical answer to "is the system profitable, and under which
configuration?" — not more code than the study needs.

Phase 1 (baseline slicing, no engine change): one real run over a long range, then slice its
trades/decisions by every signal available at decision time (session and killzone, block
behaviours and propulsion, expansion verdict, weekday, premium/discount, SMT, liquidity kind,
macro, bias) and print n / winRate / avgR per slice. Find where positive expectancy concentrates.

Phase 2 (A/B): re-run with the tickets 17–19 switches (trigger strictness, confirmations,
expansion gate, high-probability filter), singly and combined, on the same data; cost
sensitivity on the best variant.

**Blocked by:** nothing for phase 1; phase 2 needs 17–19.

**Status:** ready-for-agent

## Acceptance criteria

- [ ] Phase 1 table recorded in the Notes (slices with n ≥ 100 only, so the numbers mean
      something).
- [ ] Phase 2: the baseline vs each switch vs the best combination, same range, with
      `expectancyR`, `profitFactor`, trade count and `maxDrawdown` side by side.
- [ ] Cost sensitivity (optimistic/mid/pessimistic) on the best variant.
- [ ] A one-paragraph honest verdict: profitable or not, at what confidence, and what is left
      unexplored.

## Notes

- The baseline 25-year run (ticket 16): 3,606 trades, winRate 0.240, expectancyR −0.343,
  profitFactor 0.62, maxDrawdown 1.0 — the number this study has to move.
- Slicing needs the decisions log (`action: "enter"` decisions carry session, killzone,
  expansionTest, structure, liquidity, orderBlocks, macro, bias) matched to trades by time.

### Phase 1 — baseline slices (10y GBPUSD 2015–2024, 245,604 bars)

1,673 setups armed, 1,584 filled. Baseline win 23.3%, avgR −0.411, netR −651.6.

- Risk width (stop distance, pips): `<1` n=297 −1.343R · `1–2` n=308 −0.640 · `2–3` n=235
  −0.205 · `3–5` n=298 +0.016 · `5–8` n=261 −0.054 · `8–12` n=119 −0.092 · `>=12` n=66 +0.201.
  `risk>=2` n=979 −0.057; `risk>=3` n=744 −0.010. The whole deficit lives under 2 pips.
- Block part: body n=726 −0.717 vs wick n=858 −0.153 (the gap mostly collapses under the floor).
- Behaviour: every traded block had purged (purge-only n=594, purge+generate n=990).
- Session: London 1,485 @ −0.433; New York 99 @ −0.093. Fills outside a killzone: n=132,
  win 35.6%, +0.083 (selection — see ticket 21's refutation).
- Expansion verdict at arm time: london 167, newYork 0, neither 1,417. The NY verdict does fire
  at killzone bars (144 in 6 months of 2024) but never at arms — the asian-range exception
  shadows it (same 1.5× threshold, §8.3).
- SMT never fired; macro was always "none".
- Cost geometry: wins average +2.28R, losses −1.23R → true breakeven win rate ≈35%, not 25%.

### Phase 2 — A/B matrices

- 10y, 8 variants (scratch-ab.ts): baseline V0 −0.411/PF 0.564; risk>=2 −0.078/PF 0.901;
  risk>=3 −0.046/PF 0.941; **risk>=3 + purgeOnly −0.042/PF 0.946/netR −45.8/maxDD 0.594**;
  the four `fillOutsideKillzoneOnly` variants −0.49..−0.58 (refuted as an intervention).
- 5y, 10 variants (scratch-ab2.ts): baseline 748 @ −0.336; risk>=3 + purgeOnly 516 @ −0.075;
  + requireCrt (current candle only) 28 @ +0.232 (PF 1.338); requireCrt alone 60 @ −0.224;
  killzone sub-window variants no better than the unfiltered killzone.
- CRT lookback matrix (scratch-ab3.ts): 5y 2020–2024 `risk>=3 + purgeOnly + requireCrt` lookback
  0/3/6/12/24 → 28/+0.232, 44/+0.178, 46/+0.124, 46/+0.124, 47/+0.098. Out-of-sample 2015–2019:
  21/−0.204, 33/−0.169, 36/−0.242, 39/−0.218, 39/−0.218. **Refuted.**
- 1R probe (Nov–Dec 2024): baseline 3R 17 trades 29.4% −0.029 vs baseline 1R 17 trades 47.1%
  −0.249; filtered 3R 8 trades 62.5% +1.269 vs filtered 1R 8 trades 87.5% +0.555. Fixed 3R stays.

### Verdict (honest, as of this study)

No robust edge has been found in the entry filters or in the CRT trigger. The best measured
configuration (risk>=3 + purgeOnly) is flat over 10 years (−0.04R/trade, PF 0.95) and exactly
flat on 2015–2019 (−0.002R); the improve-in-2020–24 / worsen-in-2015–19 pattern of the CRT gate
is what a small-sample artefact looks like. Unexplored: ticket 17's real trigger→confirmation
ordering (key-level reaction, FVG, MSS — the requireCrt probe was not that), ticket 19's
high-probability order-block score, and any change to the entry mechanic itself (the engine
still buys every qualifying block open at 3R). Cost sensitivity on V3 was not run: at ~0R gross
expectancy it cannot be positive under any of the three cost settings.
