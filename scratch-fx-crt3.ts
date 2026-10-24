/**
 * FX 3-candle H4 CRT — GBPUSD / EURUSD.
 *
 * Conformational CRT (Sham):
 *   C1 = H4 range candle.
 *   C2 = next H4 candle whose wick purges one side of C1 and closes back inside C1.
 *   C3 = next H4 candle; entry at its open in the direction of the daily bias.
 *
 * Filters:
 *   - Daily bias: prior NY session-day candle direction (17:00 NY boundary).
 *   - Direction: bullish bias only buys a C1-low purge; bearish only sells a C1-high purge.
 *   - SMT: on C2, the correlated pair does NOT purge its own C1 on the same side.
 *
 * Targets:
 *   - mid: 50% of C1 (Sham's first target).
 *   - end: opposite extreme of C1.
 *
 * Stop: beyond C2's sweep extreme + pair buffer. Time stop: C3 close (or --hold hours).
 *
 * Usage:
 *   npx tsx scratch-fx-crt3.ts --from 2023-11-01 --to 2024-10-31 --target mid
 *   npx tsx scratch-fx-crt3.ts --from 2023-11-01 --to 2024-10-31 --target end
 */

import { readFileSync } from "node:fs";

import { DateTime } from "luxon";

import { loadBars } from "./src/ingest.js";
import type { Bar, Instrument } from "./src/types.js";

const PIP = 0.0001;
const M15 = 15 * 60_000;
const NY = "America/New_York";

type Dir = 1 | -1;
type TargetMode = "mid" | "end" | "dol";
type DirMode = "prior" | "macro" | "off";

interface KeyLevels {
  highs: number[];
  lows: number[];
}

interface PerPair {
  bufferPips: number;
  costPips: number;
}

const PER_PAIR: Record<Instrument, PerPair> = {
  EURUSD: { bufferPips: 1.5, costPips: 0.8 },
  GBPUSD: { bufferPips: 2.0, costPips: 1.2 },
};

interface Trade {
  instrument: Instrument;
  session: string;
  anchor: string;
  dir: Dir;
  c1Time: number;
  c2Time: number;
  c3Time: number;
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
}

const args = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1]! : fallback;
};

const fromIso = flag("--from", "2023-11-01");
const toIso = flag("--to", "2024-10-31");
const targetArg = flag("--target", "mid") as TargetMode;
const smtArg = flag("--smt", "on") as "on" | "loose" | "off";
const dirRaw = flag("--dir", "prior");
const dirArg: DirMode = dirRaw === "on" ? "prior" : dirRaw === "off" ? "off" : dirRaw as DirMode;
const keyArg = flag("--key", "on") as "on" | "off";
const keyMode = flag("--key-mode", "c1") as "c1" | "c2";
const dolArg = flag("--dol", "on") as "on" | "off";
const keyTolPips = Number(flag("--key-tol", "10"));
const debug = flag("--debug", "off") === "on";
const holdHours = Number(flag("--hold", "4"));
const from = DateTime.fromISO(fromIso, { zone: "utc" }).toMillis();
const to = DateTime.fromISO(toIso, { zone: "utc" }).endOf("day").toMillis();
const warmup = DateTime.fromISO(fromIso, { zone: "utc" }).minus({ days: 10 }).toMillis();

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

function nyHour(ms: number): number {
  return DateTime.fromMillis(ms, { zone: NY }).hour;
}

/** 17:00 New York session-day start for a UTC timestamp. */
function sessionStart(ms: number): number {
  const dt = DateTime.fromMillis(ms, { zone: NY });
  const base = dt.hour < 17 ? dt.startOf("day").minus({ days: 1 }) : dt.startOf("day");
  return base.plus({ hours: 17 }).toMillis();
}

