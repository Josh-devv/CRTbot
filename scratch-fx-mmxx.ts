/**
 * FX MMXM range model — GBPUSD / EURUSD.
 *
 * 1D: prior day bias and prior day range (high/low).
 *     Bullish prior day -> DOL = prior day high, manipulation = prior day low.
 *     Bearish prior day -> DOL = prior day low, manipulation = prior day high.
 * 4H: first H4 candle that sweeps the manipulation side and closes back inside.
 *     SMT: at that H4 candle, the other pair does NOT sweep its same side.
 * 15m: first FVG retest or CISD after the H4 sweep close.
 *     Stop beyond the H4 sweep extreme; target the prior day DOL.
 *
 * Two-month test: 2024-09-01 .. 2024-10-31 (last full FX data window).
 *
 * Usage:
 *   npx tsx scratch-fx-mmxx.ts --from 2024-09-01 --to 2024-10-31
 */

import { DateTime } from "luxon";

import { loadBars } from "./src/ingest.js";
import type { Bar, Instrument } from "./src/types.js";

const PIP = 0.0001;
const DAY = 86_400_000;
const H4 = 240 * 60_000;
const M15 = 15 * 60_000;

type Dir = 1 | -1;
type Trigger = "FVG" | "CISD";

interface PerPair {
  bufferPips: number;
  costPips: number;
}

const PER_PAIR: Record<Instrument, PerPair> = {
  EURUSD: { bufferPips: 1.5, costPips: 0.8 },
  GBPUSD: { bufferPips: 2.0, costPips: 1.2 },
};

interface Candidate {
  time: number;
  dir: Dir;
  trigger: Trigger;
  entry: number;
  sameBarLow?: number;
  sameBarHigh?: number;
}

interface Trade {
  instrument: Instrument;
  date: string;
  dir: Dir;
  trigger: Trigger;
  entryTime: number;
  entry: number;
  stop: number;
  target: number;
  exitTime: number;
  exit: number;
  riskPips: number;
  plannedR: number;
  netR: number;
  reason: string;
  h4Time: number;
}

const args = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1]! : fallback;
};
const fromIso = flag("--from", "2024-09-01");
const toIso = flag("--to", "2024-10-31");
const triggerArg = flag("--trigger", "both") as "fvg" | "cisd" | "both";
const targetArg = flag("--target", "dol") as "dol" | "fixed";
const smtArg = flag("--smt", "same") as "same" | "day" | "loose";
const rangeArg = flag("--range", "day") as "day" | "5day";
const from = DateTime.fromISO(fromIso, { zone: "utc" }).toMillis();
const to = DateTime.fromISO(toIso, { zone: "utc" }).endOf("day").toMillis();
const warmup = DateTime.fromISO(fromIso, { zone: "utc" }).minus({ days: 10 }).toMillis();

