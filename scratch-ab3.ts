/**
 * Ticket 17/20 — the CRT trigger lookback: how long a CRT of the dealing range stays a valid
 * trigger. Compares the strict current-candle reading against 3/6/12/24 H4 candles, with and
 * without the purgeOnly filter, on five years.
 *
 *   npx tsx scratch-ab3.ts [--from YYYY-MM-DD] [--to YYYY-MM-DD]
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

const V3: ExecutionFilters = { minRiskPips: 3, purgeOnly: true };
const WITH_CRT = (bars: number): ExecutionFilters => ({
  ...V3,
  requireCrt: true,
  crtLookbackBars: bars,
});

interface Variant {
  label: string;
  filters: ExecutionFilters;
}

const VARIANTS: Variant[] = [
  { label: "V3 reference", filters: V3 },
  { label: "V3 + crt lookback 0", filters: WITH_CRT(0) },
  { label: "V3 + crt lookback 3", filters: WITH_CRT(3) },
  { label: "V3 + crt lookback 6", filters: WITH_CRT(6) },
  { label: "V3 + crt lookback 12", filters: WITH_CRT(12) },
  { label: "V3 + crt lookback 24", filters: WITH_CRT(24) },
  { label: "risk>=3 + crt 6 (no purge)", filters: { minRiskPips: 3, requireCrt: true, crtLookbackBars: 6 } },
  { label: "risk>=3 + crt 12 (no purge)", filters: { minRiskPips: 3, requireCrt: true, crtLookbackBars: 12 } },
];

const rest = process.argv.slice(2);
const from = dayBound(flag(rest, "--from") ?? "2020-01-01", "start");
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

console.log(
  `range ${new Date(from).toISOString().slice(0, 10)} .. ${new Date(to).toISOString().slice(0, 10)}` +
    `  bars=${series.bars.length}\n`,
);
console.log(
  "variant".padEnd(34) + "trades".padStart(7) + "win%".padStart(7) + "avgR".padStart(8) +
    "netR".padStart(8) + "PF".padStart(7) + "maxDD".padStart(7),
);

for (const variant of VARIANTS) {
  const cfg: StrategyConfig = { ...baseConfig("GBPUSD"), execution: variant.filters };
  const started = Date.now();
  const result = runBacktest(series, cfg, { strategy: axisSystem(variant.filters), dataset });
  const stats = computeStats(result.trades, result.equityCurve);
  const netR = result.trades.reduce((sum, trade) => sum + (trade.rMultiple ?? 0), 0);

  console.log(
    variant.label.padEnd(34) +
      String(stats.tradeCount).padStart(7) +
      (100 * stats.winRate).toFixed(1).padStart(7) +
      stats.expectancyR.toFixed(3).padStart(8) +
      netR.toFixed(1).padStart(8) +
      stats.profitFactor.toFixed(3).padStart(7) +
      stats.maxDrawdown.toFixed(3).padStart(7) +
      `  (${((Date.now() - started) / 1000).toFixed(0)}s)`,
  );
}
