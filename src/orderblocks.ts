import type {
  Bar,
  Direction,
  LiquidityEvent,
  ObBehaviour,
  OrderBlock,
  OrderBlockScore,
  PricePosition,
} from "./types.js";
import { liquidityEventAt, liquidityEventAtOf, type LevelQueries } from "./liquidity.js";
import type { SignificantPoints } from "./structure.js";

/**
 * Order blocks are detected from price alone, but three of the four high-probability
 * conditions and one of the three qualifying behaviours depend on context that later
 * layers own. Those pieces are injected so this layer stays independent of them.
 */
export interface OrderBlockRules {
  points: SignificantPoints;
  /** Does this candle test an HTF key level — filling liquidity? (ticket 09) */
  testedKeyLevel?: (bar: Bar, index: number) => boolean;
  /** Is this candle at a key time (key macro or killzone)? (tickets 03/09) */
  atKeyTime?: (index: number) => boolean;
  /** Is the block tested at a key time? (tickets 03/09) */
  testedAtKeyTime?: (block: OrderBlock, index: number) => boolean;
  /** Is the current HTF bias aligned with this direction? (ticket 08) */
  biasAligned?: (direction: Direction) => boolean;
  /** Premium/discount location at this candle. (ticket 04) */
  positionOf?: (index: number) => PricePosition;
}

/**
 * How, if at all, `engulfing` closes through `target`: `"body"` when it clears only the
 * body, `"wick"` when it clears the whole candle, `null` when it does not clear the body.
 * Longs close above the candle, shorts below it (ruleset §6).
 */
function engulfment(
  bars: Bar[],
  engulfing: number,
  target: number,
  direction: Direction,
): "body" | "wick" | null {
  if (target < 0) return null;
  const bar = bars[engulfing]!;
  const candle = bars[target]!;
  const bodyTop = Math.max(candle.open, candle.close);
  const bodyBottom = Math.min(candle.open, candle.close);

  if (direction === "long") {
    if (bar.close <= bodyTop) return null;
    return bar.close > candle.high ? "wick" : "body";
  }
  if (bar.close >= bodyBottom) return null;
  return bar.close < candle.low ? "wick" : "body";
}

/** A source candle is opposite in colour to the trade: down candles form a bullish block. */
function oppositeColour(bars: Bar[], index: number, direction: Direction): boolean {
  if (index < 0) return false;
  const bar = bars[index]!;
  return direction === "long" ? bar.close < bar.open : bar.close > bar.open;
}

/**
 * The first candle of the run ending at `engulfing - 1` that the engulfing candle closes
 * through as a whole. Consecutive candles cleared together are one order block (§6).
 */
function groupStart(bars: Bar[], engulfing: number, direction: Direction): number | null {
  if (!oppositeColour(bars, engulfing - 1, direction)) return null;
  if (engulfment(bars, engulfing, engulfing - 1, direction) === null) return null;

  let from = engulfing - 1;
  for (let j = engulfing - 2; j >= 0; j--) {
    if (!oppositeColour(bars, j, direction)) break;
    if (engulfment(bars, engulfing, j, direction) === null) break;
    from = j;
  }
  return from;
}

/**
 * The price zone of a block: the union of the run's candles when the engulfing close
 * clears the whole run (wick), otherwise the union of their bodies (body). Entry and
 * stop are later taken from this zone — the open and the extreme (ruleset §5.3).
 */
function zoneFor(
  bars: Bar[],
  from: number,
  to: number,
  direction: Direction,
  engulfingClose: number,
): { top: number; bottom: number; part: "body" | "wick" } {
  let top = -Infinity;
  let bottom = Infinity;
  let bodyTop = -Infinity;
  let bodyBottom = Infinity;

  for (let i = from; i <= to; i++) {
    const bar = bars[i]!;
    top = Math.max(top, bar.high);
    bottom = Math.min(bottom, bar.low);
    bodyTop = Math.max(bodyTop, Math.max(bar.open, bar.close));
    bodyBottom = Math.min(bodyBottom, Math.min(bar.open, bar.close));
  }

  const wick = direction === "long" ? engulfingClose > top : engulfingClose < bottom;
  return wick ? { top, bottom, part: "wick" } : { top: bodyTop, bottom: bodyBottom, part: "body" };
}

/** Suffix scans turning "did any later bar ..." into an O(1) read. */
interface Suffix {
  /** The lowest low from each index to the end; `Infinity` past the last bar. */
  minLow: number[];
  /** The highest high from each index to the end; `-Infinity` past the last bar. */
  maxHigh: number[];
}

function suffixScans(bars: Bar[]): Suffix {
  const minLow = new Array<number>(bars.length + 1).fill(Infinity);
  const maxHigh = new Array<number>(bars.length + 1).fill(-Infinity);
  for (let i = bars.length - 1; i >= 0; i--) {
    minLow[i] = Math.min(minLow[i + 1]!, bars[i]!.low);
    maxHigh[i] = Math.max(maxHigh[i + 1]!, bars[i]!.high);
  }
  return { minLow, maxHigh };
}

