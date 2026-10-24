/**
 * Streaming structure reads for the replay loop (ticket 16).
 *
 * Every structure read the engine makes is "the series as of now" — a prefix. Deriving them
 * per bar is O(n²) over twenty-five years of data. `RollingPoints` derives the same points in
 * a single forward pass: a pivot settles once its right edge can no longer change, a high
 * confirms when a later low breaks its prior low, and the still-open last bar is re-evaluated
 * on each `update`. `test/rolling.test.ts` pins it to `findSignificantPoints` at every prefix;
 * the pure function stays the reference implementation.
 */

import {
  DEFAULT_SWING_WIDTH,
  type SignificantPoints,
  type SnapshotQueries,
  type StructureRules,
  type Swing,
} from "./structure.js";
import type { Bar, LiquiditySide } from "./types.js";

/** A qualified point, tagged with the series length whose prefix first shows it. */
export interface Activation {
  /** The fold — series length minus one — whose prefix first contains the point. */
  readonly index: number;
  readonly side: "high" | "low";
  readonly swing: Swing;
}

/** The first position whose price is at or past `price` (ascending). */
function lowerBound(points: Swing[], price: number): number {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.price < price) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The first position whose price is strictly past `price`. */
function upperBound(points: Swing[], price: number): number {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.price <= price) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The insertion point under the price-ascending, index-descending order. */
function place(points: Swing[], swing: Swing): number {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const point = points[mid]!;
    const before =
      point.price < swing.price || (point.price === swing.price && point.index > swing.index);
    if (before) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The higher of two pools, ties going to the earlier index — `nearestPool`'s reduce. */
function higher(left: Swing | undefined, right: Swing | undefined): Swing | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  if (right.price > left.price) return right;
  if (right.price === left.price && right.index < left.index) return right;
  return left;
}

/** The lower of two pools, ties going to the earlier index. */
function lower(left: Swing | undefined, right: Swing | undefined): Swing | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  if (right.price < left.price) return right;
  if (right.price === left.price && right.index < left.index) return right;
  return left;
}

/** The later of two points by index — `lastAtOrBefore`'s pick when both qualify. */
function later(left: Swing | undefined, right: Swing | undefined): Swing | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return right.index > left.index ? right : left;
}

/** The price-ascending, index-descending order every pool query answers under. */
function byPrice(points: Swing[]): Swing[] {
  return [...points].sort((a, b) => a.price - b.price || b.index - a.index);
}

/**
 * A plain set of qualified points with the as-of query surface. Feed it points whose index is
 * already inside "now" — the replay loop adds them as its cursor passes them, and the pure
 * alternatives can be reconstructed from the same answers.
 */
export class PointSet implements SnapshotQueries {
  private highs: Swing[] = [];
  private lows: Swing[] = [];
  private lastHighAt: Swing | undefined;
  private lastLowAt: Swing | undefined;
  private topLow: Swing | undefined;
  private floorHigh: Swing | undefined;

  /** Build from a whole point set — sorted once, not inserted one by one. */
  static fromPoints(points: SignificantPoints): PointSet {
    const set = new PointSet();
    set.highs = byPrice(points.highs);
    set.lows = byPrice(points.lows);
    for (const swing of points.highs) {
      set.lastHighAt = later(set.lastHighAt, swing);
      set.floorHigh = lower(set.floorHigh, swing);
    }
    for (const swing of points.lows) {
      set.lastLowAt = later(set.lastLowAt, swing);
      set.topLow = higher(set.topLow, swing);
    }
    return set;
  }

  /** Add one qualified point, in any order. */
  add(side: "high" | "low", swing: Swing): void {
    if (side === "low") {
      this.lows.splice(place(this.lows, swing), 0, swing);
      this.lastLowAt = later(this.lastLowAt, swing);
      this.topLow = higher(this.topLow, swing);
    } else {
      this.highs.splice(place(this.highs, swing), 0, swing);
      this.lastHighAt = later(this.lastHighAt, swing);
      this.floorHigh = lower(this.floorHigh, swing);
    }
  }

  lastHigh(): Swing | undefined {
    return this.lastHighAt;
  }

  lastLow(): Swing | undefined {
    return this.lastLowAt;
  }

  maxLow(): Swing | undefined {
    return this.topLow;
  }

  minHigh(): Swing | undefined {
    return this.floorHigh;
  }

