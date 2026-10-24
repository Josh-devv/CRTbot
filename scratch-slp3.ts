/**
 * SLP prototype v3 — owner-requested fidelity additions (direction / structure / untouched POI):
 *
 *   1. DIRECTION FIRST, verified by HTF key levels: D1 HH/HL bias, the last confirmed D1 swing low
 *      must still hold (longs; high for shorts) and the D1 cycle target (last confirmed opposite
 *      swing) must be untaken. No trade against the HTF key levels.
 *   2. STRUCTURE, 4H is the anchor frame: the 4H HH/HL read must agree with the D1 bias and a 4H
 *      MSS/BOS (body close through the last confirmed 4H swing) in the bias direction is the
 *      trigger event.
 *   3. INDUCEMENT: the first M15 pullback retracing >= 50% of the 4H event leg (leg origin = last
 *      confirmed 4H swing before the break, extreme = the event extreme), without invalidating the
 *      leg origin.
 *   4. POI: the closest-to-the-inducement UNTOUCHED (unmitigated since the structure event) order
 *      block or breaker on 4H / 3H / 1H / 45m / 30m, sitting beyond the inducement, in the bias
 *      direction. The four validity rules: caused the break (formed at or before it), protected by
 *      the inducement (zone beyond the pullback extreme), unmitigated since the break, closest to
 *      the inducement. Breaker entries start from the body; OB entries use the wick/body rule.
 *   5. STOP beyond the zone + 2-pip buffer; TARGET the nearest significant untaken liquidity pool
 *      beyond the leg extreme (H4/H1/D1 swings, day extremes; floored by --min-r so the draw is
 *      far enough to be a real draw), else the D1 cycle level. Limit life 2 days, invalidated by a
 *      close beyond the stop; independent trades.
 *
 *   npx tsx scratch-slp3.ts --test-from 2024-10-01 --test-to 2024-12-31 --load-from 2024-09-01
 */
import { aggregate } from "./src/candles.js";
import { DEFAULT_DATA_DIR, loadSeries } from "./src/ingest.js";
import { findSwings } from "./src/structure.js";
import { DEFAULT_SESSION_CONFIG } from "./src/time.js";
import type { Bar, Direction, Instrument, StrategyConfig } from "./src/types.js";

const MINUTE = 60_000;
const DAY = 86_400_000;
const H4 = 4 * 60 * 60 * 1000;
const SPREAD = 0.0001;
const STOP_BUFFER = 0.0002;
const LIMIT_LIFE_BARS = 192; // 2 days of M15
const SWING_WIDTH = 2;
const EVENT_PULLBACK_BARS = 96; // one day of M15 for the inducement to form

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

type TargetMode = "cycle" | "nearest" | "menu";

const rest = process.argv.slice(2);
const instrument = (flag(rest, "--instrument") ?? "GBPUSD") as Instrument;
const targetMode = (flag(rest, "--target") ?? "nearest") as TargetMode;
const minR = Number(flag(rest, "--min-r") ?? 2);
const h4StructureGate = !rest.includes("--no-h4-structure");
const confirmEntry = rest.includes("--confirm-entry");
const loadFrom = dayBound(flag(rest, "--load-from") ?? "2024-09-01", "start");
const testFrom = dayBound(flag(rest, "--test-from") ?? "2024-10-01", "start");
const testTo = dayBound(flag(rest, "--test-to") ?? "2024-12-31", "end");

// ---------------------------------------------------------------------------------------------
// Zones: order blocks (engulf pairs) with breaker conversion, per timeframe.

interface Zone {
  tf: number;
  direction: Direction;
  isBreaker: boolean;
  low: number;
  high: number;
  bodyLow: number;
  bodyHigh: number;
  origin: Bar;
  /** When the acting direction began: formation, or the close that converted it to a breaker. */
  formedAt: number;
}

/** Epoch-aligned bucketing for the prototype's extra timeframes (engine only supports M15/H4). */
function tfBars(bars: Bar[], minutes: number): Bar[] {
  const ms = minutes * MINUTE;
  const out: Bar[] = [];
  for (const bar of bars) {
    const key = Math.floor(bar.time / ms) * ms;
    const last = out[out.length - 1];
    if (last === undefined || last.time !== key) {
      out.push({ time: key, open: bar.open, high: bar.high, low: bar.low, close: bar.close });
    } else {
      last.high = Math.max(last.high, bar.high);
      last.low = Math.min(last.low, bar.low);
      last.close = bar.close;
    }
  }
  return out;
}

