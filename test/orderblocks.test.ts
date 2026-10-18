import { test } from "node:test";
import assert from "node:assert/strict";

import { findOrderBlocks, scoreOrderBlock, type OrderBlockRules } from "../src/orderblocks.js";
import { runBacktest } from "../src/backtest.js";
import { DEFAULT_SESSION_CONFIG } from "../src/time.js";
import type { Strategy } from "../src/strategy.js";
import type { Bar, OrderBlock, PricePosition, StrategyConfig } from "../src/types.js";

const BASE = Date.UTC(2021, 0, 4, 0, 0, 0);

/** Bars from explicit [open, high, low, close] rows. */
function bars(rows: [number, number, number, number][]): Bar[] {
  return rows.map(([open, high, low, close], i) => ({
    time: BASE + i * 60_000,
    open,
    high,
    low,
    close,
  }));
}

/** No liquidity sweeps, so behaviour comes only from the injected predicates. */
const NO_SWEEPS = { highs: [], lows: [] };

function rules(overrides: Partial<OrderBlockRules> = {}): OrderBlockRules {
  return { points: NO_SWEEPS, ...overrides };
}

/**
 * A single bearish candle engulfed by a close above its body (but not its wick), then a
 * follow-on bar that must not become a block of its own.
 */
const SINGLE: Bar[] = bars([
  [11, 11.2, 10.8, 11], // doesji/none — marks the start of the series
  [10, 10.1, 9.4, 9.5], // the order block (bearish)
  [9.6, 10.4, 9.5, 10.05], // engulfing candle, close above the body only
  [10.05, 10.2, 10, 10.1],
]);

test("an order block needs both a qualifying behaviour and engulfment", () => {
  const withBehaviour = findOrderBlocks(SINGLE, rules({ testedKeyLevel: (_, i) => i === 1 }));
  assert.equal(withBehaviour.length, 1, "behaviour + engulfment yields one block");

  // Behaviour absent → not a block, even though the candle is engulfed.
  assert.deepEqual(findOrderBlocks(SINGLE, rules()), [], "an engulf without behaviour is not a block");

  // Engulfment absent: the same candle with the qualifying behaviour but nothing closing
  // through it is not a block either.
  const noEngulf = bars([
    [11, 11.2, 10.8, 11],
    [10, 10.1, 9.4, 9.5],
    [9.7, 9.8, 9.55, 9.6], // stayed below the body top
  ]);
  assert.deepEqual(
    findOrderBlocks(noEngulf, rules({ testedKeyLevel: (_, i) => i === 1 })),
    [],
    "behaviour without engulfment is not a block",
  );
});

test("body-vs-wick resolution follows how price closes through the candle", () => {
  const tested = (i: number) => i === 1;

  const bodyCase = findOrderBlocks(SINGLE, rules({ testedKeyLevel: (_, i) => tested(i) }));
  assert.equal(bodyCase.length, 1);
  assert.equal(bodyCase[0]!.part, "body", "closed above the body but not the wick");
  assert.equal(bodyCase[0]!.top, 10);
  assert.equal(bodyCase[0]!.bottom, 9.5);

  const WICK: Bar[] = bars([
    [11, 11.2, 10.8, 11],
    [10, 10.1, 9.4, 9.5],
    [9.6, 10.35, 9.5, 10.3], // closes above the wick (10.1) → whole candle
  ]);
  const wickCase = findOrderBlocks(WICK, rules({ testedKeyLevel: (_, i) => tested(i) }));
  assert.equal(wickCase.length, 1);
  assert.equal(wickCase[0]!.part, "wick");
  assert.equal(wickCase[0]!.top, 10.1);
  assert.equal(wickCase[0]!.bottom, 9.4);
});

test("consecutive candles closed through as a whole are grouped into one order block", () => {
  const GROUP: Bar[] = bars([
    [11, 11.2, 10.8, 11], // not bearish — stops the run
    [10.2, 10.4, 9.8, 10.0], // bearish
    [9.9, 10.1, 9.5, 9.7], // bearish
    [9.8, 10.5, 9.6, 10.45], // engulfing close above both wicks
  ]);

  const blocks = findOrderBlocks(GROUP, rules({ testedKeyLevel: (_, i) => i === 1 || i === 2 }));

  assert.equal(blocks.length, 1, "the two candles form a single block");
  assert.equal(blocks[0]!.candles, 2);
  assert.equal(blocks[0]!.index, 2, "the block ends at the last grouped candle");
  assert.equal(blocks[0]!.top, 10.4);
  assert.equal(blocks[0]!.bottom, 9.5);
});

