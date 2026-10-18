import { test } from "node:test";
import assert from "node:assert/strict";

import { runBacktest } from "../src/backtest.js";
import { axisSystem } from "../src/execution.js";
import { DEFAULT_SESSION_CONFIG } from "../src/time.js";
import type { StrategyContext } from "../src/strategy.js";
import type { Bar, BarSeries, ContextSnapshot, OrderBlock, SmtDivergence, StrategyConfig } from "../src/types.js";

/** 2021-01-04 07:00 UTC = 02:00 America/New_York — inside the London killzone. */
const KILLZONE = Date.UTC(2021, 0, 4, 7, 0, 0);
/** 2021-01-04 17:00 UTC = 12:00 America/New_York — outside every killzone. */
const OUTSIDE = Date.UTC(2021, 0, 4, 17, 0, 0);
const MIN = 60 * 1000;

function approx(actual: number, expected: number, message?: string, eps = 1e-9): void {
  assert.ok(
    Math.abs(actual - expected) < eps,
    `${message ?? "expected approx"}: got ${actual}, expected ${expected}`,
  );
}

function series(start: number, rows: [number, number, number, number][]): BarSeries {
  const bars: Bar[] = rows.map(([open, high, low, close], i) => ({
    time: start + i * MIN,
    open,
    high,
    low,
    close,
  }));
  return { instrument: "GBPUSD", bars };
}

function cfg(overrides: Partial<StrategyConfig> = {}): StrategyConfig {
  return {
    instrument: "GBPUSD",
    session: DEFAULT_SESSION_CONFIG,
    structure: { swingWidth: 1 },
    strategy: { stopDistance: 0.001 },
    risk: { rMultiple: 3, maxTradesPerDay: 1, riskPerTradePct: 0.01 },
    costs: { spread: 0, commission: 0, slippage: 0 },
    initialEquity: 10000,
    ...overrides,
  };
}

/**
 * A bearish candle (index 7) purges the significant low at index 4 and is engulfed by the
 * bullish candle at index 8 → a bullish order block with open 9.5 and extreme 8.7.
 * The bar at index 9 retraces to the block open (9.5) and the bar at index 12 reaches the
 * fixed 3R target (11.9).
 */
const CRT: [number, number, number, number][] = [
  [10.0, 10.2, 9.6, 9.8],
  [9.8, 9.9, 9.0, 9.1], // swing low 9.0
  [9.1, 9.5, 9.2, 9.4],
  [9.4, 9.6, 9.3, 9.5],
  [9.5, 9.7, 8.8, 9.6], // swing low 8.8 → significant
  [9.6, 9.9, 9.3, 9.7],
  [9.8, 9.9, 9.2, 9.3], // not engulfed: body top too high for the block close
  [9.5, 9.6, 8.7, 8.9], // purges 8.8, closes back above → the order block
  [9.6, 9.9, 9.55, 9.8], // engulfs the block (close above the wick)
  [9.8, 9.9, 9.5, 9.8], // retrace to the block open → fill
  [9.8, 10.5, 9.8, 10.4],
  [10.4, 11.2, 10.4, 11.1],
  [11.1, 12.0, 11.0, 11.9], // reaches the 3R target
];

test("a crafted CRT scenario produces exactly one trade at the block open and extreme", () => {
  const result = runBacktest(series(KILLZONE, CRT), cfg(), { strategy: axisSystem() });

  assert.equal(result.trades.length, 1, "exactly one trade");
  const trade = result.trades[0]!;

  assert.equal(trade.direction, "long");
  assert.equal(trade.entryPrice, 9.5, "entry is the order-block open");
  assert.equal(trade.stopPrice, 8.7, "stop is the order-block extreme");
  assert.ok(Math.abs(trade.targetPrice - 11.9) < 1e-9, "target is a fixed 3R from entry");
  assert.ok(Math.abs(trade.exitPrice! - 11.9) < 1e-9, "the target was hit");
  assert.ok(Math.abs(trade.rMultiple! - 3) < 1e-9, "the result was 3R");
});

test("the take profit is always exactly 3R and the stop is never moved", () => {
  const result = runBacktest(series(KILLZONE, CRT), cfg(), { strategy: axisSystem() });
  const trade = result.trades[0]!;

  const entry = 9.5;
  const stop = 8.7;
  const reward = trade.targetPrice - entry;
  const risk = entry - stop;
  assert.ok(Math.abs(reward - 3 * risk) < 1e-9, "reward is exactly 3x risk");
  assert.equal(trade.stopPrice, stop, "the stop is still the order-block extreme at exit");
  assert.ok(Math.abs(trade.targetPrice - (entry + 3 * risk)) < 1e-9, "the target was never modified");
});

test("no trade is taken outside a killzone, and the reason is logged", () => {
  const result = runBacktest(series(OUTSIDE, CRT), cfg(), { strategy: axisSystem() });

  assert.equal(result.trades.length, 0, "no trade outside a killzone");
  assert.ok(
    result.decisions.some((d) => d.action === "wait" && /killzone/i.test(d.reason)),
    "the decisions log states the killzone rejection",
  );
});