function buildZones(candles: Bar[], tfMinutes: number): Zone[] {
  const ms = tfMinutes * MINUTE;
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
        tf: tfMinutes,
        direction: bullish ? "long" : "short",
        isBreaker: false,
        low: first.low,
        high: first.high,
        bodyLow: Math.min(first.open, first.close),
        bodyHigh: Math.max(first.open, first.close),
        origin: first,
        formedAt: second.time + ms,
      });
    }
  }

  // Breaker conversion: a body close through the zone fails it; it then acts the other way.
  for (const zone of zones) {
    for (const candle of candles) {
      const readyAt = zone.formedAt;
      if (candle.time + ms <= readyAt) continue;
      if (zone.direction === "long" && candle.close < zone.low) {
        zone.direction = "short";
        zone.isBreaker = true;
        zone.formedAt = candle.time + ms;
        break;
      }
      if (zone.direction === "short" && candle.close > zone.high) {
        zone.direction = "long";
        zone.isBreaker = true;
        zone.formedAt = candle.time + ms;
        break;
      }
    }
  }
  return zones;
}

/** Demarcation: breakers start from the body (proximal body edge); OBs use the wick/body rule. */
function demarcation(zone: Zone): number {
  if (zone.isBreaker) {
    return zone.direction === "long" ? zone.bodyHigh : zone.bodyLow;
  }
  const o = zone.origin;
  if (zone.direction === "long") {
    const body = o.open - o.close;
    const wick = o.high - o.open;
    return wick < body ? o.high : o.open;
  }
  const body = o.close - o.open;
  const wick = o.open - o.low;
  return wick < body ? o.low : o.open;
}

// ---------------------------------------------------------------------------------------------
// Direction: D1 bias with HTF key levels respected, plus the 4H HH/HL read.

interface BiasState {
  bias: "bullish" | "bearish" | "none";
  lastHigh: number | null;
  lastLow: number | null;
}

const d1Cache = new Map<number, BiasState>();
const h4Cache = new Map<number, BiasState>();

function hhhl(cache: Map<number, BiasState>, time: number, candles: Bar[], unit: number, min: number): BiasState {
  let count = 0;
  for (const candle of candles) {
    if (candle.time + unit <= time) count++;
    else break;
  }
  const cached = cache.get(count);
  if (cached !== undefined) return cached;

  let state: BiasState = { bias: "none", lastHigh: null, lastLow: null };
  if (count >= min) {
    const closed = candles.slice(0, count);
    const swings = findSwings(closed, 1);
    const highs = swings.filter((s) => s.kind === "high" && s.index + 1 < count);
    const lows = swings.filter((s) => s.kind === "low" && s.index + 1 < count);
    if (highs.length >= 2 && lows.length >= 2) {
      const h0 = highs[highs.length - 2]!.price;
      const h1 = highs[highs.length - 1]!.price;
      const l0 = lows[lows.length - 2]!.price;
      const l1 = lows[lows.length - 1]!.price;
      const bias: BiasState["bias"] =
        h1 > h0 && l1 > l0 ? "bullish" : h1 < h0 && l1 < l0 ? "bearish" : "none";
      state = { bias, lastHigh: h1, lastLow: l1 };
    }
  }
  cache.set(count, state);
  return state;
}

// ---------------------------------------------------------------------------------------------
// 4H structure events: body close through the last confirmed 4H swing, with their leg.

interface H4Event {
  direction: Direction;
  /** Time the event candle closed (the event is known from here on). */
  time: number;
  legOrigin: number;
  extreme: number;
}

function h4Events(h4: Bar[]): H4Event[] {
  const swings = findSwings(h4, 1);
  const events: H4Event[] = [];
  let highPointer = 0;
  let lowPointer = 0;
  let lastHigh: { index: number; price: number } | null = null;
  let lastLow: { index: number; price: number } | null = null;

  for (let i = 0; i < h4.length; i++) {
    while (highPointer < swings.length) {
      const swing = swings[highPointer]!;
      if (swing.index + 1 > i) break;
      if (swing.kind === "high") lastHigh = { index: swing.index, price: swing.price };
      highPointer++;
    }
    while (lowPointer < swings.length) {
      const swing = swings[lowPointer]!;
      if (swing.index + 1 > i) break;
      if (swing.kind === "low") lastLow = { index: swing.index, price: swing.price };
      lowPointer++;
    }

    const close = h4[i]!.close;
    if (lastHigh !== null && close > lastHigh.price && lastLow !== null) {
      let extreme = h4[lastLow.index]!.high;
      for (let k = lastLow.index; k <= i; k++) extreme = Math.max(extreme, h4[k]!.high);
      events.push({ direction: "long", time: h4[i]!.time + H4, legOrigin: lastLow.price, extreme });
    }
    if (lastLow !== null && close < lastLow.price && lastHigh !== null) {
      let extreme = h4[lastHigh.index]!.low;
      for (let k = lastHigh.index; k <= i; k++) extreme = Math.min(extreme, h4[k]!.low);
      events.push({ direction: "short", time: h4[i]!.time + H4, legOrigin: lastHigh.price, extreme });
    }
  }
  return events;
}

