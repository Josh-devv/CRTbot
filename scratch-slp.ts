/**
 * Quick SLP prototype (Toni Iyke: Structure, Liquidity, Points of Interest).
 *
 * Pipeline approximated for a one-month read:
 *   1. Bias        — H4 structural bias (closed H4 candles only).
 *   2. Structure   — M15 close through the last confirmed M15 swing high/low, with the bias.
 *   3. POI         — the last opposing M15 candle before the break (the order block).
 *   4. Liquidity   — target = nearest confirmed M15 swing high (long) / low (short) beyond
 *                    the current price; skip unless it pays at least 2R.
 *   5. Placement   — limit at the POI open, stop beyond the POI wick, 2-day limit life.
 *
 * One setup at a time. Spread charged on entry. Stops/targets resolved on M15, conservative
 * (same-bar stop+target = loss). This is a prototype, not the final ruleset.
 *
 *   npx tsx scratch-slp.ts [--from YYYY-MM-DD] [--to YYYY-MM-DD]
 */
import { aggregate } from "./src/candles.js";
import { DEFAULT_DATA_DIR, loadSeries } from "./src/ingest.js";
import { structuralBias } from "./src/bias.js";
import { findSwings } from "./src/structure.js";
import { DEFAULT_SWING_WIDTH } from "./src/structure.js";
import { DEFAULT_SESSION_CONFIG } from "./src/time.js";
import type { Bar, Direction, Instrument, StrategyConfig } from "./src/types.js";

const DAY = 86_400_000;
const H4 = 4 * 60 * 60 * 1000;
const SPREAD = 0.0001;
const MIN_RISK_PIPS = 3;
const MIN_RR = 2;
const LIMIT_LIFE_BARS = 192; // two days of M15
const TRADE_LIFE_MS = 5 * DAY;

