/**
 * ICT sniper-entry prototype — NQ/ES (NAS100/US500 CFD proxies).
 *
 * The model, as specified by the user and checked against the primary-source
 * dossier in .scratch/sniper-entries/research/ict-sniper-fib-liquidity.md:
 *
 *   1. Time macro: NY AM window (09:30-11:00 ET for indices).
 *   2. Liquidity raid: sweep a prior RTH / prior-week / Asian / London level,
 *      then close back through it (Turtle Soup trigger).
 *   3. Manipulation leg: from the origin of the raid (last opposing swing, or
 *      the 09:30 open) to the sweep extreme.
 *   4. Fibonacci standard-deviation target: project the leg range in the
 *      reversal direction. For a long (sweep of lows):
 *        target = originHigh + k * (originHigh - sweepLow)
 *      For a short (sweep of highs):
 *        target = originLow - k * (sweepHigh - originLow)
 *      This is the TradingView convention P(r) = B + r(A - B), with the
 *      anchors set to the sweep extreme (A) and leg origin (B), so negative
 *      r extends beyond the origin in the reversal direction.
 *
 * Entries:
 *   --entry limit    literal Turtle Soup: limit at the swept level +/- 1 tick.
 *   --entry confirm  M5 reclaim + M1 MSS + first M1 FVG retrace.
 *
 * Stops:
 *   --stop tight       just beyond the swept level (literal 1-tick rule + buffer).
 *   --stop structural  beyond the sweep extreme + fixed buffer.
 *   --stop atr         beyond the sweep extreme + max(fixed buffer, mult * ATR).
 *
 * This is a codified approximation, not Huddleston's discretion. Results are
 * in R; dollar sizing depends on broker CFD specs.
 *
 * Usage:
 *   npx tsx scratch-ict-sniper.ts --from 2026-07-01 --to 2026-09-30 --target fib2.5
 *   npx tsx scratch-ict-sniper.ts --entry confirm --target fib1.5 --window am
 *   npx tsx scratch-ict-sniper.ts --stop atr --atr-mult 0.25 --target liq
 *   npx tsx scratch-ict-sniper.ts --instrument USTEC --from 2024-01-01 --to 2026-10-22
 *   npx tsx scratch-ict-sniper.ts --selftest
 */

import { readFile } from "node:fs/promises";
import { DateTime } from "luxon";

const NY = "America/New_York";
const TICK = 0.25;

interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Levels {
  date: string;
  asianHigh: number | null;
  asianLow: number | null;
  londonHigh: number | null;
  londonLow: number | null;
  priorRthHigh: number;
  priorRthLow: number;
  priorWeekHigh: number | null;
  priorWeekLow: number | null;
  range930High: number | null;
  range930Low: number | null;
  midnightOpen: number | null;
  open930: number | null;
  dailyBias: 1 | -1 | null;
  gapBias: 1 | -1 | null;
}

interface Raid {
  side: 1 | -1;
  levelName: string;
  level: number;
  time: number;
  idx: number;
  priority: number;
}

interface M5Bar {
  start: number;
  end: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface Candidate {
  side: 1 | -1;
  levelName: string;
  level: number;
  raidTime: number;
  entryTime: number;
  entry: number;
  stop: number;
  target: number;
  riskPts: number;
  plannedR: number;
  fillIdx: number;
  origin: number;
  extreme: number;
  fibK: number | null;
}

interface Trade extends Candidate {
  instrument: string;
  date: string;
  exitTime: number;
  exit: number;
  netR: number;
  reason: string;
}

type EntryKind = "limit" | "confirm";
type StopKind = "tight" | "structural" | "atr";
type LegKind = "origin" | "open" | "window";
type TargetKind =
  | "fib1"
  | "fib1.5"
  | "fib2"
  | "fib2.5"
  | "fib3"
  | "fib3.5"
  | "liq"
  | "r";

const FIB_K: Record<string, number> = {
  fib1: 1,
  "fib1.5": 1.5,
  fib2: 2,
  "fib2.5": 2.5,
  fib3: 3,
  "fib3.5": 3.5,
};

interface WindowConfig {
  raidStart: number;
  raidEnd: number;
  entryEnd: number;
  exitEnd: number;
}

const WINDOWS: Record<string, WindowConfig> = {
  am: { raidStart: 570, raidEnd: 660, entryEnd: 660, exitEnd: 720 },
  judas: { raidStart: 570, raidEnd: 630, entryEnd: 630, exitEnd: 720 },
  day: { raidStart: 570, raidEnd: 900, entryEnd: 900, exitEnd: 960 },
};

const args = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1]! : fallback;
};
const has = (name: string): boolean => args.includes(name);

