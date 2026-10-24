/**
 * MNSR (Malaysian SNR) smoke test — HTF A/V level respect -> 15m shift -> 15m entry.
 *
 * Mechanical rules:
 *  - HTF levels: D1 and H4 line-chart pivots (close-based, 2 bars each side). A = peak
 *    (resistance), V = valley (support). Level is confirmed k bars after the pivot.
 *  - Level dies on a 15m body close through it (takeout). A wick through that closes back
 *    on the correct side is a "respect" touch.
 *  - Bias: prior completed D1 candle direction. Longs only at V-levels in a bullish D1,
 *    shorts only at A-levels in a bearish D1.
 *  - After the touch, wait up to 8 x 15m bars for a shift: close beyond the last confirmed
 *    15m swing high (long) / low (short). Enter at that 15m close.
 *  - Stop beyond the sweep extreme + buffer, target = RR * risk, time stop 32 bars.
 *  - No 1m entries anywhere: everything from the 15m series.
 *
 * Usage:
 *   npx tsx scratch-mnsr.ts --from 2024-09-01 --to 2024-10-31 --instrument both --rr 2
 */

import { loadBars } from "./src/ingest.js";
import type { Bar, Instrument } from "./src/types.js";

const PIP = 0.0001;
const BUFFER = 1.5 * PIP;
const MAX_HOLD = 32; // 15m bars = 8 hours
const MAX_SHIFT_WAIT = 8; // 2 hours
const SESSION_START = 7 * 60; // UTC minutes
const SESSION_END = 17 * 60;
const SWING_K = 2;

interface Level {
  price: number;
  kind: "A" | "V";
  tf: "D1" | "H4";
  confirmed: number;
  touched: boolean;
  broken: boolean;
  used: boolean;
}

interface Pending {
  level: Level;
  dir: 1 | -1;
  touchIndex: number;
  touchTime: number;
  extreme: number;
  bias: 1 | -1;
  fresh: boolean;
}

interface Trade {
  instrument: Instrument;
  dir: 1 | -1;
  level: "A" | "V";
  tf: "D1" | "H4";
  fresh: boolean;
  entryTime: number;
  entry: number;
  stop: number;
  target: number;
  exitTime: number;
  exit: number;
  grossR: number;
  netR: number;
  riskPips: number;
  reason: "target" | "stop" | "time" | "eod";
}