  nearestLowBelow(price: number, skipIndex?: number): Swing | undefined {
    for (let at = lowerBound(this.lows, price) - 1; at >= 0; at--) {
      const swing = this.lows[at]!;
      if (swing.index !== skipIndex) return swing;
    }
    return undefined;
  }

  nearestHighAbove(price: number, skipIndex?: number): Swing | undefined {
    let at = upperBound(this.highs, price);
    while (at < this.highs.length) {
      const groupPrice = this.highs[at]!.price;
      let end = at;
      while (end + 1 < this.highs.length && this.highs[end + 1]!.price === groupPrice) end++;
      // The earliest index of a price group sits at its end, under index-descending order.
      for (let i = end; i >= at; i--) {
        if (this.highs[i]!.index !== skipIndex) return this.highs[i];
      }
      at = end + 1;
    }
    return undefined;
  }

  lowestLowBelow(price: number): Swing | undefined {
    const first = this.lows[0];
    if (first === undefined || first.price >= price) return undefined;
    let end = 0;
    while (end + 1 < this.lows.length && this.lows[end + 1]!.price === first.price) end++;
    return this.lows[end];
  }

  highestHighAbove(price: number): Swing | undefined {
    const last = this.highs[this.highs.length - 1];
    if (last === undefined || last.price <= price) return undefined;
    return last;
  }

  /** Qualified levels strictly inside (lower, upper), skipping points at or past `limit`. */
  levelsInBand(side: LiquiditySide, lower: number, upper: number, limit: number): Swing[] {
    const points = side === "low" ? this.lows : this.highs;
    const found: Swing[] = [];
    let at = upperBound(points, lower);
    while (at < points.length && points[at]!.price < upper) {
      const swing = points[at]!;
      if (swing.index < limit) found.push(swing);
      at++;
    }
    return found;
  }
}

/** The pool bests SMT reads off a prefix: the highest qualified low, the lowest qualified high. */
export class PoolBests {
  private topLow: Swing | undefined;
  private floorHigh: Swing | undefined;

  /** Add one qualified point, in any order. */
  add(side: "high" | "low", swing: Swing): void {
    if (side === "low") this.topLow = higher(this.topLow, swing);
    else this.floorHigh = lower(this.floorHigh, swing);
  }

  maxLow(): Swing | undefined {
    return this.topLow;
  }

  minHigh(): Swing | undefined {
    return this.floorHigh;
  }
}

/** One side of an `ActivePoints` set: a price index fed by the monotone activation cursor. */
class ActiveSide {
  private readonly byIndex: Swing[];
  private readonly byPrice: Swing[];
  private readonly rank: number[];
  private readonly tree: number[];
  /** The largest power of two at most `byPrice.length` — binary lifting's first jump. */
  private readonly step: number;
  private active = 0;
  private pointer = 0;

  constructor(points: Swing[]) {
    this.byIndex = points;
    const order = points.map((_, position) => position);
    order.sort((a, b) => {
      const left = points[a]!;
      const right = points[b]!;
      return left.price - right.price || right.index - left.index;
    });
    this.byPrice = order.map((position) => points[position]!);
    this.rank = new Array<number>(points.length);
    for (let position = 0; position < order.length; position++) {
      this.rank[order[position]!] = position;
    }
    this.tree = new Array<number>(points.length + 1).fill(0);
    let step = 1;
    while ((step << 1) <= points.length) step <<= 1;
    this.step = step;
  }

  /** Mark every point up to `index` visible; the cursor only moves forward. */
  activateThrough(index: number): void {
    while (this.pointer < this.byIndex.length && this.byIndex[this.pointer]!.index <= index) {
      this.set(this.rank[this.pointer]!, 1);
      this.pointer += 1;
    }
  }

  /** The last activated point — the series' largest index at or before the cursor. */
  get last(): Swing | undefined {
    return this.pointer === 0 ? undefined : this.byIndex[this.pointer - 1];
  }

  /** The highest active pool strictly below `price`, ties to the earliest index. */
  nearestBelow(price: number): Swing | undefined {
    const before = this.count(lowerBound(this.byPrice, price));
    return before === 0 ? undefined : this.byPrice[this.pick(before - 1)]!;
  }

  /** The lowest active pool strictly above `price`, ties to the earliest index. */
  nearestAbove(price: number): Swing | undefined {
    const after = this.count(upperBound(this.byPrice, price));
    if (after === this.active) return undefined;
    const end = upperBound(this.byPrice, this.byPrice[this.pick(after)]!.price);
    return this.byPrice[this.pick(this.count(end) - 1)]!;
  }