function closeEnough(actual: number, expected: number, label: string): void {
  if (Math.abs(actual - expected) > 1e-9) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

if (has("--selftest")) {
  // TradingView P(r) = B + r(A - B); negative r extends beyond B.
  const p = (a: number, b: number, r: number): number => b + r * (a - b);
  closeEnough(p(90, 100, -1), 110, "up-leg -1.0");
  closeEnough(p(90, 100, -2.5), 125, "up-leg -2.5");
  closeEnough(p(110, 100, -1), 90, "down-leg -1.0");
  closeEnough(p(110, 100, -3.5), 65, "down-leg -3.5");
  // Long reversal after a low sweep: origin 100, sweep 90.
  const longK = 2.5;
  closeEnough(100 + longK * (100 - 90), 125, "long fib2.5");
  // Short reversal after a high sweep: origin 100, sweep 110.
  closeEnough(100 - longK * (110 - 100), 75, "short fib2.5");
  console.log("selftest ok");
  process.exit(0);
}

const entryArg = flag("--entry", "limit") as EntryKind;
const stopArg = flag("--stop", "structural") as StopKind;
const legArg = flag("--leg", "origin") as LegKind;
const targetArg = flag("--target", "fib1.5") as TargetKind;
const windowArg = flag("--window", "am");
const levelsArg = flag("--levels", "core") as "core" | "all";
const biasArg = flag("--bias", "off") as "off" | "daily" | "gap";
const skipMonday = has("--skip-monday");
const fvgEntryArg = flag("--fvg-entry", "50") as "50" | "edge";
const fromArg = flag("--from", "2026-07-01");
const toArg = flag("--to", "2026-09-30");
const instrumentArg = flag("--instrument", "both");
const targetR = Number(flag("--target-r", "2"));
const placeboArg = flag("--placebo", "off");
const placeboScale = Number(flag("--placebo-scale", "0.0025"));
const minFvg = Number(flag("--min-fvg", "0.5"));
const minRisk = Number(flag("--min-risk", "0.75"));
const maxRisk = Number(flag("--max-risk", "250"));
const minPlan = Number(flag("--min-plan", "1"));
const atrMult = Number(flag("--atr-mult", "0.25"));
const atrPeriod = Number(flag("--atr-period", "14"));
const onePerDay = flag("--one-per-day", "on") !== "off";

const baseWindow = WINDOWS[windowArg] ?? WINDOWS.am!;
const cfg: WindowConfig = {
  raidStart: Number(flag("--raid-start", String(baseWindow.raidStart))),
  raidEnd: Number(flag("--raid-end", String(baseWindow.raidEnd))),
  entryEnd: Number(flag("--entry-end", String(baseWindow.entryEnd))),
  exitEnd: Number(flag("--exit-end", String(baseWindow.exitEnd))),
};

const instruments = instrumentArg === "both" ? ["NQ", "ES"] : [instrumentArg];

const bufferFor = (inst: string): number => {
  const override = flag("--buffer", "");
  if (override !== "") return Number(override);
  if (inst === "NQ" || inst === "USTEC") return 2;
  if (inst === "ES" || inst === "US500") return 1;
  return 0.2;
};

const costFor = (inst: string): number => {
  const override = flag("--cost", "");
  if (override !== "") return Number(override);
  if (inst === "NQ") return 1.5;
  if (inst === "USTEC") return 2.0;
  if (inst === "ES") return 0.6;
  if (inst === "US500") return 0.6;
  return 0.02;
};

const tickFor = (inst: string): number => {
  const override = flag("--tick", "");
  if (override !== "") return Number(override);
  if (inst === "NQ" || inst === "ES") return TICK;
  return 0.01;
};

const dataPathFor = (inst: string): string => {
  if (inst === "QQQ") return "data/indices/QQQ-5y.json";
  if (inst === "QQQ10") return "data/indices/QQQ.json";
  if (inst === "SPY") return "data/indices/SPY-5y.json";
  if (inst === "SPY10") return "data/indices/SPY.json";
  if (inst === "USTEC") return "data/indices/USTEC-exness.json";
  if (inst === "US500") return "data/indices/US500-exness.json";
  return `data/indices/${inst}-duka.json`;
};

function parts(ms: number): { date: string; minute: number } {
  const dt = DateTime.fromMillis(ms, { zone: NY });
  return { date: dt.toFormat("yyyy-MM-dd"), minute: dt.hour * 60 + dt.minute };
}

function dayStart(date: string): number {
  return DateTime.fromISO(date, { zone: NY }).startOf("day").toMillis();
}

function plusDay(date: string): string {
  return DateTime.fromISO(date, { zone: NY }).plus({ days: 1 }).toFormat("yyyy-MM-dd");
}

function aggregate(
  bars: Bar[],
  assign: (date: string, minute: number) => string | null,
): Map<string, { high: number; low: number }> {
  const out = new Map<string, { high: number; low: number }>();
  for (const bar of bars) {
    const { date, minute } = parts(bar.time);
    const key = assign(date, minute);
    if (key === null) continue;
    const cur = out.get(key);
    if (cur === undefined) out.set(key, { high: bar.high, low: bar.low });
    else {
      cur.high = Math.max(cur.high, bar.high);
      cur.low = Math.min(cur.low, bar.low);
    }
  }
  return out;
}

function buildContext(bars: Bar[]): {
  byDate: Map<string, Bar[]>;
  levels: Map<string, Levels>;
} {
  const byDate = new Map<string, Bar[]>();
  for (const bar of bars) {
    const { date } = parts(bar.time);
    const list = byDate.get(date) ?? [];
    list.push(bar);
    byDate.set(date, list);
  }

  const rth = aggregate(bars, (date, minute) =>
    minute >= 570 && minute < 960 ? date : null,
  );
  const rthOC = new Map<string, { open: number; close: number }>();
  for (const bar of bars) {
    const { date, minute } = parts(bar.time);
    if (minute < 570 || minute >= 960) continue;
    const cur = rthOC.get(date);
    if (cur === undefined) rthOC.set(date, { open: bar.open, close: bar.close });
    else cur.close = bar.close;
  }

  const asian = aggregate(bars, (date, minute) => {
    if (minute >= 1200) return plusDay(date);
    if (minute < 120) return date;
    return null;
  });

  const london = aggregate(bars, (date, minute) =>
    minute >= 120 && minute < 300 ? date : null,
  );

  const range930 = aggregate(bars, (date, minute) =>
    minute >= 570 && minute < 600 ? date : null,
  );

  const midnightOpen = new Map<string, number>();
  const open930 = new Map<string, number>();
  for (const bar of bars) {
    const { date, minute } = parts(bar.time);
    if (minute === 0 && !midnightOpen.has(date)) midnightOpen.set(date, bar.open);
    if (minute === 570 && !open930.has(date)) open930.set(date, bar.open);
  }

  const rthDates = [...rth.keys()].sort();

  const weekRanges = new Map<string, { high: number; low: number }>();
  const weekOf = new Map<string, string>();
  for (const date of rthDates) {
    const key = DateTime.fromISO(date, { zone: NY }).toFormat("kkkk-WW");
    weekOf.set(date, key);
    const r = rth.get(date)!;
    const cur = weekRanges.get(key);
    if (cur === undefined) weekRanges.set(key, { high: r.high, low: r.low });
    else {
      cur.high = Math.max(cur.high, r.high);
      cur.low = Math.min(cur.low, r.low);
    }
  }

  const weekKeys = [...weekRanges.keys()].sort();
  const priorWeek = new Map<string, { high: number; low: number }>();
  for (let i = 1; i < weekKeys.length; i++) {
    priorWeek.set(weekKeys[i]!, weekRanges.get(weekKeys[i - 1]!)!);
  }

  const levels = new Map<string, Levels>();
  for (let i = 1; i < rthDates.length; i++) {
    const date = rthDates[i]!;
    const prev = rth.get(rthDates[i - 1]!)!;
    const a = asian.get(date);
    const l = london.get(date);
    const r9 = range930.get(date);
    const pw = priorWeek.get(weekOf.get(date)!);
    const prevOC = rthOC.get(rthDates[i - 1]!);
    const o930 = open930.get(date) ?? null;
    const dailyBias = prevOC === undefined || prevOC.close === prevOC.open
      ? null
      : (prevOC.close > prevOC.open ? 1 : -1);
    const gapBias = prevOC === undefined || o930 === null || o930 === prevOC.close
      ? null
      : (o930 > prevOC.close ? 1 : -1);

    levels.set(date, {
      date,
      asianHigh: a?.high ?? null,
      asianLow: a?.low ?? null,
      londonHigh: l?.high ?? null,
      londonLow: l?.low ?? null,
      priorRthHigh: prev.high,
      priorRthLow: prev.low,
      priorWeekHigh: pw?.high ?? null,
      priorWeekLow: pw?.low ?? null,
      range930High: r9?.high ?? null,
      range930Low: r9?.low ?? null,
      midnightOpen: midnightOpen.get(date) ?? null,
      open930: o930,
      dailyBias,
      gapBias,
    });
  }

  return { byDate, levels };
}

function findSwingHigh(bars: Bar[], endIdx: number): number {
  const start = Math.max(2, endIdx - 60);
  for (let j = endIdx - 3; j >= start; j--) {
    if (
      bars[j]!.high > bars[j - 1]!.high &&
      bars[j]!.high > bars[j - 2]!.high &&
      bars[j]!.high > bars[j + 1]!.high &&
      bars[j]!.high > bars[j + 2]!.high
    ) {
      return bars[j]!.high;
    }
  }
  return Math.max(...bars.slice(Math.max(0, endIdx - 10), endIdx).map((b) => b.high));
}

function findSwingLow(bars: Bar[], endIdx: number): number {
  const start = Math.max(2, endIdx - 60);
  for (let j = endIdx - 3; j >= start; j--) {
    if (
      bars[j]!.low < bars[j - 1]!.low &&
      bars[j]!.low < bars[j - 2]!.low &&
      bars[j]!.low < bars[j + 1]!.low &&
      bars[j]!.low < bars[j + 2]!.low
    ) {
      return bars[j]!.low;
    }
  }
  return Math.min(...bars.slice(Math.max(0, endIdx - 10), endIdx).map((b) => b.low));
}

function lowLevels(
  levels: Levels,
  minute: number,
): Array<{ name: string; price: number; priority: number }> {
  const out: Array<{ name: string; price: number; priority: number }> = [];
  const add = (name: string, price: number | null, priority: number): void => {
    if (price !== null) out.push({ name, price, priority });
  };
  add("Prior RTH low", levels.priorRthLow, 1);
  add("Prior week low", levels.priorWeekLow, 2);
  add("Asian low", levels.asianLow, 3);
  add("London low", levels.londonLow, 4);
  if (minute >= 600) add("Opening range low", levels.range930Low, 5);
  if (levelsArg === "all") {
    add("Midnight open", levels.midnightOpen, 6);
    add("09:30 open", levels.open930, 7);
  }
  return out;
}

function highLevels(
  levels: Levels,
  minute: number,
): Array<{ name: string; price: number; priority: number }> {
  const out: Array<{ name: string; price: number; priority: number }> = [];
  const add = (name: string, price: number | null, priority: number): void => {
    if (price !== null) out.push({ name, price, priority });
  };
  add("Prior RTH high", levels.priorRthHigh, 1);
  add("Prior week high", levels.priorWeekHigh, 2);
  add("Asian high", levels.asianHigh, 3);
  add("London high", levels.londonHigh, 4);
  if (minute >= 600) add("Opening range high", levels.range930High, 5);
  if (levelsArg === "all") {
    add("Midnight open", levels.midnightOpen, 6);
    add("09:30 open", levels.open930, 7);
  }
  return out;
}

function hashKey(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function shiftedLevel(price: number, key: string): number {
  if (placeboArg !== "shift") return price;
  const unit = (hashKey(key) % 100000) / 100000;
  const offset = (unit * 2 - 1) * placeboScale;
  return price * (1 + offset);
}

function raidsForDay(bars: Bar[], levels: Levels, config: WindowConfig, tick: number): Raid[] {
  const out: Raid[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]!;
    const { minute } = parts(bar.time);
    if (minute < config.raidStart) continue;
    if (minute >= config.raidEnd) break;

    for (const { name, price, priority } of lowLevels(levels, minute)) {
      const key = `L:${name}`;
      if (seen.has(key)) continue;
      // A resting buy limit at level - tick fills when price trades through it.
      // Do NOT require the bar to close back inside: that information is not
      // available to a limit order and would filter out failed sweeps.
      const levelPrice = shiftedLevel(price, `${levels.date}:L:${name}`);
      if (bar.low <= levelPrice - tick) {
        seen.add(key);
        out.push({ side: 1, levelName: name, level: levelPrice, time: bar.time, idx: i, priority });
      }
    }

    for (const { name, price, priority } of highLevels(levels, minute)) {
      const key = `H:${name}`;
      if (seen.has(key)) continue;
      const levelPrice = shiftedLevel(price, `${levels.date}:H:${name}`);
      if (bar.high >= levelPrice + tick) {
        seen.add(key);
        out.push({ side: -1, levelName: name, level: levelPrice, time: bar.time, idx: i, priority });
      }
    }
  }

  return out.sort((a, b) => a.time - b.time || a.priority - b.priority);
}

function buildM5(bars: Bar[], date: string): M5Bar[] {
  const base = dayStart(date);
  const map = new Map<number, M5Bar>();

  for (const bar of bars) {
    const { minute } = parts(bar.time);
    const bucket = Math.floor(minute / 5) * 5;
    const start = base + bucket * 60_000;
    const end = start + 5 * 60_000;
    const cur = map.get(start);
    if (cur === undefined) {
      map.set(start, {
        start,
        end,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      });
    } else {
      cur.high = Math.max(cur.high, bar.high);
      cur.low = Math.min(cur.low, bar.low);
      cur.close = bar.close;
    }
  }

  return [...map.values()].sort((a, b) => a.start - b.start);
}

function atrFromM5(
  m5: M5Bar[],
  raidTime: number,
  period: number,
  mult: number,
  floor: number,
): number {
  const completed = m5.filter((bar) => bar.end <= raidTime);
  const n = Math.max(2, Math.floor(period));
  if (completed.length < n + 1) return floor;

  let sum = 0;
  for (let i = completed.length - n; i < completed.length; i++) {
    const bar = completed[i]!;
    const prev = completed[i - 1]!;
    const tr = Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - prev.close),
      Math.abs(bar.low - prev.close),
    );
    sum += tr;
  }
  return Math.max(floor, mult * (sum / n));
}

