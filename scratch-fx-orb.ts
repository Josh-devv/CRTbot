import { DateTime } from "luxon";

import { loadBars } from "./src/ingest.js";
import type { Bar, Instrument } from "./src/types.js";

/**
 * Opening-range sweep/reclaim on FX, the only market where $10 can take a real position.
 * Same mechanic that validated on SPY: sweep the first 15m range of a session, enter on the
 * close back inside, stop beyond the sweep, fixed 1R target, 30m time stop.
 *
 * Usage: npx tsx scratch-fx-orb.ts [--from 2015-01-01] [--to 2024-12-31]
 *                                  [--instrument GBPUSD|EURUSD|both]
 *                                  [--session london|ny|both] [--monthly]
 */

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

const fromIso = flag("--from") ?? "2015-01-01";
const toIso = flag("--to") ?? "2024-12-31";
const from = DateTime.fromISO(fromIso, { zone: "utc" }).toMillis();
const to = DateTime.fromISO(toIso, { zone: "utc" }).endOf("day").toMillis();
const onlyInstrument = flag("--instrument") ?? "both";
const onlySession = flag("--session") ?? "both";
const showMonthly = args.includes("--monthly");

const RANGE_MIN = 15;
const SCAN_MIN = 45;
const TIME_STOP_MIN = 30;
const MAX_TRADES_PER_DAY = 2;
const MAX_RECLAIM_BARS = 5;

const SESSIONS = {
  london: { zone: "Europe/London", start: 8 * 60, label: "London 08:00" },
  ny: { zone: "America/New_York", start: 8 * 60, label: "NY 08:00" },
} as const;
type SessionKey = keyof typeof SESSIONS;

const PER_INSTRUMENT: Record<Instrument, { bufferPips: number; costPips: number }> = {
  EURUSD: { bufferPips: 1.5, costPips: 0.8 },
  GBPUSD: { bufferPips: 2.0, costPips: 1.2 },
};
const PIP = 0.0001;

interface Trade {
  date: string;
  session: SessionKey;
  instrument: Instrument;
  side: "long" | "short";
  entry: number;
  stop: number;
  exit: number;
  r: number;
  reason: "target" | "stop" | "time";
  riskPips: number;
}

function pips(value: number): number {
  return value / PIP;
}

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function simulateSession(instrument: Instrument, sessionKey: SessionKey, bars: Bar[]): Trade[] {
  const session = SESSIONS[sessionKey];
  const { bufferPips, costPips } = PER_INSTRUMENT[instrument];
  const trades: Trade[] = [];

  const byDate = new Map<string, { bar: Bar; minute: number }[]>();
  for (const bar of bars) {
    const dt = DateTime.fromMillis(bar.time, { zone: session.zone });
    const key = dt.toFormat("yyyy-MM-dd");
    const list = byDate.get(key) ?? [];
    list.push({ bar, minute: dt.hour * 60 + dt.minute });
    byDate.set(key, list);
  }

  for (const [date, day] of [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const rangeEnd = session.start + RANGE_MIN;
    const scanEnd = session.start + SCAN_MIN;
    const rangeBars = day.filter((entry) => entry.minute >= session.start && entry.minute < rangeEnd);
    if (rangeBars.length < RANGE_MIN * 0.5) continue;

    let orbHigh = -Infinity;
    let orbLow = Infinity;
    for (const { bar } of rangeBars) {
      orbHigh = Math.max(orbHigh, bar.high);
      orbLow = Math.min(orbLow, bar.low);
    }

    let shortRaid: { extreme: number; first: number } | undefined;
    let longRaid: { extreme: number; first: number } | undefined;
    let tradedShort = false;
    let tradedLong = false;
    let dayTrades = 0;

    for (let i = 0; i < day.length; i++) {
      const { bar, minute } = day[i]!;
      if (minute < rangeEnd || minute >= scanEnd) continue;

      if (!tradedShort && bar.high > orbHigh) {
        if (shortRaid === undefined) shortRaid = { extreme: bar.high, first: i };
        else shortRaid.extreme = Math.max(shortRaid.extreme, bar.high);
      }
      if (!tradedLong && bar.low < orbLow) {
        if (longRaid === undefined) longRaid = { extreme: bar.low, first: i };
        else longRaid.extreme = Math.min(longRaid.extreme, bar.low);
      }

      const shortReclaim =
        !tradedShort && shortRaid !== undefined && bar.close < orbHigh && i - shortRaid.first <= MAX_RECLAIM_BARS;
      const longReclaim =
        !tradedLong && longRaid !== undefined && bar.close > orbLow && i - longRaid.first <= MAX_RECLAIM_BARS;

      const candidates: { side: "long" | "short"; stop: number }[] = [];
      if (shortReclaim) candidates.push({ side: "short", stop: shortRaid!.extreme + bufferPips * PIP });
      if (longReclaim) candidates.push({ side: "long", stop: longRaid!.extreme - bufferPips * PIP });

      for (const candidate of candidates) {
        if (dayTrades >= MAX_TRADES_PER_DAY) break;
        const entry = bar.close;
        const risk = candidate.side === "short" ? candidate.stop - entry : entry - candidate.stop;
        const riskPips = pips(risk);
        if (riskPips < 1 || riskPips > 40) continue;

        const target = candidate.side === "short" ? entry - risk : entry + risk;
        const deadline = bar.time + TIME_STOP_MIN * 60_000;
        let exit = day[day.length - 1]!.bar.close;
        let reason: Trade["reason"] = "time";

        for (let j = i + 1; j < day.length; j++) {
          const next = day[j]!.bar;
          if (next.time > deadline) {
            exit = day[j - 1]!.bar.close;
            reason = "time";
            break;
          }
          if (candidate.side === "short") {
            if (next.high >= candidate.stop) {
              exit = candidate.stop;
              reason = "stop";
              break;
            }
            if (next.low <= target) {
              exit = target;
              reason = "target";
              break;
            }
          } else {
            if (next.low <= candidate.stop) {
              exit = candidate.stop;
              reason = "stop";
              break;
            }
            if (next.high >= target) {
              exit = target;
              reason = "target";
              break;
            }
          }
          exit = next.close;
        }

        const grossR = candidate.side === "short" ? (entry - exit) / risk : (exit - entry) / risk;
        const costR = costPips / riskPips;
        trades.push({
          date,
          session: sessionKey,
          instrument,
          side: candidate.side,
          entry,
          stop: candidate.stop,
          exit,
          r: grossR - costR,
          reason,
          riskPips,
        });
        dayTrades++;
        if (candidate.side === "short") tradedShort = true;
        else tradedLong = true;
      }
    }
  }

  return trades;
}

function summarize(label: string, trades: Trade[]): void {
  if (trades.length === 0) {
    console.log(`${label}: no trades`);
    return;
  }
  const wins = trades.filter((trade) => trade.reason === "target").length;
  const stops = trades.filter((trade) => trade.reason === "stop").length;
  const timeouts = trades.filter((trade) => trade.reason === "time").length;
  const netR = trades.reduce((sum, trade) => sum + trade.r, 0);
  const grossWin = trades.filter((trade) => trade.r > 0).reduce((sum, trade) => sum + trade.r, 0);
  const grossLoss = -trades.filter((trade) => trade.r < 0).reduce((sum, trade) => sum + trade.r, 0);
  const avgRiskPips = trades.reduce((sum, trade) => sum + trade.riskPips, 0) / trades.length;
  const dollars1000 = trades.reduce((sum, trade) => sum + trade.r * trade.riskPips * 0.1, 0);
  const dollars100 = dollars1000 / 10;

  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const trade of trades) {
    equity += trade.r;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.min(maxDrawdown, equity - peak);
  }

  console.log(
    `${label}: trades=${trades.length} precision=${((100 * wins) / trades.length).toFixed(1)}% ` +
      `(target=${wins} stop=${stops} time=${timeouts}) netR=${round(netR, 1)} avgR=${round(netR / trades.length, 3)} ` +
      `PF=${round(grossWin / Math.max(1e-9, grossLoss), 2)} maxDD=${round(maxDrawdown, 1)}R ` +
      `avgRisk=${round(avgRiskPips, 1)}pips $/1k=${round(dollars1000)} $/100=${round(dollars100)}`,
  );
}

