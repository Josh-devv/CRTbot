/**
 * Quick faithful SLP prototype (Toni Iyke) — one month of trades, with a warm-up month.
 *
 * Per the research doc (.scratch/slp-strategy/research/toni-iyke-ruleset.md):
 *   1. Bias: D1 HH/HL vs LH/LL (requires two confirmed D1 swing highs and lows).
 *   2. Anchor: price must tap a D1/H4 POI — here an H4 order block (bearish candle engulfed by
 *      a bullish one, or vice versa), in the bias direction, tapped in the last day.
 *   3. Reversal concept on M15: body close through the last confirmed M15 swing (MSS), then the
 *      first pullback retracing >= 50% of the impulse (the inducement), which must be swept.
 *   4. POI: the M15 order block that caused the MSS (last opposing candle before it). Entry is
 *      the demarcation (wick if the wick is shorter than the body, else the body).
 *   5. Stop: beyond the OB candle (full OB) + a 2-pip FX buffer. No partials, no BE.
 *   6. Target: the D1 cycle liquidity (last confirmed D1 swing high for longs / low for shorts).
 *
 * Trades are measured independently (he takes multiple re-entries per cycle). Limit at the POI
 * after the inducement, 2-day life, invalidated on a close beyond the stop. Spread on entry.
 *
 *   npx tsx scratch-slp2.ts [--test-from YYYY-MM-DD] [--test-to YYYY-MM-DD] [--load-from ...]
 */
import { aggregate } from "./src/candles.js";
import { DEFAULT_DATA_DIR, loadSeries } from "./src/ingest.js";
import { findSwings } from "./src/structure.js";
import { DEFAULT_SESSION_CONFIG } from "./src/time.js";
import type { Bar, Direction, Instrument, StrategyConfig } from "./src/types.js";

const DAY = 86_400_000;
const H4 = 4 * 60 * 60 * 1000;
const SPREAD = 0.0001;
const STOP_BUFFER = 0.0002; // 2 pips for GBPUSD/EURUSD (source's 4-5 is gold/GJ; see open questions)
const LIMIT_LIFE_BARS = 192; // 2 days of M15
const SWING_WIDTH = 2;
const MSS_WINDOW = 100;
const PULLBACK_BARS = 30;
const ANCHOR_LOOKBACK = 96; // one day of M15

function baseConfig(instrument: Instrument): StrategyConfig {
  return {
    instrument,
    session: DEFAULT_SESSION_CONFIG,
    structure: { swingWidth: SWING_WIDTH },
    strategy: { stopDistance: 0.001 },
    risk: { rMultiple: 3, maxTradesPerDay: 1, riskPerTradePct: 0.01 },
    costs: {
      spread: SPREAD,
      commission: 0,
      slippage: 0,
      sensitivity: { optimistic: 0.00005, pessimistic: 0.00025 },
    },
    initialEquity: 10000,
    smt: { enabled: true, pairs: [["GBPUSD", "EURUSD"]], useDxy: false },
  };
}

function flag(rest: string[], name: string): string | undefined {
  const index = rest.indexOf(name);
  return index === -1 ? undefined : rest[index + 1];
}

function dayBound(text: string, bound: "start" | "end"): number {
  const start = Date.parse(`${text}T00:00:00Z`);
  return bound === "start" ? start : start + DAY - 1;
}

interface Zone {
  direction: Direction;
  zoneLow: number;
  zoneHigh: number;
  formedAt: number;
}

/** H4 order blocks: the engulfed candle is the zone, known at the close of the engulfing candle. */
function h4Zones(candles: Bar[]): Zone[] {
  const zones: Zone[] = [];
  for (let i = 1; i < candles.length; i++) {
    const first = candles[i - 1]!;
    const second = candles[i]!;
    const bullish = first.close < first.open && second.close > second.open &&
      second.close >= first.open && second.open <= first.close;
    const bearish = first.close > first.open && second.close < second.open &&
      second.close <= first.open && second.open >= first.close;
    if (bullish || bearish) {
      zones.push({
        direction: bullish ? "long" : "short",
        zoneLow: first.low,
        zoneHigh: first.high,
        formedAt: candles[i]!.time + H4,
      });
    }
  }
  return zones;
}

interface D1State {
  bias: "bullish" | "bearish" | "none";
  lastHigh: number | null;
  lastLow: number | null;
}

const d1 = new Map<number, D1State>();
const h4Cache = new Map<number, D1State>();

