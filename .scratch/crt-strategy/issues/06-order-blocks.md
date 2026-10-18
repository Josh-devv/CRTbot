# 06: Order blocks

**What to build:** Order-block detection using the full definition — a qualifying behaviour (purging liquidity, filling liquidity, or generating liquidity) **and** engulfment — plus body-vs-wick resolution, multi-candle grouping, propulsion blocks, and high-probability scoring (HTF-bias alignment, premium/discount location, formed at a key time, tested at a key time).

**Blocked by:** 05 (Liquidity — purge, CRT, CSD vs purge)

**Status:** done

- [x] An order block requires both a qualifying behaviour and engulfment; missing either means it is not an order block
- [x] Body-vs-wick resolution matches how price closes through the candle
- [x] Consecutive candles closed through as a whole are grouped into a single order block
- [x] Propulsion blocks (an order block formed by testing a prior order block) are recognised
- [x] High-probability scoring applies the four conditions

## Notes

Delivered `src/orderblocks.ts`:

| Seam | Purpose |
| --- | --- |
| `engulfment(bars, engulfing, target, direction)` | How the engulfing candle closes through the target: `body`, `wick`, or `null`. |
| `groupStart(bars, engulfing, direction)` | The first candle of the consecutive run cleared as a whole. |
| `zoneFor(...)` | The block's price zone — the run's bodies, or the whole candles when the close clears the wick. |
| `behavioursAt(bars, index, rules)` | The qualifying behaviours a candle shows: `purge`, `generate`, `fill`. |
| `testsPrior(...)` | Whether a run traded into an earlier block → propulsion. |
| `findOrderBlocks(bars, rules)` | Every valid order block in the series. |
| `scoreOrderBlock(block, rules)` | The four high-probability conditions. |

`Decision.orderBlocks` carries the blocks confirmed on that bar (keyed by `engulfedBy`).

**Behaviour + engulfment are both required (AC1).** `findOrderBlocks` requires an engulfed
run *and* at least one qualifying behaviour; either missing yields nothing.

**Body-vs-wick (AC2).** `engulfment` returns `"body"` when the close clears only the body
(top/bottom = `max`/`min` of open and close) and `"wick"` when it clears the whole candle.
`zoneFor` then uses the body union or the full candle union accordingly.

**Multi-candle grouping (AC3).** A run of consecutive opposite-colour candles the engulfing
candle closes through as a whole becomes one block; `candles` counts the run.

**Propulsion (AC4).** A block whose source run trades into an earlier block's zone is flagged
`propulsion`.

**Scoring (AC5).** All four conditions are injected (HTF bias → ticket 08; premium/discount →
ticket 04; key times → tickets 03/09). Unsupplied predicates count as `false`, so a block is
high-probability only when every layer agrees.

**Decisions taken during implementation:**
- A source candle must be **opposite in colour** to the trade (down candles form a bullish
  block). Without this, a run of same-coloured candles each "engulfs" the previous, producing
  spurious blocks.
- Overlapping groups are skipped: a later, wider engulf of already-consumed candles is the
  same block, not a second one (greedy, left to right).
- `generate` is "a CRT whose own liquidity is later taken" — a purge whose body continued
  **and** that a later bar swept beyond.

Follow-ups (not blocking):
- The `purge`/`generate` behaviours are exercised through the integration test; the unit
  fixtures drive behaviour via the injected `testedKeyLevel` (`fill`) to stay price-only.
- Greedy grouping means the earliest-engulfed run wins when two engulfing candles overlap.
