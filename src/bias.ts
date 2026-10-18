import { aggregate } from "./candles.js";
import { DEFAULT_SWING_WIDTH, findSwings } from "./structure.js";
import type { Bar, BiasDirection, Direction, StrategyConfig } from "./types.js";

/**
 * The top-down directional bias (ruleset §3.1).
 *
 * A timeframe reads **bullish** when price breaks highs and rejects lows, **bearish** when it
 * breaks lows and rejects highs (§3.1.2): a swing counts as broken once a bar **closes**
 * beyond it, and whichever side was broken most recently sets the read. Anything else is
 * `"none"` — the hypothesis is dumped rather than guessed.
 *
 * Each timeframe is read independently, then refined top-down Monthly → Weekly → Daily. The
 * daily read governs the day; a higher timeframe that points the other way vetoes it.
 *
 * Tier B refinements — the Quarterly Shift framework, seasonal tendencies and market profiles
 * (§3.1.1, §3.1.3) — are deliberately absent from v1.
 */
export function structuralBias(bars: Bar[], cfg: StrategyConfig): BiasDirection {
  const width = cfg.structure?.swingWidth ?? DEFAULT_SWING_WIDTH;
  const swings = findSwings(bars, width);
  const highs = swings.filter((swing) => swing.kind === "high");
  const lows = swings.filter((swing) => swing.kind === "low");

  let latestHigh = 0; // count of swing highs confirmed by the current bar
  let latestLow = 0;
  let lastHighBreak = -1;
  let lastLowBreak = -1;

  for (let i = 0; i < bars.length; i++) {
    // A pivot needs `width` bars after it, so it is only known once the loop reaches index+width.
    while (latestHigh < highs.length && highs[latestHigh]!.index + width <= i) latestHigh += 1;
    while (latestLow < lows.length && lows[latestLow]!.index + width <= i) latestLow += 1;

    const close = bars[i]!.close;
    if (latestHigh > 0 && close > highs[latestHigh - 1]!.price) lastHighBreak = i;
    if (latestLow > 0 && close < lows[latestLow - 1]!.price) lastLowBreak = i;
  }

  if (lastHighBreak === -1 && lastLowBreak === -1) return "none";
  if (lastHighBreak === lastLowBreak) return "none";
  return lastHighBreak > lastLowBreak ? "bullish" : "bearish";
}

function opposite(bias: BiasDirection): BiasDirection {
  if (bias === "bullish") return "bearish";
  if (bias === "bearish") return "bullish";
  return "none";
}

export interface BiasSnapshot {
  /** The resolved read for the day — the one that governs trading. */
  direction: BiasDirection;
  monthly: BiasDirection;
  weekly: BiasDirection;
  daily: BiasDirection;
}

/**
 * Refine top-down: the daily read governs, but only while the higher timeframes do not point
 * the other way. A higher timeframe that opposes the daily dumps the hypothesis (§3.1.1), and
 * with no daily read there is no bias.
 */
export function resolveBias(
  daily: BiasDirection,
  weekly: BiasDirection,
  monthly: BiasDirection,
): BiasDirection {
  if (daily === "none") return "none";
  if (monthly === opposite(daily) || weekly === opposite(daily)) return "none";
  return daily;
}

/** Aggregate to Monthly, Weekly and Daily, read each, then refine top-down (§3). */
export function biasSnapshot(bars: Bar[], cfg: StrategyConfig): BiasSnapshot {
  const monthly = structuralBias(aggregate(bars, "MN1", cfg), cfg);
  const weekly = structuralBias(aggregate(bars, "W1", cfg), cfg);
  const daily = structuralBias(aggregate(bars, "D1", cfg), cfg);

  return { direction: resolveBias(daily, weekly, monthly), daily, weekly, monthly };
}

/**
 * The reason a setup is refused for its direction, or `null` to allow it.
 * A neutral bias is no read at all, so it does not veto.
 */
export function biasVetoes(bias: BiasDirection, direction: Direction): string | null {
  if (bias === "none") return null;
  const wanted: BiasDirection = direction === "long" ? "bullish" : "bearish";
  return bias === wanted ? null : "against the daily bias";
}
