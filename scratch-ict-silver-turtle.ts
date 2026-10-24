/**
 * ICT Silver Bullet + Turtle Soup prototype — NQ/ES (NAS100/US500 proxies).
 *
 * Silver Bullet:
 *   - 10:00-11:00 NY. Reference range = 09:00-10:00 high/low.
 *   - Raid the 9-10 high or low, then MSS + FVG; enter on the FVG.
 *   - Stop beyond the raid; target the opposite 9-10 side (or prior RTH).
 *   - Flat by 12:00.
 *
 * Turtle Soup:
 *   - 09:30-15:00 NY. Reference = prior RTH high/low + prior 5-day high/low.
 *   - Raid one of those levels, then MSS + FVG; enter on the FVG.
 *   - Stop beyond the raid; target the opposite prior-day/week level.
 *   - Flat by 16:00.
 *
 * Both are codified approximations, not Huddleston's discretion.
 *
 * Usage:
 *   npx tsx scratch-ict-silver-turtle.ts --model silver --from 2026-07-01 --to 2026-09-30 --target 2r
 *   npx tsx scratch-ict-silver-turtle.ts --model turtle --from 2026-07-01 --to 2026-09-30 --target 2r
 */

import { readFile } from "node:fs/promises";
import { DateTime } from "luxon";

const NY = "America/New_York";

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
  range9High: number;
  range9Low: number;
  priorRthHigh: number;
  priorRthLow: number;
  priorWeekHigh: number;
  priorWeekLow: number;
}

interface Raid {
  side: 1 | -1;
  levelName: string;
  level: number;
  time: number;
  idx: number;
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
}

interface Trade extends Candidate {
  instrument: string;
  date: string;
  exitTime: number;
  exit: number;
  netR: number;
  reason: string;
}

interface ModelConfig {
  name: string;
  raidStart: number;
  raidEnd: number;
  entryEnd: number;
  exitEnd: number;
  lowLevels: (l: Levels) => Array<{ name: string; price: number }>;
  highLevels: (l: Levels) => Array<{ name: string; price: number }>;
  targetHighs: (l: Levels) => number[];
  targetLows: (l: Levels) => number[];
}

const args = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1]! : fallback;
};

const modelArg = flag("--model", "silver") as "silver" | "turtle";
const fromArg = flag("--from", "2026-07-01");
const toArg = flag("--to", "2026-09-30");
const targetArg = flag("--target", "2r") as "liq" | "2r" | "3r";
const instrumentArg = flag("--instrument", "both");
const minRisk = Number(flag("--min-risk", "2"));
const maxRisk = Number(flag("--max-risk", "250"));
const minFvg = Number(flag("--min-fvg", "0.5"));

const instruments = instrumentArg === "both" ? ["NQ", "ES"] : [instrumentArg];
const bufferFor = (inst: string): number => (inst === "NQ" ? 2 : 1);
const costFor = (inst: string): number => (inst === "NQ" ? 1.5 : 0.6);

const CONFIG: ModelConfig = modelArg === "silver"
  ? {
      name: "Silver Bullet 10-11",
      raidStart: 10 * 60,
      raidEnd: 11 * 60,
      entryEnd: 11 * 60,
      exitEnd: 12 * 60,
      lowLevels: (l) => [{ name: "9-10 low", price: l.range9Low }],
      highLevels: (l) => [{ name: "9-10 high", price: l.range9High }],
      targetHighs: (l) => [l.range9High, l.priorRthHigh],
      targetLows: (l) => [l.range9Low, l.priorRthLow],
    }
  : {
      name: "Turtle Soup",
      raidStart: 9 * 60 + 30,
      raidEnd: 15 * 60,
      entryEnd: 15 * 60,
      exitEnd: 16 * 60,
      lowLevels: (l) => [
        { name: "Prior RTH low", price: l.priorRthLow },
        { name: "Prior week low", price: l.priorWeekLow },
      ],
      highLevels: (l) => [
        { name: "Prior RTH high", price: l.priorRthHigh },
        { name: "Prior week high", price: l.priorWeekHigh },
      ],
      targetHighs: (l) => [l.priorRthHigh, l.priorWeekHigh],
      targetLows: (l) => [l.priorRthLow, l.priorWeekLow],
    };

function parts(ms: number): { date: string; minute: number } {
  const dt = DateTime.fromMillis(ms, { zone: NY });
  return { date: dt.toFormat("yyyy-MM-dd"), minute: dt.hour * 60 + dt.minute };
}