test("at most one trade is entered per day", () => {
  // The CRT scenario, then a second setup on the same day that must be refused.
  const rows: [number, number, number, number][] = [
    ...CRT,
    [11.9, 12.0, 11.0, 11.1],
    [11.1, 11.2, 10.0, 10.1],
    [10.1, 10.2, 8.6, 8.8], // bearish, purges the significant low 8.7
    [8.8, 11.8, 8.75, 11.7], // engulfing → a second order block the same day
    [11.7, 11.8, 11.0, 11.1],
    [11.1, 12.0, 11.05, 11.9],
  ];

  const result = runBacktest(series(KILLZONE, rows), cfg(), { strategy: axisSystem() });

  assert.equal(result.trades.length, 1, "only the first setup is taken");
  assert.ok(
    result.decisions.some(
      (d) => d.action === "wait" && /maximum trades per day/i.test(d.reason),
    ),
    "the second setup is refused for the daily cap",
  );
});

test("the day's bias is visible on every decision", () => {
  const result = runBacktest(series(KILLZONE, CRT), cfg(), { strategy: axisSystem() });

  assert.ok(result.decisions.length > 0, "a decisions log is produced");
  assert.ok(
    result.decisions.every((d) => d.bias !== undefined),
    "each decision carries the bias governing that session day",
  );
});

/** The bullish order block the decision-level tests hand to `axisSystem` directly. */
const BLOCK: OrderBlock = {
  index: 1,
  time: KILLZONE,
  direction: "long",
  open: 9.5,
  top: 9.6,
  bottom: 8.7,
  part: "wick",
  behaviours: ["purge"],
  engulfedBy: 1,
  candles: 1,
  propulsion: false,
};

function strategyContext(overrides: Partial<StrategyContext> = {}): StrategyContext {
  return {
    index: 1,
    time: KILLZONE,
    open: 9.5,
    high: 9.9,
    low: 8.7,
    close: 9.8,
    openTrade: null,
    tradesToday: 0,
    isNewDay: true,
    session: "london",
    killzone: "london",
    bias: "bullish",
    context: null,
    smt: null,
    structure: null,
    liquidity: null,
    orderBlocks: [BLOCK],
    ...overrides,
  };
}

function contextSnapshot(
  position: ContextSnapshot["position"],
  aligned: boolean,
): ContextSnapshot {
  return {
    timeframe: "H4",
    range: { high: 10, low: 9, equilibrium: 9.5 },
    position,
    keyLevel: position === "discount" ? 9 : 10,
    crt: null,
    aligned,
  };
}

test("axisSystem refuses a setup that opposes the day's bias", () => {
  const refused = axisSystem().decide(strategyContext({ bias: "bearish" }));
  assert.ok(refused !== null && !("direction" in refused), "a long against a bearish bias is refused");
  assert.match(refused.reason, /bias/i, "the reason names the bias");

  const allowed = axisSystem().decide(strategyContext({ bias: "none" }));
  assert.ok(allowed !== null && "direction" in allowed, "a neutral bias does not veto");
  assert.equal(allowed.direction, "long");
});

test("axisSystem stands down when the dealing range is not aligned with the bias", () => {
  const misaligned = axisSystem().decide(
    strategyContext({ context: contextSnapshot("premium", false) }),
  );
  assert.equal(misaligned?.reason, "not aligned with the dealing range");

  const aligned = axisSystem().decide(
    strategyContext({ context: contextSnapshot("discount", true) }),
  );
  assert.ok(aligned !== null && "direction" in aligned, "a bullish setup in discount is taken");
  assert.equal(aligned.direction, "long");

  const noContext = axisSystem().decide(strategyContext());
  assert.ok(noContext !== null && "direction" in noContext, "before London the context cannot veto");
  assert.equal(noContext.direction, "long");
});

/** The divergence at the key level, confirmed or not (§7.3). */
function divergence(confirmedBy: SmtDivergence["confirmedBy"]): SmtDivergence {
  return { side: "low", took: "GBPUSD", failed: "EURUSD", confirmedBy };
}

test("an unconfirmed SMT divergence does not stand in for the map", () => {
  const refused = axisSystem().decide(
    strategyContext({
      context: contextSnapshot("premium", false),
      smt: divergence(null),
    }),
  );

  assert.ok(refused !== null && !("direction" in refused), "the setup is still refused");
  assert.equal(refused.reason, "not aligned with the dealing range");
});

test("a confirmed SMT divergence stands in for the map", () => {
  const taken = axisSystem().decide(
    strategyContext({
      context: contextSnapshot("premium", false),
      smt: divergence("csd"),
    }),
  );

  assert.ok(taken !== null && "direction" in taken, "the setup is taken");
  assert.equal(taken.direction, "long");
  assert.match(taken.reason, /SMT divergence confirmed by a csd/i);
});

test("a divergence does not overrule the day's bias", () => {
  const refused = axisSystem().decide(
    strategyContext({ bias: "bearish", smt: divergence("csd") }),
  );

  assert.ok(refused !== null && !("direction" in refused), "a long against a bearish bias is refused");
  assert.match(refused.reason, /bias/i);
});