function legOrigin(
  bars: Bar[],
  raid: Raid,
  levels: Levels,
  mode: LegKind,
  config: WindowConfig,
): number {
  if (mode === "open" && levels.open930 !== null) {
    if (raid.side === 1 && levels.open930 > raid.level) return levels.open930;
    if (raid.side === -1 && levels.open930 < raid.level) return levels.open930;
  }

  if (mode === "window") {
    const first = bars.find((bar) => parts(bar.time).minute >= config.raidStart);
    if (first !== undefined) {
      if (raid.side === 1 && first.open > raid.level) return first.open;
      if (raid.side === -1 && first.open < raid.level) return first.open;
    }
  }

  const swing = raid.side === 1
    ? findSwingHigh(bars, raid.idx)
    : findSwingLow(bars, raid.idx);

  // Ensure the origin is on the correct side of the swept level. If the last
  // swing is inside the sweep, use the reference level itself as the origin.
  return raid.side === 1 ? Math.max(swing, raid.level) : Math.min(swing, raid.level);
}

function makeCandidate(
  bars: Bar[],
  raid: Raid,
  levels: Levels,
  inst: string,
  config: WindowConfig,
  m5: M5Bar[],
  tick: number,
): Candidate | null {
  const endIdx = bars.findIndex((b) => parts(b.time).minute >= config.entryEnd);
  const lastIdx = endIdx === -1 ? bars.length - 1 : endIdx - 1;
  if (raid.idx >= lastIdx) return null;

  let buffer = bufferFor(inst);
  let entry: number;
  let stop: number;
  let fillIdx: number;
  let extreme: number;

  if (entryArg === "limit") {
    const bar = bars[raid.idx]!;
    const limit = raid.side === 1 ? raid.level - tick : raid.level + tick;
    // A buy limit fills at the limit or better if the bar gaps through it.
    entry = raid.side === 1 ? Math.min(limit, bar.open) : Math.max(limit, bar.open);
    if (raid.side === 1 && bar.low > entry) return null;
    if (raid.side === -1 && bar.high < entry) return null;

    fillIdx = raid.idx;
    extreme = raid.side === 1 ? bar.low : bar.high;
    if (stopArg === "atr") buffer = atrFromM5(m5, raid.time, atrPeriod, atrMult, buffer);

    if (stopArg === "tight") {
      stop = raid.side === 1 ? entry - buffer : entry + buffer;
    } else {
      stop = raid.side === 1 ? extreme - buffer : extreme + buffer;
    }
  } else {
    // Confirmation: M5 close back through the swept level.
    let reclaim: M5Bar | null = null;
    let count = 0;
    for (const bar of m5) {
      if (bar.end <= raid.time) continue;
      count++;
      if (count > 6) break;
      if (raid.side === 1 && bar.close > raid.level) {
        reclaim = bar;
        break;
      }
      if (raid.side === -1 && bar.close < raid.level) {
        reclaim = bar;
        break;
      }
    }
    if (reclaim === null) return null;

    const reclaimIdx = bars.findIndex((b) => b.time >= reclaim.end);
    if (reclaimIdx < 0 || reclaimIdx > lastIdx) return null;

    let mssLevel: number;
    let mssIdx = -1;
    if (raid.side === 1) {
      mssLevel = findSwingHigh(bars, reclaimIdx);
      for (let i = reclaimIdx; i <= lastIdx; i++) {
        if (bars[i]!.close > mssLevel) {
          mssIdx = i;
          break;
        }
      }
    } else {
      mssLevel = findSwingLow(bars, reclaimIdx);
      for (let i = reclaimIdx; i <= lastIdx; i++) {
        if (bars[i]!.close < mssLevel) {
          mssIdx = i;
          break;
        }
      }
    }
    if (mssIdx < 0) return null;

    let fvgIdx = -1;
    entry = NaN;
    for (let i = Math.max(2, mssIdx); i <= lastIdx; i++) {
      const bar = bars[i]!;
      if (raid.side === 1) {
        const gapLow = bars[i - 2]!.high;
        if (bar.low > gapLow && bar.low - gapLow >= minFvg) {
          fvgIdx = i;
          entry = fvgEntryArg === "50" ? (bar.low + gapLow) / 2 : bar.low;
          break;
        }
      } else {
        const gapHigh = bars[i - 2]!.low;
        if (bar.high < gapHigh && gapHigh - bar.high >= minFvg) {
          fvgIdx = i;
          entry = fvgEntryArg === "50" ? (bar.high + gapHigh) / 2 : bar.high;
          break;
        }
      }
    }
    if (fvgIdx < 0) return null;

    fillIdx = -1;
    for (let i = fvgIdx + 1; i <= lastIdx; i++) {
      const bar = bars[i]!;
      if (raid.side === 1 && bar.low <= entry) {
        fillIdx = i;
        break;
      }
      if (raid.side === -1 && bar.high >= entry) {
        fillIdx = i;
        break;
      }
    }
    if (fillIdx < 0) return null;

    extreme = raid.side === 1 ? Infinity : -Infinity;
    for (let i = raid.idx; i <= fillIdx; i++) {
      const bar = bars[i]!;
      if (raid.side === 1) extreme = Math.min(extreme, bar.low);
      else extreme = Math.max(extreme, bar.high);
    }
    if (stopArg === "atr") buffer = atrFromM5(m5, raid.time, atrPeriod, atrMult, buffer);

    stop = raid.side === 1 ? extreme - buffer : extreme + buffer;
  }

  const risk = raid.side === 1 ? entry - stop : stop - entry;
  if (!(risk > 0) || risk < minRisk || risk > maxRisk) return null;

  const origin = legOrigin(bars, raid, levels, legArg, config);
  const range = raid.side === 1 ? origin - extreme : extreme - origin;
  if (!(range > 0)) return null;

  let target: number;
  let fibK: number | null = null;
  if (targetArg === "r") {
    target = raid.side === 1 ? entry + targetR * risk : entry - targetR * risk;
  } else if (targetArg === "liq") {
    const opposing = raid.side === 1
      ? [
          levels.priorRthHigh,
          levels.priorWeekHigh,
          levels.asianHigh,
          levels.londonHigh,
          levels.range930High,
          levels.midnightOpen,
          levels.open930,
        ].filter((l): l is number => l !== null && l >= entry + risk)
      : [
          levels.priorRthLow,
          levels.priorWeekLow,
          levels.asianLow,
          levels.londonLow,
          levels.range930Low,
          levels.midnightOpen,
          levels.open930,
        ].filter((l): l is number => l !== null && l <= entry - risk);
    if (opposing.length === 0) return null;
    target = raid.side === 1 ? Math.min(...opposing) : Math.max(...opposing);
  } else {
    fibK = FIB_K[targetArg] ?? null;
    if (fibK === null) return null;
    target = raid.side === 1
      ? origin + fibK * range
      : origin - fibK * range;
  }

  if (raid.side === 1 && target <= entry) return null;
  if (raid.side === -1 && target >= entry) return null;

  const plannedR = Math.abs(target - entry) / risk;
  if (plannedR < minPlan) return null;

  return {
    side: raid.side,
    levelName: raid.levelName,
    level: raid.level,
    raidTime: raid.time,
    entryTime: bars[fillIdx]!.time,
    entry,
    stop,
    target,
    riskPts: risk,
    plannedR,
    fillIdx,
    origin,
    extreme,
    fibK,
  };
}

