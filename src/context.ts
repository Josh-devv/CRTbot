import { aggregate } from "./candles.js";
import { liquidityEventAt } from "./liquidity.js";
import { classifyPrice, dealingRange, findSignificantPoints, type DealingRange } from "./structure.js";
import { sessionWindowStart } from "./time.js";
import type { Bar, BiasDirection, ContextSnapshot, SmtDivergence, StrategyConfig } from "./types.js";

/** Context is the H4 layer (ruleset §4). */
export const CONTEXT_TIMEFRAME = "H4";

/** Is the swept level one of the prices framing the dealing range? (§4.3 "within it") */
function withinRange(level: number, range: DealingRange): boolean {
  return level >= range.low.price && level <= range.high.price;
}

/**
 * The context veto: with a bias in play the map must place price in the half the bias trades
 * from — a bullish bias in discount, a bearish one in premium (§4.2). No context — before the
 * London open — vetoes nothing (§4.4: wait, do nothing until then).
 *
 * The one reprieve is a *confirmed* SMT divergence (§7.3): the pair taking liquidity that the
 * correlated instrument failed to take is itself the evidence that this level is the one being
 * worked, so a confirmed divergence stands in for the premium/discount location. Divergence on
 * its own never does — an unconfirmed one leaves the veto standing.
 */
export function contextVetoes(
  context: ContextSnapshot | null,
  smt: SmtDivergence | null = null,
): string | null {
  if (context === null || context.aligned) return null;
  if (smt !== null && smt.confirmedBy !== null) return null;
  return "not aligned with the dealing range";
}

/**
 * Build the context for the bar at `index` (ruleset §4).
 *
 * Steps: the dealing range is drawn on the H4 series **aligned to the HTF bias direction**, and
 * the key level and CRT are read inside it. Nothing is built before the London open — §4.4 says
 * to wait for price to approach and do nothing until then, so there is no night-before context.
 *
 * Returns null when there is no bias to align to, before the London open, or while the H4 has
 * not yet framed a dealing range.
 */
export function contextSnapshot(
  bars: Bar[],
  index: number,
  cfg: StrategyConfig,
  bias: BiasDirection,
): ContextSnapshot | null {
  if (bias === "none") return null;

  const bar = bars[index];
  if (bar === undefined) return null;
  if (bar.time < sessionWindowStart(bar.time, "london", cfg.session)) return null;

  const h4 = aggregate(bars.slice(0, index + 1), CONTEXT_TIMEFRAME, cfg);
  const last = h4.length - 1;
  if (last < 0) return null;

  const points = findSignificantPoints(h4, cfg.structure);
  const range = dealingRange(points, last);
  if (range === null) return null;

  const position = classifyPrice(bar.close, range);
  const aligned =
    (bias === "bullish" && position === "discount") ||
    (bias === "bearish" && position === "premium");

  // Only a sweep that took a level *of this range* and continued away from it is its CRT.
  const sweep = liquidityEventAt(h4[last]!, last, points);
  const crt = sweep !== null && sweep.isCrt && withinRange(sweep.level, range) ? sweep : null;

  return {
    timeframe: "H4",
    range: { high: range.high.price, low: range.low.price, equilibrium: range.equilibrium },
    position,
    // A bullish bias works from the discount low; a bearish one from the premium high.
    keyLevel: bias === "bullish" ? range.low.price : range.high.price,
    crt,
    aligned,
  };
}