function hhhlState(cache: Map<number, D1State>, time: number, candles: Bar[], unit: number, min: number, width: number): D1State {
  let count = 0;
  for (const candle of candles) {
    if (candle.time + unit <= time) count++;
    else break;
  }
  const cached = cache.get(count);
  if (cached !== undefined) return cached;

  let state: D1State = { bias: "none", lastHigh: null, lastLow: null };
  if (count >= min) {
    const closed = candles.slice(0, count);
    const swings = findSwings(closed, width);
    const highs = swings.filter((swing) => swing.kind === "high" && swing.index + width < count);
    const lows = swings.filter((swing) => swing.kind === "low" && swing.index + width < count);
    if (highs.length >= 2 && lows.length >= 2) {
      const h0 = highs[highs.length - 2]!.price;
      const h1 = highs[highs.length - 1]!.price;
      const l0 = lows[lows.length - 2]!.price;
      const l1 = lows[lows.length - 1]!.price;
      const bias: D1State["bias"] =
        h1 > h0 && l1 > l0 ? "bullish" : h1 < h0 && l1 < l0 ? "bearish" : "none";
      state = { bias, lastHigh: h1, lastLow: l1 };
    }
  }
  cache.set(count, state);
  return state;
}

function d1State(time: number, candles: Bar[]): D1State {
  return hhhlState(d1, time, candles, DAY, 4, d1Width);
}

function h4State(time: number, candles: Bar[]): D1State {
  return hhhlState(h4Cache, time, candles, H4, 6, 1);
}

interface Setup {
  direction: Direction;
  entry: number;
  stop: number;
  target: number;
  risk: number;
  plannedR: number;
  mssTime: number;
  inducementLow: number;
  origin: Bar;
}

function wickEntry(candle: Bar, direction: Direction): number {
  if (direction === "long") {
    // Bearish OB: demarcation at the body top (open) or the wick top (high).
    const body = candle.open - candle.close;
    const wick = candle.high - candle.open;
    return wick < body ? candle.high : candle.open;
  }
  // Bullish OB: demarcation at the body bottom (open) or the wick bottom (low).
  const body = candle.close - candle.open;
  const wick = candle.open - candle.low;
  return wick < body ? candle.low : candle.open;
}

type TargetMode = "cycle" | "nearest" | "menu";

const rest = process.argv.slice(2);
const targetMode = (flag(rest, "--target") ?? "cycle") as TargetMode;
const menuMinR = Number(flag(rest, "--menu-min-r") ?? 3);
const d1Width = Number(flag(rest, "--d1-width") ?? 1);
const h4Confirm = rest.includes("--h4-confirm");
const loadFrom = dayBound(flag(rest, "--load-from") ?? "2024-11-01", "start");
const testFrom = dayBound(flag(rest, "--test-from") ?? "2024-12-01", "start");
const testTo = dayBound(flag(rest, "--test-to") ?? "2024-12-31", "end");

const cfg = baseConfig("GBPUSD");
const series = await loadSeries("GBPUSD", loadFrom, testTo, cfg, { dir: DEFAULT_DATA_DIR });
const bars = series.bars;
const h4 = aggregate(bars, "H4", cfg);
const d1Bars = aggregate(bars, "D1", cfg);
const zones = h4Zones(h4);
const swings = findSwings(bars, SWING_WIDTH);

function lastSwing(kind: "high" | "low", i: number): { index: number; price: number } | null {
  let found: { index: number; price: number } | null = null;
  for (const swing of swings) {
    if (swing.kind !== kind) continue;
    if (swing.index + SWING_WIDTH > i) break;
    found = { index: swing.index, price: swing.price };
  }
  return found;
}

function tapsZone(direction: Direction, i: number, zones: Zone[], bar: Bar): boolean {
  for (const zone of zones) {
    if (zone.direction !== direction || zone.formedAt >= bar.time) continue;
    for (let k = Math.max(0, i - ANCHOR_LOOKBACK); k <= i; k++) {
      const candle = bars[k]!;
      if (candle.low <= zone.zoneHigh && candle.high >= zone.zoneLow) return true;
    }
  }
  return false;
}

interface Trade {
  time: number;
  bias: D1State["bias"];
  direction: Direction;
  targetKind: "nearest" | "menu" | "cycle";
  entry: number;
  stop: number;
  target: number;
  exit: number;
  r: number;
  plannedR: number;
  riskPips: number;
  reason: "target" | "stop" | "open";
}

