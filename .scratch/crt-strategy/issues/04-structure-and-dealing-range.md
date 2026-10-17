# 04: Structure & dealing range

**What to build:** The engine derives swings, significant highs and lows (per the ruleset definitions), the active dealing range, premium/discount positioning, and the long-term and short-term DOL. All of it is surfaced per scenario in the decisions log.

**Blocked by:** 03 (Candles, sessions & killzones)

**Status:** done

- [x] Significant highs and lows are identified per the defined rules (mechanical branches: a high that led to a low being broken; a low that purged a prior low — plus injected qualifiers)
- [x] The active dealing range is selected from the most recent expansion swing
- [x] Premium/discount classification of a given price is correct
- [x] Long-term and short-term DOL are identified and visible in the decisions log
- [x] Scenario fixture tests assert range, premium/discount and DOL

## Notes

Delivered `src/structure.ts`:

| Seam | Purpose |
| --- | --- |
| `findSwings(bars, width)` | Fractal pivots (a high exceeding `width` bars either side). |
| `findSignificantPoints(bars, rules)` | Structural significance: a high that led to a low being broken, a low that purged a prior low. |
| `dealingRange(points, uptoIndex)` | The active range — the most recent expansion leg. |
| `classifyPrice(price, range)` | `premium` / `discount` / `equilibrium` against the range midpoint. |
| `drawOnLiquidity(points, range, price, uptoIndex)` | Nearest pool in the delivery direction, plus the extreme beyond it. |
| `structureSnapshot(points, index, price)` | The read recorded on `Decision.structure`. |

`StrategyConfig.structure.swingWidth` (default 2) makes pivot sensitivity configurable.
`Decision.structure` carries the range, premium/discount position and both DOLs.

**Deferred by design (agreed before implementation).** Ticket 04's AC1 defines significance
partly in terms of concepts owned by later tickets, so those criteria are injected as
predicates and the price-only core ships now:

- `testedKeyLevel` — "tested an HTF key level" → filled by ticket 09 (H4 context).
- `lowQualifies` — "purged liquidity / reacted to a key level / filled an FVG / showed SMT"
  → filled by tickets 05 and 10. The price-only fallback already covers the common purge
  case (a low taking out any prior *swing* low, not merely a prior significant one).

`dealingRange` takes the last significant high and the last significant low. Because
significant points alternate, those two are always the endpoints of the most recent leg —
this is documented on the function and covered by
"the dealing range follows the most recent leg whatever its order".

Two-axis review findings, resolved:
- **Hard defect:** an earlier careless edit had fused `Bar` and `BarSeries` onto one line in
  `src/types.ts`. Fixed.
- **Duplicated Code:** `lastLowBefore` duplicated `lastAtOrBefore`. Collapsed to one scan.
- Test name drifted from the glossary ("fractal" → "local turning point").

Follow-ups (not blocking):
- `findSignificantPoints` scans forward per high (`bars.slice(...).some(...)`), O(bars ×
  highs). Fine at M15 scale; revisit if the series grows.
- `structureSnapshot` returns `null` while `Decision.structure` is optional-`undefined`; the
  `?? undefined` at the seam bridges the two. Consider one representation.
- DOL tie-breaking when pools sit equidistant is still an open question (ruleset §15).
