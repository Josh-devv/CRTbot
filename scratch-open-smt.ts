/**
 * NY open SMT continuation prototype — NQ/ES.
 *
 * Rules tested:
 *  - Prior RTH day bias: prior day close > open = bullish, < open = bearish.
 *  - SMT at the 09:30-09:45 opening swing vs the overnight range:
 *      bullish = one index sweeps the overnight low, the other does not;
 *      bearish = one index sweeps the overnight high, the other does not.
 *  - Require SMT direction == prior-day bias.
 *  - Wait for the first 5m close after 09:45 (by 10:30) in the bias direction.
 *  - Entry at that close; stop beyond the 09:30-09:45 opening range; 2R target.
 *  - One trade per instrument per day; flat by 15:55 or 60 min.
 *
 * Usage:
 *   npx tsx scratch-open-smt.ts --from 2026-08-20 --to 2026-10-19
 */

import { readFile } from "node:fs/promises";
import { DateTime } from "luxon";

const NY = "America/New_York";
const OPEN_MIN = 9 * 60 + 30;
const MOVE_END = 9 * 60 + 45;
const ENTRY_END = 10 * 60 + 30;
const FLAT_MIN = 15 * 60 + 55;

interface Bar { time: number; open: number; high: number; low: number; close: number; volume: number }
interface B5 extends Bar { date: string; minute: number }
type Dir = 1 | -1;

