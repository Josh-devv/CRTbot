/**
 * MMXM v2 — prior-day bias + 8:30 pivot + 9:30 sweep + SMT + 1m FVG/CISD entry.
 *
 * Rules:
 *  - Prior RTH day candle = bias. Bullish -> DOL above; bearish -> DOL below.
 *  - 08:30-09:30 pre-market forms HALR on the 8:30 side and LRL (DOL) opposite.
 *  - 09:30-10:00 manipulation must sweep HALR; exactly one index sweeps = SMT.
 *  - After the sweep, first 1m FVG retest or 1m CISD in bias direction = entry.
 *  - Stop beyond the sweep extreme. Target fixed 2R. Flat by 15:55 or 60 min.
 *  - One trade per instrument/day.
 *
 * Usage:
 *   npx tsx scratch-mmxx2.ts --from 2026-08-20 --to 2026-10-19 [--trigger fvg|cisd|both]
 */

import { readFile } from "node:fs/promises";
import { DateTime } from "luxon";

const NY = "America/New_York";
const OPEN_830 = 8 * 60 + 30;
const OPEN_930 = 9 * 60 + 30;
const MANIP_END = 10 * 60;
const ENTRY_END = 10 * 60 + 30;

interface Bar { time: number; open: number; high: number; low: number; close: number; volume: number }
type Dir = 1 | -1;
type Trigger = "FVG" | "CISD";

interface Pre {
  date: string; open830: number; pmHigh: number; pmLow: number;
  lrlHigh: number; lrlLow: number;
  halrLow: number | null; halrHigh: number | null;
  failureHigh: boolean; failureLow: boolean;
}

interface Candidate {
  time: number; dir: Dir; trigger: Trigger; entry: number;
  stopEnd: number; sameBarLow?: number; sameBarHigh?: number;
}

interface Trade {
  instrument: string; date: string; dir: Dir; trigger: Trigger;
  entryTime: number; entry: number; stop: number; target: number;
  exitTime: number; exit: number; riskPts: number;
  netR: number; reason: string;
}

const args = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1]! : fallback;
};
const fromArg = flag("--from", "2026-08-20");
const toArg = flag("--to", "2026-10-19");
const triggerArg = flag("--trigger", "both") as "fvg" | "cisd" | "both";
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
    if (highs.some((x) => x.time > h.time && x.price < h.price)) {
      lrlHigh = Math.max(lrlHigh, h.price);
      failureHigh = true;
    }
  }

  let lrlLow = range.low;
  let failureLow = false;
  for (const l of lows) {
    if (l.price >= openBar.open) continue;
    if (lows.some((x) => x.time > l.time && x.price > l.price)) {
      lrlLow = Math.min(lrlLow, l.price);
      failureLow = true;
    }
  }

  return {
    date, open830: openBar.open,
    pmHigh: range.high, pmLow: range.low,
    lrlHigh, lrlLow,
    halrLow: range.low < openBar.open ? range.low : null,
    halrHigh: range.high > openBar.open ? range.high : null,
    failureHigh, failureLow,
  };
}

function fvgCandidates(
  bars: Bar[], sweepTime: number, cutoff: number, dir: Dir,
): Candidate[] {
  const out: Candidate[] = [];
  for (let i = 2; i < bars.length; i++) {
    const a = bars[i - 2]!, mid = bars[i - 1]!, c = bars[i]!;
    if (c.time <= sweepTime) continue;
    if (c.time > cutoff) break;

    if (dir === 1 && mid.close > mid.open && a.high < c.low) {
      const zoneHigh = c.low, zoneLow = a.high;
      for (let j = i + 1; j < bars.length; j++) {
        const b = bars[j]!;
        if (b.time > cutoff) break;
        if (b.low <= zoneHigh) {
          out.push({
            time: b.time + 60_000 - 1, dir, trigger: "FVG",
            entry: zoneHigh, stopEnd: b.time, sameBarLow: b.low,
          });
          break;
        }
        if (b.close < zoneLow) break;
      }
    }

    if (dir === -1 && mid.close < mid.open && a.low > c.high) {
      const zoneLow = c.high, zoneHigh = a.low;
      for (let j = i + 1; j < bars.length; j++) {
        const b = bars[j]!;
        if (b.time > cutoff) break;
        if (b.high >= zoneLow) {
          out.push({
            time: b.time + 60_000 - 1, dir, trigger: "FVG",
            entry: zoneLow, stopEnd: b.time, sameBarHigh: b.high,
          });
          break;
        }
        if (b.close > zoneHigh) break;
      }
    }
  }
  return out;
}

