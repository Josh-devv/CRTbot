/**
 * Quick R:R check — two months, 3R vs 1R, baseline vs the ticket-21 filters. Scratch.
 *
 *   npx tsx scratch-rr.ts [--from YYYY-MM-DD] [--to YYYY-MM-DD]
 */
import { runBacktest } from "./src/backtest.js";
import { axisSystem } from "./src/execution.js";
import { DEFAULT_DATA_DIR, loadSeries } from "./src/ingest.js";
import { computeStats } from "./src/stats.js";
import { DEFAULT_SWING_WIDTH } from "./src/structure.js";
import { DEFAULT_SESSION_CONFIG } from "./src/time.js";
import type { BarSeries, ExecutionFilters, Instrument, StrategyConfig } from "./src/types.js";

const DAY = 86_400_000;

function baseConfig(instrument: Instrument): StrategyConfig {
  return {
    instrument,
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
    smt: { enabled: true, pairs: [["GBPUSD", "EURUSD"]], useDxy: false },
  };
}

function flag(rest: string[], name: string): string | undefined {
  const index = rest.indexOf(name);
  return index === -1 ? undefined : rest[index + 1];
}

function dayBound(text: string, bound: "start" | "end"): number {
  const start = Date.parse(`${text}T00:00:00Z`);
  return bound === "start" ? start : start + DAY - 1;
}

const rest = process.argv.slice(2);
const from = dayBound(flag(rest, "--from") ?? "2024-11-01", "start");
const to = dayBound(flag(rest, "--to") ?? "2024-12-31", "end");

const loaded = new Map<Instrument, BarSeries>();
for (const instrument of ["GBPUSD", "EURUSD"] as Instrument[]) {
  const series = await loadSeries(instrument, from, to, baseConfig(instrument), {
    dir: DEFAULT_DATA_DIR,
  });
  if (series.bars.length > 0) loaded.set(instrument, series);
}
const series = loaded.get("GBPUSD");
if (series === undefined) throw new Error("no GBPUSD bars in range");
const dataset = [...loaded.values()].filter((other) => other.instrument !== "GBPUSD");

const FILTERS: ExecutionFilters = { minRiskPips: 3, purgeOnly: true };
const variants: { label: string; r: number; filters: ExecutionFilters }[] = [
  { label: "baseline 3R", r: 3, filters: {} },
  { label: "baseline 1R", r: 1, filters: {} },
  { label: "risk>=3+purge 3R", r: 3, filters: FILTERS },
  { label: "risk>=3+purge 1R", r: 1, filters: FILTERS },
];

console.log(
  `range ${new Date(from).toISOString().slice(0, 10)} .. ${new Date(to).toISOString().slice(0, 10)}` +
    `  bars=${series.bars.length}\n`,
);
console.log(
  "variant".padEnd(24) + "trades".padStart(7) + "win%".padStart(7) + "avgR".padStart(8) +
    "netR".padStart(8) + "PF".padStart(7) + "maxDD".padStart(7),
);

for (const variant of variants) {
  const base = baseConfig("GBPUSD");
  const cfg: StrategyConfig = {
    ...base,
    risk: { ...base.risk, rMultiple: variant.r },
    execution: variant.filters,
  };
  const result = runBacktest(series, cfg, { strategy: axisSystem(variant.filters), dataset });
  const stats = computeStats(result.trades, result.equityCurve);
  const netR = result.trades.reduce((sum, trade) => sum + (trade.rMultiple ?? 0), 0);
  console.log(
    variant.label.padEnd(24) +
      String(stats.tradeCount).padStart(7) +
      (100 * stats.winRate).toFixed(1).padStart(7) +
      stats.expectancyR.toFixed(3).padStart(8) +
      netR.toFixed(1).padStart(8) +
      stats.profitFactor.toFixed(3).padStart(7) +
      stats.maxDrawdown.toFixed(3).padStart(7),
  );
}
