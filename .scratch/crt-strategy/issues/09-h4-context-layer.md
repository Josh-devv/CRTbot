# 09: H4 context layer

**What to build:** The intermediate context layer — the H4 bias-aligned dealing range, the key level within it, and the CRT — constructed only from the London open onward (never pre-built the night before).

**Blocked by:** 08 (Directional bias layer)

**Status:** done

- [x] The context dealing range is aligned to the HTF bias direction
- [x] A key level and a CRT are identified within the dealing range
- [x] Context is only built from the London open (no pre-built night-before context)
- [x] Tests assert aligned vs misaligned scenarios

## Notes

Landed in `src/context.ts`: `contextSnapshot`, `contextVetoes`, `CONTEXT_TIMEFRAME = "H4"`.
`ContextSnapshot` added to `src/types.ts`, plus `Decision.context` and `StrategyContext.context`.
`sessionWindowStart` added to `src/time.ts` — the London open of the session day a bar belongs to.

**Building the map (§4).** `contextSnapshot(bars, index, cfg, bias)` returns null, then draws the
map: aggregate the execution series to H4 (`aggregate`), take the significant points, and read the
dealing range off the most recent expansion leg. `position` is the current bar's close against the
range equilibrium; `keyLevel` is the endpoint the bias trades from — the discount low for a bullish
bias, the premium high for a bearish one; `aligned` is that pairing. So "the dealing range aligned
to the bias direction" (AC1) is expressed as *which half of the range the bias is allowed to trade*,
which is the part of §4.2 the execution layer can act on.

**The London-open gate (§4.4).** Nothing is built before the bar's own session day London open —
`sessionWindowStart(bar.time, "london", cfg.session)` resolves the 02:00 NY open in the session
timezone, so a bar between 17:00 and 24:00 NY resolves to the *next* day's open and yields no
context. That is the AC3 "no night-before context" rule, DST-correct.

**CRT within the range (AC2).** The CRT is the current H4 bar's sweep **only when it took a level
that frames this dealing range and its body continued away from that level** — a purge elsewhere in
the H4 history, or one that closed beyond the level, is not this range's CRT.

**Gating.** `contextVetoes` mirrors `biasVetoes`: `axisSystem` runs
`biasVetoes(ctx.bias, block.direction) ?? contextVetoes(ctx.context)` as one gate, so a bullish
setup is taken in discount and declined in premium with "not aligned with the dealing range". No
context (before the London open) vetoes nothing, matching §4.4's "do nothing until the London open".

**Tests** (`test/context.test.ts`, 6): the London open resolved in New York time; no bias means no
context; the same bars 8h apart yield context after the open and none the night before; the range,
equilibrium and premium/discount alignment for bullish and bearish; the key level per bias and the
CRT on the sweeping bar (and its absence without a sweep); the veto helper's three cases. Plus one
in `test/execution.test.ts`: `axisSystem` stands down on a misaligned map and trades an aligned one.

## Follow-ups

- The range itself is framed by the most recent expansion leg and is *bias-agnostic*; only the key
  level and the alignment flag carry the direction. Constructing a per-bias range (dropping framing
  legs that contradict the bias) is a Tier C refinement — the spec is silent on the selection method.
- `crt` reads the latest H4 bar only. There is no "CRT forming / awaiting the purge" state, and no
  check that the CRT is the *nearest* unfilled one within the range.
- Both `contextSnapshot` and `biasSnapshot` re-aggregate `bars.slice(0, i + 1)` per bar — O(n²).
  Fine for synthetic fixtures; a running aggregation is needed before a real multi-year run.
- `StructureRules.testedKeyLevel` (§5.1.3) is still injected by nobody, so a significant high still
  requires a subsequent low break; a key level that produced no break is invisible to the range.
- `test/execution.test.ts` now hoists `BLOCK`/`strategyContext`/`contextSnapshot` fixtures; the
  per-file `cfg()` helper convention is repeated across the test files and predates this ticket.

## Review

Two-axis review of the working diff at `c42be46` (Standards + Spec).

- *Hard (both fixed):* `src/time.ts` and `src/types.ts` each had a doc comment glued onto the
  following `export` line.
- Judgement fixes applied: extracted `contextVetoes` so the map's rule lives beside `biasVetoes`
  instead of a second inline gate in `execution.ts`; `keyLevel` made non-null (the null branch was
  unreachable once `bias === "none"` returns early); CRT required to be a continued sweep *within*
  the range; the shared `RangeView` type extracted from `StructureSnapshot`/`ContextSnapshot`;
  duplicated `OrderBlock`/context fixtures hoisted in `test/execution.test.ts`.
- Deferred (recorded above): per-bias range construction, CRT-forming state, the O(n²) re-aggregation,
  and the per-file test-config duplication that predates this ticket.