function simulate(
  bars: Bar[],
  candidate: Candidate,
  date: string,
  inst: string,
  config: WindowConfig,
): Trade | null {
  const { side, entry, stop, target, fillIdx } = candidate;
  const exitEnd = dayStart(date) + config.exitEnd * 60_000;
  let exit = NaN;
  let exitTime = NaN;
  let reason = "";

  for (let i = fillIdx; i < bars.length; i++) {
    const bar = bars[i]!;
    if (bar.time >= exitEnd) break;
    // On the entry bar we know the fill price but not the intrabar path.
    // Check the stop, but do not credit a same-bar target: the high/low could
    // have occurred before the fill. Targets are evaluated from the next bar.
    const entryBar = i === fillIdx;

    if (side === 1) {
      if (bar.low <= stop) {
        exit = stop;
        exitTime = bar.time;
        reason = "stop";
        break;
      }
      if (!entryBar && bar.high >= target) {
        exit = target;
        exitTime = bar.time;
        reason = "target";
        break;
      }
    } else {
      if (bar.high >= stop) {
        exit = stop;
        exitTime = bar.time;
        reason = "stop";
        break;
      }
      if (!entryBar && bar.low <= target) {
        exit = target;
        exitTime = bar.time;
        reason = "target";
        break;
      }
    }

    exit = bar.close;
    exitTime = bar.time;
    reason = "time";
  }

  if (!Number.isFinite(exit)) return null;

  const risk = candidate.riskPts;
  const grossR = side === 1 ? (exit - entry) / risk : (entry - exit) / risk;
  const netR = grossR - costFor(inst) / risk;

  return {
    ...candidate,
    instrument: inst,
    date,
    exitTime,
    exit,
    netR,
    reason,
  };
}