  /** The lowest active pool strictly below `price`, ties to the earliest index. */
  lowestBelow(price: number): Swing | undefined {
    if (this.active === 0) return undefined;
    const first = this.pick(0);
    if (this.byPrice[first]!.price >= price) return undefined;
    const end = upperBound(this.byPrice, this.byPrice[first]!.price);
    return this.byPrice[this.pick(this.count(end) - 1)]!;
  }

  /** The highest active pool strictly above `price`, ties to the earliest index. */
  highestAbove(price: number): Swing | undefined {
    if (this.active === 0) return undefined;
    const last = this.pick(this.active - 1);
    return this.byPrice[last]!.price > price ? this.byPrice[last]! : undefined;
  }

  private set(position: number, delta: number): void {
    this.active += delta;
    for (let at = position + 1; at < this.tree.length; at += at & -at) this.tree[at]! += delta;
  }

  /** How many active points sit at price positions below `position`. */
  private count(position: number): number {
    let total = 0;
    for (let at = position; at > 0; at -= at & -at) total += this.tree[at]!;
    return total;
  }

  /** The price position of the k-th active point (0-based) — Fenwick binary lifting. */
  private pick(k: number): number {
    let position = 0;
    for (let step = this.step; step > 0; step >>= 1) {
      const next = position + step;
      if (next < this.tree.length && this.tree[next]! <= k) {
        position = next;
        k -= this.tree[next]!;
      }
    }
    return position;
  }
}

/**
 * A point set scoped to the replay cursor: points become visible as the cursor passes their
 * index, and every pool query is logarithmic — no per-bar scan of the prefix (ticket 16).
 * Cursors are monotone: call `activateThrough` with non-decreasing indices.
 */
export class ActivePoints implements SnapshotQueries {
  private readonly highs: ActiveSide;
  private readonly lows: ActiveSide;

  constructor(highs: Swing[], lows: Swing[]) {
    this.highs = new ActiveSide(highs);
    this.lows = new ActiveSide(lows);
  }

  /** Bring the set up to the bar at `index`. */
  activateThrough(index: number): void {
    this.highs.activateThrough(index);
    this.lows.activateThrough(index);
  }

  lastHigh(): Swing | undefined {
    return this.highs.last;
  }

  lastLow(): Swing | undefined {
    return this.lows.last;
  }

  nearestLowBelow(price: number): Swing | undefined {
    return this.lows.nearestBelow(price);
  }

  nearestHighAbove(price: number): Swing | undefined {
    return this.highs.nearestAbove(price);
  }

  lowestLowBelow(price: number): Swing | undefined {
    return this.lows.lowestBelow(price);
  }

  highestHighAbove(price: number): Swing | undefined {
    return this.highs.highestAbove(price);
  }
}

/** The still-open candidate: its right edge is the tail, so it is re-derived on each fold. */
interface Open {
  readonly index: number;
  readonly high: Swing;
  readonly low: Swing;
  readonly priorLow: Swing | undefined;
  pivotHigh: boolean;
  pivotLow: boolean;
  qualifiedHigh: boolean;
  qualifiedLow: boolean;
  /** Activation already recorded, so re-qualification never double-pushes. */
  seenHigh: boolean;
  seenLow: boolean;
}

/** A pivot high awaiting a later low that breaks its prior low. */
interface PendingHigh {
  price: number;
  swing: Swing;
}

/**
 * `findSignificantPoints` as a single forward pass. Fold the series bar by bar; when an
 * aggregate's tail is still being built, `update` it with the refreshed candle. Reads answer
 * for the prefix folded so far, exactly as the pure function would over that prefix.
 */
export class RollingPoints implements SnapshotQueries {
  /** The series folded so far; the last bar may be replaced by `update`. */
  readonly bars: Bar[] = [];
  /** Points in the order their prefixes first showed them, for pair-prefix reads. */
  readonly activations: Activation[] = [];

  private readonly width: number;
  private readonly rules: StructureRules;
  private readonly qualifiedHighs: Swing[] = [];
  private readonly qualifiedLows: Swing[] = [];
  /** Every frozen low pivot, ascending — the prior-low source for later candidates. */
  private readonly pivotLows: Swing[] = [];
  private readonly pending: PendingHigh[] = [];
  /** The settled set, built on first query and kept in step from there. */
  private settled: PointSet | null = null;
  private open: Open | null = null;