function yearly(label: string, trades: Trade[]): void {
  const years = [...new Set(trades.map((trade) => trade.date.slice(0, 4)))].sort();
  for (const year of years) {
    const subset = trades.filter((trade) => trade.date.startsWith(year));
    const wins = subset.filter((trade) => trade.reason === "target").length;
    const netR = subset.reduce((sum, trade) => sum + trade.r, 0);
    console.log(
      `  ${year} ${label}: n=${subset.length} precision=${((100 * wins) / subset.length).toFixed(0)}% netR=${round(netR, 1)}`,
    );
  }
}

function monthly(label: string, trades: Trade[]): void {
  const months = [...new Set(trades.map((trade) => trade.date.slice(0, 7)))].sort();
  for (const month of months) {
    const subset = trades.filter((trade) => trade.date.startsWith(month));
    const wins = subset.filter((trade) => trade.reason === "target").length;
    const netR = subset.reduce((sum, trade) => sum + trade.r, 0);
    console.log(`  ${month} ${label}: n=${subset.length} precision=${((100 * wins) / subset.length).toFixed(0)}% netR=${round(netR, 1)}`);
  }
}

const instruments: Instrument[] =
  onlyInstrument === "both" ? ["GBPUSD", "EURUSD"] : [onlyInstrument as Instrument];
const sessions: SessionKey[] = onlySession === "both" ? ["london", "ny"] : [onlySession as SessionKey];

console.log(`range ${fromIso}..${toIso} sessions=${sessions.join(",")} instruments=${instruments.join(",")}`);

for (const instrument of instruments) {
  const bars = await loadBars(instrument, from, to);
  console.log(`\n${instrument}: ${bars.length} 1m bars`);
  for (const sessionKey of sessions) {
    const trades = simulateSession(instrument, sessionKey, bars);
    const label = `${instrument} ${SESSIONS[sessionKey].label}`;
    summarize(label, trades);
    yearly(label, trades);
    if (showMonthly) monthly(label, trades);

    const firstHalf = trades.filter((trade) => trade.date < "2020-01-01");
    const secondHalf = trades.filter((trade) => trade.date >= "2020-01-01");
    summarize(`${label} 2015-2019`, firstHalf);
    summarize(`${label} 2020-2024`, secondHalf);
  }
}