function stats(trades: Trade[]): {
  n: number;
  wr: number;
  netR: number;
  pf: number;
  dd: number;
  avgPlan: number;
  avgRisk: number;
  medRisk: number;
  p10Risk: number;
  p90Risk: number;
  avgWin: number;
  avgLoss: number;
  exp: number;
} {
  const n = trades.length;
  const wins = trades.filter((t) => t.netR > 0);
  const losses = trades.filter((t) => t.netR <= 0);
  const netR = trades.reduce((s, t) => s + t.netR, 0);
  const gw = wins.reduce((s, t) => s + t.netR, 0);
  const gl = -losses.reduce((s, t) => s + t.netR, 0);
  const risks = trades.map((t) => t.riskPts).sort((a, b) => a - b);
  const at = (p: number): number => {
    if (risks.length === 0) return 0;
    return risks[Math.min(risks.length - 1, Math.max(0, Math.floor((risks.length - 1) * p)))]!;
  };

  let eq = 0;
  let peak = 0;
  let dd = 0;
  for (const trade of trades) {
    eq += trade.netR;
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
    avgRisk: n === 0 ? 0 : trades.reduce((s, t) => s + t.riskPts, 0) / n,
    medRisk: at(0.5),
    p10Risk: at(0.1),
    p90Risk: at(0.9),
    avgWin: wins.length === 0 ? 0 : gw / wins.length,
    avgLoss: losses.length === 0 ? 0 : losses.reduce((s, t) => s + t.netR, 0) / losses.length,
    exp: n === 0 ? 0 : netR / n,
  };
}