function dayStart(date: string): number {
  return DateTime.fromISO(date, { zone: NY }).startOf("day").toMillis();
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
  const range9 = aggregate(bars, (date, minute) =>
    minute >= 540 && minute < 600 ? date : null,
  );

  const rthDates = [...rth.keys()].sort();
  const levels = new Map<string, Levels>();
  for (let i = 1; i < rthDates.length; i++) {
    const date = rthDates[i]!;
    const prev = rth.get(rthDates[i - 1]!)!;
    const r9 = range9.get(date);
    if (r9 === undefined) continue;

    const week = rthDates.slice(Math.max(0, i - 5), i);
    const weekBars = week.map((d) => rth.get(d)!).filter((x) => x !== undefined);
    if (weekBars.length === 0) continue;

    levels.set(date, {
      date,
      range9High: r9.high,
      range9Low: r9.low,
      priorRthHigh: prev.high,
      priorRthLow: prev.low,
      priorWeekHigh: Math.max(...weekBars.map((b) => b.high)),
      priorWeekLow: Math.min(...weekBars.map((b) => b.low)),
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

function raidsForDay(bars: Bar[], levels: Levels, config: ModelConfig): Raid[] {
  const out: Raid[] = [];
  const seenLow = new Set<string>();
  const seenHigh = new Set<string>();
  const lows = config.lowLevels(levels);
  const highs = config.highLevels(levels);

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]!;
    const { minute } = parts(bar.time);
    if (minute < config.raidStart) continue;
    if (minute >= config.raidEnd) break;

    for (const { name, price } of lows) {
      if (seenLow.has(name)) continue;
      if (bar.low < price && bar.close > price) {
        seenLow.add(name);
        out.push({ side: 1, levelName: name, level: price, time: bar.time, idx: i });
      }
    }
    for (const { name, price } of highs) {
      if (seenHigh.has(name)) continue;
      if (bar.high > price && bar.close < price) {
        seenHigh.add(name);
        out.push({ side: -1, levelName: name, level: price, time: bar.time, idx: i });
      }
    }
  }
  return out.sort((a, b) => a.time - b.time);
}

function buildCandidate(
  bars: Bar[],
  raid: Raid,
  levels: Levels,
  inst: string,
  config: ModelConfig,
): Candidate | null {
  const endIdx = bars.findIndex((b) => parts(b.time).minute >= config.entryEnd);
  const lastIdx = endIdx === -1 ? bars.length - 1 : endIdx - 1;
  if (raid.idx >= lastIdx) return null;

  let mssLevel: number;
  let mssIdx = -1;
  if (raid.side === 1) {
    mssLevel = findSwingHigh(bars, raid.idx);
    for (let i = raid.idx; i <= lastIdx; i++) {
      if (bars[i]!.close > mssLevel) {
        mssIdx = i;
        break;
      }
    }
  } else {
    mssLevel = findSwingLow(bars, raid.idx);
    for (let i = raid.idx; i <= lastIdx; i++) {
      if (bars[i]!.close < mssLevel) {
        mssIdx = i;
        break;
      }
    }
  }
  if (mssIdx < 0) return null;

  let fvgIdx = -1;
  let entry = NaN;
  for (let i = Math.max(2, mssIdx); i <= lastIdx; i++) {
    const b = bars[i]!;
    if (raid.side === 1 && b.low > bars[i - 2]!.high && b.low - bars[i - 2]!.high >= minFvg) {
      fvgIdx = i;
      entry = b.low;
      break;
    }
    if (raid.side === -1 && b.high < bars[i - 2]!.low && bars[i - 2]!.low - b.high >= minFvg) {
      fvgIdx = i;
      entry = b.high;
      break;
    }
  }
  if (fvgIdx < 0) return null;

  let fillIdx = -1;
  for (let i = fvgIdx + 1; i <= lastIdx; i++) {
    const b = bars[i]!;
    if (raid.side === 1 && b.low <= entry) {
      fillIdx = i;
      break;
    }
    if (raid.side === -1 && b.high >= entry) {
      fillIdx = i;
      break;
    }
  }
  if (fillIdx < 0) return null;

  let extreme = raid.side === 1 ? Infinity : -Infinity;
  for (let i = 0; i <= fillIdx; i++) {
    const b = bars[i]!;
    const { minute } = parts(b.time);
    if (minute < config.raidStart) continue;
    if (raid.side === 1) extreme = Math.min(extreme, b.low);
    else extreme = Math.max(extreme, b.high);
  }

  const buffer = bufferFor(inst);
  const stop = raid.side === 1 ? extreme - buffer : extreme + buffer;
  const risk = raid.side === 1 ? entry - stop : stop - entry;
  if (risk <= 0 || risk < minRisk || risk > maxRisk) return null;

  let target: number;
  if (targetArg === "2r" || targetArg === "3r") {
    const r = targetArg === "2r" ? 2 : 3;
    target = raid.side === 1 ? entry + r * risk : entry - r * risk;
  } else {
    const opposing = raid.side === 1
      ? config.targetHighs(levels).filter((l) => l >= entry + risk)
      : config.targetLows(levels).filter((l) => l <= entry - risk);
    if (opposing.length === 0) return null;
    target = raid.side === 1 ? Math.min(...opposing) : Math.max(...opposing);
  }

  const plannedR = Math.abs(target - entry) / risk;
  if (plannedR < 1) return null;

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
  };
}

function simulate(
  bars: Bar[],
  candidate: Candidate,
  date: string,
  inst: string,
  config: ModelConfig,
): Trade | null {
  const { side, entry, stop, target, fillIdx } = candidate;
  const exitEnd = dayStart(date) + config.exitEnd * 60_000;
  let exit = NaN;
  let exitTime = NaN;
  let reason = "";

  for (let i = fillIdx; i < bars.length; i++) {
    const b = bars[i]!;
    if (b.time >= exitEnd) break;
    if (side === 1) {
      if (b.low <= stop) {
        exit = stop;
        exitTime = b.time;
        reason = "stop";
        break;
      }
      if (b.high >= target) {
        exit = target;
        exitTime = b.time;
        reason = "target";
        break;
      }
    } else {
      if (b.high >= stop) {
        exit = stop;
        exitTime = b.time;
        reason = "stop";
        break;
      }
      if (b.low <= target) {
        exit = target;
        exitTime = b.time;
        reason = "target";
        break;
      }
    }
    exit = b.close;
    exitTime = b.time;
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
  return `${label.padEnd(16)} ${String(s.n).padStart(3)}  ${s.wr.toFixed(1).padStart(4)}%  ${s.netR.toFixed(1).padStart(6)}R  PF ${s.pf === Infinity ? "inf" : s.pf.toFixed(2)}  DD ${s.dd.toFixed(1)}R  avgPlan ${s.avgPlan.toFixed(1)}R`;
}

async function main(): Promise<void> {
  const from = DateTime.fromISO(fromArg, { zone: NY }).startOf("day");
  const to = DateTime.fromISO(toArg, { zone: NY }).endOf("day");
  const loadFrom = from.minus({ days: 7 }).toMillis();
  const loadTo = to.plus({ days: 1 }).toMillis();

  const contexts = new Map<string, ReturnType<typeof buildContext>>();
  for (const inst of instruments) {
    const raw = JSON.parse(
      await readFile(`data/indices/${inst}-duka.json`, "utf8"),
    ) as Bar[];
    const bars = raw.filter((b) => b.time >= loadFrom && b.time <= loadTo);
    contexts.set(inst, buildContext(bars));
    console.log(`${inst}: ${bars.length} M1 bars (${fromArg}..${toArg} + warmup)`);
  }

  const trades: Trade[] = [];
  const funnel = { days: 0, raids: 0, entries: 0 };

  for (const inst of instruments) {
    const context = contexts.get(inst)!;
    const dates = [...context.levels.keys()].filter((d) => d >= fromArg && d <= toArg).sort();

    for (const date of dates) {
      const bars = context.byDate.get(date);
      const levels = context.levels.get(date);
      if (bars === undefined || levels === undefined) continue;
      funnel.days++;

      const raids = raidsForDay(bars, levels, CONFIG);
      funnel.raids += raids.length;

      for (const raid of raids) {
        const candidate = buildCandidate(bars, raid, levels, inst, CONFIG);
        if (candidate === null) continue;
        funnel.entries++;

        const trade = simulate(bars, candidate, date, inst, CONFIG);
        if (trade === null) continue;
        trades.push(trade);
        break;
      }
    }
  }

  console.log(`\nICT ${CONFIG.name} ${fromArg}..${toArg} | target ${targetArg} | window ${CONFIG.raidStart}-${CONFIG.raidEnd} | exit ${CONFIG.exitEnd}`);
  console.log(`Funnel: days ${funnel.days} -> raids ${funnel.raids} -> entries ${funnel.entries} -> trades ${trades.length}`);

  for (const inst of instruments) {
    console.log(line(inst, stats(trades.filter((t) => t.instrument === inst))));
  }
  const total = stats(trades);
  console.log(line("TOTAL", total));
  console.log(
    `Stops: avg ${total.avgRisk.toFixed(1)}p | median ${total.medRisk.toFixed(1)}p | ` +
    `p10 ${total.p10Risk.toFixed(1)}p | p90 ${total.p90Risk.toFixed(1)}p | ` +
    `avgWin ${total.avgWin.toFixed(2)}R | avgLoss ${total.avgLoss.toFixed(2)}R | exp ${total.exp.toFixed(2)}R`,
  );

  for (const side of [1, -1] as const) {
    console.log(line(side === 1 ? "  LONG" : "  SHORT", stats(trades.filter((t) => t.side === side))));
  }
  for (const level of [...new Set(trades.map((t) => t.levelName))]) {
    console.log(line(level, stats(trades.filter((t) => t.levelName === level))));
  }
  for (const month of ["2026-07", "2026-08", "2026-09"]) {
    console.log(line(month, stats(trades.filter((t) => t.date.startsWith(month)))));
  }

  console.log("");
  for (const t of trades.slice(0, 25)) {
    const entryTime = DateTime.fromMillis(t.entryTime, { zone: NY }).toFormat("yyyy-MM-dd HH:mm");
    console.log(
      `  ${entryTime} ${t.instrument} ${t.side === 1 ? "LONG " : "SHORT"} ${t.levelName} ` +
      `entry ${t.entry.toFixed(2)} stop ${t.stop.toFixed(2)} target ${t.target.toFixed(2)} ` +
      `risk ${t.riskPts.toFixed(1)}p plan ${t.plannedR.toFixed(1)}R -> ${t.reason} ${t.netR.toFixed(2)}R`,
    );
  }
  if (trades.length > 25) console.log(`  ... ${trades.length - 25} more`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