  constructor(rules: StructureRules = {}) {
    this.width = rules.swingWidth ?? DEFAULT_SWING_WIDTH;
    this.rules = rules;
  }

  /** Append the next bar of the series. Earlier bars are final from here on. */
  fold(bar: Bar): void {
    this.settle();
    this.bars.push(bar);
    const index = this.bars.length - 1 - this.width;
    if (index >= this.width) {
      this.open = this.candidate(index);
      this.evaluate();
    }
    this.drain();
  }

  /** Replace the still-open last bar — the tail of the aggregate being built. */
  update(bar: Bar): void {
    this.bars[this.bars.length - 1] = bar;
    if (this.open !== null) this.evaluate();
    this.drain();
  }

  /** The prefix's `findSignificantPoints`, materialized in index order. */
  toPoints(): SignificantPoints {
    const highs = [...this.qualifiedHighs];
    const lows = [...this.qualifiedLows];
    const high = this.openHigh();
    const low = this.openLow();
    if (high !== undefined) highs.push(high);
    if (low !== undefined) lows.push(low);
    highs.sort((a, b) => a.index - b.index);
    lows.sort((a, b) => a.index - b.index);
    return { highs, lows };
  }

  lastHigh(): Swing | undefined {
    return later(this.ensureSettled().lastHigh(), this.openHigh());
  }

  lastLow(): Swing | undefined {
    return later(this.ensureSettled().lastLow(), this.openLow());
  }

  maxLow(): Swing | undefined {
    return higher(this.ensureSettled().maxLow(), this.openLow());
  }

  minHigh(): Swing | undefined {
    return lower(this.ensureSettled().minHigh(), this.openHigh());
  }

  nearestLowBelow(price: number, skipIndex?: number): Swing | undefined {
    return higher(
      this.ensureSettled().nearestLowBelow(price, skipIndex),
      this.openLowBelow(price, skipIndex),
    );
  }

  nearestHighAbove(price: number, skipIndex?: number): Swing | undefined {
    return lower(
      this.ensureSettled().nearestHighAbove(price, skipIndex),
      this.openHighAbove(price, skipIndex),
    );
  }

  lowestLowBelow(price: number): Swing | undefined {
    return lower(this.ensureSettled().lowestLowBelow(price), this.openLowBelow(price, undefined));
  }

  highestHighAbove(price: number): Swing | undefined {
    return higher(this.ensureSettled().highestHighAbove(price), this.openHighAbove(price, undefined));
  }

  /** Qualified levels strictly inside (lower, upper), skipping points at or past `limit`. */
  levelsInBand(side: LiquiditySide, lower: number, upper: number, limit: number): Swing[] {
    const found = this.ensureSettled().levelsInBand(side, lower, upper, limit);
    const extra = side === "low" ? this.openLow() : this.openHigh();
    if (extra !== undefined && extra.price > lower && extra.price < upper && extra.index < limit) {
      found.push(extra);
    }
    return found;
  }

  /** Build the settled set once queries are asked of it, then keep it in step. */
  private ensureSettled(): PointSet {
    this.settled ??= PointSet.fromPoints({ highs: this.qualifiedHighs, lows: this.qualifiedLows });
    return this.settled;
  }

  /** The open candidate, if it is currently a qualified low. */
  private openLow(): Swing | undefined {
    const open = this.open;
    return open !== null && open.pivotLow && open.qualifiedLow ? open.low : undefined;
  }

  /** The open candidate, if it is currently a qualified high. */
  private openHigh(): Swing | undefined {
    const open = this.open;
    return open !== null && open.pivotHigh && open.qualifiedHigh ? open.high : undefined;
  }

  private openLowBelow(price: number, skipIndex: number | undefined): Swing | undefined {
    const swing = this.openLow();
    if (swing === undefined || swing.price >= price || swing.index === skipIndex) return undefined;
    return swing;
  }

  private openHighAbove(price: number, skipIndex: number | undefined): Swing | undefined {
    const swing = this.openHigh();
    if (swing === undefined || swing.price <= price || swing.index === skipIndex) return undefined;
    return swing;
  }

  private candidate(index: number): Open {
    const bar = this.bars[index]!;
    return {
      index,
      high: { index, time: bar.time, price: bar.high, kind: "high" },
      low: { index, time: bar.time, price: bar.low, kind: "low" },
      priorLow: this.pivotLows[this.pivotLows.length - 1],
      pivotHigh: false,
      pivotLow: false,
      qualifiedHigh: false,
      qualifiedLow: false,
      seenHigh: false,
      seenLow: false,
    };
  }

