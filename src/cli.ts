import { writeFileSync } from "node:fs";

import { runBacktest } from "./backtest.js";
import { axisSystem } from "./execution.js";
import { DEFAULT_SWING_WIDTH } from "./structure.js";
import { DEFAULT_SESSION_CONFIG } from "./time.js";
import type { BacktestResult, Bar, BarSeries, StrategyConfig } from "./types.js";

const M15 = 15 * 60 * 1000;
const DAY = 86_400_000;

/** Deterministic demo series: three days of M15 bars drifting up. */
function syntheticSeries(): BarSeries {
  const start = Date.UTC(2021, 0, 4, 0, 0, 0);
  const bars: Bar[] = [];
  let close = 1.2;
  for (let d = 0; d < 3; d++) {
    for (let m = 0; m < 96; m++) {
      const open = close;
      close = open + 0.0002;
      bars.push({
        time: start + d * DAY + m * M15,
        open,
        high: close + 0.00005,
        low: Math.min(open, close) - 0.00005,
        close,
      });
    }
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
    costs: { spread: 0.0001, commission: 0, slippage: 0 },
    initialEquity: 10000,
  };
}

function formatReport(result: BacktestResult, bars: number): string {
  const s = result.stats;
  const lines = [
    "CRTbot backtest",
    `bars: ${bars}`,
    `tradeCount: ${s.tradeCount}`,
    `winRate: ${s.winRate.toFixed(3)}`,
    `avgR: ${s.avgR.toFixed(3)}`,
    `expectancyR: ${s.expectancyR.toFixed(3)}`,
    `profitFactor: ${s.profitFactor}`,
    `maxDrawdown: ${s.maxDrawdown.toFixed(3)}`,
    `configHash: ${result.configHash}`,
  ];
  return lines.join("\n");
}

function runBacktestCommand(rest: string[]): number {
  const series = syntheticSeries();
  const config = demoConfig();
  const result = runBacktest(series, config, { strategy: axisSystem() });

  console.log(formatReport(result, series.bars.length));

  const outIndex = rest.indexOf("--out");
  if (outIndex !== -1 && rest[outIndex + 1]) {
    const path = rest[outIndex + 1]!;
    writeFileSync(path, JSON.stringify(result, null, 2), "utf8");
    console.log(`report written to ${path}`);
  }
  return 0;
}

function main(argv: string[]): number {
  const command = argv[2];
  const rest = argv.slice(3);

  switch (command) {
    case "backtest":
      return runBacktestCommand(rest);
    default:
      console.error("usage: crtbot backtest [--out <file>]");
      return 1;
  }
}

process.exitCode = main(process.argv);