function cisdCandidates(
  bars: Bar[], sweepTime: number, cutoff: number, dir: Dir,
): Candidate[] {
  const out: Candidate[] = [];
  for (let i = 6; i < bars.length; i++) {
    const b = bars[i]!;
    if (b.time <= sweepTime) continue;
    if (b.time > cutoff) break;

    if (dir === 1) {
      let ref = -1;
      for (let j = i - 1; j >= i - 6; j--) {
        if (bars[j]!.close < bars[j]!.open) { ref = j; break; }
      }
      if (ref === -1) continue;
      if (b.close > bars[ref]!.open && b.close > b.open) {
        out.push({
          time: b.time + 60_000 - 1, dir, trigger: "CISD",
          entry: b.close, stopEnd: b.time + 60_000,
        });
        break;
      }
    } else {
      let ref = -1;
      for (let j = i - 1; j >= i - 6; j--) {
        if (bars[j]!.close > bars[j]!.open) { ref = j; break; }
      }
      if (ref === -1) continue;
      if (b.close < bars[ref]!.open && b.close < b.open) {
        out.push({
          time: b.time + 60_000 - 1, dir, trigger: "CISD",
          entry: b.close, stopEnd: b.time + 60_000,
        });
        break;
      }
    }
  }
  return out;
}

