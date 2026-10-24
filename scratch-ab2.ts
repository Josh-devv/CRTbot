/**
 * Ticket 20, phase 2b — the refinement matrix on five years (2020-2024, much faster than the
 * full 25): the CRT trigger gate (ticket 17's §5.1 purge trigger) against the ticket-21
 * filters, plus the killzone sub-window experiments. One load, one replay per variant.
 *
 *   npx tsx scratch-ab2.ts [--from YYYY-MM-DD] [--to YYYY-MM-DD]
 */
import { runBacktest } from "./src/backtest.js";
import { axisSystem } from "./src/execution.js";
import { DEFAULT_DATA_DIR, loadSeries } from "./src/ingest.js";
import { computeStats } from "./src/stats.js";
import { DEFAULT_SWING_WIDTH } from "./src/structure.js";
import { DEFAULT_SESSION_CONFIG } from "./src/time.js";
import type {
  BarSeries,
  ExecutionFilters,
  Instrument,
  KillzoneName,
  SessionConfig,
  StrategyConfig,
  Window,
} from "./src/types.js";

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

interface Variant {
  label: string;
  filters: ExecutionFilters;
  killzones?: Partial<Record<KillzoneName, Window>>;
}

const V3: ExecutionFilters = { minRiskPips: 3, purgeOnly: true };
const VARIANTS: Variant[] = [
  { label: "R0 baseline", filters: {} },
  { label: "R1 risk>=3 + purgeOnly", filters: V3 },
  { label: "R2 R1 + requireCrt", filters: { ...V3, requireCrt: true } },
  { label: "R3 requireCrt alone", filters: { requireCrt: true } },
  {
    label: "R4 R1 + London only",
    filters: V3,
    killzones: { newYork: { start: "04:00", end: "04:01" } },
  },
  {
    label: "R5 R1 + London 03:00-05:00",
    filters: V3,
    killzones: { london: { start: "03:00", end: "05:00" } },
  },
  {
    label: "R6 R1 + NY 08:30-09:30",
    filters: V3,
    killzones: { newYork: { start: "08:30", end: "09:30" } },
  },
  { label: "R7 risk>=5 + purgeOnly", filters: { minRiskPips: 5, purgeOnly: true } },
  { label: "R8 purgeOnly alone", filters: { purgeOnly: true } },
  {
    label: "R9 R2 + NY 08:30-09:30",
    filters: { ...V3, requireCrt: true },
    killzones: { newYork: { start: "08:30", end: "09:30" } },
  },
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
  "variant".padEnd(32) + "trades".padStart(7) + "win%".padStart(7) + "avgR".padStart(8) +
    "netR".padStart(8) + "PF".padStart(7) + "maxDD".padStart(7),
);

for (const variant of VARIANTS) {
  const base = baseConfig("GBPUSD");
  const session: SessionConfig = {
    ...base.session,
    killzones: { ...base.session.killzones, ...variant.killzones },
  };
  const cfg: StrategyConfig = { ...base, session, execution: variant.filters };
  const started = Date.now();
  const result = runBacktest(series, cfg, { strategy: axisSystem(variant.filters), dataset });
  const stats = computeStats(result.trades, result.equityCurve);
  const netR = result.trades.reduce((sum, trade) => sum + (trade.rMultiple ?? 0), 0);

  console.log(
    variant.label.padEnd(32) +
      String(stats.tradeCount).padStart(7) +
      (100 * stats.winRate).toFixed(1).padStart(7) +
      stats.expectancyR.toFixed(3).padStart(8) +
      netR.toFixed(1).padStart(8) +
      stats.profitFactor.toFixed(3).padStart(7) +
      stats.maxDrawdown.toFixed(3).padStart(7) +
      `  (${((Date.now() - started) / 1000).toFixed(0)}s)`,
  );
}
