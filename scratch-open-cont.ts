/**
 * NY open continuation prototype — NQ/ES.
 *
 * Idea: wait for the 09:30-09:45 ET opening move, require it to agree with the prior-day bias,
 * then enter a continuation on the first 5m FVG retest or 5m CISD after 09:45. One trade/day,
 * 2R target, stop beyond the zone/pullback, flat by 15:55 ET.
 *
 * Usage:
 *   npx tsx scratch-open-cont.ts --from 2026-08-20 --to 2026-10-19 --instrument both
 */

import { readFile } from "node:fs/promises";
import { DateTime } from "luxon";

const NY = "America/New_York";
const OPEN_MIN = 9 * 60 + 30;
const MOVE_END = 9 * 60 + 45;
const SCAN_END = 11 * 60 + 30;
const FLAT_MIN = 15 * 60 + 55;

interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface B5 extends Bar {
  date: string;
  minute: number;
}

type Dir = 1 | -1;
type Trigger = "FVG" | "CISD";

interface Candidate {
  time: number;
  dir: Dir;
  trigger: Trigger;
  entry: number;
  stop: number;
  sameBarLow?: number;
  sameBarHigh?: number;
}

interface Trade {
  instrument: string;
  date: string;
  dir: Dir;
  trigger: Trigger;
  entryTime: number;
  entry: number;
  stop: number;
  target: number;
  exitTime: number;
  exit: number;
  riskPts: number;
  grossR: number;
  netR: number;
  reason: string;
}

const args = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1]! : fallback;
};
const fromArg = flag("--from", "2026-08-20");
const toArg = flag("--to", "2026-10-19");
const instrumentArg = flag("--instrument", "both");
const triggerArg = flag("--trigger", "both") as "fvg" | "cisd" | "both";
const targetR = Number(flag("--target-r", "2"));
const bufferArg = flag("--buffer", "");
const costArg = flag("--cost", "");
const minRiskCost = Number(flag("--min-risk-cost", "0"));
const maxRiskCost = Number(flag("--max-risk-cost", "1e9"));
const cutoffMin = Number(flag("--cutoff", String(SCAN_END)));

const instruments = instrumentArg === "both" ? ["NQ", "ES"] : [instrumentArg];
const bufferFor = (inst: string): number => (bufferArg ? Number(bufferArg) : inst === "NQ" ? 2 : 1);
const costFor = (inst: string): number => (costArg ? Number(costArg) : inst === "NQ" ? 1 : 0.5);

function et(bar: Bar): { date: string; minute: number } {
  const dt = DateTime.fromMillis(bar.time, { zone: NY });
  return { date: dt.toFormat("yyyy-MM-dd"), minute: dt.hour * 60 + dt.minute };
}

