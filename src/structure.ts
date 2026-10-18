import type { Bar, Dol, LiquiditySide, PricePosition, StructureSnapshot } from "./types.js";

/** A local turning point in price — the raw material of structure. */
export interface Swing {
  index: number;
  time: number;
  price: number;
  kind: "high" | "low";
}

export interface SignificantPoints {
  highs: Swing[];
  lows: Swing[];
}

/**
 * Structural significance is partly price-only and partly context that later
 * layers supply. Those context criteria are injected so this layer stays
 * independent of them.
 */
export interface StructureRules {
  /** Bars either side a pivot must exceed. Defaults to `DEFAULT_SWING_WIDTH`. */
  swingWidth?: number;
  /** Did this high test an HTF key level? (ticket 09) */
  testedKeyLevel?: (swing: Swing) => boolean;
  /** Did this low purge liquidity, react to a key level, fill an FVG or show SMT? (tickets 05/10) */
  lowQualifies?: (swing: Swing) => boolean;
}

export const DEFAULT_SWING_WIDTH = 2;

/** Fractal pivots: a high exceeding `width` bars either side, and the converse for a low. */
export function findSwings(bars: Bar[], width = DEFAULT_SWING_WIDTH): Swing[] {
  const swings: Swing[] = [];

  for (let i = width; i < bars.length - width; i++) {
    const bar = bars[i]!;
    let isHigh = true;
    let isLow = true;

    for (let j = i - width; j <= i + width; j++) {
      if (j === i) continue;
      const other = bars[j]!;
      if (other.high >= bar.high) isHigh = false;
      if (other.low <= bar.low) isLow = false;
    }

    if (isHigh) swings.push({ index: i, time: bar.time, price: bar.high, kind: "high" });
    if (isLow) swings.push({ index: i, time: bar.time, price: bar.low, kind: "low" });
  }

  return swings;
}

/**
 * The swings that qualify as structurally significant:
 * - a high that tested an HTF key level, or led to a low being broken;
 * - a low that purged liquidity (took out a prior low), or met an injected qualifier.
 */
export function findSignificantPoints(bars: Bar[], rules: StructureRules = {}): SignificantPoints {
  const swings = findSwings(bars, rules.swingWidth ?? DEFAULT_SWING_WIDTH);
  const swingLows = swings.filter((s) => s.kind === "low");

  const highs: Swing[] = [];
  const lows: Swing[] = [];

  for (const swing of swings) {
    // Swings are ascending by index, so the last low strictly before this swing is the
    // final match: filter out this swing itself and any that follow it.
    const priorLow = lastAtOrBefore(swingLows, swing.index - 1);

    if (swing.kind === "high") {
      const qualified =
        rules.testedKeyLevel?.(swing) === true ||
        (priorLow !== undefined &&
          bars.slice(swing.index + 1).some((bar) => bar.low < priorLow.price));
      if (qualified) highs.push(swing);
    } else {
      const qualified =
        rules.lowQualifies?.(swing) === true ||
        (priorLow !== undefined && swing.price < priorLow.price);
      if (qualified) lows.push(swing);
    }
  }

  return { highs, lows };
}

export interface DealingRange {
  high: Swing;
  low: Swing;
  /** Time of the earlier of the two framing points. */
  start: number;
  /** Time of the later of the two framing points. */
  end: number;
  equilibrium: number;
}

function lastAtOrBefore(points: Swing[], uptoIndex: number): Swing | undefined {
  let found: Swing | undefined;
  for (const point of points) {
    if (point.index > uptoIndex) break;
    found = point;
  }
  return found;
}

/**
 * The active dealing range, framed by the most recent expansion swing.
 *
 * Because significant points alternate high/low, the last significant high and the
 * last significant low are always the two endpoints of the most recent leg — so taking
 * one of each is exactly "the most recent expansion swing", whatever order they occurred in.
 */
export function dealingRange(points: SignificantPoints, uptoIndex = Number.POSITIVE_INFINITY): DealingRange | null {
  const high = lastAtOrBefore(points.highs, uptoIndex);
  const low = lastAtOrBefore(points.lows, uptoIndex);
  if (high === undefined || low === undefined) return null;

  return {
    high,
    low,
    start: Math.min(high.time, low.time),
    end: Math.max(high.time, low.time),
    equilibrium: (high.price + low.price) / 2,
  };
}

/** Premium is the upper half of the dealing range, discount the lower half. */
export function classifyPrice(price: number, range: DealingRange): PricePosition {
  if (price > range.equilibrium) return "premium";
  if (price < range.equilibrium) return "discount";
  return "equilibrium";
}

/** The qualifying pool nearest the reference: the highest of the lows, or the lowest of the highs. */
export function nearestPool(
  points: SignificantPoints,
  side: LiquiditySide,
  qualifies: (swing: Swing) => boolean,
): Swing | null {
  const pools = (side === "low" ? points.lows : points.highs).filter(qualifies);
  if (pools.length === 0) return null;
  return pools.reduce((a, b) => ((side === "low" ? b.price > a.price : b.price < a.price) ? b : a));
}

/** The qualifying pool furthest from the reference: the deepest low, or the highest high. */
export function extremePool(
  points: SignificantPoints,
  side: LiquiditySide,
  qualifies: (swing: Swing) => boolean,
): Swing | null {
  const pools = (side === "low" ? points.lows : points.highs).filter(qualifies);
  if (pools.length === 0) return null;
  return pools.reduce((a, b) => ((side === "low" ? b.price < a.price : b.price > a.price) ? b : a));
}

/**
 * Price is drawn toward liquidity: up out of discount, down out of premium. The
 * short-term DOL is the nearest opposing significant point; the long-term DOL is
 * the extreme beyond it.
 */
export function drawOnLiquidity(
  points: SignificantPoints,
  range: DealingRange,
  price: number,
  uptoIndex = Number.POSITIVE_INFINITY,
): Dol | null {
  const drawingUp = price <= range.equilibrium;
  const side: LiquiditySide = drawingUp ? "high" : "low";
  const qualifies = (swing: Swing): boolean =>
    swing.index <= uptoIndex && (drawingUp ? swing.price > price : swing.price < price);

  const nearest = nearestPool(points, side, qualifies);
  const extreme = extremePool(points, side, qualifies);
  if (nearest === null || extreme === null) return null;

  return { shortTerm: nearest.price, longTerm: extreme.price };
}

/** The structural read at `index` for `price`, as recorded on a decision. */
export function structureSnapshot(
  points: SignificantPoints,
  index: number,
  price: number,
): StructureSnapshot | null {
  const range = dealingRange(points, index);
  if (range === null) return null;

  return {
    range: { high: range.high.price, low: range.low.price, equilibrium: range.equilibrium },
    position: classifyPrice(price, range),
    dol: drawOnLiquidity(points, range, price, index),
  };
}