function aggregate(bars: Bar[], minutes: number): Bar[] {
  const ms = minutes * 60_000;
  const buckets = new Map<number, Bar>();
  for (const b of bars) {
    const t = Math.floor(b.time / ms) * ms;
    const cur = buckets.get(t);
    if (cur === undefined) {
      buckets.set(t, { time: t, open: b.open, high: b.high, low: b.low, close: b.close });
    } else {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
    }
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

/** Close-based pivots (MNSR uses the line chart). */
function buildLevels(bars: Bar[], tf: "D1" | "H4"): Level[] {
  const levels: Level[] = [];
  for (let i = SWING_K; i < bars.length - SWING_K; i++) {
    const c = bars[i]!.close;
    let high = true;
    let low = true;
    for (let j = i - SWING_K; j <= i + SWING_K; j++) {
      if (j === i) continue;
      if (bars[j]!.close >= c) high = false;
      if (bars[j]!.close <= c) low = false;
    }
    if (high) {
      levels.push({
        price: c,
        kind: "A",
        tf,
        confirmed: bars[i + SWING_K]!.time,
        touched: false,
        broken: false,
        used: false,
      });
    }
    if (low) {
      levels.push({
        price: c,
        kind: "V",
        tf,
        confirmed: bars[i + SWING_K]!.time,
        touched: false,
        broken: false,
        used: false,
      });
    }
  }
  return levels;
}

/** Last confirmed 15m swing high / low as of each bar index. */
function swingRefs(m15: Bar[]): { high: number[]; low: number[] } {
  const high = new Array<number>(m15.length).fill(NaN);
  const low = new Array<number>(m15.length).fill(NaN);
  let lastHigh = NaN;
  let lastLow = NaN;
  for (let i = 0; i < m15.length; i++) {
    const j = i - SWING_K;
    if (j >= SWING_K) {
      let isHigh = true;
      let isLow = true;
      for (let q = j - SWING_K; q <= j + SWING_K; q++) {
        if (q === j) continue;
        if (m15[q]!.high >= m15[j]!.high) isHigh = false;
        if (m15[q]!.low <= m15[j]!.low) isLow = false;
      }
      if (isHigh) lastHigh = m15[j]!.high;
      if (isLow) lastLow = m15[j]!.low;
    }
    high[i] = lastHigh;
    low[i] = lastLow;
  }
  return { high, low };
}

function dayStart(t: number): number {
  return Math.floor(t / 86_400_000) * 86_400_000;
}

/** Simple EMA over closes. */
function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out = new Array<number>(values.length).fill(NaN);
  let prev = values[0] ?? NaN;
  for (let i = 0; i < values.length; i++) {
    prev = i === 0 ? values[i]! : values[i]! * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Direction of the last completed D1 candle before the UTC day containing t. */
function biasAt(d1: Bar[], d1Ema: number[], t: number, mode: "candle" | "ema"): 1 | -1 | 0 {
  const day = dayStart(t);
  let lo = 0;
  let hi = d1.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (d1[mid]!.time < day) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (idx < 0) return 0;
  const b = d1[idx]!;
  if (mode === "ema") {
    const e = d1Ema[idx]!;
    if (!Number.isFinite(e)) return 0;
    return b.close > e ? 1 : b.close < e ? -1 : 0;
  }
  return b.close > b.open ? 1 : b.close < b.open ? -1 : 0;
}

function inSession(t: number): boolean {
  const d = new Date(t);
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  return minutes >= SESSION_START && minutes < SESSION_END;
}

function run(
  instrument: Instrument,
  m1: Bar[],
  from: number,
  to: number,
  rr: number,
  freshOnly: boolean,
  biasMode: "candle" | "ema",
): Trade[] {
  const m15 = aggregate(m1, 15);
  const h4 = aggregate(m1, 240);
  const d1 = aggregate(m1, 1440);
  const d1Ema = ema(d1.map((b) => b.close), 20);
  const levels = [...buildLevels(d1, "D1"), ...buildLevels(h4, "H4")].sort(
    (a, b) => a.confirmed - b.confirmed,
  );
  const refs = swingRefs(m15);

  const trades: Trade[] = [];
  const pendings: Pending[] = [];
  let position: Trade | null = null;
  let levelCursor = 0;

  const costPips = instrument === "EURUSD" ? 0.8 : 1.2;

  const closePosition = (t: Bar, reason: Trade["reason"], exitOverride?: number): void => {
    if (position === null) return;
    const exit = exitOverride ?? t.close;
    const gross =
      position.dir === 1
        ? (exit - position.entry) / (position.entry - position.stop)
        : (position.entry - exit) / (position.stop - position.entry);
    position.exitTime = t.time;
    position.exit = exit;
    position.grossR = gross;
    position.netR = gross - costPips / position.riskPips;
    position.reason = reason;
    trades.push(position);
    position = null;
  };

  for (let i = 0; i < m15.length; i++) {
    const bar = m15[i]!;

    // Manage an open position from the bar after entry onward.
    if (position !== null && bar.time > position.entryTime) {
      const p = position;
      if (p.dir === 1) {
        if (bar.low <= p.stop) closePosition(bar, "stop", p.stop);
        else if (bar.high >= p.target) closePosition(bar, "target", p.target);
        else if ((bar.time - p.entryTime) / 900_000 >= MAX_HOLD) closePosition(bar, "time");
      } else {
        if (bar.high >= p.stop) closePosition(bar, "stop", p.stop);
        else if (bar.low <= p.target) closePosition(bar, "target", p.target);
        else if ((bar.time - p.entryTime) / 900_000 >= MAX_HOLD) closePosition(bar, "time");
      }
      if (position !== null && bar.time >= to) closePosition(bar, "eod");
    }

    // Activate levels confirmed strictly before this bar.
    while (levelCursor < levels.length && levels[levelCursor]!.confirmed < bar.time) {
      levelCursor++;
    }
    const active: Level[] = [];
    for (let j = 0; j < levelCursor; j++) {
      const lv = levels[j]!;
      if (!lv.broken && !lv.used) active.push(lv);
    }

    // Update level state and detect respect touches.
    for (const lv of active) {
      const fresh = !lv.touched;
      if (lv.kind === "A") {
        if (bar.close > lv.price + 0.2 * PIP) {
          lv.broken = true;
          continue;
        }
        if (bar.high >= lv.price && bar.close < lv.price) {
          lv.touched = true;
        } else {
          continue;
        }
      } else {
        if (bar.close < lv.price - 0.2 * PIP) {
          lv.broken = true;
          continue;
        }
        if (bar.low <= lv.price && bar.close > lv.price) {
          lv.touched = true;
        } else {
          continue;
        }
      }

      if (bar.time < from || !inSession(bar.time) || position !== null) continue;
      if (freshOnly && !fresh) continue;
      if (pendings.some((p) => p.level === lv)) continue;

      const bias = biasAt(d1, d1Ema, bar.time, biasMode);
      if (bias === 0) continue;
      const dir: 1 | -1 = lv.kind === "A" ? -1 : 1;
      if (dir !== bias) continue;

      const extreme = lv.kind === "A" ? Math.max(lv.price, bar.high) : Math.min(lv.price, bar.low);
      pendings.push({
        level: lv,
        dir,
        touchIndex: i,
        touchTime: bar.time,
        extreme,
        bias,
        fresh,
      });
    }

    // Advance pending setups, and enter on the first 15m shift close.
    for (let p = pendings.length - 1; p >= 0; p--) {
      const s = pendings[p]!;
      if (s.level.broken || i - s.touchIndex > MAX_SHIFT_WAIT) {
        pendings.splice(p, 1);
        continue;
      }
      if (i <= s.touchIndex) continue;
      if (position !== null) continue;

      // Track the sweep extreme through the shift window.
      s.extreme =
        s.dir === 1 ? Math.min(s.extreme, bar.low) : Math.max(s.extreme, bar.high);

      const ref = s.dir === 1 ? refs.high[i]! : refs.low[i]!;
      if (!Number.isFinite(ref)) continue;
      const shifted = s.dir === 1 ? bar.close > ref + 0.5 * PIP : bar.close < ref - 0.5 * PIP;
      if (!shifted) continue;

      const entry = bar.close;
      const stop = s.dir === 1 ? s.extreme - BUFFER : s.extreme + BUFFER;
      const risk = Math.abs(entry - stop);
      const riskPips = risk / PIP;
      if (riskPips < 3 || riskPips > 80) continue;

      position = {
        instrument,
        dir: s.dir,
        level: s.level.kind,
        tf: s.level.tf,
        fresh: s.fresh,
        entryTime: bar.time,
        entry,
        stop,
        target: s.dir === 1 ? entry + rr * risk : entry - rr * risk,
        exitTime: 0,
        exit: 0,
        grossR: 0,
        netR: 0,
        riskPips,
        reason: "eod",
      };
      s.level.used = true;
      pendings.splice(p, 1);
      break;
    }

    if (position !== null && bar.time >= to) closePosition(bar, "eod");
  }

  if (position !== null) closePosition(m15[m15.length - 1]!, "eod");
  return trades;
}

function stats(trades: Trade[]): {
  n: number;
  winRate: number;
  netR: number;
  avgR: number;
  pf: number;
  maxDD: number;
} {
  const n = trades.length;
  const wins = trades.filter((t) => t.netR > 0).length;
  const netR = trades.reduce((s, t) => s + t.netR, 0);
  const grossWin = trades.filter((t) => t.netR > 0).reduce((s, t) => s + t.netR, 0);
  const grossLoss = Math.abs(trades.filter((t) => t.netR < 0).reduce((s, t) => s + t.netR, 0));
  let peak = 0;
  let equity = 0;
  let maxDD = 0;
  for (const t of trades) {
    equity += t.netR;
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, peak - equity);
  }
  return {
    n,
    winRate: n === 0 ? 0 : wins / n,
    netR,
    avgR: n === 0 ? 0 : netR / n,
    pf: grossLoss === 0 ? Infinity : grossWin / grossLoss,
    maxDD,
  };
}

function report(label: string, trades: Trade[]): void {
  const s = stats(trades);
  console.log(
    `${label.padEnd(18)} ${String(s.n).padStart(4)}  ${(s.winRate * 100).toFixed(1).padStart(5)}%  ` +
      `${s.netR.toFixed(1).padStart(8)}R  ${s.avgR.toFixed(3).padStart(7)}R/t  ` +
      `PF ${Number.isFinite(s.pf) ? s.pf.toFixed(2) : "inf"}  maxDD ${s.maxDD.toFixed(1)}R`,
  );
}

function parseArgs(): {
  instrument: "both" | Instrument;
  from: string;
  to: string;
  rr: number;
  freshOnly: boolean;
  summaryOnly: boolean;
  biasMode: "candle" | "ema";
} {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string): string => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] !== undefined ? args[i + 1]! : fallback;
  };
  const instrument = get("--instrument", "both");
  if (instrument !== "both" && instrument !== "EURUSD" && instrument !== "GBPUSD") {
    throw new Error(`bad --instrument ${instrument}`);
  }
  return {
    instrument,
    from: get("--from", "2024-09-01"),
    to: get("--to", "2024-10-31"),
    rr: Number(get("--rr", "2")),
    freshOnly: args.includes("--fresh"),
    summaryOnly: args.includes("--summary"),
    biasMode: get("--bias", "candle") === "ema" ? "ema" : "candle",
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const from = Date.parse(`${args.from}T00:00:00Z`);
  const to = Date.parse(`${args.to}T23:59:59Z`);
  const warmup = from - 365 * 86_400_000;
  const instruments: Instrument[] =
    args.instrument === "both" ? ["EURUSD", "GBPUSD"] : [args.instrument];

  console.log(
    `MNSR smoke test ${args.from} -> ${args.to}, RR ${args.rr}, ${args.biasMode} bias, 15m entries`,
  );
  console.log(
    "HTF D1/H4 close pivots | D1 bias | respect touch | 15m MSS close | stop beyond sweep | 8h time stop",
  );

  const all: Trade[] = [];
  for (const instrument of instruments) {
    const m1 = await loadBars(instrument, warmup, to);
    console.log(`${instrument}: ${m1.length} M1 bars loaded`);
    const trades = run(
      instrument,
      m1,
      from,
      to,
      args.rr,
      args.freshOnly,
      args.biasMode,
    );
    all.push(...trades);
    report(instrument, trades);
    if (!args.summaryOnly) {
      const byMonth = new Map<string, Trade[]>();
      for (const t of trades) {
        const key = new Date(t.entryTime).toISOString().slice(0, 7);
        byMonth.set(key, [...(byMonth.get(key) ?? []), t]);
      }
      for (const [month, ts] of [...byMonth.entries()].sort()) report(`  ${month}`, ts);
      const byTf = new Map<string, Trade[]>();
      for (const t of trades) {
        const key = `${t.tf}/${t.level}`;
        byTf.set(key, [...(byTf.get(key) ?? []), t]);
      }
      for (const [key, ts] of [...byTf.entries()].sort()) report(`  ${key}`, ts);
    }
  }
  report("TOTAL", all);

  if (!args.summaryOnly && all.length > 0) {
    console.log("\nTrades:");
    for (const t of all.slice(0, 20)) {
      console.log(
        `  ${new Date(t.entryTime).toISOString().slice(0, 16)} ${t.instrument} ${
          t.dir === 1 ? "LONG " : "SHORT"
        } ${t.tf}/${t.level} entry ${t.entry.toFixed(5)} stop ${t.stop.toFixed(5)} ` +
          `risk ${t.riskPips.toFixed(1)}p -> ${t.reason} ${t.netR.toFixed(2)}R`,
      );
    }
  }
}

await main();