/** The qualifying behaviours a single candle shows (ruleset §6). */
function behavioursAt(
  bars: Bar[],
  index: number,
  rules: OrderBlockRules,
  eventAt: (index: number) => LiquidityEvent | null,
  suffix: Suffix,
): ObBehaviour[] {
  const bar = bars[index]!;
  const found: ObBehaviour[] = [];

  const event = eventAt(index);
  if (event !== null) {
    found.push("purge");
    // Generating liquidity: a CRT whose own liquidity is later taken.
    if (event.isCrt) {
      const extreme = event.side === "low" ? bar.low : bar.high;
      const later =
        event.side === "low"
          ? suffix.minLow[index + 1]! < extreme
          : suffix.maxHigh[index + 1]! > extreme;
      if (later) found.push("generate");
    }
  }

  if (rules.testedKeyLevel?.(bar, index) === true) found.push("fill");
  return found;
}

/** Did the source run trade into a previously detected block? (§6 propulsion) */
function testsPrior(bars: Bar[], from: number, to: number, prior: OrderBlock[]): boolean {
  let low = Infinity;
  let high = -Infinity;
  for (let i = from; i <= to; i++) {
    low = Math.min(low, bars[i]!.low);
    high = Math.max(high, bars[i]!.high);
  }
  return prior.some((block) => low <= block.top && high >= block.bottom);
}

/**
 * Every order block in the series: a candle (or run of consecutive candles) that shows a
 * qualifying behaviour **and** is engulfed by a later candle. Missing either is not a block.
 */
export function findOrderBlocks(bars: Bar[], rules: OrderBlockRules): OrderBlock[] {
  return collectOrderBlocks(bars, rules, (index) =>
    liquidityEventAt(bars[index]!, index, rules.points),
  );
}

/**
 * `findOrderBlocks` against a queryable point set (ticket 16): the per-candle liquidity read
 * becomes `liquidityEventAtOf`, and the "liquidity taken later" scan is precomputed. The set
 * must already hold every level of the series, exactly as `rules.points` does.
 */
export function findOrderBlocksOf(
  bars: Bar[],
  rules: OrderBlockRules,
  queries: LevelQueries,
): OrderBlock[] {
  return collectOrderBlocks(bars, rules, (index) =>
    liquidityEventAtOf(bars[index]!, index, queries),
  );
}

function collectOrderBlocks(
  bars: Bar[],
  rules: OrderBlockRules,
  eventAt: (index: number) => LiquidityEvent | null,
): OrderBlock[] {
  const blocks: OrderBlock[] = [];
  const consumed = new Array<boolean>(bars.length).fill(false);
  const suffix = suffixScans(bars);

  for (let i = 1; i < bars.length; i++) {
    const engulfing = bars[i]!;
    if (engulfing.close === engulfing.open) continue;
    const direction: Direction = engulfing.close > engulfing.open ? "long" : "short";

    const from = groupStart(bars, i, direction);
    if (from === null) continue;

    // A candle already consumed by an earlier block cannot source another: a later,
    // wider engulf of the same candles is the same block, not a second one.
    let overlaps = false;
    for (let j = from; j <= i - 1; j++) {
      if (consumed[j]!) {
        overlaps = true;
        break;
      }
    }
    if (overlaps) continue;

    const behaviours: ObBehaviour[] = [];
    for (let j = from; j <= i - 1; j++) {
      for (const behaviour of behavioursAt(bars, j, rules, eventAt, suffix)) {
        if (!behaviours.includes(behaviour)) behaviours.push(behaviour);
      }
    }
    if (behaviours.length === 0) continue;

    const zone = zoneFor(bars, from, i - 1, direction, engulfing.close);
    const propulsion = testsPrior(bars, from, i - 1, blocks);

    for (let j = from; j <= i - 1; j++) consumed[j] = true;
    blocks.push({
      index: i - 1,
      time: bars[i - 1]!.time,
      direction,
      open: bars[i - 1]!.open,
      top: zone.top,
      bottom: zone.bottom,
      part: zone.part,
      behaviours,
      engulfedBy: i,
      candles: i - from,
      propulsion,
    });
  }

  return blocks;
}

/**
 * High-probability scoring: all four conditions must hold (ruleset §6). Unsupplied
 * predicates count as false, so a block is only high-probability when every layer agrees.
 */
export function scoreOrderBlock(block: OrderBlock, rules: OrderBlockRules): OrderBlockScore {
  const biasAligned = rules.biasAligned?.(block.direction) === true;

  const position = rules.positionOf?.(block.index);
  const discountOrPremium =
    block.direction === "long" ? position === "discount" : position === "premium";

  const formedAtKeyTime = rules.atKeyTime?.(block.index) === true;
  const testedAtKeyTime = rules.testedAtKeyTime?.(block, block.engulfedBy) === true;

  return {
    highProbability: biasAligned && discountOrPremium && formedAtKeyTime && testedAtKeyTime,
    biasAligned,
    discountOrPremium,
    formedAtKeyTime,
    testedAtKeyTime,
  };
}