interface Trade {
  instrument: string; date: string; dir: Dir;
  entryTime: number; entry: number; stop: number; target: number;
  exitTime: number; exit: number; riskPts: number; netR: number; reason: string;
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

function etParts(ms: number): { date: string; minute: number } {
  const dt = DateTime.fromMillis(ms, { zone: NY });
  return { date: dt.toFormat("yyyy-MM-dd"), minute: dt.hour * 60 + dt.minute };
}

function aggregate5(bars: Bar[]): B5[] {
  const map = new Map<string, B5>();
  for (const b of bars) {
    const { date, minute } = etParts(b.time);
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
    const { date, minute } = etParts(b.time);
    if (minute >= OPEN_MIN && minute < 16 * 60) {
      const list = out.get(date) ?? [];
      list.push(b);
      out.set(date, list);
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

function lowerBound(bars: Bar[], t: number): number {
  let lo = 0;
  let hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid]!.time < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function rangeHL(bars: Bar[], start: number, end: number): { high: number; low: number } | null {
  let high = -Infinity;
  let low = Infinity;
  for (let i = lowerBound(bars, start); i < bars.length; i++) {
    const b = bars[i]!;
    if (b.time >= end) break;
    high = Math.max(high, b.high);
    low = Math.min(low, b.low);
  }
  if (!Number.isFinite(high)) return null;
  return { high, low };
}

function overnightRange(bars: Bar[], date: string): { high: number; low: number } | null {
  const prev = DateTime.fromISO(date, { zone: NY }).minus({ days: 1 }).toFormat("yyyy-MM-dd");
  const start = DateTime.fromISO(`${prev}T18:00:00`, { zone: NY }).toMillis();
  const end = DateTime.fromISO(`${date}T09:30:00`, { zone: NY }).toMillis();
  return rangeHL(bars, start, end);
}

function openingRange(bars: Bar[], date: string): { high: number; low: number } | null {
  const start = DateTime.fromISO(`${date}T09:30:00`, { zone: NY }).toMillis();
  const end = DateTime.fromISO(`${date}T09:45:00`, { zone: NY }).toMillis();
  return rangeHL(bars, start, end);
}

function simulate(
  instrument: string, m1: Bar[], date: string, dir: Dir,
  entryTime: number, entry: number, stop: number,
): Trade | null {
  const risk = Math.abs(entry - stop);
  if (!Number.isFinite(risk) || risk < 2) return null;
  const cost = costFor(instrument);
  const target = dir === 1 ? entry + 2 * risk : entry - 2 * risk;
  const flat = DateTime.fromISO(`${date}T15:55:00`, { zone: NY }).toMillis();
  const timeLimit = Math.min(flat, entryTime + 60 * 60_000);

  for (let i = lowerBound(m1, entryTime + 1); i < m1.length; i++) {
    const b = m1[i]!;
    if (b.time > timeLimit) {
      const gross = dir === 1 ? (b.open - entry) / risk : (entry - b.open) / risk;
      return {
        instrument, date, dir, entryTime, entry, stop, target,
        exitTime: b.time, exit: b.open, riskPts: risk,
        netR: gross - cost / risk, reason: "time",
      };
    }
    if (dir === 1) {
      if (b.low <= stop) return {
        instrument, date, dir, entryTime, entry, stop, target,
        exitTime: b.time, exit: stop, riskPts: risk, netR: -1 - cost / risk, reason: "stop",
      };
      if (b.high >= target) return {
        instrument, date, dir, entryTime, entry, stop, target,
        exitTime: b.time, exit: target, riskPts: risk, netR: 2 - cost / risk, reason: "target",
      };
    } else {
      if (b.high >= stop) return {
        instrument, date, dir, entryTime, entry, stop, target,
        exitTime: b.time, exit: stop, riskPts: risk, netR: -1 - cost / risk, reason: "stop",
      };
      if (b.low <= target) return {
        instrument, date, dir, entryTime, entry, stop, target,
        exitTime: b.time, exit: target, riskPts: risk, netR: 2 - cost / risk, reason: "target",
      };
    }
  }
  return null;
}

function stats(trades: Trade[]): { n: number; wr: number; netR: number; pf: number; dd: number } {
  const n = trades.length;
  const wins = trades.filter((t) => t.netR > 0);
  const losses = trades.filter((t) => t.netR < 0);
  const netR = trades.reduce((s, t) => s + t.netR, 0);
  const gw = wins.reduce((s, t) => s + t.netR, 0);
  const gl = Math.abs(losses.reduce((s, t) => s + t.netR, 0));
  let eq = 0, peak = 0, dd = 0;
  for (const t of trades) { eq += t.netR; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
  return { n, wr: n ? wins.length / n : 0, netR, pf: gl ? gw / gl : Infinity, dd };
}

function report(label: string, trades: Trade[]): void {
  const s = stats(trades);
  console.log(
    `${label.padEnd(10)} ${String(s.n).padStart(3)}  ${(s.wr * 100).toFixed(1).padStart(5)}%  ` +
    `${s.netR.toFixed(1).padStart(7)}R  PF ${Number.isFinite(s.pf) ? s.pf.toFixed(2) : "inf"}  DD ${s.dd.toFixed(1)}R`,
  );
}

async function main(): Promise<void> {
  console.log(`NY open SMT continuation ${fromArg} -> ${toArg}`);
  const instruments = ["NQ", "ES"];
  const m1: Record<string, Bar[]> = {};
  const rth: Record<string, Map<string, Bar[]>> = {};
  const bias: Record<string, Map<string, Dir | 0>> = {};
  const bars5: Record<string, B5[]> = {};

  for (const inst of instruments) {
    m1[inst] = JSON.parse(await readFile(`data/indices/${inst}-duka.json`, "utf8")) as Bar[];
    rth[inst] = rthByDate(m1[inst]!);
    bias[inst] = priorBias(rth[inst]!);
    bars5[inst] = aggregate5(m1[inst]!);
  }

  const dates = [...rth["NQ"]!.keys()]
    .filter((d) => d >= fromArg && d <= toArg && rth["ES"]!.has(d))
    .sort();

  let alignedDays = 0;
  let smtDays = 0;
  const trades: Trade[] = [];

  for (const date of dates) {
    const nqBias = bias["NQ"]!.get(date) ?? 0;
    const esBias = bias["ES"]!.get(date) ?? 0;
    if (nqBias === 0 || esBias === 0) continue;

    const onNQ = overnightRange(m1["NQ"]!, date);
    const onES = overnightRange(m1["ES"]!, date);
    const orNQ = openingRange(m1["NQ"]!, date);
    const orES = openingRange(m1["ES"]!, date);
    if (onNQ === null || onES === null || orNQ === null || orES === null) continue;

    // Opening-swing sweep vs overnight range.
    const nqSweptLow = orNQ.low < onNQ.low;
    const esSweptLow = orES.low < onES.low;
    const nqSweptHigh = orNQ.high > onNQ.high;
    const esSweptHigh = orES.high > onES.high;

    const bullSMT = nqSweptLow !== esSweptLow && !(nqSweptHigh !== esSweptHigh);
    const bearSMT = nqSweptHigh !== esSweptHigh && !(nqSweptLow !== esSweptLow);
    if (bullSMT || bearSMT) smtDays++;
    if (nqBias === esBias && ((bullSMT && nqBias === 1) || (bearSMT && nqBias === -1))) alignedDays++;

    for (const inst of instruments) {
      const dir = bias[inst]!.get(date) ?? 0;
      if (dir === 0) continue;
      if (dir === 1 && !bullSMT) continue;
      if (dir === -1 && !bearSMT) continue;

      // First 5m close after 09:45 in the bias direction, by 10:30.
      const entryBar = bars5[inst]!.find(
        (b) => b.date === date && b.minute >= MOVE_END && b.minute <= ENTRY_END &&
          (dir === 1 ? b.close > b.open : b.close < b.open),
      );
      if (entryBar === undefined) continue;

      const or = inst === "NQ" ? orNQ : orES;
      const entry = entryBar.close;
      const stop = dir === 1 ? or.low - bufferFor(inst) : or.high + bufferFor(inst);
      if (dir === 1 && entry <= stop) continue;
      if (dir === -1 && entry >= stop) continue;

      const entryTime = entryBar.time + 5 * 60_000 - 1;
      const trade = simulate(inst, m1[inst]!, date, dir, entryTime, entry, stop);
      if (trade !== null) trades.push(trade);
    }
  }

  console.log(`Dates: ${dates.length} | SMT days: ${smtDays} | bias+SMT aligned: ${alignedDays}`);
  report("NQ", trades.filter((t) => t.instrument === "NQ"));
  report("ES", trades.filter((t) => t.instrument === "ES"));
  report("TOTAL", trades);

  const byMonth = new Map<string, Trade[]>();
  for (const t of trades) {
    const k = t.date.slice(0, 7);
    byMonth.set(k, [...(byMonth.get(k) ?? []), t]);
  }
  for (const [k, ts] of [...byMonth.entries()].sort()) report(k, ts);

  for (const t of trades) {
    console.log(
      `  ${t.date} ${t.instrument} ${t.dir === 1 ? "LONG " : "SHORT"} ` +
      `entry ${t.entry.toFixed(2)} stop ${t.stop.toFixed(2)} risk ${t.riskPts.toFixed(1)}p -> ${t.reason} ${t.netR.toFixed(2)}R`,
    );
  }
}

await main();
