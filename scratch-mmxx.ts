/**
 * MMXM / 8:30-9:30-10:00 prototype — NQ/ES.
 *
 * Framework tested (from the provided notes):
 *  - 08:30 ET open is the pivot.
 *  - Pre-market 08:30-09:30 forms HALR (sweep level) on the 8:30 side and LRL
 *    (failure-swing target) on the opposite side.
 *  - 09:30-10:00 manipulation sweeps HALR; require SMT: only one index sweeps.
 *  - After the sweep, first 5m close back through HALR = entry.
 *  - Stop beyond the sweep extreme; target the LRL.
 *  - One trade per instrument/day; flat by 15:55 or 60 min.
 *
 * Usage:
 *   npx tsx scratch-mmxx.ts --from 2026-08-20 --to 2026-10-19
 */

import { readFile } from "node:fs/promises";
import { DateTime } from "luxon";

const NY = "America/New_York";
const OPEN_830 = 8 * 60 + 30;
const OPEN_930 = 9 * 60 + 30;
const MANIP_END = 10 * 60;
const ENTRY_END = 10 * 60 + 30;

interface Bar { time: number; open: number; high: number; low: number; close: number; volume: number }
interface B5 extends Bar { date: string; minute: number }
type Dir = 1 | -1;

interface Pre {
  date: string;
  open830: number;
  pmHigh: number;
  pmLow: number;
  lrlHigh: number;
  lrlLow: number;
  halrLow: number | null;
  halrHigh: number | null;
  failureHigh: boolean;
  failureLow: boolean;
  swingHighs: number;
  swingLows: number;
}

interface Trade {
  instrument: string; date: string; dir: Dir;
  entryTime: number; entry: number; stop: number; target: number;
  exitTime: number; exit: number; riskPts: number; plannedR: number;
  netR: number; reason: string;
}

const args = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1]! : fallback;
};
const fromArg = flag("--from", "2026-08-20");
const toArg = flag("--to", "2026-10-19");
const bufferFor = (inst: string): number => (inst === "NQ" ? 2 : 1);
const costFor = (inst: string): number => (inst === "NQ" ? 1 : 0.5);

function parts(ms: number): { date: string; minute: number } {
  const dt = DateTime.fromMillis(ms, { zone: NY });
  return { date: dt.toFormat("yyyy-MM-dd"), minute: dt.hour * 60 + dt.minute };
}

function lowerBound(bars: Bar[], t: number): number {
  let lo = 0, hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid]!.time < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function rangeHL(bars: Bar[], start: number, end: number): { high: number; low: number } | null {
  let high = -Infinity, low = Infinity;
  for (let i = lowerBound(bars, start); i < bars.length; i++) {
    const b = bars[i]!;
    if (b.time >= end) break;
    high = Math.max(high, b.high);
    low = Math.min(low, b.low);
  }
  if (!Number.isFinite(high)) return null;
  return { high, low };
}

function aggregate5(bars: Bar[]): B5[] {
  const map = new Map<string, B5>();
  for (const b of bars) {
    const { date, minute } = parts(b.time);
    const bucket = Math.floor(minute / 5) * 5;
    const key = `${date}|${bucket}`;
    const cur = map.get(key);
    if (cur === undefined) map.set(key, { ...b, date, minute: bucket });
    else {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
    }
  }
  return [...map.values()].sort((a, b) => a.time - b.time);
}

function rthByDate(bars: Bar[]): Map<string, Bar[]> {
  const out = new Map<string, Bar[]>();
  for (const b of bars) {
    const p = parts(b.time);
    if (p.minute >= OPEN_930 && p.minute < 16 * 60) {
      const list = out.get(p.date) ?? [];
      list.push(b);
      out.set(p.date, list);
    }
  }
  return out;
}

function priorBias(rth: Map<string, Bar[]>): Map<string, Dir | 0> {
  const dates = [...rth.keys()].sort();
  const out = new Map<string, Dir | 0>();
  for (let i = 1; i < dates.length; i++) {
    const prev = rth.get(dates[i - 1]!)!;
    const open = prev[0]!.open;
    const close = prev[prev.length - 1]!.close;
    out.set(dates[i]!, close > open ? 1 : close < open ? -1 : 0);
  }
  return out;
}

