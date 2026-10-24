import type { Bar, LiquidityEvent, LiquiditySide, RejectionKind } from "./types.js";
import { nearestPool, type SignificantPoints, type Swing } from "./structure.js";

export interface PurgeEvent {
  index: number;
  time: number;
  /** The level whose liquidity was taken. */
  level: number;
  side: LiquiditySide;
  /** The wick extreme that took the liquidity. */
  extreme: number;
}

/**
 * A purge is a wick that drives through a level, takes the resting liquidity and
 * rejects: the body closes back on the origin side. Closing beyond the level is not a
 * purge — the level failed.
 */
export function isPurge(bar: Bar, level: number, side: LiquiditySide): boolean {
  return side === "low"
    ? bar.low < level && bar.close > level
    : bar.high > level && bar.close < level;
}

/** A CRT is a purge whose body then continues away from the swept level. */
export function isCrt(bar: Bar, level: number, side: LiquiditySide): boolean {
  if (!isPurge(bar, level, side)) return false;
  return side === "low" ? bar.close > bar.open : bar.close < bar.open;
}

/** A significant level a bar may sweep. */
interface Level {
  price: number;
  index: number;
  side: LiquiditySide;
}

/**
 * The as-of level reads a liquidity event needs of a point set: the levels inside a bar's
 * trade window, and the nearest pool beyond a swept level. The replay answers these against
 * its rolling set; the `SignificantPoints` path scans and filters.
 */
export interface LevelQueries {
  /** Qualified levels strictly inside (lower, upper), skipping points at or past `limit`. */
  levelsInBand(side: LiquiditySide, lower: number, upper: number, limit: number): Swing[];
  /** The nearest qualified low strictly below / high strictly above `price`, skipping `skipIndex`. */
  nearestLowBelow(price: number, skipIndex?: number): Swing | undefined;
  nearestHighAbove(price: number, skipIndex?: number): Swing | undefined;
}

/** The purge events among `levels` for this bar, in the deterministic sweep order. */
function purgeEvents(bar: Bar, index: number, levels: Level[]): PurgeEvent[] {
  const purges: PurgeEvent[] = [];
  for (const level of levels) {
    if (level.index >= index) continue;
    if (!isPurge(bar, level.price, level.side)) continue;
    purges.push({
      index,
      time: bar.time,
      level: level.price,
      side: level.side,
      extreme: level.side === "low" ? bar.low : bar.high,
    });
  }

  // Deterministic order so a caller can take the first sweep as "the" event: nearest level
  // first (the highest low, the lowest high), low-side sweeps before high-side, and — as the
  // reference's stable sort leaves them — levels sharing a price in ascending index order.
  purges.sort((a, b) => {
    if (a.side !== b.side) return a.side === "low" ? -1 : 1;
    const byLevel = a.side === "low" ? b.level - a.level : a.level - b.level;
    return byLevel !== 0 ? byLevel : a.index - b.index;
  });
  return purges;
}

/** Every significant level this single bar sweeps. */
function purgesAt(bar: Bar, index: number, points: SignificantPoints): PurgeEvent[] {
  const levels: Level[] = [
    ...points.lows.map((low) => ({ price: low.price, index: low.index, side: "low" as const })),
    ...points.highs.map((high) => ({ price: high.price, index: high.index, side: "high" as const })),
  ];
  return purgeEvents(bar, index, levels);
}

/**
 * The same sweep read against a queryable point set: only levels inside the bar's trade window
 * can purge (the close-back test), so the band is the whole search space — no prefix scan.
 */
function purgesAtOf(bar: Bar, index: number, queries: LevelQueries): PurgeEvent[] {
  const levels: Level[] = [
    ...queries
      .levelsInBand("low", bar.low, bar.close, index)
      .map((low) => ({ price: low.price, index: low.index, side: "low" as const })),
    ...queries
      .levelsInBand("high", bar.close, bar.high, index)
      .map((high) => ({ price: high.price, index: high.index, side: "high" as const })),
  ];
  return purgeEvents(bar, index, levels);
}

/** Every purge of a significant level across the series, ascending by bar. */
export function findPurges(bars: Bar[], points: SignificantPoints): PurgeEvent[] {
  const purges: PurgeEvent[] = [];
  for (let i = 0; i < bars.length; i++) {
    purges.push(...purgesAt(bars[i]!, i, points));
  }
  return purges;
}

/** The purges whose body continued — the CRTs. */
export function findCrts(bars: Bar[], points: SignificantPoints): PurgeEvent[] {
  return findPurges(bars, points).filter((purge) => isCrt(bars[purge.index]!, purge.level, purge.side));
}

/**
 * A rejection before the relative DOL is reached is a mere liquidity purge; at or
 * beyond it, the delivery has shifted state — a CSD.
 */
export function classifyRejection(
  extreme: number,
  relativeDol: number,
  side: LiquiditySide,
): RejectionKind {
  const reached = side === "low" ? extreme <= relativeDol : extreme >= relativeDol;
  return reached ? "csd" : "purge";
}

/**
 * The nearest significant pool beyond the swept level, on the same side, excluding the
 * sweep itself. Null when the level was the deepest known liquidity.
 *
 * This resolves the pool analytically over the whole series rather than point-in-time;
 * point-in-time DOL selection belongs with the narrative layer.
 */
function relativeDol(
  points: SignificantPoints,
  level: number,
  side: LiquiditySide,
  sweepIndex: number,
): number | null {
  const pool = nearestPool(
    points,
    side,
    (swing) =>
      swing.index !== sweepIndex && (side === "low" ? swing.price < level : swing.price > level),
  );
  return pool === null ? null : pool.price;
}

/** The same relative DOL against a queryable point set. */
function relativeDolOf(
  queries: LevelQueries,
  level: number,
  side: LiquiditySide,
  sweepIndex: number,
): number | null {
  const pool =
    side === "low"
      ? queries.nearestLowBelow(level, sweepIndex)
      : queries.nearestHighAbove(level, sweepIndex);
  return pool === undefined ? null : pool.price;
}

/** The liquidity read for a single bar, as recorded on a decision. */
export function liquidityEventAt(
  bar: Bar,
  index: number,
  points: SignificantPoints,
): LiquidityEvent | null {
  // A bar can sweep several levels at once; the event records the nearest sweep (see
  // `purgesAt` ordering). `findPurges` reports every sweep, so nothing is lost for analysis.
  const purge = purgesAt(bar, index, points)[0];
  if (purge === undefined) return null;

  const dol = relativeDol(points, purge.level, purge.side, index);

  return {
    side: purge.side,
    level: purge.level,
    extreme: purge.extreme,
    isCrt: isCrt(bar, purge.level, purge.side),
    kind: dol === null ? null : classifyRejection(purge.extreme, dol, purge.side),
  };
}

/**
 * The liquidity read for a single bar against a queryable point set — `liquidityEventAt`'s
 * fast path. Answers identically; the set must already hold every level of the series, because
 * the relative DOL is resolved across the whole series, not up to the bar.
 */
export function liquidityEventAtOf(
  bar: Bar,
  index: number,
  queries: LevelQueries,
): LiquidityEvent | null {
  const purge = purgesAtOf(bar, index, queries)[0];
  if (purge === undefined) return null;

  const dol = relativeDolOf(queries, purge.level, purge.side, index);

  return {
    side: purge.side,
    level: purge.level,
    extreme: purge.extreme,
    isCrt: isCrt(bar, purge.level, purge.side),
    kind: dol === null ? null : classifyRejection(purge.extreme, dol, purge.side),
  };
}
