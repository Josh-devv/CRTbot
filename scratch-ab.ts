/**
 * Ticket 20, phase 2 — the A/B matrix for the measured edge filters (ticket 21). Loads the
 * store once, then replays the same range under each variant configuration and prints the
 * stats side by side. Deterministic: same bars, same strategy, only the filters change.
 *
 *   npx tsx scratch-ab.ts [--from YYYY-MM-DD] [--to YYYY-MM-DD]
 */
import { runBacktest } from "./src/backtest.js";
import { axisSystem } from "./src/execution.js";
import { DEFAULT_DATA_DIR, loadSeries } from "./src/ingest.js";
import { computeStats } from "./src/stats.js";
import { DEFAULT_SWING_WIDTH } from "./src/structure.js";
import { DEFAULT_SESSION_CONFIG } from "./src/time.js";
import type { BarSeries, ExecutionFilters, Instrument, StrategyConfig } from "./src/types.js";

const DAY = 86_400_000;

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

function realConfig(instrument: Instrument): StrategyConfig {
  return {
    ...demoConfig(),
    instrument,
    smt: { enabled: true, pairs: [["GBPUSD", "EURUSD"]], useDxy: false },
  };
}

function flag(rest: string[], name: string): string | undefined {
  const index = rest.indexOf(name);
  return index === -1 ? undefined : rest[index + 1];
}

function dayBound(text: string, bound: "start" | "end"): number {
  const start = Date.parse(`${text}T00:00:00Z`);
  if (Number.isNaN(start)) throw new Error(`cannot read the date "${text}"`);
  return bound === "start" ? start : start + DAY - 1;
}

interface Variant {
  label: string;
  filters: ExecutionFilters;
}

const VARIANTS: Variant[] = [
  { label: "V0 baseline", filters: {} },
  { label: "V1 risk>=2", filters: { minRiskPips: 2 } },
  { label: "V2 risk>=3", filters: { minRiskPips: 3 } },
  { label: "V3 risk>=3 + purgeOnly", filters: { minRiskPips: 3, purgeOnly: true } },
  { label: "V4 risk>=3 + fillOutside", filters: { minRiskPips: 3, fillOutsideKillzoneOnly: true } },
  {
    label: "V5 risk>=3 + purgeOnly + fillOutside",
    filters: { minRiskPips: 3, purgeOnly: true, fillOutsideKillzoneOnly: true },
  },
  {
    label: "V6 V5 + wick only",
    filters: { minRiskPips: 3, purgeOnly: true, fillOutsideKillzoneOnly: true, blockPart: "wick" },
  },
  { label: "V7 risk>=2 + fillOutside", filters: { minRiskPips: 2, fillOutsideKillzoneOnly: true } },
];

const rest = process.argv.slice(2);
const from = dayBound(flag(rest, "--from") ?? "2015-01-01", "start");
const to = dayBound(flag(rest, "--to") ?? "2024-12-31", "end");

const loaded = new Map<Instrument, BarSeries>();
for (const instrument of ["GBPUSD", "EURUSD"] as Instrument[]) {
  const series = await loadSeries(instrument, from, to, realConfig(instrument), {
    dir: DEFAULT_DATA_DIR,
  });
  if (series.bars.length > 0) loaded.set(instrument, series);
}
const series = loaded.get("GBPUSD");
if (series === undefined) throw new Error("no GBPUSD bars in range");
const dataset = [...loaded.values()].filter((other) => other.instrument !== "GBPUSD");

console.log(
  `range ${new Date(from).toISOString().slice(0, 10)} .. ${new Date(to).toISOString().slice(0, 10)}` +
    `  bars=${series.bars.length}\n`,
);
console.log(
  "variant".padEnd(38) +
    "trades".padStart(7) +
    "win%".padStart(7) +
    "avgR".padStart(8) +
    "netR".padStart(9) +
    "PF".padStart(7) +
    "maxDD".padStart(7) +
    "  london/NY",
);

for (const variant of VARIANTS) {
  const cfg = { ...realConfig("GBPUSD"), execution: variant.filters };
  const started = Date.now();
  const result = runBacktest(series, cfg, { strategy: axisSystem(variant.filters), dataset });
  const stats = computeStats(result.trades, result.equityCurve);
  const netR = result.trades.reduce((sum, trade) => sum + (trade.rMultiple ?? 0), 0);

  const bySession = new Map<string, { n: number; netR: number }>();
  for (const trade of result.trades) {
    const decision = result.decisions.find(
      (d) => d.action === "enter" && d.time === trade.entryTime && d.direction === trade.direction,
    );
    const key = decision?.killzone ?? "outside";
    const entry = bySession.get(key) ?? { n: 0, netR: 0 };
    entry.n += 1;
    entry.netR += trade.rMultiple ?? 0;
    bySession.set(key, entry);
  }
  const sessionText = [...bySession]
    .map(([key, value]) => {
      const avg = value.n === 0 ? 0 : value.netR / value.n;
      return `${key} ${value.n}@${avg.toFixed(3)}`;
    })
    .join("  ");

  console.log(
    variant.label.padEnd(38) +
      String(stats.tradeCount).padStart(7) +
      (100 * stats.winRate).toFixed(1).padStart(7) +
      stats.expectancyR.toFixed(3).padStart(8) +
      netR.toFixed(1).padStart(9) +
      stats.profitFactor.toFixed(3).padStart(7) +
      stats.maxDrawdown.toFixed(3).padStart(7) +
      "  " +
      sessionText +
      `  (${((Date.now() - started) / 1000).toFixed(0)}s)`,
  );
}