// ---------------------------------------------------------------------------------------------
// Data.

const cfg = baseConfig(instrument);
const series = await loadSeries(instrument, loadFrom, testTo, cfg, { dir: DEFAULT_DATA_DIR });
const bars = series.bars;
const h4 = aggregate(bars, "H4", cfg);
const d1Bars = aggregate(bars, "D1", cfg);
const zones: Zone[] = [
  ...buildZones(h4, 240),
  ...buildZones(tfBars(bars, 180), 180),
  ...buildZones(tfBars(bars, 60), 60),
  ...buildZones(tfBars(bars, 45), 45),
  ...buildZones(tfBars(bars, 30), 30),
];
const events = h4Events(h4);

// Significant liquidity pools for targets: H4/H1/D1 swings and day extremes. These are the
// draws an experienced eye would target — not M15 fractals sitting next to the entry.
interface Pool {
  price: number;
  /** Time the pool became known (confirmation close). */
  time: number;
  label: string;
  kind: "high" | "low";
}

function swingPools(candles: Bar[], tfMs: number, width: number, label: string): Pool[] {
  const pools: Pool[] = [];
  for (const swing of findSwings(candles, width)) {
    const confirm = candles[Math.min(swing.index + width, candles.length - 1)]!;
    pools.push({ price: swing.price, time: confirm.time + tfMs, label, kind: swing.kind });
  }
  return pools;
}

const pools: Pool[] = [
  ...swingPools(h4, H4, 1, "H4"),
  ...swingPools(tfBars(bars, 60), 60 * MINUTE, 2, "H1"),
  ...swingPools(d1Bars, DAY, 1, "D1"),
  ...d1Bars.flatMap((day) => [
    { price: day.high, time: day.time + DAY, label: "day", kind: "high" as const },
    { price: day.low, time: day.time + DAY, label: "day", kind: "low" as const },
  ]),
];

function overlaps(bar: Bar, zone: Zone): boolean {
  return bar.low <= zone.high && bar.high >= zone.low;
}

// ---------------------------------------------------------------------------------------------
// Entry scan: per event, find the inducement, the untouched zone beyond it, fill and resolve.

interface PlacedTrade {
  time: number;
  direction: Direction;
  zoneTf: number;
  zoneKind: "breaker" | "ob";
  targetLabel: string;
  entry: number;
  stop: number;
  target: number;
  exit: number;
  r: number;
  plannedR: number;
  riskPips: number;
  reason: "target" | "stop" | "open";
}

const trades: PlacedTrade[] = [];
const usedZones = new Set<Zone>();
let eventsLive = 0;
let gated = 0;
let inducementFound = 0;
let zoneSetups = 0;
let mitigatedAway = 0;
let fills = 0;
let noDraw = 0;