interface Swing { time: number; price: number; kind: "H" | "L" }

function swings(bars: Bar[], start: number, end: number, k = 3): Swing[] {
  const arr: Bar[] = [];
  for (let i = lowerBound(bars, start); i < bars.length; i++) {
    const b = bars[i]!;
    if (b.time >= end) break;
    arr.push(b);
  }
  const out: Swing[] = [];
  for (let i = k; i < arr.length - k; i++) {
    let isH = true, isL = true;
    for (let j = 1; j <= k; j++) {
      if (arr[i]!.high <= arr[i - j]!.high || arr[i]!.high <= arr[i + j]!.high) isH = false;
      if (arr[i]!.low >= arr[i - j]!.low || arr[i]!.low >= arr[i + j]!.low) isL = false;
    }
    if (isH) out.push({ time: arr[i]!.time, price: arr[i]!.high, kind: "H" });
    if (isL) out.push({ time: arr[i]!.time, price: arr[i]!.low, kind: "L" });
  }
  return out;
}

function preMarket(bars: Bar[], date: string): Pre | null {
  const start830 = DateTime.fromISO(`${date}T08:30:00`, { zone: NY }).toMillis();
  const start930 = DateTime.fromISO(`${date}T09:30:00`, { zone: NY }).toMillis();
  const i830 = lowerBound(bars, start830);
  const openBar = bars[i830];
  if (openBar === undefined || openBar.time >= start930) return null;
  const range = rangeHL(bars, start830, start930);
  if (range === null) return null;
  const sw = swings(bars, start830, start930, 3);
  const highs = sw.filter((s) => s.kind === "H").sort((a, b) => a.time - b.time);
  const lows = sw.filter((s) => s.kind === "L").sort((a, b) => a.time - b.time);

  let lrlHigh = range.high;
  let failureHigh = false;
  for (const h of highs) {
    if (h.price <= openBar.open) continue;
    const later = highs.filter((x) => x.time > h.time && x.price < h.price);
    if (later.length > 0) {
      lrlHigh = Math.max(lrlHigh, h.price);
      failureHigh = true;
    }
  }

  let lrlLow = range.low;
  let failureLow = false;
  for (const l of lows) {
    if (l.price >= openBar.open) continue;
    const later = lows.filter((x) => x.time > l.time && x.price > l.price);
    if (later.length > 0) {
      lrlLow = Math.min(lrlLow, l.price);
      failureLow = true;
    }
  }

  return {
    date,
    open830: openBar.open,
    pmHigh: range.high,
    pmLow: range.low,
    lrlHigh,
    lrlLow,
    halrLow: range.low < openBar.open ? range.low : null,
    halrHigh: range.high > openBar.open ? range.high : null,
    failureHigh,
    failureLow,
    swingHighs: highs.length,
    swingLows: lows.length,
  };
}

function simulate(
  instrument: string, m1: Bar[], date: string, dir: Dir,
  entryTime: number, entry: number, stop: number, target: number,
): Trade | null {
  const risk = Math.abs(entry - stop);
  if (!Number.isFinite(risk) || risk < 2) return null;
  const plannedR = Math.abs(target - entry) / risk;
  if (plannedR < 1) return null;
  const cost = costFor(instrument);
  const flat = DateTime.fromISO(`${date}T15:55:00`, { zone: NY }).toMillis();
  const timeLimit = Math.min(flat, entryTime + 60 * 60_000);

  for (let i = lowerBound(m1, entryTime + 1); i < m1.length; i++) {
    const b = m1[i]!;
    if (b.time > timeLimit) {
      const gross = dir === 1 ? (b.open - entry) / risk : (entry - b.open) / risk;
      return {
        instrument, date, dir, entryTime, entry, stop, target,
        exitTime: b.time, exit: b.open, riskPts: risk, plannedR,
        netR: gross - cost / risk, reason: "time",
      };
    }
    if (dir === 1) {
      if (b.low <= stop) return {
        instrument, date, dir, entryTime, entry, stop, target,
        exitTime: b.time, exit: stop, riskPts: risk, plannedR,
        netR: -1 - cost / risk, reason: "stop",
      };
      if (b.high >= target) return {
        instrument, date, dir, entryTime, entry, stop, target,
        exitTime: b.time, exit: target, riskPts: risk, plannedR,
        netR: plannedR - cost / risk, reason: "target",
      };
    } else {
      if (b.high >= stop) return {
        instrument, date, dir, entryTime, entry, stop, target,
        exitTime: b.time, exit: stop, riskPts: risk, plannedR,
        netR: -1 - cost / risk, reason: "stop",
      };
      if (b.low <= target) return {
        instrument, date, dir, entryTime, entry, stop, target,
        exitTime: b.time, exit: target, riskPts: risk, plannedR,
        netR: plannedR - cost / risk, reason: "target",
      };
    }
  }
  return null;
}