/** Aggregate 1m bars into NY-anchored buckets (H4 or D1). */
function aggregateNY(bars: Bar[], hoursPerBar: number): Bar[] {
  const map = new Map<number, Bar>();
  for (const b of bars) {
    const start = sessionStart(b.time);
    const dt = DateTime.fromMillis(b.time, { zone: NY });
    let hours = dt.hour - 17;
    if (hours < 0) hours += 24;
    const bucketHour = Math.floor(hours / hoursPerBar) * hoursPerBar;
    const totalHour = 17 + bucketHour;
    const bucket = DateTime.fromMillis(start, { zone: NY })
      .plus({ days: Math.floor(totalHour / 24) })
      .set({ hour: totalHour % 24 })
      .toMillis();
    const cur = map.get(bucket);
    if (cur === undefined) {
      map.set(bucket, { time: bucket, open: b.open, high: b.high, low: b.low, close: b.close });
    } else {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
    }
  }
  return [...map.values()].sort((a, b) => a.time - b.time);
}

function biasMap(d1: Bar[]): Map<number, Dir> {
  const out = new Map<number, Dir>();
  for (let i = 1; i < d1.length; i++) {
    const prev = d1[i - 1]!;
    const dir: Dir | 0 = prev.close > prev.open ? 1 : prev.close < prev.open ? -1 : 0;
    if (dir !== 0) out.set(d1[i]!.time, dir);
  }
  return out;
}

function keyLevelsBySession(d1: Bar[]): Map<number, KeyLevels> {
  const out = new Map<number, KeyLevels>();
  for (let i = 1; i < d1.length; i++) {
    const prev = d1[i - 1]!;
    const look = d1.slice(Math.max(0, i - 5), i);
    out.set(d1[i]!.time, {
      highs: [prev.high, Math.max(...look.map((b) => b.high))],
      lows: [prev.low, Math.min(...look.map((b) => b.low))],
    });
  }
  return out;
}

interface MacroRow {
  date: string;
  close: number;
}

