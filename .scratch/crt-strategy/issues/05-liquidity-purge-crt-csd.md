# 05: Liquidity — purge, CRT, CSD vs purge

**What to build:** Liquidity-purge detection (wick through a level that rejects), CRT detection, and the classification of a rejection as a mere liquidity purge versus a valid CSD using the relative-DOL rule (rejection before relative DOL = purge; after = CSD).

**Blocked by:** 04 (Structure & dealing range)

**Status:** done

- [x] Liquidity purges are detected and labelled
- [x] A CRT is detected on a crafted candle range
- [x] A rejection before relative DOL is classified as a purge; a rejection after relative DOL is classified as a CSD
- [x] Results are visible in the decisions log
- [x] Tests cover purge-before-DOL and CSD-after-DOL scenarios

## Notes

Delivered `src/liquidity.ts`:

| Seam | Purpose |
| --- | --- |
| `isPurge(bar, level, side)` | A wick through a level that closes back on the origin side. Closing beyond the level is not a purge — the level failed. |
| `isCrt(bar, level, side)` | A purge whose body then continues. |
| `findPurges(bars, points)` | Every sweep of a significant level, ascending by bar. |
| `findCrts(bars, points)` | The purges that are also CRTs. |
| `classifyRejection(extreme, relativeDol, side)` | `purge` before the relative DOL, `csd` at or beyond it. |
| `liquidityEventAt(bar, index, points)` | The single-bar read attached to a decision. |

`Decision.liquidity` carries the side, swept level, wick extreme, CRT flag and classification.
`StrategyConfig` is unchanged.

**Boundary decision.** The ruleset says a rejection *before* the relative DOL is reached is a
purge, and *after* it — a CSD. "At" the DOL means the pool was taken, so equality counts as
reached (`csd`); a wick that stops short is a `purge`. Both are covered by tests in both
directions.

**Relative DOL is resolved analytically, not point-in-time.** `relativeDol` takes the nearest
significant pool beyond the swept level across the whole series, excluding the sweep itself.
A `kind` of `null` means the swept level was the deepest known liquidity. Point-in-time DOL
selection belongs with the narrative layer.

Two-axis review findings, resolved:
- **Vocabulary:** "rejection" was flagged as invented — but it is ruleset language (§7.1 uses
  "Rejection below a low / above a high"). Added a **Rejection** entry to `GLOSSARY.md` rather
  than renaming the code.
- **Duplicated Code:** `relativeDol` re-implemented the nearest-pool reduce already inside
  `drawOnLiquidity`. Extracted `nearestPool` / `extremePool` into `structure.ts` and used them
  in both.
- **Undocumented tie-break:** a bar sweeping several levels recorded only the first, silently.
  Now documented at the call site; `findPurges` still reports every sweep.

Follow-ups (not blocking):
- The decisions-log test demonstrates the `purge` case; a `csd` case in the log itself is only
  covered at the unit level.
- Multiple sweeps in one bar are reported in full by `findPurges` but summarised to one event
  on the decision.
