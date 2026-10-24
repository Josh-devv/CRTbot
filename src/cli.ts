import { readFileSync, writeFileSync } from "node:fs";

import { runBacktest } from "./backtest.js";
import { axisSystem } from "./execution.js";
import { DEFAULT_DATA_DIR, ingestHistDataFiles, loadSeries } from "./ingest.js";
import {
  buildReport,
  costSensitivity,
  formatReport,
  parseReport,
  serializeReport,
} from "./report.js";
import { DEFAULT_SWING_WIDTH } from "./structure.js";
import { DEFAULT_SESSION_CONFIG } from "./time.js";
import type { Report } from "./report.js";
import type { BacktestResult, Bar, BarSeries, Instrument, StrategyConfig } from "./types.js";

const MIN = 60 * 1000;
const DAY = 86_400_000;
/** 2021-01-04 07:00 UTC = 02:00 America/New_York — inside the London killzone. */
const KILLZONE_START = Date.UTC(2021, 0, 4, 7, 0, 0);
const INSTRUMENTS: Instrument[] = ["GBPUSD", "EURUSD"];
const USAGE =
  "usage: crtbot ingest <csv...> [--data <dir>] | " +
  "crtbot backtest [--instrument GBPUSD|EURUSD|both] [--from <YYYY-MM-DD>] " +
  "[--to <YYYY-MM-DD>] [--data <dir>] [--out <file>] [--result <file>] [--sensitivity] | " +
  "crtbot report --in <file>";

/**
 * One day's worth of bars: a significant low is purged and engulfed into an order block, then the
 * retrace to the block's open runs to the fixed 3R target. The shape the execution tests trade.
 */
const SET_UP: [number, number, number, number][] = [
  [10.0, 10.2, 9.6, 9.8],
  [9.8, 9.9, 9.0, 9.1],
  [9.1, 9.5, 9.2, 9.4],
  [9.4, 9.6, 9.3, 9.5],
  [9.5, 9.7, 8.8, 9.6],
  [9.6, 9.9, 9.3, 9.7],
  [9.8, 9.9, 9.2, 9.3],
  [9.5, 9.6, 8.7, 8.9],
  [9.6, 9.9, 9.55, 9.8],
  [9.8, 9.9, 9.5, 9.8],
  [9.8, 10.5, 9.8, 10.4],
  [10.4, 11.2, 10.4, 11.1],
  [11.1, 12.0, 11.0, 11.9],
];

/**
 * Deterministic demo series: three days of one-minute bars, each day the same set-up, so the
 * strategy trades once a day inside the London killzone.
 */
function syntheticSeries(): BarSeries {
  const bars: Bar[] = [];
  for (let d = 0; d < 3; d++) {
    SET_UP.forEach(([open, high, low, close], i) => {
      bars.push({ time: KILLZONE_START + d * DAY + i * MIN, open, high, low, close });
    });
  }
  return { instrument: "GBPUSD", bars };
}

function demoConfig(): StrategyConfig {
  return {
    instrument: "GBPUSD",
    session: DEFAULT_SESSION_CONFIG,
    structure: { swingWidth: DEFAULT_SWING_WIDTH },
    strategy: { stopDistance: 0.001 },
    risk: { rMultiple: 3, maxTradesPerDay: 1, riskPerTradePct: 0.01 },
    costs: {
      spread: 0.0001,
      commission: 0,
      slippage: 0,
      sensitivity: { optimistic: 0.00005, pessimistic: 0.00025 },
    },
    initialEquity: 10000,
  };
}

/** The configured run for an instrument: the demo's config, pointed at it, with SMT armed. */
function realConfig(instrument: Instrument): StrategyConfig {
  return {
    ...demoConfig(),
    instrument,
    smt: { enabled: true, pairs: [["GBPUSD", "EURUSD"]], useDxy: false },
  };
}

/** The value that follows a flag, if the flag is there and has one. */
function flag(rest: string[], name: string): string | undefined {
  const index = rest.indexOf(name);
  return index === -1 ? undefined : rest[index + 1];
}

/** Run the demo scenario once: the raw run, and the report built from it. */
function demoRun(withSensitivity: boolean): { result: BacktestResult; report: Report } {
  const series = syntheticSeries();
  const config = demoConfig();
  const options = { strategy: axisSystem(config.execution) };
  const result = runBacktest(series, config, options);
  const sweep = withSensitivity ? costSensitivity({ series, cfg: config, options }) : null;

  const report = buildReport({
    runs: [{ instrument: series.instrument, bars: series.bars.length, result }],
    session: config.session,
    costSensitivity: sweep ?? undefined,
  });
  return { result, report };
}

/** The day boundary of a `YYYY-MM-DD` date, or of its end. */
function dayBound(text: string | undefined, bound: "start" | "end"): number {
  if (text === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error(`cannot read the date "${text ?? ""}"; expected YYYY-MM-DD`);
  }
  const start = Date.parse(`${text}T00:00:00Z`);
  return bound === "start" ? start : start + DAY - 1;
}