  /** Re-derive the open candidate against its neighbours, the live tail included. */
  private evaluate(): void {
    const open = this.open!;
    const bar = this.bars[open.index]!;
    // The candle may have extended since the candidate was created; the swings it stands for
    // must track the candle as it is now.
    open.high.time = bar.time;
    open.high.price = bar.high;
    open.low.time = bar.time;
    open.low.price = bar.low;

    const from = open.index - this.width;
    const to = open.index + this.width;

    let pivotHigh = true;
    let pivotLow = true;
    for (let j = from; j <= to; j++) {
      if (j === open.index) continue;
      const other = this.bars[j]!;
      if (other.high >= bar.high) pivotHigh = false;
      if (other.low <= bar.low) pivotLow = false;
    }
    open.pivotHigh = pivotHigh;
    open.pivotLow = pivotLow;

    const prior = open.priorLow;
    open.qualifiedLow =
      pivotLow &&
      (this.rules.lowQualifies?.(open.low) === true ||
        (prior !== undefined && bar.low < prior.price));

    let broke = this.rules.testedKeyLevel?.(open.high) === true;
    for (let j = open.index + 1; j <= to && !broke; j++) {
      if (prior !== undefined && this.bars[j]!.low < prior.price) broke = true;
    }
    open.qualifiedHigh = pivotHigh && broke;

    if (open.qualifiedHigh && !open.seenHigh) {
      open.seenHigh = true;
      this.activations.push({ index: this.bars.length - 1, side: "high", swing: open.high });
    }
    if (open.qualifiedLow && !open.seenLow) {
      open.seenLow = true;
      this.activations.push({ index: this.bars.length - 1, side: "low", swing: open.low });
    }
  }

  /** Materialize the open candidate now that its window can no longer change. */
  private settle(): void {
    const open = this.open;
    if (open === null) return;
    this.open = null;

    if (open.pivotLow) {
      this.pivotLows.push(open.low);
      if (open.qualifiedLow) {
        this.qualifiedLows.push(open.low);
        this.settled?.add("low", open.low);
      }
    }
    if (open.pivotHigh) {
      if (open.qualifiedHigh) {
        this.qualifiedHighs.push(open.high);
        this.settled?.add("high", open.high);
      } else if (open.priorLow !== undefined) {
        this.pushPending(open.high, open.priorLow.price);
      }
    }
  }

  /** Confirm pending highs against the current tail low — the latest qualifying bar. */
  private drain(): void {
    const low = this.bars[this.bars.length - 1]?.low;
    if (low === undefined) return;
    while (this.pending.length > 0 && this.pending[0]!.price > low) {
      const { swing } = this.popPending();
      this.qualifiedHighs.push(swing);
      this.settled?.add("high", swing);
      this.activations.push({ index: this.bars.length - 1, side: "high", swing });
    }
  }

  private pushPending(swing: Swing, price: number): void {
    this.pending.push({ price, swing });
    let at = this.pending.length - 1;
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (this.pending[parent]!.price >= this.pending[at]!.price) break;
      const swap = this.pending[parent]!;
      this.pending[parent] = this.pending[at]!;
      this.pending[at] = swap;
      at = parent;
    }
  }

  private popPending(): PendingHigh {
    const top = this.pending[0]!;
    const last = this.pending.pop()!;
    if (this.pending.length > 0) {
      this.pending[0] = last;
      let at = 0;
      for (;;) {
        const left = 2 * at + 1;
        const right = left + 1;
        let biggest = at;
        if (left < this.pending.length && this.pending[left]!.price > this.pending[biggest]!.price) {
          biggest = left;
        }
        if (
          right < this.pending.length &&
          this.pending[right]!.price > this.pending[biggest]!.price
        ) {
          biggest = right;
        }
        if (biggest === at) break;
        const swap = this.pending[biggest]!;
        this.pending[biggest] = this.pending[at]!;
        this.pending[at] = swap;
        at = biggest;
      }
    }
    return top;
  }
}

/** Fold a whole series in one forward pass — the replay's linear `findSignificantPoints`. */
export function foldPoints(bars: Bar[], rules: StructureRules = {}): RollingPoints {
  const points = new RollingPoints(rules);
  for (const bar of bars) points.fold(bar);
  return points;
}