const trades: Trade[] = [];
let mssCount = 0;
let anchoredCount = 0;
let inducementCount = 0;
let setupCount = 0;
let filledCount = 0;

for (let i = 2; i < bars.length - 1; i++) {
  const bar = bars[i]!;
  if (bar.time < testFrom) continue;

  const state = d1State(bar.time, d1Bars);
  if (state.bias === "none") continue;
  if (h4Confirm && h4State(bar.time, h4).bias !== state.bias) continue;

  const direction: Direction = state.bias === "bullish" ? "long" : "short";
  const high = lastSwing("high", i);
  const low = lastSwing("low", i);
  if (high === null || low === null) continue;

  const previous = bars[i - 1]!;
  const mss = direction === "long"
    ? previous.close <= high.price && bar.close > high.price
    : previous.close >= low.price && bar.close < low.price;
  if (!mss) continue;
  mssCount++;

  if (!tapsZone(direction, i, zones, bar)) continue;
  anchoredCount++;

  // POI: the last opposing candle before the break (the OB that caused the MSS).
  let originIndex = -1;
  for (let j = i - 1; j >= Math.max(0, i - 10); j--) {
    const candle = bars[j]!;
    if (direction === "long" ? candle.close < candle.open : candle.close > candle.open) {
      originIndex = j;
      break;
    }
  }
  if (originIndex === -1) continue;
  const origin = bars[originIndex]!;

  const entry = wickEntry(origin, direction) + (direction === "long" ? SPREAD : -SPREAD);
  const stop = direction === "long" ? origin.low - STOP_BUFFER : origin.high + STOP_BUFFER;
  const risk = direction === "long" ? entry - stop : stop - entry;
  if (risk <= 0) continue;

  // Impulse origin and the >=50% pullback (inducement).
  const impulseOrigin = direction === "long" ? lastSwing("low", i) : lastSwing("high", i);
  if (impulseOrigin === null || impulseOrigin.index < Math.max(0, i - MSS_WINDOW)) continue;
  const mssExtreme = direction === "long" ? bar.high : bar.low;
  const midpoint = (impulseOrigin.price + mssExtreme) / 2;

  let pullbackIndex = -1;
  for (let j = i + 1; j <= Math.min(bars.length - 1, i + PULLBACK_BARS); j++) {
    const candle = bars[j]!;
    const reached = direction === "long" ? candle.low <= midpoint : candle.high >= midpoint;
    if (reached) {
      pullbackIndex = j;
      break;
    }
  }
  if (pullbackIndex === -1) continue;
  const pullback = bars[pullbackIndex]!;
  // The pullback must not invalidate the impulse.
  if (direction === "long" ? pullback.low <= impulseOrigin.price : pullback.high >= impulseOrigin.price) continue;
  inducementCount++;

  // The POI must sit beyond the inducement, so the sweep is what fills it.
  if (direction === "long" ? entry >= pullback.low : entry <= pullback.high) continue;

  // Target: the source's liquidity menu. `cycle` aims at the D1 cycle swing (last confirmed D1
  // high/low); `nearest` aims at the closest untaken M15 swing; `menu` takes the nearest untaken
  // M15 swing worth `menuMinR` and falls back to the cycle swing.
  const cycle = direction === "long" ? state.lastHigh : state.lastLow;
  let target: number | null = null;
  let targetKind: "nearest" | "menu" | "cycle" = "cycle";
  if (targetMode !== "cycle") {
    const targets = swings
      .filter((swing) => swing.kind === (direction === "long" ? "high" : "low"))
      .filter((swing) => swing.index + SWING_WIDTH <= i)
      .filter((swing) => direction === "long" ? swing.price > mssExtreme : swing.price < mssExtreme)
      .sort((a, b) => direction === "long" ? a.price - b.price : b.price - a.price);
    for (const candidate of targets) {
      const r = direction === "long" ? (candidate.price - entry) / risk : (entry - candidate.price) / risk;
      if (targetMode === "nearest" || r >= menuMinR) {
        target = candidate.price;
        targetKind = targetMode;
        break;
      }
    }
  }
  if (target === null && cycle !== null && (direction === "long" ? cycle > entry : cycle < entry)) {
    target = cycle;
    targetKind = "cycle";
  }
  if (target === null) continue;
  const plannedR = direction === "long" ? (target - entry) / risk : (entry - target) / risk;
  if (plannedR <= 0) continue;
  setupCount++;

  // Resting limit after the inducement, two days.
  let fillIndex = -1;
  let fill = 0;
  for (let j = pullbackIndex + 1; j < bars.length && j <= pullbackIndex + LIMIT_LIFE_BARS; j++) {
    const candle = bars[j]!;
    const hit = direction === "long" ? candle.low <= entry : candle.high >= entry;
    if (hit) {
      fillIndex = j;
      fill = direction === "long" ? Math.min(candle.open, entry) + SPREAD : Math.max(candle.open, entry) - SPREAD;
      break;
    }
    const invalid = direction === "long" ? candle.close < stop : candle.close > stop;
    if (invalid) break;
  }
  if (fillIndex === -1) continue;
  const fillRisk = direction === "long" ? fill - stop : stop - fill;
  if (fillRisk <= 0) continue;

  const targetR = direction === "long" ? (target - fill) / fillRisk : (fill - target) / fillRisk;
  if (targetR <= 0) continue;
  filledCount++;
  let resolved: { exit: number; r: number; reason: Trade["reason"] } | null = null;
  for (let j = fillIndex; j < bars.length; j++) {
    const candle = bars[j]!;
    const stopHit = direction === "long" ? candle.low <= stop : candle.high >= stop;
    const targetHit = direction === "long" ? candle.high >= target : candle.low <= target;
    if (stopHit) {
      resolved = { exit: stop, r: -1, reason: "stop" };
      break;
    }
    if (targetHit) {
      resolved = { exit: target, r: targetR, reason: "target" };
      break;
    }
  }
  if (resolved === null) {
    const lastBar = bars[bars.length - 1]!;
    const exit = lastBar.close;
    resolved = {
      exit,
      r: direction === "long" ? (exit - fill) / fillRisk : (fill - exit) / fillRisk,
      reason: "open",
    };
  }

  trades.push({
    time: bar.time,
    bias: state.bias,
    direction,
    targetKind,
    entry: fill,
    stop,
    target,
    exit: resolved.exit,
    r: resolved.r,
    plannedR: targetR,
    riskPips: fillRisk * 10000,
    reason: resolved.reason,
  });
}

