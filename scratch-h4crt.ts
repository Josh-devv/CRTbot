/**
 * Prototype: the H4 three-candle CRT, traded natively on H4.
 *
 *   candle 1 = the range, candle 2 = the sweep (a CRT of candle 1's extreme), candle 3 = entry.
 *
 * Two placements per direction:
 *   A "market at candle 3 open"  — entry at the open of candle 3, stop beyond the sweep extreme.
 *   B "retest of candle 1"       — limit at candle 1's swept extreme during candle 3,
 *                                  stop beyond the sweep extreme.
 *
 * Fixed 3R target, one position at a time, spread charged on entry, stop/target resolved on M15.
 * Three months (2024-10-01 .. 2024-12-31) by default.
 *
 *   npx tsx scratch-h4crt.ts [--from YYYY-MM-DD] [--to YYYY-MM-DD]
 */
import { aggregate } from "./src/candles.js";
import { runBacktest } from "./src/backtest.js";
import { axisSystem } from "./src/execution.js";
import { DEFAULT_DATA_DIR, loadSeries } from "./src/ingest.js";
import { isCrt } from "./src/liquidity.js";
import { DEFAULT_SWING_WIDTH } from "./src/structure.js";
import { DEFAULT_SESSION_CONFIG, killzoneOf } from "./src/time.js";
import type { Bar, Direction, Instrument, StrategyConfig } from "./src/types.js";

const DAY = 86_400_000;
const H4 = 4 * 60 * 60 * 1000;
const SPREAD = 0.0001;

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

interface Setup {
  time: number;
  direction: Direction;
  /** The H4 candle 1 range and candle 2 sweep. */
  rangeHigh: number;
  rangeLow: number;
  sweepHigh: number;
  sweepLow: number;
  /** Did candle 2 occur while a killzone was open? */
  inKillzone: boolean;
}

interface TradeResult {
  time: number;
  direction: Direction;
  entry: number;
  stop: number;
  target: number;
  exit: number;
  r: number;
  reason: "target" | "stop" | "timeout";
  riskPips: number;
}

function foundSetup(c1: Bar, c2: Bar, bars: Bar[], cfg: StrategyConfig): Setup | null {
  const bullish = isCrt(c2, c1.low, "low");
  const bearish = isCrt(c2, c1.high, "high");
  if (bullish === bearish) return null; // neither, or an outside bar sweeping both

  const inKillzone = bars.some(
    (bar) => bar.time >= c2.time && bar.time < c2.time + H4 && killzoneOf(bar.time, cfg.session) !== null,
  );

  return {
    time: c2.time + H4,
    direction: bullish ? "long" : "short",
    rangeHigh: c1.high,
    rangeLow: c1.low,
    sweepHigh: c2.high,
    sweepLow: c2.low,
    inKillzone,
  };
}

/** Walk M15 bars from `start` until stop/target hits or the deadline passes. */
function resolve(
  bars: Bar[],
  start: number,
  setup: Setup,
  entry: number,
  stop: number,
  deadline: number,
  targetR = 3,
): Omit<TradeResult, "time" | "direction" | "riskPips"> & { exitTime: number } {
  const risk = setup.direction === "long" ? entry - stop : stop - entry;
  const target = setup.direction === "long" ? entry + targetR * risk : entry - targetR * risk;

  let last = start;
  for (let i = start; i < bars.length && bars[i]!.time <= deadline; i++) {
    const bar = bars[i]!;
    last = i;
    const stopHit = setup.direction === "long" ? bar.low <= stop : bar.high >= stop;
    const targetHit = setup.direction === "long" ? bar.high >= target : bar.low <= target;
    // Same-bar ambiguity is booked as the loss, the conservative reading.
    if (stopHit) return { entry, stop, target, exit: stop, r: -1, reason: "stop", exitTime: bar.time };
    if (targetHit) {
      return { entry, stop, target, exit: target, r: targetR, reason: "target", exitTime: bar.time };
    }
  }

  const exit = bars[last]!.close;
  const r = setup.direction === "long" ? (exit - entry) / risk : (entry - exit) / risk;
  return { entry, stop, target, exit, r, reason: "timeout", exitTime: bars[last]!.time };
}

interface Row {
  label: string;
  setups: number;
  fills: number;
  wins: number;
  timeouts: number;
  netR: number;
  avgRiskPips: number;
}

function row(label: string, trades: TradeResult[], setups: number): Row {
  const wins = trades.filter((trade) => trade.reason === "target").length;
  const netR = trades.reduce((sum, trade) => sum + trade.r, 0);
  return {
    label,
    setups,
    fills: trades.length,
    wins,
    timeouts: trades.filter((trade) => trade.reason === "timeout").length,
    netR,
    avgRiskPips: trades.reduce((sum, trade) => sum + trade.riskPips, 0) / Math.max(1, trades.length),
  };
}

function print(rows: Row[]): void {
  console.log(
    "variant".padEnd(30) + "setups".padStart(7) + "fills".padStart(7) + "win%".padStart(7) +
      "avgR".padStart(8) + "netR".padStart(8) + "pips".padStart(7) + "timeouts".padStart(9),
  );
  for (const r of rows) {
    const avgR = r.fills === 0 ? 0 : r.netR / r.fills;
    console.log(
      r.label.padEnd(30) +
        String(r.setups).padStart(7) +
        String(r.fills).padStart(7) +
        (r.fills === 0 ? "0.0" : ((100 * r.wins) / r.fills).toFixed(1)).padStart(7) +
        avgR.toFixed(3).padStart(8) +
        r.netR.toFixed(1).padStart(8) +
        r.avgRiskPips.toFixed(1).padStart(7) +
        String(r.timeouts).padStart(9),
    );
  }
}