function baseConfig(instrument: Instrument): StrategyConfig {
  return {
    instrument,
    session: DEFAULT_SESSION_CONFIG,
    structure: { swingWidth: DEFAULT_SWING_WIDTH },
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

interface Pending {
  direction: Direction;
  entry: number;
  stop: number;
  target: number;
  risk: number;
  placedAt: number;
  expiresAt: number;
  plannedR: number;
  mssTime: number;
}

interface Trade {
  direction: Direction;
  entry: number;
  stop: number;
  target: number;
  exit: number;
  r: number;
  reason: "target" | "stop" | "timeout";
  plannedR: number;
  riskPips: number;
  time: number;
}

const rest = process.argv.slice(2);
const from = dayBound(flag(rest, "--from") ?? "2024-12-01", "start");
const to = dayBound(flag(rest, "--to") ?? "2024-12-31", "end");

const cfg = baseConfig("GBPUSD");
const series = await loadSeries("GBPUSD", from, to, cfg, { dir: DEFAULT_DATA_DIR });
const bars = series.bars;
const h4 = aggregate(bars, "H4", cfg);
const swings = findSwings(bars, DEFAULT_SWING_WIDTH);

/** H4 bias from the candles that closed before `time`. */
function biasAt(time: number): "bullish" | "bearish" | "none" {
  const closed = h4.filter((candle) => candle.time + H4 <= time);
  return structuralBias(closed, cfg);
}

/** The most recent swing of `kind` confirmed by `width` bars at `i`. */
function lastSwing(kind: "high" | "low", i: number): { index: number; price: number } | null {
  let found: { index: number; price: number } | null = null;
  for (const swing of swings) {
    if (swing.kind !== kind) continue;
    if (swing.index + DEFAULT_SWING_WIDTH > i) break;
    found = { index: swing.index, price: swing.price };
  }
  return found;
}

/** Nearest confirmed swing high above `price` (long) / low below it (short). */
function liquidityTarget(direction: Direction, i: number, price: number): number | null {
  let best: number | null = null;
  for (const swing of swings) {
    if (swing.index + DEFAULT_SWING_WIDTH > i) break;
    if (swing.kind === "high" && direction === "long" && swing.price > price) {
      best = best === null ? swing.price : Math.min(best, swing.price);
    }
    if (swing.kind === "low" && direction === "short" && swing.price < price) {
      best = best === null ? swing.price : Math.max(best, swing.price);
    }
  }
  return best;
}

const trades: Trade[] = [];
let pending: Pending | null = null;
let open: { pending: Pending } | null = null;
let mssCount = 0;
let skippedRR = 0;

for (let i = 2; i < bars.length; i++) {
  const bar = bars[i]!;

  // Manage an open trade first.
  if (open !== null) {
    const { pending: trade } = open;
    const stopHit = trade.direction === "long" ? bar.low <= trade.stop : bar.high >= trade.stop;
    const targetHit = trade.direction === "long" ? bar.high >= trade.target : bar.low <= trade.target;
    const expired = bar.time > trade.mssTime + TRADE_LIFE_MS;
    if (stopHit || targetHit || expired) {
      const reason: Trade["reason"] = stopHit ? "stop" : targetHit ? "target" : "timeout";
      const exit = stopHit ? trade.stop : targetHit ? trade.target : bar.close;
      const r =
        trade.direction === "long"
          ? (exit - trade.entry) / trade.risk
          : (trade.entry - exit) / trade.risk;
      trades.push({
        direction: trade.direction,
        entry: trade.entry,
        stop: trade.stop,
        target: trade.target,
        exit,
        r,
        reason,
        plannedR: trade.plannedR,
        riskPips: trade.risk * 10000,
        time: trade.mssTime,
      });
      open = null;
    }
    continue;
  }

  // Manage a resting limit.
  if (pending !== null) {
    const filled = pending.direction === "long" ? bar.low <= pending.entry : bar.high >= pending.entry;
    if (filled) {
      const fill = pending.direction === "long"
        ? Math.min(bar.open, pending.entry) + SPREAD
        : Math.max(bar.open, pending.entry) - SPREAD;
      const risk = pending.direction === "long" ? fill - pending.stop : pending.stop - fill;
      if (risk > 0) {
        const adjusted: Pending = {
          ...pending,
          entry: fill,
          risk,
          plannedR:
            pending.direction === "long"
              ? (pending.target - fill) / risk
              : (fill - pending.target) / risk,
        };
        // Resolve the fill bar itself, conservatively: a stop in the same bar is a loss.
        const stopHit = adjusted.direction === "long" ? bar.low <= adjusted.stop : bar.high >= adjusted.stop;
        const targetHit = adjusted.direction === "long" ? bar.high >= adjusted.target : bar.low <= adjusted.target;
        if (stopHit || targetHit) {
          const reason: Trade["reason"] = stopHit ? "stop" : "target";
          trades.push({
            direction: adjusted.direction,
            entry: adjusted.entry,
            stop: adjusted.stop,
            target: adjusted.target,
            exit: stopHit ? adjusted.stop : adjusted.target,
            r: stopHit ? -1 : adjusted.plannedR,
            reason,
            plannedR: adjusted.plannedR,
            riskPips: adjusted.risk * 10000,
            time: adjusted.mssTime,
          });
          pending = null;
        } else {
          open = { pending: adjusted };
          pending = null;
        }
        continue;
      }
      pending = null;
    } else if (bar.time > pending.expiresAt) {
      pending = null;
    }
  }

  if (pending !== null || open !== null) continue;

  const bias = biasAt(bar.time);
  if (bias === "none") continue;

  const high = lastSwing("high", i);
  const low = lastSwing("low", i);
  if (high === null || low === null) continue;

  let direction: Direction | null = null;
  if (bias === "bullish" && bars[i - 1]!.close <= high.price && bar.close > high.price) direction = "long";
  if (bias === "bearish" && bars[i - 1]!.close >= low.price && bar.close < low.price) direction = "short";
  if (direction === null) continue;
  mssCount++;

  // POI: the last opposing candle before the break.
  let poi: Bar | null = null;
  for (let j = i - 1; j >= Math.max(0, i - 10); j--) {
    const candle = bars[j]!;
    if (direction === "long" ? candle.close < candle.open : candle.close > candle.open) {
      poi = candle;
      break;
    }
  }
  if (poi === null) continue;

  const entry = direction === "long" ? poi.open + SPREAD : poi.open - SPREAD;
  const stop = direction === "long" ? poi.low : poi.high;
  const risk = direction === "long" ? entry - stop : stop - entry;
  if (risk * 10000 < MIN_RISK_PIPS) continue;

  const target = liquidityTarget(direction, i, bar.close);
  if (target === null) continue;
  const plannedR = direction === "long" ? (target - entry) / risk : (entry - target) / risk;
  if (plannedR < MIN_RR) {
    skippedRR++;
    continue;
  }

  pending = {
    direction,
    entry,
    stop,
    target,
    risk,
    placedAt: bar.time,
    expiresAt: bar.time + LIMIT_LIFE_BARS * 15 * 60_000,
    plannedR,
    mssTime: bar.time,
  };
}

const wins = trades.filter((trade) => trade.reason === "target").length;
const netR = trades.reduce((sum, trade) => sum + trade.r, 0);
const losses = trades.reduce((sum, trade) => (trade.r < 0 ? sum + trade.r : sum), 0);
const gains = trades.reduce((sum, trade) => (trade.r > 0 ? sum + trade.r : sum), 0);

console.log(
  `SLP prototype — GBPUSD ${new Date(from).toISOString().slice(0, 10)} .. ${new Date(to).toISOString().slice(0, 10)}` +
    `  M15=${bars.length} H4=${h4.length}\n`,
);
console.log(`MSS signals: ${mssCount}; skipped for RR<${MIN_RR}: ${skippedRR}; unfilled limits expire in 2 days.`);
console.log(
  `trades=${trades.length}  wins=${wins}  win%=${(100 * wins / Math.max(1, trades.length)).toFixed(1)}` +
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
        `  R=${trade.r.toFixed(2).padStart(5)}` +
        `  (planned ${trade.plannedR.toFixed(2)})` +
        `  risk=${trade.riskPips.toFixed(1)}p` +
        `  ${trade.reason}`,
    );
  }
}