const wins = trades.filter((trade) => trade.reason === "target").length;
const netR = trades.reduce((sum, trade) => sum + trade.r, 0);
const gains = trades.reduce((sum, trade) => (trade.r > 0 ? sum + trade.r : sum), 0);
const losses = trades.reduce((sum, trade) => (trade.r < 0 ? sum + trade.r : sum), 0);

console.log(
  `SLP faithful prototype — GBPUSD trades ${new Date(testFrom).toISOString().slice(0, 10)} .. ` +
    `${new Date(testTo).toISOString().slice(0, 10)}` +
    `  (loaded from ${new Date(loadFrom).toISOString().slice(0, 10)}; M15=${bars.length} H4=${h4.length} D1=${d1Bars.length})\n`,
);
console.log(
  `config: target=${targetMode}${targetMode === "menu" ? `(min ${menuMinR}R)` : ""}  d1-width=${d1Width}  h4-confirm=${h4Confirm}`,
);
console.log(
  `MSS=${mssCount}  anchored at H4 POI=${anchoredCount}  inducement>=50%=${inducementCount}` +
    `  valid POI setups=${setupCount}  fills=${filledCount}`,
);
console.log(
  `trades=${trades.length}  wins=${wins} (${(100 * wins / Math.max(1, trades.length)).toFixed(1)}%)` +
    `  avgR=${(netR / Math.max(1, trades.length)).toFixed(3)}  netR=${netR.toFixed(1)}` +
    `  PF=${(gains / Math.abs(losses || 1)).toFixed(2)}` +
    `  avgPlannedR=${(trades.reduce((sum, trade) => sum + trade.plannedR, 0) / Math.max(1, trades.length)).toFixed(2)}` +
    `  avgRiskPips=${(trades.reduce((sum, trade) => sum + trade.riskPips, 0) / Math.max(1, trades.length)).toFixed(1)}`,
);

if (trades.length > 0) {
  console.log("\ntrades:");
  for (const trade of trades) {
    console.log(
      `  ${new Date(trade.time).toISOString().slice(0, 16).replace("T", " ")}` +
        `  ${trade.direction.padEnd(5)}` +
        `  R=${trade.r.toFixed(2).padStart(6)}` +
        `  planned=${trade.plannedR.toFixed(2).padStart(5)}` +
        `  risk=${trade.riskPips.toFixed(1)}p` +
        `  target=${trade.targetKind.padEnd(7)}` +
        `  ${trade.reason}`,
    );
  }
}
