# 15: Domain docs — glossary & ADRs

**What to build:** A root `GLOSSARY.md` seeded from the ruleset's terminology, plus ADRs recording the decisions that shape the project: instruments are GBPUSD/EURUSD only (indices dropped), the TypeScript/Node + hand-rolled engine + single-seam architecture, and the fixed-3R target that supersedes the public 50 %/opposing-end targets.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] `GLOSSARY.md` exists with the Axis System vocabulary
- [x] An ADR records that instruments are GBPUSD/EURUSD only (indices dropped)
- [x] An ADR records TypeScript/Node, the hand-rolled engine, and the single backtest seam
- [x] An ADR records that the fixed-3R target supersedes the public 50 %/opposing-end targets

## Notes

Wrote root `GLOSSARY.md` — organised by layer (structure & narrative, liquidity, mechanics,
divergence, time, risk, domain objects), opinionated `_Avoid_` lists throughout, no
implementation detail. Three ADRs in `docs/adr/`:

- `0001-fx-only-gbpusd-eurusd.md`
- `0002-typescript-hand-rolled-single-seam.md`
- `0003-fixed-3r-target-supersedes-public-targets.md`

Cross-referenced the glossary's domain objects against `src/types.ts`: `Instrument`, `Bar`,
`BarSeries`, `Trade`, `Decision`, `EquityPoint`, `configHash` all match — no drift.

**Vocabulary tension surfaced (needs a decision):** the code uses both `Bar` (the OHLC data
unit) and `candle` — `src/candles.ts` produces `Bar`s, and `Decision.candle` is actually a
`{ timeframe, time }` bucket, not a bar. To stop "candle" meaning two things, the glossary
now defines **Bar** (the data unit) and **Candle bucket** (the session-aligned period)
separately. Follow-up: rename `Decision.candle` → `Decision.bucket` (and `contextOf`'s
field) so the code matches the vocabulary.