const rest = process.argv.slice(2);
const from = dayBound(flag(rest, "--from") ?? "2024-10-01", "start");
const to = dayBound(flag(rest, "--to") ?? "2024-12-31", "end");

const cfg = baseConfig("GBPUSD");
const series = await loadSeries("GBPUSD", from, to, cfg, { dir: DEFAULT_DATA_DIR });
const bars = series.bars;
const h4 = aggregate(bars, "H4", cfg);
const byTime = new Map(bars.map((bar, index) => [bar.time, index]));

console.log(
  `GBPUSD ${new Date(from).toISOString().slice(0, 10)} .. ${new Date(to).toISOString().slice(0, 10)}` +
    `  M15 bars=${bars.length} H4 candles=${h4.length}\n`,
);

const setups: Setup[] = [];
for (let i = 1; i < h4.length - 1; i++) {
  const setup = foundSetup(h4[i - 1]!, h4[i]!, bars, cfg);
  if (setup !== null) setups.push(setup);
}

function runMarket(pool: Setup[], blocking: boolean, targetR = 3): TradeResult[] {
  const trades: TradeResult[] = [];
  let busyUntil = 0;
  for (const setup of pool) {
    if (blocking && setup.time < busyUntil) continue;
    const index = byTime.get(setup.time);
    if (index === undefined) continue;
    const entry = setup.direction === "long" ? bars[index]!.open + SPREAD : bars[index]!.open - SPREAD;
    const stop = setup.direction === "long" ? setup.sweepLow : setup.sweepHigh;
    const risk = setup.direction === "long" ? entry - stop : stop - entry;
    if (risk <= 0) continue;
    const result = resolve(bars, index, setup, entry, stop, setup.time + 5 * DAY, targetR);
    trades.push({
      time: setup.time,
      direction: setup.direction,
      riskPips: risk * 10000,
      ...result,
    });
    if (blocking) busyUntil = result.exitTime;
  }
  return trades;
}

function runLimit(pool: Setup[], blocking: boolean, targetR = 3): TradeResult[] {
  const trades: TradeResult[] = [];
  let busyUntil = 0;
  for (const setup of pool) {
    if (blocking && setup.time < busyUntil) continue;
    const index = byTime.get(setup.time);
    if (index === undefined) continue;
    const level = setup.direction === "long" ? setup.rangeLow : setup.rangeHigh;
    const end = setup.time + H4;
    let fillIndex = -1;
    let fill = 0;
    for (let i = index; i < bars.length && bars[i]!.time < end; i++) {
      const bar = bars[i]!;
      if (setup.direction === "long" ? bar.low <= level : bar.high >= level) {
        fillIndex = i;
        fill = setup.direction === "long" ? Math.min(bar.open, level) + SPREAD : Math.max(bar.open, level) - SPREAD;
        break;
      }
    }
    if (fillIndex === -1) continue;
    const stop = setup.direction === "long" ? setup.sweepLow : setup.sweepHigh;
    const risk = setup.direction === "long" ? fill - stop : stop - fill;
    if (risk <= 0) continue;
    const result = resolve(bars, fillIndex, setup, fill, stop, setup.time + 5 * DAY, targetR);
    trades.push({
      time: setup.time,
      direction: setup.direction,
      riskPips: risk * 10000,
      ...result,
    });
    if (blocking) busyUntil = result.exitTime;
  }
  return trades;
}

const rows: Row[] = [];
for (const killzoneOnly of [false, true]) {
  const pool = setups.filter((setup) => !killzoneOnly || setup.inKillzone);
  const suffix = killzoneOnly ? " + killzone sweep" : "";
  rows.push(row(`A market candle 3${suffix}`, runMarket(pool, true), pool.length));
  rows.push(row(`B retest candle 1${suffix}`, runLimit(pool, true), pool.length));
}
for (const targetR of [2, 3, 4]) {
  rows.push(row("A market candle 3 (indep " + targetR + "R)", runMarket(setups, false, targetR), setups.length));
  rows.push(row("B retest candle 1 (indep " + targetR + "R)", runLimit(setups, false, targetR), setups.length));
}

print(rows);

// Reference: the shipped engine on the same three months.
const base = baseConfig("GBPUSD");
for (const [label, execution] of [
  ["engine baseline", undefined],
  ["engine risk>=3+purgeOnly", { minRiskPips: 3, purgeOnly: true }],
] as const) {
  const runCfg: StrategyConfig = execution === undefined ? base : { ...base, execution };
  const result = runBacktest(series, runCfg, { strategy: axisSystem(execution ?? {}) });
  const netR = result.trades.reduce((sum, trade) => sum + (trade.rMultiple ?? 0), 0);
  const wins = result.trades.filter((trade) => (trade.rMultiple ?? 0) > 0).length;
  console.log(
    `${label.padEnd(30)}trades=${String(result.trades.length).padStart(4)}` +
      `  win=${(100 * wins / Math.max(1, result.trades.length)).toFixed(1)}%` +
      `  avgR=${(netR / Math.max(1, result.trades.length)).toFixed(3)}  netR=${netR.toFixed(1)}`,
  );
}