function stats(trades: Trade[]): { n: number; wr: number; netR: number; pf: number; dd: number; avgPlan: number } {
  const n = trades.length;
  const wins = trades.filter((t) => t.netR > 0);
  const losses = trades.filter((t) => t.netR < 0);
  const netR = trades.reduce((s, t) => s + t.netR, 0);
  const gw = wins.reduce((s, t) => s + t.netR, 0);
  const gl = Math.abs(losses.reduce((s, t) => s + t.netR, 0));
  let eq = 0, peak = 0, dd = 0;
  for (const t of trades) { eq += t.netR; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
  return {
    n, wr: n ? wins.length / n : 0, netR,
    pf: gl ? gw / gl : Infinity, dd,
    avgPlan: n ? trades.reduce((s, t) => s + t.plannedR, 0) / n : 0,
  };
}

function report(label: string, trades: Trade[]): void {
  const s = stats(trades);
  console.log(
    `${label.padEnd(10)} ${String(s.n).padStart(3)}  ${(s.wr * 100).toFixed(1).padStart(5)}%  ` +
    `${s.netR.toFixed(1).padStart(7)}R  PF ${Number.isFinite(s.pf) ? s.pf.toFixed(2) : "inf"}  ` +
    `DD ${s.dd.toFixed(1)}R  avgPlan ${s.avgPlan.toFixed(1)}R`,
  );
}

async function main(): Promise<void> {
  console.log(`MMXM 8:30/9:30/10:00 ${fromArg} -> ${toArg}`);
  const instruments = ["NQ", "ES"];
  const m1: Record<string, Bar[]> = {};
  const bars5: Record<string, B5[]> = {};
  const pre: Record<string, Map<string, Pre>> = {};

  for (const inst of instruments) {
    m1[inst] = JSON.parse(await readFile(`data/indices/${inst}-duka.json`, "utf8")) as Bar[];
    bars5[inst] = aggregate5(m1[inst]!);
    const rth = rthByDate(m1[inst]!);
    const bias = priorBias(rth);
    const map = new Map<string, Pre>();
    for (const date of rth.keys()) {
      if (date < fromArg || date > toArg) continue;
      const p = preMarket(m1[inst]!, date);
      if (p !== null) map.set(date, p);
    }
    pre[inst] = map;
    (pre[inst] as unknown as { bias: Map<string, Dir | 0> }).bias = bias;
  }

  const biasNQ = (pre["NQ"] as unknown as { bias: Map<string, Dir | 0> }).bias;
  const biasES = (pre["ES"] as unknown as { bias: Map<string, Dir | 0> }).bias;

  const dates = [...pre["NQ"]!.keys()].filter((d) => pre["ES"]!.has(d)).sort();
  let bullDays = 0, bearDays = 0, halrDays = 0, smtDays = 0, trades = 0;
  const all: Trade[] = [];

  for (const date of dates) {
    const pNQ = pre["NQ"]!.get(date)!;
    const pES = pre["ES"]!.get(date)!;
    const bNQ = biasNQ.get(date) ?? 0;
    const bES = biasES.get(date) ?? 0;

    // SMT: during 09:30-10:00, exactly one index sweeps its HALR.
    const start930 = DateTime.fromISO(`${date}T09:30:00`, { zone: NY }).toMillis();
    const endManip = DateTime.fromISO(`${date}T10:00:00`, { zone: NY }).toMillis();
    const sweepNQ = rangeHL(m1["NQ"]!, start930, endManip);
    const sweepES = rangeHL(m1["ES"]!, start930, endManip);
    if (sweepNQ === null || sweepES === null) continue;

    const nqSweptLow = pNQ.halrLow !== null && sweepNQ.low < pNQ.halrLow;
    const esSweptLow = pES.halrLow !== null && sweepES.low < pES.halrLow;
    const nqSweptHigh = pNQ.halrHigh !== null && sweepNQ.high > pNQ.halrHigh;
    const esSweptHigh = pES.halrHigh !== null && sweepES.high > pES.halrHigh;
    const bullSMT = nqSweptLow !== esSweptLow;
    const bearSMT = nqSweptHigh !== esSweptHigh;
    if (bullSMT) bullDays++;
    if (bearSMT) bearDays++;
    if ((bNQ === 1 && bullSMT) || (bNQ === -1 && bearSMT)) halrDays++;
    if (bullSMT || bearSMT) smtDays++;

    for (const inst of instruments) {
      const p = inst === "NQ" ? pNQ : pES;
      const bias = inst === "NQ" ? bNQ : bES;
      if (bias === 0) continue;
      if (bias === 1 && !bullSMT) continue;
      if (bias === -1 && !bearSMT) continue;

      const entryBars = bars5[inst]!.filter(
        (b) => b.date === date && b.minute >= OPEN_930 && b.minute <= ENTRY_END,
      );
      let swept = false;
      for (const eb of entryBars) {
        if (bias === 1) {
          if (p.halrLow === null) break;
          if (eb.low < p.halrLow) swept = true;
          if (!swept || eb.close <= p.halrLow) continue;
          const range = rangeHL(
            m1[inst]!,
            start930,
            eb.time + 5 * 60_000,
          );
          if (range === null) continue;
          const entry = eb.close;
          const stop = range.low - bufferFor(inst);
          const target = p.lrlHigh;
          if (target <= entry) continue;
          const trade = simulate(inst, m1[inst]!, date, 1, eb.time + 5 * 60_000 - 1, entry, stop, target);
          if (trade !== null) { all.push(trade); trades++; }
          break;
        }
        if (bias === -1) {
          if (p.halrHigh === null) break;
          if (eb.high > p.halrHigh) swept = true;
          if (!swept || eb.close >= p.halrHigh) continue;
          const range = rangeHL(
            m1[inst]!,
            start930,
            eb.time + 5 * 60_000,
          );
          if (range === null) continue;
          const entry = eb.close;
          const stop = range.high + bufferFor(inst);
          const target = p.lrlLow;
          if (target >= entry) continue;
          const trade = simulate(inst, m1[inst]!, date, -1, eb.time + 5 * 60_000 - 1, entry, stop, target);
          if (trade !== null) { all.push(trade); trades++; }
          break;
        }
      }
    }
  }

  console.log(
    `Dates ${dates.length} | bullSMT ${bullDays} | bearSMT ${bearDays} | bias+SMT ${halrDays} | SMT ${smtDays} | trades ${trades}`,
  );
  report("NQ", all.filter((t) => t.instrument === "NQ"));
  report("ES", all.filter((t) => t.instrument === "ES"));
  report("TOTAL", all);

  const byMonth = new Map<string, Trade[]>();
  for (const t of all) byMonth.set(t.date.slice(0, 7), [...(byMonth.get(t.date.slice(0, 7)) ?? []), t]);
  for (const [k, ts] of [...byMonth.entries()].sort()) report(k, ts);

  for (const t of all) {
    console.log(
      `  ${t.date} ${t.instrument} ${t.dir === 1 ? "LONG " : "SHORT"} ` +
      `entry ${t.entry.toFixed(2)} stop ${t.stop.toFixed(2)} target ${t.target.toFixed(2)} ` +
      `risk ${t.riskPts.toFixed(1)}p plan ${t.plannedR.toFixed(1)}R -> ${t.reason} ${t.netR.toFixed(2)}R`,
    );
  }
}

await main();