function dateOf(ms: number): string {
  return DateTime.fromMillis(ms, { zone: "utc" }).toFormat("yyyy-MM-dd");
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

function aggregate(bars: Bar[], ms: number): Bar[] {
  const map = new Map<number, Bar>();
  for (const b of bars) {
    const t = Math.floor(b.time / ms) * ms;
    const cur = map.get(t);
    if (cur === undefined) {
      map.set(t, { time: t, open: b.open, high: b.high, low: b.low, close: b.close });
    } else {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
    }
  }
  return [...map.values()].sort((a, b) => a.time - b.time);
}

function byDate(bars: Bar[]): Map<string, Bar[]> {
  const out = new Map<string, Bar[]>();
  for (const b of bars) {
    const d = dateOf(b.time);
    const list = out.get(d) ?? [];
    list.push(b);
    out.set(d, list);
  }
  return out;
}

function fvgCandidates(
  bars: Bar[], startTime: number, endTime: number, dir: Dir,
): Candidate[] {
  const out: Candidate[] = [];
  for (let i = 2; i < bars.length; i++) {
    const a = bars[i - 2]!, mid = bars[i - 1]!, c = bars[i]!;
    if (c.time < startTime) continue;
    if (c.time >= endTime) break;

    if (dir === 1 && mid.close > mid.open && a.high < c.low) {
      const zoneHigh = c.low;
      for (let j = i + 1; j < bars.length; j++) {
        const b = bars[j]!;
        if (b.time >= endTime) break;
        if (b.low <= zoneHigh) {
          out.push({
            time: b.time + M15 - 1,
            dir,
            trigger: "FVG",
            entry: zoneHigh,
            sameBarLow: b.low,
          });
          break;
        }
      }
    }

    if (dir === -1 && mid.close < mid.open && a.low > c.high) {
      const zoneLow = c.high;
      for (let j = i + 1; j < bars.length; j++) {
        const b = bars[j]!;
        if (b.time >= endTime) break;
        if (b.high >= zoneLow) {
          out.push({
            time: b.time + M15 - 1,
            dir,
            trigger: "FVG",
            entry: zoneLow,
            sameBarHigh: b.high,
          });
          break;
        }
      }
    }
  }
  return out;
}

function cisdCandidates(
  bars: Bar[], startTime: number, endTime: number, dir: Dir,
): Candidate[] {
  const out: Candidate[] = [];
  for (let i = 6; i < bars.length; i++) {
    const b = bars[i]!;
    if (b.time < startTime) continue;
    if (b.time >= endTime) break;

    if (dir === 1) {
      let ref = -1;
      for (let j = i - 1; j >= i - 6; j--) {
        if (bars[j]!.close < bars[j]!.open) { ref = j; break; }
      }
      if (ref === -1) continue;
      if (b.close > bars[ref]!.open && b.close > b.open) {
        out.push({
          time: b.time + M15 - 1,
          dir,
          trigger: "CISD",
          entry: b.close,
          sameBarLow: b.low,
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
          time: b.time + M15 - 1,
          dir,
          trigger: "CISD",
          entry: b.close,
          sameBarHigh: b.high,
        });
        break;
      }
    }
  }
  return out;
}

function simulate(
  instrument: Instrument,
  m15: Bar[],
  date: string,
  dir: Dir,
  trigger: Trigger,
  h4Time: number,
  entryTime: number,
  entry: number,
  stop: number,
  target: number,
  sameBarLow?: number,
  sameBarHigh?: number,
): Trade | null {
  const { costPips, bufferPips } = PER_PAIR[instrument];
  const risk = Math.abs(entry - stop);
  const riskPips = risk / PIP;
  if (!Number.isFinite(risk) || riskPips < 3 || riskPips > 120) return null;
  const finalTarget = targetArg === "fixed"
    ? (dir === 1 ? entry + 2 * risk : entry - 2 * risk)
    : target;
  const plannedR = Math.abs(finalTarget - entry) / risk;
  if (plannedR < 1) return null;
  if (dir === 1 && entry <= stop) return null;
  if (dir === -1 && entry >= stop) return null;

  // Conservative same-bar stop check.
  if (dir === 1 && sameBarLow !== undefined && sameBarLow <= stop) {
    return {
      instrument, date, dir, trigger, entryTime, entry, stop, target: finalTarget,
      exitTime: entryTime, exit: stop, riskPips, plannedR,
      netR: -1 - costPips / riskPips, reason: "stop", h4Time,
    };
  }
  if (dir === -1 && sameBarHigh !== undefined && sameBarHigh >= stop) {
    return {
      instrument, date, dir, trigger, entryTime, entry, stop, target: finalTarget,
      exitTime: entryTime, exit: stop, riskPips, plannedR,
      netR: -1 - costPips / riskPips, reason: "stop", h4Time,
    };
  }

  const dayEnd = DateTime.fromISO(date, { zone: "utc" }).plus({ days: 1 }).toMillis();
  const timeLimit = Math.min(dayEnd, entryTime + 12 * 60 * 60_000);

  for (let i = lowerBound(m15, entryTime + 1); i < m15.length; i++) {
    const b = m15[i]!;
    if (b.time > timeLimit) {
      const gross = dir === 1 ? (b.open - entry) / risk : (entry - b.open) / risk;
      return {
        instrument, date, dir, trigger, entryTime, entry, stop, target: finalTarget,
        exitTime: b.time, exit: b.open, riskPips, plannedR,
        netR: gross - costPips / riskPips, reason: "time", h4Time,
      };
    }
    if (dir === 1) {
      if (b.low <= stop) return {
        instrument, date, dir, trigger, entryTime, entry, stop, target: finalTarget,
        exitTime: b.time, exit: stop, riskPips, plannedR,
        netR: -1 - costPips / riskPips, reason: "stop", h4Time,
      };
      if (b.high >= finalTarget) return {
        instrument, date, dir, trigger, entryTime, entry, stop, target: finalTarget,
        exitTime: b.time, exit: finalTarget, riskPips, plannedR,
        netR: plannedR - costPips / riskPips, reason: "target", h4Time,
      };
    } else {
      if (b.high >= stop) return {
        instrument, date, dir, trigger, entryTime, entry, stop, target: finalTarget,
        exitTime: b.time, exit: stop, riskPips, plannedR,
        netR: -1 - costPips / riskPips, reason: "stop", h4Time,
      };
      if (b.low <= finalTarget) return {
        instrument, date, dir, trigger, entryTime, entry, stop, target: finalTarget,
        exitTime: b.time, exit: finalTarget, riskPips, plannedR,
        netR: plannedR - costPips / riskPips, reason: "target", h4Time,
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
    `${label.padEnd(12)} ${String(s.n).padStart(3)}  ${(s.wr * 100).toFixed(1).padStart(5)}%  ` +
    `${s.netR.toFixed(1).padStart(7)}R  PF ${Number.isFinite(s.pf) ? s.pf.toFixed(2) : "inf"}  ` +
    `DD ${s.dd.toFixed(1)}R  avgPlan ${s.avgPlan.toFixed(1)}R`,
  );
}

async function main(): Promise<void> {
  console.log(`FX MMXM ${rangeArg} range ${fromIso}..${toIso} | entry ${triggerArg} | target ${targetArg} | smt ${smtArg}`);

  const instruments: Instrument[] = ["GBPUSD", "EURUSD"];
  const m15: Record<string, Bar[]> = {};
  const h4ByDay: Record<string, Map<string, Bar[]>> = {};
  const ranges: Record<string, Map<string, { bias: Dir | 0; high: number; low: number }>> = {};

  for (const inst of instruments) {
    const m1 = await loadBars(inst, warmup, to);
    const h4 = aggregate(m1, H4);
    const d1 = aggregate(m1, DAY);
    const d1Dates = d1.map((b) => dateOf(b.time));

    const rangeMap = new Map<string, { bias: Dir | 0; high: number; low: number }>();
    for (let i = 1; i < d1.length; i++) {
      const date = d1Dates[i]!;
      if (date < fromIso || date > toIso) continue;
      const prev = d1[i - 1]!;
      const look = rangeArg === "5day"
        ? d1.slice(Math.max(0, i - 5), i)
        : [prev];
      rangeMap.set(date, {
        bias: prev.close > prev.open ? 1 : prev.close < prev.open ? -1 : 0,
        high: Math.max(...look.map((b) => b.high)),
        low: Math.min(...look.map((b) => b.low)),
      });
    }

    const h4Map = new Map<string, Bar[]>();
    for (const b of h4) {
      const d = dateOf(b.time);
      if (d < fromIso || d > toIso) continue;
      const list = h4Map.get(d) ?? [];
      list.push(b);
      h4Map.set(d, list);
    }

    m15[inst] = aggregate(m1, M15);
    h4ByDay[inst] = h4Map;
    ranges[inst] = rangeMap;
    console.log(`${inst}: ${m1.length} M1 bars, ${h4Map.size} days`);
  }

  const dates = [...ranges["GBPUSD"]!.keys()].filter((d) => ranges["EURUSD"]!.has(d)).sort();
  const trades: Trade[] = [];
  let sweepEvents = 0;
  let smtEvents = 0;

  for (const date of dates) {
    const rG = ranges["GBPUSD"]!.get(date)!;
    const rE = ranges["EURUSD"]!.get(date)!;
    const h4G = h4ByDay["GBPUSD"]!.get(date) ?? [];
    const h4E = h4ByDay["EURUSD"]!.get(date) ?? [];
    if (h4G.length === 0 || h4E.length === 0) continue;

    for (const inst of instruments) {
      const other: Instrument = inst === "GBPUSD" ? "EURUSD" : "GBPUSD";
      const r = inst === "GBPUSD" ? rG : rE;
      const ro = inst === "GBPUSD" ? rE : rG;
      if (r.bias === 0) continue;
      const h4 = inst === "GBPUSD" ? h4G : h4E;
      const h4o = inst === "GBPUSD" ? h4E : h4G;

      for (const bar of h4) {
        const otherBar = h4o.find((x) => x.time === bar.time);
        if (otherBar === undefined) continue;

        const sweptLow = bar.low < r.low && bar.close > r.low;
        const sweptHigh = bar.high > r.high && bar.close < r.high;
        const sweepLowDepth = r.low - bar.low;
        const sweepHighDepth = bar.high - r.high;
        const otherLowDepth = Math.max(0, ro.low - otherBar.low);
        const otherHighDepth = Math.max(0, otherBar.high - ro.high);
        const otherSweptLow = smtArg === "day"
          ? h4o.some((x) => x.time <= bar.time && x.low < ro.low)
          : smtArg === "loose"
            ? otherLowDepth >= sweepLowDepth * 0.5
            : otherBar.low < ro.low;
        const otherSweptHigh = smtArg === "day"
          ? h4o.some((x) => x.time <= bar.time && x.high > ro.high)
          : smtArg === "loose"
            ? otherHighDepth >= sweepHighDepth * 0.5
            : otherBar.high > ro.high;
        if (!sweptLow && !sweptHigh) continue;
        sweepEvents++;

        const bullSMT = sweptLow && !otherSweptLow && r.bias === 1;
        const bearSMT = sweptHigh && !otherSweptHigh && r.bias === -1;
        if (!bullSMT && !bearSMT) continue;
        smtEvents++;

        const dir: Dir = bullSMT ? 1 : -1;
        const target = dir === 1 ? r.high : r.low;
        const h4Close = bar.time + H4;
        const dayEnd = DateTime.fromISO(date, { zone: "utc" }).plus({ days: 1 }).toMillis();
        const start = Math.max(h4Close, DateTime.fromISO(date, { zone: "utc" }).toMillis());
        if (start >= dayEnd) continue;

        const i0 = lowerBound(m15[inst]!, start);
        const i1 = lowerBound(m15[inst]!, dayEnd);
        const bars = m15[inst]!.slice(i0, i1);
        const fvg = triggerArg !== "cisd" ? fvgCandidates(bars, start, dayEnd, dir) : [];
        const cisd = triggerArg !== "fvg" ? cisdCandidates(bars, start, dayEnd, dir) : [];
        const candidates = [...fvg, ...cisd].sort((a, b) => a.time - b.time);

        for (const c of candidates) {
          const buffer = PER_PAIR[inst].bufferPips * PIP;
          const stop = dir === 1 ? bar.low - buffer : bar.high + buffer;
          if (targetArg === "dol") {
            if (dir === 1 && c.entry >= target) continue;
            if (dir === -1 && c.entry <= target) continue;
          }
          const trade = simulate(
            inst, m15[inst]!, date, dir, c.trigger, bar.time,
            c.time, c.entry, stop, target, c.sameBarLow, c.sameBarHigh,
          );
          if (trade !== null) {
            trades.push(trade);
            break;
          }
        }
        if (trades.length > 0 && trades[trades.length - 1]!.date === date &&
            trades[trades.length - 1]!.instrument === inst) break;
      }
    }
  }

  console.log(`Dates ${dates.length} | H4 sweeps ${sweepEvents} | SMT events ${smtEvents} | trades ${trades.length}`);
  report("GBPUSD", trades.filter((t) => t.instrument === "GBPUSD"));
  report("EURUSD", trades.filter((t) => t.instrument === "EURUSD"));
  report("TOTAL", trades);

  for (const trig of ["FVG", "CISD"] as Trigger[]) {
    report(`  ${trig}`, trades.filter((t) => t.trigger === trig));
  }

  const byMonth = new Map<string, Trade[]>();
  for (const t of trades) byMonth.set(t.date.slice(0, 7), [...(byMonth.get(t.date.slice(0, 7)) ?? []), t]);
  for (const [k, ts] of [...byMonth.entries()].sort()) report(k, ts);

  for (const t of trades) {
    console.log(
      `  ${t.date} ${t.instrument} ${t.dir === 1 ? "LONG " : "SHORT"} ${t.trigger} ` +
      `H4 ${new Date(t.h4Time).toISOString().slice(11, 16)} entry ${t.entry.toFixed(5)} ` +
      `stop ${t.stop.toFixed(5)} target ${t.target.toFixed(5)} ` +
      `risk ${t.riskPips.toFixed(1)}p plan ${t.plannedR.toFixed(1)}R -> ${t.reason} ${t.netR.toFixed(2)}R`,
    );
  }
}

await main();