test("a block formed by testing a previous block is a propulsion block", () => {
  const SERIES: Bar[] = bars([
    [11.0, 11.2, 10.8, 11.0],
    [10.0, 10.1, 9.4, 9.5], // first block source → zone [9.5, 10]
    [9.6, 10.4, 9.5, 10.05], // engulfs it
    [11.0, 11.05, 10.5, 10.6], // moves away; not bearish, blocks further grouping
    [10.6, 10.65, 9.7, 9.8], // second source: low 9.7 tests the first zone
    [9.9, 11.0, 9.85, 10.9], // engulfs it
  ]);

  const blocks = findOrderBlocks(
    SERIES,
    rules({ testedKeyLevel: (_, i) => i === 1 || i === 4 }),
  );

  assert.equal(blocks.length, 2);
  assert.equal(blocks[0]!.propulsion, false, "the first block stands alone");
  assert.equal(blocks[1]!.propulsion, true, "the second block tested the first");
});

test("high-probability scoring requires all four conditions", () => {
  const block: OrderBlock = {
    index: 10,
    time: BASE,
    direction: "long",
    open: 10,
    top: 10,
    bottom: 9.5,
    part: "body",
    behaviours: ["fill"],
    engulfedBy: 11,
    candles: 1,
    propulsion: false,
  };

  const all = scoreOrderBlock(
    block,
    rules({
      biasAligned: () => true,
      positionOf: (): PricePosition => "discount",
      atKeyTime: () => true,
      testedAtKeyTime: () => true,
    }),
  );
  assert.equal(all.highProbability, true);
  assert.deepEqual(
    [all.biasAligned, all.discountOrPremium, all.formedAtKeyTime, all.testedAtKeyTime],
    [true, true, true, true],
  );

  assert.equal(
    scoreOrderBlock(block, rules({ biasAligned: () => false, positionOf: () => "discount", atKeyTime: () => true, testedAtKeyTime: () => true })).highProbability,
    false,
    "missing bias alignment",
  );
  assert.equal(
    scoreOrderBlock(block, rules({ biasAligned: () => true, positionOf: () => "premium", atKeyTime: () => true, testedAtKeyTime: () => true })).highProbability,
    false,
    "a long in premium is not high-probability",
  );
  assert.equal(
    scoreOrderBlock(block, rules({ biasAligned: () => true, positionOf: () => "discount", atKeyTime: () => false, testedAtKeyTime: () => true })).highProbability,
    false,
    "not formed at a key time",
  );
  assert.equal(
    scoreOrderBlock(block, rules({ biasAligned: () => true, positionOf: () => "discount", atKeyTime: () => true, testedAtKeyTime: () => false })).highProbability,
    false,
    "not tested at a key time",
  );
});

const CFG: StrategyConfig = {
  instrument: "GBPUSD",
  session: DEFAULT_SESSION_CONFIG,
  structure: { swingWidth: 1 },
  strategy: { stopDistance: 0.001 },
  risk: { rMultiple: 3, maxTradesPerDay: 1, riskPerTradePct: 0.01 },
  costs: { spread: 0, commission: 0, slippage: 0 },
  initialEquity: 10000,
};

test("an order block is visible in the decisions log", () => {
  // A bearish candle (index 5) purges the significant low at index 3 and is engulfed by
  // the bullish candle at index 6.
  const series = bars([
    [12, 12, 10, 12],
    [11, 11, 7, 11],
    [12, 12, 9, 12],
    [11, 11, 6, 11],
    [12, 12, 8, 12],
    [18, 18, 5, 12],
    [12, 20, 11, 19],
    [11, 11, 3, 11],
    [12, 12, 7, 12],
  ]);

  const strategy: Strategy = {
    name: "enter-on-order-block",
    decide: (ctx) => (ctx.index === 6 ? { direction: "long", reason: "test entry" } : null),
  };

  const result = runBacktest({ instrument: "GBPUSD", bars: series }, CFG, { strategy });
  const entry = result.decisions.find((d) => d.action === "enter");

  assert.ok(entry, "the strategy entered");
  assert.ok(
    entry.orderBlocks?.some((b) => b.index === 5 && b.behaviours.includes("purge")),
    "the engulfed purge candle is logged as an order block",
  );
});
