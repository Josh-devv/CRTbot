import { aggregate, RunningCandles } from "./candles.js";
import { DEFAULT_SWING_WIDTH, findSwings, type StructureRules } from "./structure.js";
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
 * The Quarterly Shift framework and seasonal tendencies (§3.1.1) are read separately — see
 * `seasonality.ts`; market profiles (§3.1.3) are still deliberately absent from v1.
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
 * `structuralBias` as a fold over one aggregate's candles: fold, then update the live candle as
 * the bucket builds. The confirmed pivots the cursor has reached are frozen; only the newest
 * pivot — whose window touches the live candle — and the live candle's own break are re-derived,
 * so a read costs a step, not a rescan of the prefix (ticket 16).
 */
export class RollingStructuralBias {
  private readonly width: number;
  private readonly candles: Bar[] = [];
  /** Confirmed pivot prices, ascending by index — all the break checks need of them. */
  private readonly highPrices: number[] = [];
  private readonly lowPrices: number[] = [];
  private frozenHighBreak = -1;
  private frozenLowBreak = -1;
  private liveHigh = false;
  private liveLow = false;
  /** Is the newest evaluated candle (`live - width`) currently a confirmed pivot? */
  private tailHigh = false;
  private tailLow = false;

  constructor(rules: StructureRules = {}) {
    this.width = rules.swingWidth ?? DEFAULT_SWING_WIDTH;
  }

  /** Append the aggregate's next candle. Earlier candles are final from here on. */
  fold(bar: Bar): void {
    const live = this.candles.length;
    if (live > 0) {
      if (this.liveHigh) this.frozenHighBreak = live - 1;
      if (this.liveLow) this.frozenLowBreak = live - 1;
    }
    this.candles.push(bar);

    const index = live - this.width;
    if (index >= this.width) {
      this.tailHigh = this.isPivotHigh(index);
      this.tailLow = this.isPivotLow(index);
      if (this.tailHigh) this.highPrices.push(this.candles[index]!.high);
      if (this.tailLow) this.lowPrices.push(this.candles[index]!.low);
    } else {
      this.tailHigh = false;
      this.tailLow = false;
    }

    this.deriveLive(live);
  }

  /** Replace the still-open last candle — the bucket being built. */
  update(bar: Bar): void {
    const live = this.candles.length - 1;
    if (live < 0) return;
    this.candles[live] = bar;

    // The only pivot the live candle's window can change is the newest one, and no earlier
    // bar's break ever read it, so its flip is safe to apply in place. Its price comes from
    // the pivot's own (already frozen) candle, which a live-candle update never changes.
    const index = live - this.width;
    if (index >= this.width) {
      const pivotHigh = this.isPivotHigh(index);
      if (pivotHigh !== this.tailHigh) {
        if (pivotHigh) this.highPrices.push(this.candles[index]!.high);
        else this.highPrices.pop();
        this.tailHigh = pivotHigh;
      }

      const pivotLow = this.isPivotLow(index);
      if (pivotLow !== this.tailLow) {
        if (pivotLow) this.lowPrices.push(this.candles[index]!.low);
        else this.lowPrices.pop();
        this.tailLow = pivotLow;
      }
    }

    this.deriveLive(live);
  }

  value(): BiasDirection {
    const live = this.candles.length - 1;
    const highBreak = this.liveHigh ? live : this.frozenHighBreak;
    const lowBreak = this.liveLow ? live : this.frozenLowBreak;
    if (highBreak === -1 && lowBreak === -1) return "none";
    if (highBreak === lowBreak) return "none";
    return highBreak > lowBreak ? "bullish" : "bearish";
  }

  /** The live candle's own break check, against the newest pivot the cursor has reached. */
  private deriveLive(live: number): void {
    const close = this.candles[live]!.close;
    this.liveHigh = this.highPrices.length > 0 && close > this.highPrices[this.highPrices.length - 1]!;
    this.liveLow = this.lowPrices.length > 0 && close < this.lowPrices[this.lowPrices.length - 1]!;
  }

  /** A pivot high under `findSwings`' rule: strictly above every bar in its window. */
  private isPivotHigh(index: number): boolean {
    const bar = this.candles[index]!;
    for (let j = index - this.width; j <= index + this.width; j++) {
      if (j === index) continue;
      if (this.candles[j]!.high >= bar.high) return false;
    }
    return true;
  }

  private isPivotLow(index: number): boolean {
    const bar = this.candles[index]!;
    for (let j = index - this.width; j <= index + this.width; j++) {
      if (j === index) continue;
      if (this.candles[j]!.low <= bar.low) return false;
    }
    return true;
  }
}

/**
 * `biasSnapshot` as a fold: each execution bar is folded into the monthly, weekly and daily
 * windows, and a session-day read is a step over three forward passes, not three
 * prefix re-aggregations (ticket 16). `biasSnapshot` stays the reference implementation.
 */
export class BiasReader {
  private readonly daily: RunningCandles;
  private readonly weekly: RunningCandles;
  private readonly monthly: RunningCandles;
  private readonly dayBias: RollingStructuralBias;
  private readonly weekBias: RollingStructuralBias;
  private readonly monthBias: RollingStructuralBias;

  constructor(cfg: StrategyConfig) {
    this.daily = new RunningCandles("D1", cfg);
    this.weekly = new RunningCandles("W1", cfg);
    this.monthly = new RunningCandles("MN1", cfg);
    this.dayBias = new RollingStructuralBias(cfg.structure);
    this.weekBias = new RollingStructuralBias(cfg.structure);
    this.monthBias = new RollingStructuralBias(cfg.structure);
  }

  /** Fold one execution bar into all three windows; call before reading `snapshot`. */
  fold(bar: Bar): void {
    this.foldOne(this.daily, this.dayBias, bar);
    this.foldOne(this.weekly, this.weekBias, bar);
    this.foldOne(this.monthly, this.monthBias, bar);
  }

  /** The monthly candles folded so far — `aggregate(prefix, "MN1")`, for the macro read. */
  get months(): Bar[] {
    return this.monthly.bars;
  }

  /** The day's resolved read (§3), equal to `biasSnapshot` over the bars folded so far. */
  snapshot(): BiasSnapshot {
    const daily = this.dayBias.value();
    const weekly = this.weekBias.value();
    const monthly = this.monthBias.value();
    return { direction: resolveBias(daily, weekly, monthly), daily, weekly, monthly };
  }

  private foldOne(window: RunningCandles, bias: RollingStructuralBias, bar: Bar): void {
    const opened = window.fold(bar);
    const candle = window.current!;
    if (opened) bias.fold(candle);
    else bias.update(candle);
  }
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