for (const event of events) {
  if (event.time < testFrom || event.time > testTo) continue;
  eventsLive++;

  // M15 resume point.
  let start = 0;
  while (start < bars.length && bars[start]!.time < event.time) start++;

  const direction = event.direction;
  const mid = (event.legOrigin + event.extreme) / 2;

  let inducementIndex = -1;
  let pullbackExtreme = direction === "long" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  for (let k = start; k <= Math.min(bars.length - 1, start + EVENT_PULLBACK_BARS); k++) {
    const candle = bars[k]!;
    pullbackExtreme = direction === "long" ? Math.min(pullbackExtreme, candle.low) : Math.max(pullbackExtreme, candle.high);
    const reached = direction === "long" ? candle.low <= mid : candle.high >= mid;
    if (reached) {
      const invalid = direction === "long" ? candle.low <= event.legOrigin : candle.high >= event.legOrigin;
      if (!invalid) inducementIndex = k;
      break;
    }
  }
  if (inducementIndex === -1) continue;
  inducementFound++;

  const inducementBar = bars[inducementIndex]!;

  // Direction gate: D1 bias (HH/HL) with HTF key levels respected, and 4H structure aligned.
  const d1State = hhhl(d1Cache, inducementBar.time, d1Bars, DAY, 4);
  const wanted = direction === "long" ? "bullish" : "bearish";
  if (d1State.bias !== wanted || d1State.lastHigh === null || d1State.lastLow === null) continue;
  const close = inducementBar.close;
  // HTF key levels respected: the bias's protective level must still hold. A bullish bias is only
  // tradable while the last confirmed D1 swing low holds; a bearish bias while the D1 high holds.
  const levelsRespected = direction === "long"
    ? close > d1State.lastLow
    : close < d1State.lastHigh;
  if (!levelsRespected) continue;
  if (h4StructureGate && hhhl(h4Cache, inducementBar.time, h4, H4, 6).bias !== d1State.bias) continue;
  gated++;

  // Eligible POIs: direction-aligned, formed at or before the break, unmitigated since it, and
  // beyond the inducement so the sweep is what fills them.
  const eligible = zones.filter((zone) => {
    if (usedZones.has(zone)) return false;
    if (zone.direction !== direction || zone.formedAt > event.time + H4) return false;
    if (direction === "long" && zone.high > pullbackExtreme) return false;
    if (direction === "short" && zone.low < pullbackExtreme) return false;
    for (let k = start; k <= inducementIndex; k++) {
      if (overlaps(bars[k]!, zone)) return false;
    }
    return true;
  });
  if (eligible.length === 0) continue;

  // Closest to the inducement: the highest zone under it (longs), lowest zone above (shorts).
  eligible.sort((a, b) => direction === "long" ? b.high - a.high : a.low - b.low);
  const zone = eligible[0]!;
  zoneSetups++;

  const entry = demarcation(zone) + (direction === "long" ? SPREAD : -SPREAD);
  const stop = direction === "long" ? zone.low - STOP_BUFFER : zone.high + STOP_BUFFER;
  const risk = direction === "long" ? entry - stop : stop - entry;
  if (risk <= 0) continue;
  if (direction === "long" ? entry >= pullbackExtreme : entry <= pullbackExtreme) continue;

  // Fill scan: first touch of the zone from beyond the inducement. In limit mode a touch that
  // misses the demarcation still mitigates the zone and kills the setup; in confirm mode the
  // entry waits for a bar that touches and closes back at/above the demarcation (the "watch the
  // market, don't just pend orders" variant).
  let fillIndex = -1;
  let fill = 0;
  for (let k = inducementIndex + 1; k < bars.length && k <= inducementIndex + LIMIT_LIFE_BARS; k++) {
    const candle = bars[k]!;
    if (confirmEntry) {
      const touched = direction === "long" ? candle.low <= entry : candle.high >= entry;
      const confirmed = direction === "long" ? candle.close >= entry : candle.close <= entry;
      if (touched && confirmed) {
        fillIndex = k;
        fill = candle.close + (direction === "long" ? SPREAD : -SPREAD);
        break;
      }
    } else {
      const hit = direction === "long" ? candle.low <= entry : candle.high >= entry;
      if (hit) {
        fillIndex = k;
        fill = direction === "long" ? Math.min(candle.open, entry) + SPREAD : Math.max(candle.open, entry) - SPREAD;
        break;
      }
      if (overlaps(candle, zone)) {
        mitigatedAway++;
        break;
      }
    }
    const invalid = direction === "long" ? candle.close < stop : candle.close > stop;
    if (invalid) break;
  }
  if (fillIndex === -1) continue;
  const fillRisk = direction === "long" ? fill - stop : stop - fill;
  if (fillRisk <= 0) continue;
  fills++;
  usedZones.add(zone);

  // Target: the nearest significant untaken liquidity pool beyond the leg extreme, from the
  // source's draw-on-liquidity menu (H4/H1/D1 swings, day extremes), else the D1 cycle level.
  // A draw closer than the floor is not a draw: move to the next pool, or skip the setup.
  const floor = targetMode === "menu" ? 3 : minR;
  const fillTime = bars[fillIndex]!.time;
  let target: number | null = null;
  let targetLabel = "cycle";
  if (targetMode !== "cycle") {
    const candidates = pools
      .filter((pool) => (direction === "long" ? pool.kind === "high" : pool.kind === "low"))
      .filter((pool) => pool.time <= fillTime)
      .filter((pool) => direction === "long" ? pool.price > event.extreme : pool.price < event.extreme)
      .sort((a, b) => direction === "long" ? a.price - b.price : b.price - a.price);
    for (const pool of candidates) {
      const r = direction === "long" ? (pool.price - fill) / fillRisk : (fill - pool.price) / fillRisk;
      if (r >= floor) {
        target = pool.price;
        targetLabel = pool.label;
        break;
      }
    }
  }
  if (target === null) {
    const cycle = direction === "long" ? d1State.lastHigh : d1State.lastLow;
    if (cycle !== null && (direction === "long" ? cycle > event.extreme : cycle < event.extreme)) {
      const r = direction === "long" ? (cycle - fill) / fillRisk : (fill - cycle) / fillRisk;
      if (r >= floor) target = cycle;
    }
  }
  if (target === null) {
    noDraw++;
    continue;
  }

  const targetR = direction === "long" ? (target - fill) / fillRisk : (fill - target) / fillRisk;
  if (targetR <= 0) continue;

  let resolved: { exit: number; r: number; reason: PlacedTrade["reason"] } | null = null;
  for (let k = fillIndex; k < bars.length; k++) {
    const candle = bars[k]!;
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
    const exit = bars[bars.length - 1]!.close;
    resolved = {
      exit,
      r: direction === "long" ? (exit - fill) / fillRisk : (fill - exit) / fillRisk,
      reason: "open",
    };
  }

  trades.push({
    time: bars[fillIndex]!.time,
    direction,
    zoneTf: zone.tf,
    zoneKind: zone.isBreaker ? "breaker" : "ob",
    targetLabel,
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

// ---------------------------------------------------------------------------------------------
// Report.

const wins = trades.filter((trade) => trade.reason === "target").length;
const netR = trades.reduce((sum, trade) => sum + trade.r, 0);
const gains = trades.reduce((sum, trade) => (trade.r > 0 ? sum + trade.r : sum), 0);
const losses = trades.reduce((sum, trade) => (trade.r < 0 ? sum + trade.r : sum), 0);

console.log(
  `SLP v3 (4H-anchored, untouched POIs) — ${instrument} trades ${new Date(testFrom).toISOString().slice(0, 10)} .. ` +
    `${new Date(testTo).toISOString().slice(0, 10)}  (loaded from ${new Date(loadFrom).toISOString().slice(0, 10)}; M15=${bars.length} H4=${h4.length})\n`,
);
console.log(`config: target=${targetMode}  min-r=${minR}  h4-structure-gate=${h4StructureGate}  confirm-entry=${confirmEntry}  pools=${pools.length}`);
console.log(
  `4H events in window=${eventsLive}  inducement>=50%=${inducementFound}  direction+key-levels+4H structure ok=${gated}` +
    `  untouched POI setups=${zoneSetups}  mitigated before fill=${mitigatedAway}  fills=${fills}  no valid draw=${noDraw}`,
);
const rrs = trades.map((trade) => trade.plannedR).sort((a, b) => a - b);
console.log(
  `trades=${trades.length}  wins=${wins} (${(100 * wins / Math.max(1, trades.length)).toFixed(1)}%)` +
    `  avgR=${(netR / Math.max(1, trades.length)).toFixed(3)}  netR=${netR.toFixed(1)}` +
    `  PF=${(gains / Math.abs(losses || 1)).toFixed(2)}` +
    `  plannedR min/med/max=${(rrs[0] ?? 0).toFixed(1)}/${(rrs[Math.floor(rrs.length / 2)] ?? 0).toFixed(1)}/${(rrs[rrs.length - 1] ?? 0).toFixed(1)}` +
    `  avgRiskPips=${(trades.reduce((sum, trade) => sum + trade.riskPips, 0) / Math.max(1, trades.length)).toFixed(1)}`,
);

if (trades.length > 0) {
  console.log("\ntrades:");
  for (const trade of trades) {
    console.log(
      `  ${new Date(trade.time).toISOString().slice(0, 16).replace("T", " ")}` +
        `  ${trade.direction.padEnd(5)}` +
        `  ${String(trade.zoneTf + "m").padStart(4)} ${trade.zoneKind.padEnd(7)}` +
        `  R=${trade.r.toFixed(2).padStart(6)}` +
        `  planned=${trade.plannedR.toFixed(2).padStart(5)}` +
        `  risk=${trade.riskPips.toFixed(1)}p` +
        `  tp=${trade.targetLabel.padEnd(4)}` +
        `  ${trade.reason}`,
    );
  }
}