/** Print a report, saving it and/or a raw result dump when the flags ask for it. */
function emit(rest: string[], report: Report, result: unknown): void {
  console.log(formatReport(report));

  const out = flag(rest, "--out");
  if (out !== undefined) {
    writeFileSync(out, serializeReport(report), "utf8");
    console.error(`report written to ${out}`);
  }
  const raw = flag(rest, "--result");
  if (raw !== undefined) {
    writeFileSync(raw, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    console.error(`run written to ${raw}`);
  }
}

/** Print the demo run's report, saving it and/or the raw run when asked for. */
function backtestCommand(rest: string[]): number {
  const { result, report } = demoRun(rest.includes("--sensitivity"));
  emit(rest, report, result);
  return 0;
}

/** One instrument's run over stored data, with the others loaded for SMT. */
interface StoredRun {
  instrument: Instrument;
  series: BarSeries;
  result: BacktestResult;
}

/**
 * Backtests stored data (ticket 02): loads each asked-for instrument at the execution timeframe,
 * runs it against the rest of the dataset for SMT, and reports. Without `--instrument` it is
 * GBPUSD; `both` pools GBPUSD and EURUSD into one report.
 */
async function storedCommand(rest: string[]): Promise<number> {
  const fromFlag = flag(rest, "--from");
  const toFlag = flag(rest, "--to");
  if (fromFlag === undefined || toFlag === undefined) {
    throw new Error("give both --from and --to (YYYY-MM-DD) to run on stored data");
  }
  const from = dayBound(fromFlag, "start");
  const to = dayBound(toFlag, "end");

  const asked = flag(rest, "--instrument") ?? "GBPUSD";
  const wanted: Instrument[] =
    asked === "both" ? INSTRUMENTS : INSTRUMENTS.filter((one) => one === asked);
  if (wanted.length === 0) throw new Error(`unknown instrument "${asked}"`);

  const dir = flag(rest, "--data") ?? DEFAULT_DATA_DIR;
  const loaded = new Map<Instrument, BarSeries>();
  for (const instrument of INSTRUMENTS) {
    const series = await loadSeries(instrument, from, to, realConfig(instrument), { dir });
    if (series.bars.length > 0) loaded.set(instrument, series);
  }
  const missing = wanted.filter((instrument) => !loaded.has(instrument));
  if (missing.length > 0) {
    throw new Error(
      `no stored bars for ${missing.join(", ")} in the range; ingest its files first`,
    );
  }

  const others = (instrument: Instrument): BarSeries[] =>
    [...loaded.values()].filter((other) => other.instrument !== instrument);
  const runs: StoredRun[] = wanted.map((instrument) => {
    const series = loaded.get(instrument)!;
    return {
      instrument,
      series,
      result: runBacktest(series, realConfig(instrument), {
        strategy: axisSystem(realConfig(instrument).execution),
        dataset: others(instrument),
      }),
    };
  });

  const sensitivity =
    rest.includes("--sensitivity") && runs.length === 1
      ? costSensitivity({
          series: runs[0]!.series,
          cfg: realConfig(runs[0]!.instrument),
          options: {
            strategy: axisSystem(realConfig(runs[0]!.instrument).execution),
            dataset: others(runs[0]!.instrument),
          },
        })
      : null;

  const report = buildReport({
    runs: runs.map((run) => ({
      instrument: run.instrument,
      bars: run.series.bars.length,
      result: run.result,
    })),
    session: DEFAULT_SESSION_CONFIG,
    costSensitivity: sensitivity ?? undefined,
  });

  const dump =
    runs.length === 1
      ? runs[0]!.result
      : runs.map((run) => ({ instrument: run.instrument, result: run.result }));
  emit(rest, report, dump);
  return 0;
}

/** Ingests HistData M1 exports into the store (ticket 02). */
async function ingestCommand(rest: string[]): Promise<number> {
  const dataFlag = flag(rest, "--data");
  const files = rest.filter((arg) => !arg.startsWith("--") && arg !== dataFlag);
  if (files.length === 0) {
    console.error(USAGE);
    return 1;
  }

  const dataDir = dataFlag ?? DEFAULT_DATA_DIR;
  const batch = await ingestHistDataFiles(files, { dir: dataDir });
  let stored = 0;
  for (const report of batch.reports) {
    const { rows, rejected } = report;
    stored += report.stored;
    console.log(
      `${report.source}: ${rows} rows, ${report.stored} stored, ` +
        `${rejected.duplicates} duplicate, ${rejected.prices} bad price, ` +
        `${rejected.malformed} malformed, ${rejected.misordered} out of order; ` +
        `gaps ${report.missingMinutes} minutes, largest ${report.largestGapMinutes}`,
    );
    for (const example of report.examples) {
      console.error(`  ${report.source}:${example.line}: ${example.reason}`);
    }
  }
  console.log(`${stored} bars stored across ${batch.written.length} year files under ${dataDir}`);
  return 0;
}

function reportCommand(rest: string[]): number {
  const file = flag(rest, "--in");
  if (file === undefined) {
    console.error(USAGE);
    return 1;
  }

  try {
    console.log(formatReport(parseReport(readFileSync(file, "utf8"))));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const command = argv[2];
  const rest = argv.slice(3);

  try {
    switch (command) {
      case "ingest":
        return await ingestCommand(rest);
      case "backtest":
        return flag(rest, "--from") === undefined
          ? backtestCommand(rest)
          : await storedCommand(rest);
      case "report":
        return reportCommand(rest);
      default:
        console.error(USAGE);
        return 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

process.exitCode = await main(process.argv);
