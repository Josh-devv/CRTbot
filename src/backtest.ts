import { createHash } from "node:crypto";

import { bucketStart } from "./candles.js";
import { liquidityEventAt } from "./liquidity.js";
import { findOrderBlocks } from "./orderblocks.js";
import { computeStats } from "./stats.js";
import { findSignificantPoints, structureSnapshot, type SignificantPoints } from "./structure.js";
import { placeholderLong, type Strategy, type StrategyContext } from "./strategy.js";
import { killzoneOf, sessionDayStart, sessionOf } from "./time.js";
import type {
  BacktestResult,
  Bar,
  BarSeries,
  Decision,
  EquityPoint,
  OrderBlock,
  StrategyConfig,
  Trade,
} from "./types.js";

/** Deterministic stringify: sorts object keys at every level. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
}

export function configHash(cfg: StrategyConfig): string {
  return createHash("sha256").update(stableStringify(cfg)).digest("hex");
}

function checkExit(trade: Trade, b: Bar): "target" | "stop" | null {
  if (trade.direction === "long") {
    if (b.low <= trade.stopPrice) return "stop";
    if (b.high >= trade.targetPrice) return "target";
  } else {
    if (b.high >= trade.stopPrice) return "stop";
    if (b.low <= trade.targetPrice) return "target";
  }
  return null;
}

export interface BacktestOptions {
  strategy?: Strategy;
}

/** The Axis System fixes execution at M15, so every decision names its M15 candle bucket. */
const EXECUTION_TIMEFRAME = "M15";

function contextOf(
  bar: Bar,
  index: number,
  points: SignificantPoints,
  cfg: StrategyConfig,
  orderBlocks: OrderBlock[],
): Pick<Decision, "session" | "killzone" | "bucket" | "structure" | "liquidity" | "orderBlocks"> {
  return {
    session: sessionOf(bar.time, cfg.session),
    killzone: killzoneOf(bar.time, cfg.session),
    bucket: { timeframe: EXECUTION_TIMEFRAME, time: bucketStart(bar.time, EXECUTION_TIMEFRAME, cfg) },
    structure: structureSnapshot(points, index, bar.close) ?? undefined,
    liquidity: liquidityEventAt(bar, index, points) ?? undefined,
    orderBlocks: orderBlocks.length > 0 ? orderBlocks : undefined,
  };
}

/**
 * The single architectural seam. Replays a bar series through a strategy and
 * returns trades, an equity curve, statistics, a decisions log and a config hash.
 */
export function runBacktest(
  series: BarSeries,
  cfg: StrategyConfig,
  options: BacktestOptions = {},
): BacktestResult {
  const strategy = options.strategy ?? placeholderLong(cfg);
  const halfSpread = cfg.costs.spread / 2;
  const slip = cfg.costs.slippage;
  const points = findSignificantPoints(series.bars, cfg.structure);

  // Group blocks by the candle that engulfs them, so each decision can name the blocks
  // confirmed on that bar.
  const blocksByEngulfing = new Map<number, OrderBlock[]>();
  for (const block of findOrderBlocks(series.bars, { points })) {
    const existing = blocksByEngulfing.get(block.engulfedBy);
    if (existing === undefined) blocksByEngulfing.set(block.engulfedBy, [block]);
    else existing.push(block);
  }


  const trades: Trade[] = [];
  const decisions: Decision[] = [];
  const equityCurve: EquityPoint[] = [];

  let equity = cfg.initialEquity;
  equityCurve.push({ time: series.bars[0]?.time ?? 0, equity });

  let openTrade: Trade | null = null;
  let currentDay = Number.NaN;
  let tradesToday = 0;

  for (let i = 0; i < series.bars.length; i++) {
    const bar = series.bars[i]!;

    // 1) Manage an open trade against this bar.
    if (openTrade !== null) {
      const hit = checkExit(openTrade, bar);
      if (hit !== null) {
        const rawExit = hit === "target" ? openTrade.targetPrice : openTrade.stopPrice;
        // Costs are charged on both sides: half the spread and slippage on the way out,
        // and commission per side (so twice over the round trip).
        const fill =
          openTrade.direction === "long"
            ? rawExit - halfSpread - slip
            : rawExit + halfSpread + slip;
        const dir = openTrade.direction === "long" ? 1 : -1;
        const commission = 2 * cfg.costs.commission;
        const pnl = (fill - openTrade.entryPrice) * openTrade.size * dir - commission;
        openTrade.exitTime = bar.time;
        openTrade.exitPrice = fill;
        openTrade.pnl = pnl;
        openTrade.rMultiple = openTrade.riskAmount === 0 ? 0 : pnl / openTrade.riskAmount;
        equity += pnl;
        equityCurve.push({ time: bar.time, equity });
        trades.push(openTrade);
        decisions.push({
          time: bar.time,
          action: "exit",
          direction: openTrade.direction,
          reason: `${hit} hit`,
          ...contextOf(bar, i, points, cfg, blocksByEngulfing.get(i) ?? []),
        });
        openTrade = null;
        continue; // one action per bar
      }
    }

    // 2) Session-day rollover bookkeeping.
    const day = sessionDayStart(bar.time, cfg.session);
    const isNewDay = i === 0 || sessionDayStart(series.bars[i - 1]!.time, cfg.session) !== day;
    if (day !== currentDay) {
      currentDay = day;
      tradesToday = 0;
    }

    // 3) Evaluate an entry.
    if (openTrade === null) {
      const ctx: StrategyContext = {
        index: i,
        time: bar.time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        openTrade,
        tradesToday,
        isNewDay,
      };
      const signal = strategy.decide(ctx);
      if (signal !== null) {
        const dir = signal.direction === "long" ? 1 : -1;
        const entryPrice = bar.close + dir * (halfSpread + slip);
        const stopPrice = entryPrice - dir * cfg.strategy.stopDistance;
        const targetPrice = entryPrice + dir * cfg.risk.rMultiple * cfg.strategy.stopDistance;
        const riskPerUnit = Math.abs(entryPrice - stopPrice);
        const riskAmount = equity * cfg.risk.riskPerTradePct;
        const size = riskPerUnit === 0 ? 0 : riskAmount / riskPerUnit;

        openTrade = {
          instrument: series.instrument,
          direction: signal.direction,
          entryTime: bar.time,
          entryPrice,
          stopPrice,
          targetPrice,
          size,
          riskAmount,
          reason: signal.reason,
        };
        tradesToday += 1;
        decisions.push({
          time: bar.time,
          action: "enter",
          direction: signal.direction,
          reason: signal.reason,
          ...contextOf(bar, i, points, cfg, blocksByEngulfing.get(i) ?? []),
        });
      }
    }
  }

  return {
    trades,
    equityCurve,
    stats: computeStats(trades, equityCurve),
    decisions,
    configHash: configHash(cfg),
  };
}
