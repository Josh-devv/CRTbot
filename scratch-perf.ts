import { runBacktest } from "./src/backtest.js";
import { axisSystem } from "./src/execution.js";
import { loadSeries } from "./src/ingest.js";
import { DEFAULT_SWING_WIDTH } from "./src/structure.js";
import { DEFAULT_SESSION_CONFIG } from "./src/time.js";
import type { Instrument, StrategyConfig } from "./src/types.js";

const DAY = 86_400_000;

function realConfig(instrument: Instrument): StrategyConfig {
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

const from = Date.parse("2024-01-01T00:00:00Z");
const to = Date.parse("2024-01-31T00:00:00Z") + DAY - 1;

async function load(instrument: Instrument) {
  const t0 = performance.now();
  const series = await loadSeries(instrument, from, to, realConfig(instrument));
  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(`load ${instrument}: ${secs}s, ${series.bars.length} bars`);
  return series;
}

const gbp = await load("GBPUSD");
const eur = await load("EURUSD");

const t0 = performance.now();
const result = runBacktest(gbp, realConfig("GBPUSD"), { strategy: axisSystem(), dataset: [eur] });
console.log(`run: ${((performance.now() - t0) / 1000).toFixed(1)}s`);
console.log(`TOTAL: ${((performance.now() - t0 + 0) / 1000).toFixed(1)}s (run only)`);
console.log(`trades ${result.trades.length} winRate ${result.stats.winRate}`);
console.log(`expectancyR ${result.stats.expectancyR}`);
console.log(`configHash ${result.configHash}`);
console.log(`dataHash ${result.dataHash}`);
