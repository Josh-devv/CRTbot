import { createHash } from "node:crypto";

import { BiasReader } from "./bias.js";
import { bucketStart, EXECUTION_TIMEFRAME } from "./candles.js";
import { ContextReader } from "./context.js";
import { dayStandDown, exceptionsInPlay, foldDay } from "./exceptions.js";
import { liquidityEventAtOf } from "./liquidity.js";
import { findOrderBlocksOf } from "./orderblocks.js";
import { expansionTest } from "./profiles.js";
import { ActivePoints, foldPoints, PointSet, RollingPoints } from "./rolling.js";
import { macroContext } from "./seasonality.js";
import { correlatedPair, smtDivergenceOf } from "./smt.js";
import { computeStats } from "./stats.js";
import { structureSnapshotOf } from "./structure.js";
import { placeholderLong, type Signal, type Strategy, type StrategyContext } from "./strategy.js";
import {
  isKeyMacro,
  isNewsDay,
  killzoneOf,
  monthStart,
  sessionDayStart,
  sessionOf,
} from "./time.js";
import type {
  BacktestResult,
  Bar,
  BarSeries,
  BiasDirection,
  ContextSnapshot,
  DayFacts,
  Decision,
  Direction,
  EquityPoint,
  ExceptionProtocol,
  ExpansionTest,
  LiquidityEvent,
  MacroContext,
  OrderBlock,
  SmtDivergence,
  StrategyConfig,
  StructureSnapshot,
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

/**
 * A fingerprint of the bars a run replayed: the traded instrument's series, then any dataset
 * series given alongside it, each ordered by instrument name. Two runs over the same bars share
 * it, so a stored result can be tied back to the data behind it (spec §Determinism).
 */
export function dataHash(series: BarSeries, dataset: BarSeries[] = []): string {
  const hash = createHash("sha256");
  const parts = [series, ...dataset].sort((a, b) => a.instrument.localeCompare(b.instrument));
  const chunk: string[] = [];
  for (const part of parts) {
    hash.update(`${part.instrument}\n`);
    for (const bar of part.bars) {
      chunk.push(`${bar.time},${bar.open},${bar.high},${bar.low},${bar.close};\n`);
      if (chunk.length === 10_000) {
        hash.update(chunk.join(""));
        chunk.length = 0;
      }
    }
    hash.update(chunk.join(""));
    chunk.length = 0;
  }
  return hash.digest("hex");
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
  /** Whether the fill-timing deferral has already been logged for this setup. */
  deferralLogged?: boolean;
}

/** Has the bar traded through the resting limit? */
function reached(bar: Bar, pending: Pending): boolean {
  return pending.direction === "long" ? bar.low <= pending.entry : bar.high >= pending.entry;
}

/** Size a position so that being stopped out loses `riskPerTradePct` of equity. */
function sizeFor(
  equity: number,
  cfg: StrategyConfig,
  entry: number,
  stop: number,
): { size: number; riskAmount: number } {
  const riskPerUnit = Math.abs(entry - stop);
  const riskAmount = equity * cfg.risk.riskPerTradePct;
  return { size: riskPerUnit === 0 ? 0 : riskAmount / riskPerUnit, riskAmount };
}

/**
 * Realise a trade on the bar that hit its stop or target. Costs are charged on the way out
 * as they were on the way in — half the spread plus slippage — and commission is charged per
 * side, so twice over the round trip. The stop and target themselves are never modified.
 */
function realise(trade: Trade, bar: Bar, hit: "target" | "stop", cfg: StrategyConfig): void {
  const rawExit = hit === "target" ? trade.targetPrice : trade.stopPrice;
  const dir = trade.direction === "long" ? 1 : -1;
  const fill = rawExit - dir * (cfg.costs.spread / 2 + cfg.costs.slippage);
  const pnl = (fill - trade.entryPrice) * trade.size * dir - 2 * cfg.costs.commission;
  trade.exitTime = bar.time;
  trade.exitPrice = fill;
  trade.pnl = pnl;
  trade.rMultiple = trade.riskAmount === 0 ? 0 : pnl / trade.riskAmount;
}

export interface BacktestOptions {
  strategy?: Strategy;
  /**
   * The rest of the multi-instrument dataset — the correlated instruments SMT is measured
   * against (§7.3). Bars are matched to the traded series by time; an instrument with no bar
   * at a given time simply produces no divergence there.
   */
  dataset?: BarSeries[];
}

/** The per-bar reads every decision in the log carries, assembled once per bar. */
function decisionReads(input: {
  bar: Bar;
  index: number;
  /** The structural read at this bar, against points activated up to its index. */
  structure: StructureSnapshot | null;
  cfg: StrategyConfig;
  orderBlocks: OrderBlock[];
  bias: BiasDirection;
  context: ContextSnapshot | null;
  smt: SmtDivergence | null;
  sweep: LiquidityEvent | null;
  exceptions: ExceptionProtocol[];
  newsDay: boolean;
  expansionTest?: ExpansionTest;
  /** The macro directional context (§3.1.1) for this session day. */
  macro?: MacroContext;
}): Pick<
  Decision,
  | "session"
  | "killzone"
  | "bias"
  | "context"
  | "smt"
  | "exceptions"
  | "newsDay"
  | "expansionTest"
  | "macro"
  | "bucket"
  | "structure"
  | "liquidity"
  | "orderBlocks"
> {
  const {
    bar,
    cfg,
    structure,
    orderBlocks,
    bias,
    context,
    smt,
    sweep,
    exceptions,
    newsDay,
    expansionTest,
    macro,
  } = input;
  return {
    session: sessionOf(bar.time, cfg.session),
    killzone: killzoneOf(bar.time, cfg.session),
    bias,
    context: context ?? undefined,
    smt: smt ?? undefined,
    exceptions: exceptions.length > 0 ? exceptions : undefined,
    newsDay: newsDay || undefined,
    expansionTest,
    macro,
    bucket: { timeframe: EXECUTION_TIMEFRAME, time: bucketStart(bar.time, EXECUTION_TIMEFRAME, cfg) },
    structure: structure ?? undefined,
    liquidity: sweep ?? undefined,
    orderBlocks: orderBlocks.length > 0 ? orderBlocks : undefined,
  };
}

/**
 * SMT for one bar (§7.3). The two lower-timeframe confirmations are read off this bar: a sweep
 * classified as a CSD, or an order block confirmed here. Either validates a divergence; neither
 * means the divergence is flagged but unconfirmed — and unconfirmed divergence never trades.
 *
 * The pair's significant points ride a rolling pass folded up to the pair bar (`pairPoints`),
 * answering exactly as the reference's re-read prefix does (ticket 16).
 */
function detectSmt(input: {
  bar: Bar;
  cfg: StrategyConfig;
  series: BarSeries;
  pairSeries: BarSeries | null;
  pairPoints: RollingPoints | null;
  pairIndexByTime: Map<number, number>;
  context: ContextSnapshot | null;
  sweep: LiquidityEvent | null;
  blocksHere: OrderBlock[];
  bias: BiasDirection;
}): SmtDivergence | null {
  const { bar, cfg, series, pairSeries, pairPoints, pairIndexByTime, context, sweep, blocksHere, bias } =
    input;
  if (pairSeries === null || pairPoints === null || context === null) return null;

  const { session } = cfg;
  const confirmedBy: SmtDivergence["confirmedBy"] =
    sweep?.kind === "csd" ? "csd" : blocksHere.length > 0 ? "order-block" : null;

  return smtDivergenceOf(
    {
      traded: series.instrument,
      pair: pairSeries.instrument,
      sweep,
      pairBars: pairSeries.bars,
      pairIndex: pairIndexByTime.get(bar.time) ?? null,
      bias,
      keyLevel: context.keyLevel,
      atKeyTime: killzoneOf(bar.time, session) !== null || isKeyMacro(bar.time, session),
      confirmedBy,
      structure: cfg.structure,
    },
    pairPoints,
  );
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

  // One forward pass derives every significant point of the series (ticket 16); the pure
  // `findSignificantPoints` stays the reference, pinned equal by `test/rolling.test.ts`.
  const points = foldPoints(series.bars, cfg.structure).toPoints();
  // The two query surfaces the replay reads: liquidity resolves across the whole series (the
  // relative DOL is a whole-series read), and structure is scoped to the cursor as it advances.
  const levels = PointSet.fromPoints(points);
  const activePoints = new ActivePoints(points.highs, points.lows);

  // SMT needs the correlated instrument's bars at the same times (§7.3): pair the traded series
  // with the configured correlation and index its bars by time.
  const pair = correlatedPair(cfg, series.instrument, options.dataset);
  const pairSeries = pair?.series ?? null;
  const pairIndexByTime = pair?.indexByTime ?? new Map<number, number>();
  const pairPoints = pairSeries === null ? null : new RollingPoints(cfg.structure);
  let pairFolded = 0;

  const biasReader = new BiasReader(cfg);
  const contextReader = new ContextReader(cfg);

  // Group blocks by the candle that engulfs them, so each decision can name the blocks
  // confirmed on that bar.
  const blocksByEngulfing = new Map<number, OrderBlock[]>();
  for (const block of findOrderBlocksOf(series.bars, { points }, levels)) {
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
  let biasToday: BiasDirection = "none";

  // The exception protocols are anticipation for the day ahead (§8), so they are read from the
  // days already behind us plus the day being built — never from bars that have not printed.
  const completedDays: DayFacts[] = [];
  let today: DayFacts | null = null;
  let stoodDownDay = Number.NaN;
  let macroMonthStart = Number.NaN;
  let macroToday: MacroContext | null = null;

  for (let i = 0; i < series.bars.length; i++) {
    const bar = series.bars[i]!;

    // Fold this bar into the rolling readers first: every read below answers "as of this bar".
    biasReader.fold(bar);
    contextReader.fold(bar);
    activePoints.activateThrough(i);

    // Session-day rollover: the counter resets and the day's bias is read fresh, from structure
    // up to and including this bar only.
    const day = sessionDayStart(bar.time, cfg.session);
    const isNewDay = i === 0 || sessionDayStart(series.bars[i - 1]!.time, cfg.session) !== day;
    if (day !== currentDay) {
      currentDay = day;
      tradesToday = 0;
      biasToday = biasReader.snapshot().direction;
      // The macro context is a monthly-level read (§3.1.1): it cannot change until the month does.
      const month = monthStart(bar.time, cfg.session);
      if (month !== macroMonthStart) {
        macroMonthStart = month;
        macroToday = macroContext(biasReader.months, bar.time, cfg);
      }
      if (today !== null) completedDays.push(today);
      today = null;
    }
    today = foldDay(today, bar, cfg);
    const macroRead = macroToday ?? undefined;

    const inPlay = exceptionsInPlay({ completedDays, today, cfg });
    const newsDay = isNewsDay(bar.time, cfg.session);
    const expansion = expansionTest({ completedDays, today, cfg });
    const dayPlan = dayStandDown({
      exceptions: inPlay,
      newsDay,
      expansionTest: expansion,
      macro: macroRead,
      cfg,
    });

    const blocksHere = blocksByEngulfing.get(i) ?? [];
    const sweep = liquidityEventAtOf(bar, i, levels);
    const ctxContext = contextReader.at(bar, biasToday);

    // The pair's points fold forward only as far as this bar's index; the read below is the
    // same prefix the reference re-aggregates for SMT.
    if (pairSeries !== null && pairPoints !== null) {
      const pairIndex = pairIndexByTime.get(bar.time);
      if (pairIndex !== undefined) {
        while (pairFolded <= pairIndex) {
          pairPoints.fold(pairSeries.bars[pairFolded]!);
          pairFolded += 1;
        }
      }
    }

    const smt = detectSmt({
      bar,
      cfg,
      series,
      pairSeries,
      pairPoints,
      pairIndexByTime,
      context: ctxContext,
      sweep,
      blocksHere,
      bias: biasToday,
    });
    const context = decisionReads({
      bar,
      index: i,
      cfg,
      structure: structureSnapshotOf(activePoints, bar.close),
      orderBlocks: blocksHere,
      bias: biasToday,
      context: ctxContext,
      smt,
      sweep,
      exceptions: inPlay.map((exception) => exception.protocol),
      newsDay,
      expansionTest: expansion,
      macro: macroRead,
    });

    // 1) Manage an open trade against this bar.
    if (openTrade !== null) {
      const hit = checkExit(openTrade, bar);
      if (hit !== null) {
        realise(openTrade, bar, hit, cfg);
        equity += openTrade.pnl!;
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

    // 2) An exception protocol (§8), a news day (§9), or an enforced non-expansion day (§10)
    // skips the day entirely: any setup still resting is dropped so it cannot fill, the skip is
    // logged once, and no setup is even asked for. An open trade is still managed above.
    if (dayPlan.standDown) {
      pending = null;
      if (stoodDownDay !== day) {
        stoodDownDay = day;
        decisions.push({
          time: bar.time,
          action: "stand-down",
          reason: dayPlan.reasons.join("; "),
          ...context,
        });
      }
      continue;
    }

    // 3) Fill a resting limit order — unless the fill-timing filter (ticket 21) has the limit
    // wait for the killzone to close before it may take its fill.
    if (openTrade === null && pending !== null && reached(bar, pending)) {
      const deferred =
        cfg.execution?.fillOutsideKillzoneOnly === true &&
        killzoneOf(bar.time, cfg.session) !== null;
      if (deferred) {
        if (pending.deferralLogged !== true) {
          pending.deferralLogged = true;
          decisions.push({
            time: bar.time,
            action: "wait",
            reason: "fill deferred: inside the killzone (fillOutsideKillzoneOnly)",
            direction: pending.direction,
            ...context,
          });
        }
        continue;
      }

      const dir = pending.direction === "long" ? 1 : -1;
      const fill = pending.entry + dir * (cfg.costs.spread / 2 + cfg.costs.slippage);
      const { size, riskAmount } = sizeFor(equity, cfg, fill, pending.stop);

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
        realise(trade, bar, sameBar, cfg);
        equity += trade.pnl!;
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

    // 4) An unfilled setup expires with its day.
    if (pending !== null && pending.day !== day) {
      decisions.push({
        time: bar.time,
        action: "wait",
        reason: "setup expired with the day",
        ...context,
      });
      pending = null;
    }

    // 5) Ask the strategy for a setup.
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
        bias: biasToday,
        context: ctxContext,
        smt,
        structure: context.structure ?? null,
        liquidity: sweep,
        orderBlocks: blocksByEngulfing.get(i) ?? [],
      };

      const outcome = strategy.decide(ctx);
      let answered = false;

      if (outcome !== null && "direction" in outcome) {
        answered = true;
        const signal = outcome as Signal;
        if (tradesToday >= cfg.risk.maxTradesPerDay) {
          decisions.push({
            time: bar.time,
            action: "wait",
            reason: "maximum trades per day reached",
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
            // Placement is mechanical: the take profit is always `rMultiple` x risk (§5.3).
            target: signal.entry + dir * cfg.risk.rMultiple * risk,
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
          // Market entry for strategies that plan no prices (the walking skeleton): enter at
          // the bar close, with a fixed stop distance and the fixed R multiple.
          const dir = signal.direction === "long" ? 1 : -1;
          const entryPrice = bar.close + dir * (cfg.costs.spread / 2 + cfg.costs.slippage);
          const stopPrice = entryPrice - dir * cfg.strategy.stopDistance;
          const { size, riskAmount } = sizeFor(equity, cfg, entryPrice, stopPrice);
          openTrade = {
            instrument: series.instrument,
            direction: signal.direction,
            entryTime: bar.time,
            entryPrice,
            stopPrice,
            targetPrice: entryPrice + dir * cfg.risk.rMultiple * cfg.strategy.stopDistance,
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
        answered = true;
        decisions.push({ time: bar.time, action: "wait", reason: outcome.reason, ...context });
      }

      // Flat, no resting order, and the strategy said nothing: record that there was nothing.
      if (!answered) {
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
    dataHash: dataHash(series, options.dataset),
  };
}
