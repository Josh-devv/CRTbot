/**
 * ICT Judas swing prototype — NQ/ES (proxies for NAS100/US500 CFDs).
 *
 * Rules:
 *   - NY AM killzone: 07:00-10:00. Entry cutoff 10:30. Flat by 12:00.
 *   - Raid: price sweeps an Asian, London, or prior-RTH high/low and closes back
 *     through it (the Judas move).
 *   - MSS: after the raid, a 1m close through the last opposing swing.
 *   - FVG: first 1m fair value gap after the MSS; enter on its proximal edge.
 *   - Stop: beyond the raid extreme + buffer. Target: nearest opposing
 *     liquidity (Asian/London/prior-RTH high or low) with at least 1R.
 *   - Optional SMT: the other index must NOT raid its corresponding level.
 *
 * This is a semi-discretionary ICT model, not a claim to replicate Huddleston's
 * actual discretionary trading. Results are in R; dollar sizing depends on the
 * CFD contract specs.
 *
 * Usage:
 *   npx tsx scratch-ict-judas.ts --from 2026-07-01 --to 2026-09-30 --smt off
 *   npx tsx scratch-ict-judas.ts --from 2026-07-01 --to 2026-09-30 --smt on
 */

import { readFile } from "node:fs/promises";
import { DateTime } from "luxon";

const NY = "America/New_York";
const RAID_START = 7 * 60;
const RAID_END = 10 * 60;
const ENTRY_END = 10 * 60 + 30;
const EXIT_END = 12 * 60;

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
  asianHigh: number;
  asianLow: number;
  londonHigh: number;
  londonLow: number;
  priorRthHigh: number;
  priorRthLow: number;
}

interface Raid {
  side: 1 | -1;
  levelName: "Asian" | "London" | "Prior RTH";
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

const args = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1]! : fallback;
};

const fromArg = flag("--from", "2026-07-01");
const toArg = flag("--to", "2026-09-30");
const smtArg = flag("--smt", "off") as "on" | "off";
const targetArg = flag("--target", "liq") as "liq" | "r";
const targetR = Number(flag("--target-r", "2"));
const instrumentArg = flag("--instrument", "both");
const entryEndMin = Number(flag("--entry-end", String(ENTRY_END)));
const exitEndMin = Number(flag("--exit-end", String(EXIT_END)));
const raidEndMin = Number(flag("--raid-end", String(RAID_END)));
const minRisk = Number(flag("--min-risk", "2"));
const maxRisk = Number(flag("--max-risk", "200"));
const minFvg = Number(flag("--min-fvg", "0.5"));

