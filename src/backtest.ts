import { createHash } from "node:crypto";

import { bucketStart } from "./candles.js";
import { liquidityEventAt } from "./liquidity.js";
import { findOrderBlocks } from "./orderblocks.js";
import { computeStats } from "./stats.js";
import { findSignificantPoints, structureSnapshot, type SignificantPoints } from "./structure.js";
import { placeholderLong, type Signal, type Strategy, type StrategyContext } from "./strategy.js";
import { killzoneOf, sessionDayStart, sessionOf } from "./time.js";
import type {
  BacktestResult,
  Bar,
  BarSeries,
  Decision,
  Direction,
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

/** A resting limit order awaiting its entry price. */
interface Pending {
  direction: Direction;
  entry: number;
  stop: number;
  target: number;
  reason: string;
  /** Session day the setup was armed on; it expires with the day. */
  day: number;
}

/** Has the bar traded through the resting limit? */
function reached(bar: Bar, pending: Pending): boolean {
  return pending.direction === "long" ? bar.low <= pending.entry : bar.high >= pending.entry;
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
 *
 * Entry is by resting limit at the order-block open when the strategy supplies one,
 * otherwise at market on the signal bar. A limit fills when a later bar trades to it; the
 * same bar is then checked for a stop first (conservative, as intrabar order is unknown).
 */
export function runBacktest(
  series: BarSeries,
  cfg: StrategyConfig,
  options: BacktestOptions = {},
): BacktestResult {
  const strategy = options.strategy ?? placeholderLong(cfg);
  const halfSpread = cfg.costs.spread / 2;
  const slip = cfg.costs.slippage;
  const killzonesOnly = cfg.risk.killzonesOnly ?? false;
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
  let pending: Pending | null = null;
  let currentDay = Number.NaN;
  let tradesToday = 0;

  for (let i = 0; i < series.bars.length; i++) {
    const bar = series.bars[i]!;
    const blocksHere = blocksByEngulfing.get(i) ?? [];
    const context = contextOf(bar, i, points, cfg, blocksHere);

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
          ...context,
        });
        openTrade = null;
        continue; // one action per bar
      }
    }

    // 2) Fill a resting limit order.
    if (openTrade === null && pending !== null && reached(bar, pending)) {
      const dir = pending.direction === "long" ? 1 : -1;
      const fill = pending.entry + dir * (halfSpread + slip);
      const riskPerUnit = Math.abs(fill - pending.stop);
      const riskAmount = equity * cfg.risk.riskPerTradePct;
      const size = riskPerUnit === 0 ? 0 : riskAmount / riskPerUnit;

      const trade: Trade = {
        instrument: series.instrument,
        direction: pending.direction,
        entryTime: bar.time,
        entryPrice: fill,
        stopPrice: pending.stop,
        targetPrice: pending.target,
        size,
        riskAmount,
        reason: pending.reason,
      };
      pending = null;
      tradesToday += 1;
      decisions.push({
        time: bar.time,
        action: "enter",
        direction: trade.direction,
        reason: trade.reason,
        ...context,
      });

      // Same bar may already have run to the stop or target; stop is assumed first.
      const sameBar = checkExit(trade, bar);
      if (sameBar !== null) {
        const rawExit = sameBar === "target" ? trade.targetPrice : trade.stopPrice;
        const exitFill = trade.direction === "long" ? rawExit - halfSpread - slip : rawExit + halfSpread + slip;
        const sdir = trade.direction === "long" ? 1 : -1;
        const pnl = (exitFill - trade.entryPrice) * trade.size * sdir - 2 * cfg.costs.commission;
        trade.exitTime = bar.time;
        trade.exitPrice = exitFill;
        trade.pnl = pnl;
        trade.rMultiple = trade.riskAmount === 0 ? 0 : pnl / trade.riskAmount;
        equity += pnl;
        equityCurve.push({ time: bar.time, equity });
        trades.push(trade);
        decisions.push({
          time: bar.time,
          action: "exit",
          direction: trade.direction,
          reason: `${sameBar} hit`,
          ...context,
        });
      } else {
        openTrade = trade;
      }
      continue;
    }

    // 3) Session-day rollover bookkeeping; an unfilled setup expires with its day.
    const day = sessionDayStart(bar.time, cfg.session);
    const isNewDay = i === 0 || sessionDayStart(series.bars[i - 1]!.time, cfg.session) !== day;
    if (day !== currentDay) {
      currentDay = day;
      tradesToday = 0;
    }
    if (pending !== null && pending.day !== day) {
      decisions.push({
        time: bar.time,
        action: "wait",
        reason: "setup expired with the day",
        ...context,
      });
      pending = null;
    }

    // 4) Ask the strategy for a setup.
    if (openTrade === null && pending === null) {
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
        session: context.session!,
        killzone: context.killzone ?? null,
        structure: context.structure ?? null,
        liquidity: context.liquidity ?? null,
        orderBlocks: blocksByEngulfing.get(i) ?? [],
      };

      const outcome = strategy.decide(ctx);
      let spoke = false;

      if (outcome !== null && "direction" in outcome) {
        spoke = true;
        const signal = outcome as Signal;
        if (tradesToday >= cfg.risk.maxTradesPerDay) {
          decisions.push({
            time: bar.time,
            action: "wait",
            reason: "maximum trades per day reached",
            direction: signal.direction,
            ...context,
          });
        } else if (killzonesOnly && ctx.killzone === null) {
          decisions.push({
            time: bar.time,
            action: "wait",
            reason: "outside a killzone",
            direction: signal.direction,
            ...context,
          });
        } else if (signal.entry !== undefined && signal.stop !== undefined) {
          const dir = signal.direction === "long" ? 1 : -1;
          const risk = Math.abs(signal.entry - signal.stop);
          pending = {
            direction: signal.direction,
            entry: signal.entry,
            stop: signal.stop,
            target: signal.target ?? signal.entry + dir * cfg.risk.rMultiple * risk,
            reason: signal.reason,
            day,
          };
          decisions.push({
            time: bar.time,
            action: "wait",
            reason: `setup armed: ${signal.reason}`,
            direction: signal.direction,
            ...context,
          });
        } else {
          // Legacy market entry (no planned prices): enter at the bar close.
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
            ...context,
          });
        }
      } else if (outcome !== null) {
        spoke = true;
        decisions.push({ time: bar.time, action: "wait", reason: outcome.reason, ...context });
      }

      // Nothing was taken and the strategy said nothing: record why.
      if (!spoke) {
        decisions.push({
          time: bar.time,
          action: "wait",
          reason: "no qualifying setup",
          ...context,
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