function loadMacro(file: string): MacroRow[] {
  const raw = JSON.parse(readFileSync(file, "utf8")) as {
    chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ close?: Array<number | null> }> } }> };
  };
  const result = raw.chart?.result?.[0];
  const ts = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const out: MacroRow[] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i];
    if (c === null || c === undefined || !Number.isFinite(c)) continue;
    out.push({
      date: DateTime.fromMillis(ts[i]! * 1000, { zone: NY }).toFormat("yyyy-MM-dd"),
      close: c,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function macroBiasTable(): Array<{ date: string; score: number }> {
  const dxy = new Map(loadMacro("data/macro/dxy.json").map((r) => [r.date, r.close]));
  const us5y = new Map(loadMacro("data/macro/us5y.json").map((r) => [r.date, r.close]));
  const dates = [...dxy.keys()].filter((d) => us5y.has(d)).sort();
  const out: Array<{ date: string; score: number }> = [];
  for (let i = 20; i < dates.length; i++) {
    const cur = dates[i]!;
    const prev = dates[i - 20]!;
    const score =
      Math.sign(dxy.get(cur)! - dxy.get(prev)!) +
      Math.sign(us5y.get(cur)! - us5y.get(prev)!);
    out.push({ date: cur, score });
  }
  return out;
}

function macroBiasFor(table: Array<{ date: string; score: number }>, date: string): number {
  let lo = 0;
  let hi = table.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (table[mid]!.date < date) lo = mid + 1;
    else hi = mid;
  }
  return lo === 0 ? 0 : table[lo - 1]!.score;
}

function simulate(
  instrument: Instrument,
  m15: Bar[],
  entryTime: number,
  entry: number,
  stop: number,
  target: number,
  dir: Dir,
  endTime: number,
  c1Time: number,
  c2Time: number,
  c3Time: number,
  session: string,
  anchor: string,
): Trade | null {
  const { costPips } = PER_PAIR[instrument];
  const risk = Math.abs(entry - stop);
  const riskPips = risk / PIP;
  if (!Number.isFinite(risk) || riskPips < 3 || riskPips > 120) return null;

  const plannedR = Math.abs(target - entry) / risk;
  if (plannedR < 1) return null;
  if (dir === 1 && entry >= target) return null;
  if (dir === -1 && entry <= target) return null;

  const base = {
    instrument, session, anchor, dir, c1Time, c2Time, c3Time,
    entryTime, entry, stop, target, riskPips, plannedR,
  };

  const i0 = lowerBound(m15, entryTime);
  for (let i = i0; i < m15.length; i++) {
    const b = m15[i]!;
    if (b.time >= endTime) {
      const gross = dir === 1 ? (b.open - entry) / risk : (entry - b.open) / risk;
      return {
        ...base,
        exitTime: b.time, exit: b.open,
        netR: gross - costPips / riskPips, reason: "time",
      };
    }
    if (dir === 1) {
      if (b.low <= stop) {
        return {
          ...base,
          exitTime: b.time, exit: stop,
          netR: -1 - costPips / riskPips, reason: "stop",
        };
      }
      if (b.high >= target) {
        return {
          ...base,
          exitTime: b.time, exit: target,
          netR: plannedR - costPips / riskPips, reason: "target",
        };
      }
    } else {
      if (b.high >= stop) {
        return {
          ...base,
          exitTime: b.time, exit: stop,
          netR: -1 - costPips / riskPips, reason: "stop",
        };
      }
      if (b.low <= target) {
        return {
          ...base,
          exitTime: b.time, exit: target,
          netR: plannedR - costPips / riskPips, reason: "target",
        };
      }
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
  let eq = 0;
  let peak = 0;
  let dd = 0;
  for (const t of trades) {
    eq += t.netR;
    peak = Math.max(peak, eq);
    dd = Math.max(dd, peak - eq);
  }
  return {
    n,
    wr: n === 0 ? 0 : (wins.length / n) * 100,
    netR,
    pf: gl === 0 ? (gw > 0 ? Infinity : 0) : gw / gl,
    dd,
    avgPlan: n === 0 ? 0 : trades.reduce((s, t) => s + t.plannedR, 0) / n,
  };
}

function line(label: string, s: ReturnType<typeof stats>): string {
  return `${label.padEnd(14)} ${String(s.n).padStart(3)}  ${s.wr.toFixed(1).padStart(4)}%  ${s.netR.toFixed(1).padStart(6)}R  PF ${s.pf === Infinity ? "inf" : s.pf.toFixed(2)}  DD ${s.dd.toFixed(1)}R  avgPlan ${s.avgPlan.toFixed(1)}R`;
}

async function main(): Promise<void> {
  const instruments: Instrument[] = ["GBPUSD", "EURUSD"];
  const m15ByPair = new Map<Instrument, Bar[]>();
  const h4ByPair = new Map<Instrument, Bar[]>();
  const h4TimeByPair = new Map<Instrument, Map<number, Bar>>();
  const biasByPair = new Map<Instrument, Map<number, Dir>>();
  const keyByPair = new Map<Instrument, Map<number, KeyLevels>>();
  const macroTable = macroBiasTable();
  console.log(`Macro rows: ${macroTable.length} (DXY + US5Y, 20-day change)`);

  for (const inst of instruments) {
    const m1 = await loadBars(inst, warmup, to);
    const agg15 = new Map<number, Bar>();
    for (const b of m1) {
      const t = Math.floor(b.time / M15) * M15;
      const cur = agg15.get(t);
      if (cur === undefined) agg15.set(t, { time: t, open: b.open, high: b.high, low: b.low, close: b.close });
      else {
        cur.high = Math.max(cur.high, b.high);
        cur.low = Math.min(cur.low, b.low);
        cur.close = b.close;
      }
    }
    m15ByPair.set(inst, [...agg15.values()].sort((a, b) => a.time - b.time));

    const h4 = aggregateNY(m1, 4);
    h4ByPair.set(inst, h4);
    h4TimeByPair.set(inst, new Map(h4.map((b) => [b.time, b])));

    const d1 = aggregateNY(m1, 24);
    biasByPair.set(inst, biasMap(d1));
    keyByPair.set(inst, keyLevelsBySession(d1));

    console.log(`${inst}: ${m1.length} M1 bars | ${h4.length} H4 NY bars | ${d1.length} D1 NY bars`);
  }

  const busyUntil: Record<Instrument, number> = { GBPUSD: 0, EURUSD: 0 };
  const trades: Trade[] = [];
  const funnel = {
    h4: 0,
    c2Pattern: 0,
    direction: 0,
    key: 0,
    otherData: 0,
    smtPassed: 0,
    dol: 0,
  };

  for (const inst of instruments) {
    const h4 = h4ByPair.get(inst)!;
    const h4Map = h4TimeByPair.get(inst)!;
    const bias = biasByPair.get(inst)!;
    const keyLevels = keyByPair.get(inst)!;
    const other = inst === "GBPUSD" ? "EURUSD" : "GBPUSD";
    const otherMap = h4TimeByPair.get(other)!;
    const m15 = m15ByPair.get(inst)!;

    for (let i = 1; i < h4.length - 1; i++) {
      const c1 = h4[i - 1]!;
      const c2 = h4[i]!;
      const c3 = h4[i + 1]!;
      if (c2.time < from || c2.time > to) continue;

      const h1 = nyHour(c1.time);
      const h2 = nyHour(c2.time);
      const h3 = nyHour(c3.time);
      const anchor =
        h1 === 21 && h2 === 1 && h3 === 5 ? "Asia 21-1-5" :
        h1 === 1 && h2 === 5 && h3 === 9 ? "Asian 1-5-9" :
        h1 === 5 && h2 === 9 && h3 === 13 ? "London 5-9-13" :
        h1 === 9 && h2 === 13 && h3 === 17 ? "NY 9-13-17" :
        null;
      if (anchor === null) continue;
      funnel.h4++;

      const session = sessionStart(c2.time);
      const sessionDate = DateTime.fromMillis(session, { zone: NY }).toFormat("yyyy-MM-dd");
      const biasDir = bias.get(session);

      const bull = c2.low < c1.low && c2.close > c1.low && c2.close < c1.high;
      const bear = c2.high > c1.high && c2.close < c1.high && c2.close > c1.low;
      if (bull === bear) continue; // neither, or an outside bar that swept both sides
      funnel.c2Pattern++;
      const dir: Dir = bull ? 1 : -1;

      if (dirArg === "prior" && dir !== biasDir) continue;
      if (dirArg === "macro") {
        const macroBias = Math.sign(macroBiasFor(macroTable, sessionDate));
        if (macroBias === 0 || dir !== -macroBias) continue;
      }
      funnel.direction++;

      const keys = keyLevels.get(session);
      if (keyArg === "on") {
        if (keys === undefined) continue;
        const tol = keyTolPips * PIP;
        const atKey = keyMode === "c1"
          ? dir === 1
            ? keys.lows.some((k) => c1.low >= k && c1.low - k <= tol)
            : keys.highs.some((k) => c1.high <= k && k - c1.high <= tol)
          : dir === 1
            ? keys.lows.some((k) => c2.low < k && k - c2.low <= tol)
            : keys.highs.some((k) => c2.high > k && c2.high - k <= tol);
        if (!atKey) continue;
      }
      funnel.key++;

      const otherC1 = otherMap.get(c1.time);
      const otherC2 = otherMap.get(c2.time);
      if (otherC1 === undefined || otherC2 === undefined) continue;
      funnel.otherData++;

      if (smtArg !== "off") {
        let otherSwept: boolean;
        if (smtArg === "loose") {
          const ourDepth = dir === 1 ? c1.low - c2.low : c2.high - c1.high;
          const otherDepth = dir === 1
            ? Math.max(0, otherC1.low - otherC2.low)
            : Math.max(0, otherC2.high - otherC1.high);
          otherSwept = otherDepth >= ourDepth * 0.5;
        } else {
          otherSwept = dir === 1 ? otherC2.low < otherC1.low : otherC2.high > otherC1.high;
        }
        if (otherSwept) continue;
      }
      funnel.smtPassed++;

      const entry = c3.open;
      const stop = dir === 1
        ? c2.low - PER_PAIR[inst].bufferPips * PIP
        : c2.high + PER_PAIR[inst].bufferPips * PIP;

      let dol: number | undefined;
      if (dolArg === "on") {
        if (keys === undefined) continue;
        const candidates = dir === 1
          ? keys.highs.filter((h) => h > entry)
          : keys.lows.filter((l) => l < entry);
        if (candidates.length === 0) {
          if (debug) console.log(`DOL no candidate ${sessionDate} ${inst} ${dir === 1 ? "L" : "S"} entry ${entry} keys ${JSON.stringify(keys)}`);
          continue;
        }
        dol = dir === 1 ? Math.min(...candidates) : Math.max(...candidates);
        if (Math.abs(dol - entry) < Math.abs(entry - stop)) {
          if (debug) console.log(`DOL too close ${sessionDate} ${inst} ${dir === 1 ? "L" : "S"} entry ${entry} dol ${dol} risk ${Math.abs(entry - stop)}`);
          continue;
        }
      }
      funnel.dol++;

      const target = targetArg === "dol"
        ? dol
        : dir === 1
          ? (targetArg === "mid" ? (c1.high + c1.low) / 2 : c1.high)
          : (targetArg === "mid" ? (c1.high + c1.low) / 2 : c1.low);
      if (target === undefined) continue;

      if (dir === 1 && entry >= target) continue;
      if (dir === -1 && entry <= target) continue;

      if (dolArg === "on" && dol !== undefined && targetArg !== "dol") {
        if (dir === 1 && target > dol) continue;
        if (dir === -1 && target < dol) continue;
      }

      const endTime = c3.time + holdHours * 60 * 60_000;
      const trade = simulate(
        inst, m15, c3.time, entry, stop, target, dir, endTime,
        c1.time, c2.time, c3.time,
        DateTime.fromMillis(session, { zone: NY }).toFormat("yyyy-MM-dd"),
        anchor,
      );
      if (trade === null) continue;
      if (trade.entryTime < busyUntil[inst]) continue;
      busyUntil[inst] = trade.exitTime;
      trades.push(trade);
    }
  }

  console.log(`\nFX 3-candle H4 CRT ${fromIso}..${toIso} | target ${targetArg} | SMT ${smtArg} | dir ${dirArg} | key ${keyArg}/${keyMode} (${keyTolPips}p) | DOL ${dolArg} | hold ${holdHours}h`);
  console.log(`Funnel: H4 C2 ${funnel.h4} -> pattern ${funnel.c2Pattern} -> direction ${funnel.direction} -> key ${funnel.key} -> other data ${funnel.otherData} -> SMT ${funnel.smtPassed} -> DOL ${funnel.dol} -> trades ${trades.length}`);

  for (const inst of instruments) {
    console.log(line(inst, stats(trades.filter((t) => t.instrument === inst))));
  }
  for (const anchor of ["Asia 21-1-5", "Asian 1-5-9", "London 5-9-13", "NY 9-13-17"]) {
    console.log(line(anchor, stats(trades.filter((t) => t.anchor === anchor))));
  }
  console.log(line("TOTAL", stats(trades)));
  for (const dir of [1, -1] as Dir[]) {
    console.log(line(dir === 1 ? "  LONG" : "  SHORT", stats(trades.filter((t) => t.dir === dir))));
  }

  const shown = trades.slice(0, 20);
  console.log("");
  for (const t of shown) {
    const c2 = DateTime.fromMillis(t.c2Time, { zone: NY }).toFormat("yyyy-MM-dd HH:mm");
    console.log(
      `  ${c2} ${t.instrument} ${t.dir === 1 ? "LONG " : "SHORT"} ` +
      `entry ${t.entry.toFixed(5)} stop ${t.stop.toFixed(5)} target ${t.target.toFixed(5)} ` +
      `risk ${t.riskPips.toFixed(1)}p plan ${t.plannedR.toFixed(1)}R -> ${t.reason} ${t.netR.toFixed(2)}R`,
    );
  }
  if (trades.length > shown.length) console.log(`  ... ${trades.length - shown.length} more`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