function aggregate5(bars: Bar[]): B5[] {
  const map = new Map<string, B5>();
  for (const b of bars) {
    const { date, minute } = et(b);
    const bucket = Math.floor(minute / 5) * 5;
    const key = `${date}|${bucket}`;
    const cur = map.get(key);
    if (cur === undefined) {
      map.set(key, { ...b, date, minute: bucket });
    } else {
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
    const { date, minute } = et(b);
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

function inRange(date: string): boolean {
  return date >= fromArg && date <= toArg;
}

interface DayOpen {
  date: string;
  bias: Dir | 0;
  openDir: Dir | 0;
  open: number;
  close: number;
  high: number;
  low: number;
}

function openingMove(bars5: B5[], date: string, bias: Dir | 0): DayOpen | null {
  const opening = bars5.filter((b) => b.date === date && b.minute >= OPEN_MIN && b.minute < MOVE_END);
  if (opening.length < 2) return null;
  const open = opening[0]!.open;
  const close = opening[opening.length - 1]!.close;
  const high = Math.max(...opening.map((b) => b.high));
  const low = Math.min(...opening.map((b) => b.low));
  return {
    date,
    bias,
    openDir: close > open ? 1 : close < open ? -1 : 0,
    open,
    close,
    high,
    low,
  };
}

function fvgCandidates(bars5: B5[], day: DayOpen, instrument: string): Candidate[] {
  const bars = bars5.filter(
    (b) => b.date === day.date && b.minute >= OPEN_MIN && b.minute <= SCAN_END,
  );
  const out: Candidate[] = [];
  for (let i = 2; i < bars.length; i++) {
    const a = bars[i - 2]!;
    const mid = bars[i - 1]!;
    const c = bars[i]!;
    if (c.minute < MOVE_END) continue;

    if (day.bias === 1 && mid.close > mid.open && a.high < c.low) {
      const zoneHigh = c.low;
      const zoneLow = a.high;
      for (let j = i + 1; j < bars.length; j++) {
        const b = bars[j]!;
        if (b.low <= zoneHigh) {
          out.push({
            time: b.time,
            dir: 1,
            trigger: "FVG",
            entry: zoneHigh,
            stop: zoneLow - bufferFor(instrument),
            sameBarLow: b.low,
          });
          break;
        }
      }
    }

    if (day.bias === -1 && mid.close < mid.open && a.low > c.high) {
      const zoneLow = c.high;
      const zoneHigh = a.low;
      for (let j = i + 1; j < bars.length; j++) {
        const b = bars[j]!;
        if (b.high >= zoneLow) {
          out.push({
            time: b.time,
            dir: -1,
            trigger: "FVG",
            entry: zoneLow,
            stop: zoneHigh + bufferFor(instrument),
            sameBarHigh: b.high,
          });
          break;
        }
      }
    }
  }
  return out;
}

function cisdCandidates(bars5: B5[], day: DayOpen, instrument: string): Candidate[] {
  const bars = bars5.filter(
    (b) => b.date === day.date && b.minute >= MOVE_END && b.minute <= SCAN_END,
  );
  const out: Candidate[] = [];
  for (let i = 6; i < bars.length; i++) {
    const b = bars[i]!;
    if (day.bias === 1) {
      let ref = -1;
      for (let j = i - 1; j >= i - 6; j--) {
        if (bars[j]!.close < bars[j]!.open) {
          ref = j;
          break;
        }
      }
      if (ref === -1) continue;
      const refOpen = bars[ref]!.open;
      if (b.close > refOpen && b.close > b.open) {
        const pullbackLow = Math.min(...bars.slice(i - 6, i).map((x) => x.low));
        out.push({
          time: b.time,
          dir: 1,
          trigger: "CISD",
          entry: b.close,
          stop: pullbackLow - bufferFor(instrument),
          sameBarLow: b.low,
        });
        break;
      }
    } else if (day.bias === -1) {
      let ref = -1;
      for (let j = i - 1; j >= i - 6; j--) {
        if (bars[j]!.close > bars[j]!.open) {
          ref = j;
          break;
        }
      }
      if (ref === -1) continue;
      const refOpen = bars[ref]!.open;
      if (b.close < refOpen && b.close < b.open) {
        const pullbackHigh = Math.max(...bars.slice(i - 6, i).map((x) => x.high));
        out.push({
          time: b.time,
          dir: -1,
          trigger: "CISD",
          entry: b.close,
          stop: pullbackHigh + bufferFor(instrument),
          sameBarHigh: b.high,
        });
        break;
      }
    }
  }
  return out;
}

function simulate(
  instrument: string,
  m1: Bar[],
  candidate: Candidate,
  day: DayOpen,
): Trade | null {
  const buffer = bufferFor(instrument);
  const cost = costFor(instrument);
  const entry = candidate.entry;
  const stop = candidate.stop;
  const risk = Math.abs(entry - stop);
  if (!Number.isFinite(risk) || risk < 2) return null;
  if (risk < minRiskCost * cost || risk > maxRiskCost * cost) return null;
  const target = candidate.dir === 1 ? entry + targetR * risk : entry - targetR * risk;

  // Conservative same-bar stop check.
  if (candidate.dir === 1 && candidate.sameBarLow !== undefined && candidate.sameBarLow <= stop) {
    return {
      instrument,
      date: day.date,
      dir: candidate.dir,
      trigger: candidate.trigger,
      entryTime: candidate.time,
      entry,
      stop,
      target,
      exitTime: candidate.time,
      exit: stop,
      riskPts: risk,
      grossR: -1,
      netR: -1 - cost / risk,
      reason: "stop",
    };
  }
  if (candidate.dir === -1 && candidate.sameBarHigh !== undefined && candidate.sameBarHigh >= stop) {
    return {
      instrument,
      date: day.date,
      dir: candidate.dir,
      trigger: candidate.trigger,
      entryTime: candidate.time,
      entry,
      stop,
      target,
      exitTime: candidate.time,
      exit: stop,
      riskPts: risk,
      grossR: -1,
      netR: -1 - cost / risk,
      reason: "stop",
    };
  }

  const start = candidate.time + 5 * 60_000 - 1;
  const flat = DateTime.fromISO(`${day.date}T15:55:00`, { zone: NY }).toMillis();
  const timeLimit = Math.min(flat, start + 60 * 60_000);
  for (const b of m1) {
    if (b.time <= start) continue;
    if (b.time > timeLimit) {
      const exit = b.open;
      const gross = candidate.dir === 1 ? (exit - entry) / risk : (entry - exit) / risk;
      return {
        instrument,
        date: day.date,
        dir: candidate.dir,
        trigger: candidate.trigger,
        entryTime: candidate.time,
        entry,
        stop,
        target,
        exitTime: b.time,
        exit,
        riskPts: risk,
        grossR: gross,
        netR: gross - cost / risk,
        reason: "time",
      };
    }
    if (candidate.dir === 1) {
      if (b.low <= stop) {
        return {
          instrument, date: day.date, dir: candidate.dir, trigger: candidate.trigger,
          entryTime: candidate.time, entry, stop, target, exitTime: b.time, exit: stop,
          riskPts: risk, grossR: -1, netR: -1 - cost / risk, reason: "stop",
        };
      }
      if (b.high >= target) {
        return {
          instrument, date: day.date, dir: candidate.dir, trigger: candidate.trigger,
          entryTime: candidate.time, entry, stop, target, exitTime: b.time, exit: target,
          riskPts: risk, grossR: targetR, netR: targetR - cost / risk, reason: "target",
        };
      }
    } else {
      if (b.high >= stop) {
        return {
          instrument, date: day.date, dir: candidate.dir, trigger: candidate.trigger,
          entryTime: candidate.time, entry, stop, target, exitTime: b.time, exit: stop,
          riskPts: risk, grossR: -1, netR: -1 - cost / risk, reason: "stop",
        };
      }
      if (b.low <= target) {
        return {
          instrument, date: day.date, dir: candidate.dir, trigger: candidate.trigger,
          entryTime: candidate.time, entry, stop, target, exitTime: b.time, exit: target,
          riskPts: risk, grossR: targetR, netR: targetR - cost / risk, reason: "target",
        };
      }
    }
  }
  return null;
}

function stats(trades: Trade[]): {
  n: number; winRate: number; netR: number; avgR: number; pf: number; maxDD: number;
} {
  const n = trades.length;
  const wins = trades.filter((t) => t.netR > 0).length;
  const netR = trades.reduce((s, t) => s + t.netR, 0);
  const gw = trades.filter((t) => t.netR > 0).reduce((s, t) => s + t.netR, 0);
  const gl = Math.abs(trades.filter((t) => t.netR < 0).reduce((s, t) => s + t.netR, 0));
  let peak = 0;
  let eq = 0;
  let dd = 0;
  for (const t of trades) {
    eq += t.netR;
    peak = Math.max(peak, eq);
    dd = Math.max(dd, peak - eq);
  }
  return {
    n,
    winRate: n === 0 ? 0 : wins / n,
    netR,
    avgR: n === 0 ? 0 : netR / n,
    pf: gl === 0 ? Infinity : gw / gl,
    maxDD: dd,
  };
}

function report(label: string, trades: Trade[]): void {
  const s = stats(trades);
  console.log(
    `${label.padEnd(18)} ${String(s.n).padStart(4)}  ${(s.winRate * 100).toFixed(1).padStart(5)}%  ` +
      `${s.netR.toFixed(1).padStart(7)}R  ${s.avgR.toFixed(3).padStart(7)}R/t  ` +
      `PF ${Number.isFinite(s.pf) ? s.pf.toFixed(2) : "inf"}  DD ${s.maxDD.toFixed(1)}R`,
  );
}

async function main(): Promise<void> {
  console.log(
    `NY open continuation ${fromArg} -> ${toArg} | target ${targetR}R | trigger ${triggerArg}`,
  );
  const all: Trade[] = [];

  for (const instrument of instruments) {
    const m1 = JSON.parse(
      await readFile(`data/indices/${instrument}-duka.json`, "utf8"),
    ) as Bar[];
    const bars5 = aggregate5(m1);
    const rth = rthByDate(m1);
    const biasMap = priorBias(rth);
    const days: DayOpen[] = [];
    for (const date of [...rth.keys()].sort()) {
      if (!inRange(date)) continue;
      const day = openingMove(bars5, date, biasMap.get(date) ?? 0);
      if (day !== null && day.bias !== 0 && day.openDir === day.bias) days.push(day);
    }

    console.log(`${instrument}: ${m1.length} M1 bars, ${days.length} aligned open days`);

    const trades: Trade[] = [];
    for (const day of days) {
      if (day.bias === 0) continue;
      const fvg = triggerArg !== "cisd" ? fvgCandidates(bars5, day, instrument) : [];
      const cisd = triggerArg !== "fvg" ? cisdCandidates(bars5, day, instrument) : [];
      const candidates = [...fvg, ...cisd]
        .filter((c) => {
          const dt = DateTime.fromMillis(c.time, { zone: NY });
          return dt.hour * 60 + dt.minute <= cutoffMin;
        })
        .sort((a, b) => a.time - b.time);
      for (const c of candidates) {
        const trade = simulate(instrument, m1, c, day);
        if (trade !== null) {
          trades.push(trade);
          break;
        }
      }
    }
    all.push(...trades);
    report(instrument, trades);
    const byTrigger = new Map<string, Trade[]>();
    for (const t of trades) byTrigger.set(t.trigger, [...(byTrigger.get(t.trigger) ?? []), t]);
    for (const [k, ts] of [...byTrigger.entries()].sort()) report(`  ${k}`, ts);
    const byMonth = new Map<string, Trade[]>();
    for (const t of trades) byMonth.set(t.date.slice(0, 7), [...(byMonth.get(t.date.slice(0, 7)) ?? []), t]);
    for (const [k, ts] of [...byMonth.entries()].sort()) report(`  ${k}`, ts);
  }

  report("TOTAL", all);
  for (const t of all) {
    console.log(
      `  ${t.date} ${t.instrument} ${t.dir === 1 ? "LONG " : "SHORT"} ${t.trigger} ` +
        `entry ${t.entry.toFixed(2)} stop ${t.stop.toFixed(2)} risk ${t.riskPts.toFixed(2)}p -> ${t.reason} ${t.netR.toFixed(2)}R`,
    );
  }
}

await main();