function line(label: string, s: ReturnType<typeof stats>): string {
  return (
    `${label.padEnd(18)} ${String(s.n).padStart(3)}  ` +
    `${s.wr.toFixed(1).padStart(4)}%  ${s.netR.toFixed(1).padStart(6)}R  ` +
    `PF ${s.pf === Infinity ? "inf" : s.pf.toFixed(2)}  DD ${s.dd.toFixed(1)}R  ` +
    `avgPlan ${s.avgPlan.toFixed(1)}R  exp ${s.exp.toFixed(2)}R`
  );
}

function bootstrapNet(trades: Trade[], iterations = 5000): {
  p05: number;
  median: number;
  p95: number;
  probPositive: number;
} {
  const rs = trades.map((t) => t.netR);
  const n = rs.length;
  if (n === 0) return { p05: 0, median: 0, p95: 0, probPositive: 0 };

  const sums: number[] = [];
  for (let i = 0; i < iterations; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) sum += rs[Math.floor(Math.random() * n)]!;
    sums.push(sum);
  }
  sums.sort((a, b) => a - b);
  const at = (p: number): number => sums[Math.min(iterations - 1, Math.floor(iterations * p))]!;

  return {
    p05: at(0.05),
    median: at(0.5),
    p95: at(0.95),
    probPositive: (sums.filter((s) => s > 0).length / iterations) * 100,
  };
}

function streaks(trades: Trade[]): { maxLoss: number; maxWin: number } {
  const sorted = [...trades].sort((a, b) => a.entryTime - b.entryTime);
  let loss = 0;
  let win = 0;
  let maxLoss = 0;
  let maxWin = 0;
  for (const trade of sorted) {
    if (trade.netR > 0) {
      win++;
      loss = 0;
      maxWin = Math.max(maxWin, win);
    } else {
      loss++;
      win = 0;
      maxLoss = Math.max(maxLoss, loss);
    }
  }
  return { maxLoss, maxWin };
}

function losingRuns(trades: Trade[]): Trade[][] {
  const sorted = [...trades].sort((a, b) => a.entryTime - b.entryTime);
  const runs: Trade[][] = [];
  let run: Trade[] = [];
  for (const trade of sorted) {
    if (trade.netR <= 0) {
      run.push(trade);
    } else if (run.length > 0) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length > 0) runs.push(run);
  return runs;
}

function winningRuns(trades: Trade[]): Trade[][] {
  const sorted = [...trades].sort((a, b) => a.entryTime - b.entryTime);
  const runs: Trade[][] = [];
  let run: Trade[] = [];
  for (const trade of sorted) {
    if (trade.netR > 0) {
      run.push(trade);
    } else if (run.length > 0) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length > 0) runs.push(run);
  return runs;
}

function distribution(trades: Trade[]): string {
  const rs = trades.map((t) => t.netR).sort((a, b) => a - b);
  const n = rs.length;
  if (n === 0) return "R distribution: no trades";

  const q = (p: number): number => rs[Math.min(n - 1, Math.max(0, Math.floor((n - 1) * p)))]!;
  const sum = rs.reduce((a, b) => a + b, 0);
  const top5 = rs.slice(-5).reduce((a, b) => a + b, 0);
  const bottom5 = rs.slice(0, 5).reduce((a, b) => a + b, 0);
  const buckets: Array<[string, number]> = [
    ["<=-1R", rs.filter((r) => r <= -1).length],
    ["-1..0", rs.filter((r) => r > -1 && r <= 0).length],
    ["0..2R", rs.filter((r) => r > 0 && r <= 2).length],
    ["2..5R", rs.filter((r) => r > 2 && r <= 5).length],
    ["5..10R", rs.filter((r) => r > 5 && r <= 10).length],
    [">10R", rs.filter((r) => r > 10).length],
  ];

  return (
    `R distribution: median ${q(0.5).toFixed(2)}R | p10 ${q(0.1).toFixed(2)}R | p90 ${q(0.9).toFixed(2)}R | ` +
    `best ${rs[n - 1]!.toFixed(2)}R | worst ${rs[0]!.toFixed(2)}R | ` +
    `top5 ${top5.toFixed(1)}R (${sum > 0 ? ((top5 / sum) * 100).toFixed(0) : "n/a"}% of net) | ` +
    `bottom5 ${bottom5.toFixed(1)}R | ` +
    buckets.map(([k, v]) => `${k} ${v}`).join(" | ")
  );
}