const instruments = instrumentArg === "both" ? ["NQ", "ES"] : [instrumentArg];
const bufferFor = (inst: string): number => (inst === "NQ" ? 2 : 1);
const costFor = (inst: string): number => (inst === "NQ" ? 1.5 : 0.6);

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
): Map<string, { high: number; low: number; close: number }> {
  const out = new Map<string, { high: number; low: number; close: number }>();
  for (const bar of bars) {
    const { date, minute } = parts(bar.time);
    const key = assign(date, minute);
    if (key === null) continue;
    const cur = out.get(key);
    if (cur === undefined) {
      out.set(key, { high: bar.high, low: bar.low, close: bar.close });
    } else {
      cur.high = Math.max(cur.high, bar.high);
      cur.low = Math.min(cur.low, bar.low);
      cur.close = bar.close;
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

  const asian = aggregate(bars, (date, minute) => {
    if (minute >= 1200) return DateTime.fromISO(date, { zone: NY }).plus({ days: 1 }).toFormat("yyyy-MM-dd");
    if (minute < 120) return date;
    return null;
  });

  const london = aggregate(bars, (date, minute) =>
    minute >= 120 && minute < 300 ? date : null,
  );

  const rthDates = [...rth.keys()].sort();
  const prior = new Map<string, { high: number; low: number }>();
  for (let i = 1; i < rthDates.length; i++) {
    const prev = rth.get(rthDates[i - 1]!)!;
    prior.set(rthDates[i]!, { high: prev.high, low: prev.low });
  }

  const levels = new Map<string, Levels>();
  for (const date of rthDates) {
    const a = asian.get(date);
    const l = london.get(date);
    const p = prior.get(date);
    if (a === undefined || l === undefined || p === undefined) continue;
    levels.set(date, {
      date,
      asianHigh: a.high,
      asianLow: a.low,
      londonHigh: l.high,
      londonLow: l.low,
      priorRthHigh: p.high,
      priorRthLow: p.low,
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

function raidsForDay(bars: Bar[], levels: Levels): Raid[] {
  const out: Raid[] = [];
  let minLow = Infinity;
  let maxHigh = -Infinity;
  const seenLow = new Set<string>();
  const seenHigh = new Set<string>();

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]!;
    const { minute } = parts(bar.time);
    if (minute < RAID_START) continue;
    if (minute >= raidEndMin) break;

    minLow = Math.min(minLow, bar.low);
    maxHigh = Math.max(maxHigh, bar.high);

    const lowLevels: Array<[string, number]> = [
      ["Asian", levels.asianLow],
      ["London", levels.londonLow],
      ["Prior RTH", levels.priorRthLow],
    ];
    const highLevels: Array<[string, number]> = [
      ["Asian", levels.asianHigh],
      ["London", levels.londonHigh],
      ["Prior RTH", levels.priorRthHigh],
    ];

    for (const [name, level] of lowLevels) {
      if (seenLow.has(name)) continue;
      if (bar.low < level && bar.close > level) {
        seenLow.add(name);
        out.push({ side: 1, levelName: name as Raid["levelName"], level, time: bar.time, idx: i });
      }
    }
    for (const [name, level] of highLevels) {
      if (seenHigh.has(name)) continue;
      if (bar.high > level && bar.close < level) {
        seenHigh.add(name);
        out.push({ side: -1, levelName: name as Raid["levelName"], level, time: bar.time, idx: i });
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
): Candidate | null {
  const endIdx = bars.findIndex((b) => parts(b.time).minute >= entryEndMin);
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
    if (minute < RAID_START) continue;
    if (raid.side === 1) extreme = Math.min(extreme, b.low);
    else extreme = Math.max(extreme, b.high);
  }

  const buffer = bufferFor(inst);
  const stop = raid.side === 1 ? extreme - buffer : extreme + buffer;
  const risk = raid.side === 1 ? entry - stop : stop - entry;
  if (risk <= 0 || risk < minRisk || risk > maxRisk) return null;

  let target: number;
  if (targetArg === "r") {
    target = raid.side === 1 ? entry + targetR * risk : entry - targetR * risk;
  } else {
    const opposing = raid.side === 1
      ? [levels.asianHigh, levels.londonHigh, levels.priorRthHigh].filter((l) => l >= entry + risk)
      : [levels.asianLow, levels.londonLow, levels.priorRthLow].filter((l) => l <= entry - risk);
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
): Trade | null {
  const { side, entry, stop, target, fillIdx } = candidate;
  const exitEnd = dayStart(date) + exitEndMin * 60_000;
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
  const loadFrom = from.minus({ days: 5 }).toMillis();
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
  const funnel = { days: 0, raids: 0, mss: 0, fvg: 0, entries: 0 };

  for (const inst of instruments) {
    const context = contexts.get(inst)!;
    const other = inst === "NQ" ? "ES" : "NQ";
    const otherContext = contexts.get(other);
    const dates = [...context.levels.keys()].filter((d) => d >= fromArg && d <= toArg).sort();

    for (const date of dates) {
      const bars = context.byDate.get(date);
      const levels = context.levels.get(date);
      if (bars === undefined || levels === undefined) continue;
      funnel.days++;

      const raids = raidsForDay(bars, levels);
      funnel.raids += raids.length;

      for (const raid of raids) {
        if (smtArg === "on") {
          if (otherContext === undefined) continue;
          const otherLevels = otherContext.levels.get(date);
          const otherBars = otherContext.byDate.get(date);
          if (otherLevels === undefined || otherBars === undefined) continue;
          const otherKey = raid.levelName === "Asian"
            ? (raid.side === 1 ? "asianLow" : "asianHigh")
            : raid.levelName === "London"
              ? (raid.side === 1 ? "londonLow" : "londonHigh")
              : (raid.side === 1 ? "priorRthLow" : "priorRthHigh");
          const otherLevel = otherLevels[otherKey as keyof Levels] as number;
          const upTo = otherBars.filter((b) => b.time <= raid.time && parts(b.time).minute >= RAID_START);
          if (upTo.length === 0) continue;
          const otherExtreme = raid.side === 1
            ? Math.min(...upTo.map((b) => b.low))
            : Math.max(...upTo.map((b) => b.high));
          const otherRaided = raid.side === 1 ? otherExtreme < otherLevel : otherExtreme > otherLevel;
          if (otherRaided) continue;
        }

        const candidate = buildCandidate(bars, raid, levels, inst);
        if (candidate === null) continue;
        funnel.mss++;
        funnel.fvg++;
        funnel.entries++;

        const trade = simulate(bars, candidate, date, inst);
        if (trade === null) continue;
        trades.push(trade);
        break;
      }
    }
  }

  console.log(`\nICT Judas swing ${fromArg}..${toArg} | SMT ${smtArg} | target ${targetArg}${targetArg === "r" ? ` ${targetR}R` : ""} | entry-end ${entryEndMin} | exit-end ${exitEndMin}`);
  console.log(`Funnel: days ${funnel.days} -> raids ${funnel.raids} -> MSS ${funnel.mss} -> FVG ${funnel.fvg} -> entries ${funnel.entries} -> trades ${trades.length}`);

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
  for (const level of ["Asian", "London", "Prior RTH"]) {
    console.log(line(level, stats(trades.filter((t) => t.levelName === level))));
  }
  for (const month of ["2026-07", "2026-08", "2026-09"]) {
    console.log(line(month, stats(trades.filter((t) => t.date.startsWith(month)))));
  }

  console.log("");
  for (const t of trades.slice(0, 30)) {
    const entryTime = DateTime.fromMillis(t.entryTime, { zone: NY }).toFormat("yyyy-MM-dd HH:mm");
    console.log(
      `  ${entryTime} ${t.instrument} ${t.side === 1 ? "LONG " : "SHORT"} ${t.levelName} raid ` +
      `entry ${t.entry.toFixed(2)} stop ${t.stop.toFixed(2)} target ${t.target.toFixed(2)} ` +
      `risk ${t.riskPts.toFixed(1)}p plan ${t.plannedR.toFixed(1)}R -> ${t.reason} ${t.netR.toFixed(2)}R`,
    );
  }
  if (trades.length > 30) console.log(`  ... ${trades.length - 30} more`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
