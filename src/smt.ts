import { findSignificantPoints, nearestPool, type StructureRules } from "./structure.js";
import type {
  Bar,
  BarSeries,
  BiasDirection,
  Instrument,
  LiquidityEvent,
  LiquiditySide,
  SmtDivergence,
  StrategyConfig,
} from "./types.js";

/** The correlated instrument to diverge against, with its bars indexed by time. */
export interface SmtPair {
  series: BarSeries;
  indexByTime: Map<number, number>;
}

/**
 * Pick the instrument to measure divergence against (§7.3): the first dataset series that the
 * configured pairs tie to the traded instrument. Nothing when SMT is off or no pair matches, so
 * a single-instrument run simply never looks at divergence.
 */
export function correlatedPair(
  cfg: StrategyConfig,
  traded: Instrument,
  dataset: BarSeries[] = [],
): SmtPair | null {
  const smt = cfg.smt;
  if (smt === undefined || !smt.enabled) return null;

  const series = dataset.find((other) =>
    smt.pairs.some((pair) => pair.includes(traded) && pair.includes(other.instrument)),
  );
  if (series === undefined) return null;

  const indexByTime = new Map<number, number>();
  series.bars.forEach((bar, index) => indexByTime.set(bar.time, index));
  return { series, indexByTime };
}

export interface SmtInput {
  /** The instrument the backtest is trading. */
  traded: Instrument;
  /** The correlated instrument to diverge against. */
  pair: Instrument;
  /** What the traded instrument just did: the level it swept, or null if it swept nothing. */
  sweep: LiquidityEvent | null;
  /** The pair's bars, aligned bar-for-bar with the traded series by time. */
  pairBars: Bar[];
  /** Index of this bar in `pairBars`; null when the pair has no bar at this time. */
  pairIndex: number | null;
  /** The HTF bias governing the day (§7.3 criterion 1). */
  bias: BiasDirection;
  /** The HTF key level inside the dealing range (§7.3 criterion 2). */
  keyLevel: number | null;
  /** Is this bar at a key time — a killzone or key macro? (§7.3 criterion 3) */
  atKeyTime: boolean;
  /** The follow-on valid CSD or valid order block available on this bar (§7.3 confirmation). */
  confirmedBy: SmtDivergence["confirmedBy"];
  structure?: StructureRules;
}

/** Which bias a liquidity sweep on `side` agrees with: a low sweep is bullish evidence. */
function biasFor(side: LiquiditySide): BiasDirection {
  return side === "low" ? "bullish" : "bearish";
}

/**
 * SMT divergence (§7.3): one instrument takes the liquidity and the correlated instrument fails to.
 *
 * All three criteria must hold or nothing is reported:
 * 1. the sweep agrees with the HTF bias;
 * 2. the swept level is the HTF key level inside the dealing range;
 * 3. the sweep happens at a key time.
 *
 * The divergence itself is only half the story: §7.3 confirms it with a follow-on valid CSD or
 * valid order block, so `confirmedBy` is null until one appears — and an unconfirmed divergence
 * must not fire a trade.
 */
export function smtDivergence(input: SmtInput): SmtDivergence | null {
  const { sweep, pairIndex } = input;
  if (sweep === null || pairIndex === null) return null;

  // 1) Aligned with the HTF bias.
  if (input.bias !== biasFor(sweep.side)) return null;

  // 2. Forms at an HTF key level.
  if (input.keyLevel === null || input.keyLevel !== sweep.level) return null;

  // 3. Forms at a key time.
  if (!input.atKeyTime) return null;

  // The pair must have *failed* to take its own liquidity: its nearest prior pool on the same
  // side is still intact. If the pair undercut it too, the move was correlated — no divergence.
  const pairBar = input.pairBars[pairIndex];
  if (pairBar === undefined) return null;

  const points = findSignificantPoints(input.pairBars.slice(0, pairIndex + 1), input.structure);
  const pool = nearestPool(points, sweep.side, (swing) => swing.index < pairIndex);
  if (pool === null) return null;

  const took = sweep.side === "low" ? pairBar.low <= pool.price : pairBar.high >= pool.price;
  if (took) return null;

  return {
    side: sweep.side,
    took: input.traded,
    failed: input.pair,
    confirmedBy: input.confirmedBy,
  };
}