function simulate(
  instrument: string, m1: Bar[], date: string, candidate: Candidate,
): Trade | null {
  const start930 = DateTime.fromISO(`${date}T09:30:00`, { zone: NY }).toMillis();
  const range = rangeHL(m1, start930, candidate.stopEnd);
  if (range === null) return null;
  const buffer = bufferFor(instrument);
  const stop = candidate.dir === 1 ? range.low - buffer : range.high + buffer;
  const entry = candidate.entry;
  const risk = Math.abs(entry - stop);
  if (!Number.isFinite(risk) || risk < 2) return null;
  if (candidate.dir === 1 && entry <= stop) return null;
  if (candidate.dir === -1 && entry >= stop) return null;
  const target = candidate.dir === 1 ? entry + 2 * risk : entry - 2 * risk;
  const cost = costFor(instrument);

  if (candidate.dir === 1 && candidate.sameBarLow !== undefined && candidate.sameBarLow <= stop) {
    return {
      instrument, date, dir: candidate.dir, trigger: candidate.trigger,
      entryTime: candidate.time, entry, stop, target,
      exitTime: candidate.time, exit: stop, riskPts: risk,
      netR: -1 - cost / risk, reason: "stop",
    };
  }
  if (candidate.dir === -1 && candidate.sameBarHigh !== undefined && candidate.sameBarHigh >= stop) {
    return {
      instrument, date, dir: candidate.dir, trigger: candidate.trigger,
      entryTime: candidate.time, entry, stop, target,
      exitTime: candidate.time, exit: stop, riskPts: risk,
      netR: -1 - cost / risk, reason: "stop",
    };
  }

  const flat = DateTime.fromISO(`${date}T15:55:00`, { zone: NY }).toMillis();
  const timeLimit = Math.min(flat, candidate.time + 60 * 60_000);

  for (let i = lowerBound(m1, candidate.time + 1); i < m1.length; i++) {
    const b = m1[i]!;
    if (b.time > timeLimit) {
      const gross = candidate.dir === 1 ? (b.open - entry) / risk : (entry - b.open) / risk;
      return {
        instrument, date, dir: candidate.dir, trigger: candidate.trigger,
        entryTime: candidate.time, entry, stop, target,
        exitTime: b.time, exit: b.open, riskPts: risk,
        netR: gross - cost / risk, reason: "time",
      };
    }
    if (candidate.dir === 1) {
      if (b.low <= stop) return {
        instrument, date, dir: candidate.dir, trigger: candidate.trigger,
        entryTime: candidate.time, entry, stop, target,
        exitTime: b.time, exit: stop, riskPts: risk,
        netR: -1 - cost / risk, reason: "stop",
      };
      if (b.high >= target) return {
        instrument, date, dir: candidate.dir, trigger: candidate.trigger,
        entryTime: candidate.time, entry, stop, target,
        exitTime: b.time, exit: target, riskPts: risk,
        netR: 2 - cost / risk, reason: "target",
      };
    } else {
      if (b.high >= stop) return {
        instrument, date, dir: candidate.dir, trigger: candidate.trigger,
        entryTime: candidate.time, entry, stop, target,
        exitTime: b.time, exit: stop, riskPts: risk,
        netR: -1 - cost / risk, reason: "stop",
      };
      if (b.low <= target) return {
        instrument, date, dir: candidate.dir, trigger: candidate.trigger,
        entryTime: candidate.time, entry, stop, target,
        exitTime: b.time, exit: target, riskPts: risk,
        netR: 2 - cost / risk, reason: "target",
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
  console.log(`MMXM v2 ${fromArg} -> ${toArg} | entry ${triggerArg} | target 2R`);
  const instruments = ["NQ", "ES"];
  const m1: Record<string, Bar[]> = {};
  const pre: Record<string, Map<string, Pre>> = {};
  const bias: Record<string, Map<string, Dir | 0>> = {};

  for (const inst of instruments) {
    m1[inst] = JSON.parse(await readFile(`data/indices/${inst}-duka.json`, "utf8")) as Bar[];
    const rth = rthByDate(m1[inst]!);
    bias[inst] = priorBias(rth);
    const map = new Map<string, Pre>();
    for (const date of rth.keys()) {
      if (date < fromArg || date > toArg) continue;
      const p = preMarket(m1[inst]!, date);
      if (p !== null) map.set(date, p);
    }
    pre[inst] = map;
  }

  const dates = [...pre["NQ"]!.keys()].filter((d) => pre["ES"]!.has(d)).sort();
  let smtDays = 0, alignedDays = 0, trades = 0;
  const all: Trade[] = [];

  for (const date of dates) {
    const pNQ = pre["NQ"]!.get(date)!;
    const pES = pre["ES"]!.get(date)!;
    const bNQ = bias["NQ"]!.get(date) ?? 0;
    const bES = bias["ES"]!.get(date) ?? 0;

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
    if (bullSMT || bearSMT) smtDays++;
    if ((bNQ === 1 && bullSMT) || (bNQ === -1 && bearSMT)) alignedDays++;

    for (const inst of instruments) {
      const p = inst === "NQ" ? pNQ : pES;
      const dir = (inst === "NQ" ? bNQ : bES) as Dir | 0;
      if (dir === 0) continue;
      if (dir === 1 && !bullSMT) continue;
      if (dir === -1 && !bearSMT) continue;

      const bars = m1[inst]!;
      const start = DateTime.fromISO(`${date}T09:30:00`, { zone: NY }).toMillis();
      const cutoff = DateTime.fromISO(`${date}T10:30:00`, { zone: NY }).toMillis();
      const dayBars: Bar[] = [];
      for (let i = lowerBound(bars, start); i < bars.length; i++) {
        const b = bars[i]!;
        if (b.time >= cutoff) break;
        dayBars.push(b);
      }

      let sweepTime = -1;
      for (const b of dayBars) {
        if (dir === 1 && p.halrLow !== null && b.low < p.halrLow) { sweepTime = b.time; break; }
        if (dir === -1 && p.halrHigh !== null && b.high > p.halrHigh) { sweepTime = b.time; break; }
      }
      if (sweepTime < 0) continue;

      const candidates: Candidate[] = [];
      if (triggerArg !== "cisd") candidates.push(...fvgCandidates(dayBars, sweepTime, cutoff, dir));
      if (triggerArg !== "fvg") candidates.push(...cisdCandidates(dayBars, sweepTime, cutoff, dir));
      candidates.sort((a, b) => a.time - b.time);

      for (const c of candidates) {
        // Must be trading toward the DOL.
        const dol = dir === 1 ? p.lrlHigh : p.lrlLow;
        if (dir === 1 && !(dol > c.entry)) continue;
        if (dir === -1 && !(dol < c.entry)) continue;
        const trade = simulate(inst, bars, date, c);
        if (trade !== null) {
          all.push(trade);
          trades++;
          break;
        }
      }
    }
  }

  console.log(`Dates ${dates.length} | SMT ${smtDays} | bias+SMT ${alignedDays} | trades ${trades}`);
  report("NQ", all.filter((t) => t.instrument === "NQ"));
  report("ES", all.filter((t) => t.instrument === "ES"));
  report("TOTAL", all);

  for (const trig of ["FVG", "CISD"] as Trigger[]) {
    report(`  ${trig}`, all.filter((t) => t.trigger === trig));
  }

  const byMonth = new Map<string, Trade[]>();
  for (const t of all) byMonth.set(t.date.slice(0, 7), [...(byMonth.get(t.date.slice(0, 7)) ?? []), t]);
  for (const [k, ts] of [...byMonth.entries()].sort()) report(k, ts);

  for (const t of all) {
    console.log(
      `  ${t.date} ${t.instrument} ${t.dir === 1 ? "LONG " : "SHORT"} ${t.trigger} ` +
      `entry ${t.entry.toFixed(2)} stop ${t.stop.toFixed(2)} target ${t.target.toFixed(2)} ` +
      `risk ${t.riskPts.toFixed(1)}p -> ${t.reason} ${t.netR.toFixed(2)}R`,
    );
  }
}

await main();