async function main(): Promise<void> {
  const from = DateTime.fromISO(fromArg, { zone: NY }).startOf("day");
  const to = DateTime.fromISO(toArg, { zone: NY }).endOf("day");
  const loadFrom = from.minus({ days: 10 }).toMillis();
  const loadTo = to.plus({ days: 1 }).toMillis();

  const contexts = new Map<string, ReturnType<typeof buildContext>>();
  for (const inst of instruments) {
    const raw = JSON.parse(
      await readFile(dataPathFor(inst), "utf8"),
    ) as Bar[];
    const bars = raw.filter((b) => b.time >= loadFrom && b.time <= loadTo);
    contexts.set(inst, buildContext(bars));
    console.log(`${inst}: ${bars.length} M1 bars (${fromArg}..${toArg} + warmup)`);
  }

  const trades: Trade[] = [];
  const funnel = { days: 0, raids: 0, candidates: 0 };

  for (const inst of instruments) {
    const context = contexts.get(inst)!;
    const instTick = tickFor(inst);
    const dates = [...context.levels.keys()].filter((d) => d >= fromArg && d <= toArg).sort();

    for (const date of dates) {
      const weekday = DateTime.fromISO(date, { zone: NY }).weekday;
      if (weekday === 6 || weekday === 7) continue; // ignore weekend/fake bars
      if (skipMonday && weekday === 1) continue;
      const bars = context.byDate.get(date);
      const levels = context.levels.get(date);
      if (bars === undefined || levels === undefined) continue;
      funnel.days++;

      const m5 = entryArg === "confirm" || stopArg === "atr" ? buildM5(bars, date) : [];
      const raids = raidsForDay(bars, levels, cfg, instTick);
      funnel.raids += raids.length;

      const bias = biasArg === "daily" ? levels.dailyBias : biasArg === "gap" ? levels.gapBias : null;
      for (const raid of raids) {
        if (biasArg !== "off" && bias !== null && raid.side !== bias) continue;
        const candidate = makeCandidate(bars, raid, levels, inst, cfg, m5, instTick);
        if (candidate === null) continue;
        funnel.candidates++;

        const trade = simulate(bars, candidate, date, inst, cfg);
        if (trade === null) continue;
        trades.push(trade);
        if (onePerDay) break;
      }
    }
  }

  console.log(
    `\nICT sniper ${fromArg}..${toArg} | entry ${entryArg} | stop ${stopArg}${stopArg === "atr" ? ` ${atrMult}xATR${atrPeriod}` : ""} | leg ${legArg} | ` +
    `target ${targetArg}${targetArg === "r" ? ` ${targetR}R` : ""} | window ${cfg.raidStart}-${cfg.raidEnd} | exit ${cfg.exitEnd} | levels ${levelsArg}` +
    `${biasArg !== "off" ? ` | bias ${biasArg}` : ""}${skipMonday ? " | no-Mon" : ""}${minPlan !== 1 ? ` | minPlan ${minPlan}R` : ""} | placebo ${placeboArg}`,
  );
  console.log(
    `Funnel: days ${funnel.days} -> raids ${funnel.raids} -> candidates ${funnel.candidates} -> trades ${trades.length}`,
  );

  for (const inst of instruments) {
    console.log(line(inst, stats(trades.filter((t) => t.instrument === inst))));
  }
  const total = stats(trades);
  console.log(line("TOTAL", total));
  const q1 = trades.filter((t) => t.netR >= 1).length;
  const q2 = trades.filter((t) => t.netR >= 2).length;
  console.log(
    `Quality wins: >=1R ${q1}/${total.n} (${total.n ? ((q1 / total.n) * 100).toFixed(1) : "0.0"}%) | ` +
    `>=2R ${q2}/${total.n} (${total.n ? ((q2 / total.n) * 100).toFixed(1) : "0.0"}%)`,
  );
  console.log(
    `Stops: avg ${total.avgRisk.toFixed(1)}p | median ${total.medRisk.toFixed(1)}p | ` +
    `p10 ${total.p10Risk.toFixed(1)}p | p90 ${total.p90Risk.toFixed(1)}p | ` +
    `avgWin ${total.avgWin.toFixed(2)}R | avgLoss ${total.avgLoss.toFixed(2)}R | exp ${total.exp.toFixed(2)}R`,
  );
  console.log(distribution(trades));
  const boot = bootstrapNet(trades);
  const streak = streaks(trades);
  console.log(
    `Bootstrap 5000x: net 5% ${boot.p05.toFixed(0)}R | median ${boot.median.toFixed(0)}R | ` +
    `95% ${boot.p95.toFixed(0)}R | P(net>0) ${boot.probPositive.toFixed(1)}% | ` +
    `max losing streak ${streak.maxLoss} | max winning streak ${streak.maxWin}`,
  );

  const top = [...trades].sort((a, b) => b.netR - a.netR).slice(0, 5);
  for (const trade of top) {
    const entryTime = DateTime.fromMillis(trade.entryTime, { zone: NY }).toFormat("yyyy-MM-dd HH:mm");
    console.log(
      `  TOP ${entryTime} ${trade.instrument} ${trade.side === 1 ? "LONG " : "SHORT"} ${trade.levelName} ` +
      `${trade.netR.toFixed(2)}R plan ${trade.plannedR.toFixed(1)}R risk ${trade.riskPts.toFixed(1)}p`,
    );
  }

  for (const side of [1, -1] as const) {
    console.log(line(side === 1 ? "  LONG" : "  SHORT", stats(trades.filter((t) => t.side === side))));
  }

  for (const level of [...new Set(trades.map((t) => t.levelName))]) {
    console.log(line(level, stats(trades.filter((t) => t.levelName === level))));
  }

  const months = [...new Set(trades.map((t) => t.date.slice(0, 7)))].sort();
  for (const month of months) {
    console.log(line(month, stats(trades.filter((t) => t.date.startsWith(month)))));
  }

  const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
  for (const weekday of weekdays) {
    const dayTrades = trades.filter(
      (t) => DateTime.fromMillis(t.entryTime, { zone: NY }).weekdayLong === weekday,
    );
    if (dayTrades.length > 0)
      console.log(line(weekday, stats(dayTrades)));
  }

  console.log("");
  for (const trade of trades.slice(0, 25)) {
    const entryTime = DateTime.fromMillis(trade.entryTime, { zone: NY }).toFormat("yyyy-MM-dd HH:mm");
    console.log(
      `  ${entryTime} ${trade.instrument} ${trade.side === 1 ? "LONG " : "SHORT"} ${trade.levelName} ` +
      `entry ${trade.entry.toFixed(2)} stop ${trade.stop.toFixed(2)} target ${trade.target.toFixed(2)} ` +
      `risk ${trade.riskPts.toFixed(1)}p plan ${trade.plannedR.toFixed(1)}R -> ${trade.reason} ${trade.netR.toFixed(2)}R`,
    );
  }
  if (trades.length > 25) console.log(`  ... ${trades.length - 25} more`);

  if (args.includes("--losing-streaks") || args.includes("--streaks")) {
    const fmt = (ms: number): string =>
      DateTime.fromMillis(ms, { zone: NY }).toFormat("yyyy-MM-dd HH:mm");
    const printRuns = (label: string, runs: Trade[][], suffix: "L" | "W"): void => {
      const counts = new Map<number, number>();
      for (const run of runs) counts.set(run.length, (counts.get(run.length) ?? 0) + 1);
      const byLength = [...counts.entries()].sort((a, b) => a[0] - b[0]);
      console.log(`\n${label} runs: ${runs.length} total`);
      console.log(`By length: ${byLength.map(([n, c]) => `${n}x=${c}`).join(" ")}`);
      for (const run of runs.filter((r) => r.length >= 3)) {
        const first = run[0]!;
        const last = run[run.length - 1]!;
        const totalR = run.reduce((s, t) => s + t.netR, 0);
        const instruments = [...new Set(run.map((t) => t.instrument))].join("/");
        console.log(
          `  ${fmt(first.entryTime)}..${fmt(last.entryTime)} ${run.length}${suffix} ${totalR.toFixed(2)}R ${instruments}`,
        );
      }
      const maxRun = runs.reduce((best, run) => (run.length > best.length ? run : best), [] as Trade[]);
      if (maxRun.length > 0) {
        console.log(`\nMAX ${label.toUpperCase()} RUN (${maxRun.length}):`);
        for (const trade of maxRun) {
          console.log(
            `  ${fmt(trade.entryTime)} ${trade.instrument} ${trade.side === 1 ? "LONG " : "SHORT"} ` +
              `${trade.levelName} ${trade.netR.toFixed(2)}R`,
          );
        }
      }
    };
    printRuns("Losing", losingRuns(trades), "L");
    if (args.includes("--streaks")) printRuns("Winning", winningRuns(trades), "W");
  }

  if (args.includes("--loss-analysis")) {
    const losses = trades.filter((t) => t.netR <= 0);
    const fmtGroup = (label: string, rows: Trade[]): void => {
      const groups = new Map<string, { n: number; r: number }>();
      for (const trade of rows) {
        const key =
          label === "level"
            ? trade.levelName
            : label === "side"
              ? trade.side === 1
                ? "LONG"
                : "SHORT"
              : label === "month"
                ? trade.date.slice(0, 7)
                : trade.reason;
        const current = groups.get(key) ?? { n: 0, r: 0 };
        current.n++;
        current.r += trade.netR;
        groups.set(key, current);
      }
      console.log(`\nLosses by ${label}:`);
      for (const [key, value] of [...groups.entries()].sort((a, b) => a[1].r - b[1].r)) {
        console.log(`  ${key.padEnd(22)} ${String(value.n).padStart(4)}  ${value.r.toFixed(2)}R`);
      }
    };
    console.log(`\nLOSS ANALYSIS (${losses.length} losses, ${losses.reduce((s, t) => s + t.netR, 0).toFixed(2)}R)`);
    fmtGroup("side", losses);
    fmtGroup("level", losses);
    fmtGroup("month", losses);
    fmtGroup("reason", losses);
  }

  if (args.includes("--dollars")) {
    const pnl = trades.reduce((sum, trade) => sum + trade.netR * trade.riskPts * 0.05, 0);
    console.log(`\nUSD at 0.05 lot ($0.05/point): ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}`);
    console.log(`Starting $100.00 -> $${(100 + pnl).toFixed(2)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
