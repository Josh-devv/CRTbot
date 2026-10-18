import { readFileSync, writeFileSync } from "node:fs";

import { runBacktest } from "./backtest.js";
import { axisSystem } from "./execution.js";
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
import type { BacktestResult, Bar, BarSeries, StrategyConfig } from "./types.js";

const MIN = 60 * 1000;
const DAY = 86_400_000;
/** 2021-01-04 07:00 UTC = 02:00 America/New_York — inside the London killzone. */
const KILLZONE_START = Date.UTC(2021, 0, 4, 7, 0, 0);
const USAGE =
  "usage: crtbot backtest [--out <file>] [--result <file>] [--sensitivity] | " +
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

/** The value that follows a flag, if the flag is there and has one. */
function flag(rest: string[], name: string): string | undefined {
  const index = rest.indexOf(name);
  return index === -1 ? undefined : rest[index + 1];
}

/** Run the demo scenario once: the raw run, and the report built from it. */
function demoRun(withSensitivity: boolean): { result: BacktestResult; report: Report } {
  const series = syntheticSeries();
  const config = demoConfig();
  const options = { strategy: axisSystem() };
  const result = runBacktest(series, config, options);
  const sweep = withSensitivity ? costSensitivity({ series, cfg: config, options }) : null;

  const report = buildReport({
    runs: [{ instrument: series.instrument, bars: series.bars.length, result }],
    session: config.session,
    costSensitivity: sweep ?? undefined,
  });
  return { result, report };
}

/** Print the demo run's report, saving it and/or the raw run when asked for. */
function backtestCommand(rest: string[]): number {
  const { result, report } = demoRun(rest.includes("--sensitivity"));
  const out = flag(rest, "--out");
  const raw = flag(rest, "--result");

  console.log(formatReport(report));

  if (out !== undefined) {
    writeFileSync(out, serializeReport(report), "utf8");
    console.error(`report written to ${out}`);
  }
  if (raw !== undefined) {
    writeFileSync(raw, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    console.error(`run written to ${raw}`);
  }
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

function main(argv: string[]): number {
  const command = argv[2];
  const rest = argv.slice(3);

  switch (command) {
    case "backtest":
      return backtestCommand(rest);
    case "report":
      return reportCommand(rest);
    default:
      console.error(USAGE);
      return 1;
  }
}

process.exitCode = main(process.argv);
