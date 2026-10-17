import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classifyPrice,
  dealingRange,
  drawOnLiquidity,
  findSignificantPoints,
  findSwings,
} from "../src/structure.js";
import { runBacktest } from "../src/backtest.js";
import { DEFAULT_SESSION_CONFIG } from "../src/time.js";
import type { Strategy } from "../src/strategy.js";
import type { Bar, StrategyConfig } from "../src/types.js";

let clock = Date.UTC(2021, 0, 4, 0, 0, 0);

/** Build bars from [high, low] pairs; open/close are irrelevant to structure. */
function bars(pairs: [number, number][]): Bar[] {
  return pairs.map(([high, low]) => {
    const time = clock;
    clock += 60_000;
    return { time, open: low, high, low, close: high };
  });
}

test("findSwings identifies a local turning point high and low", () => {
  clock = Date.UTC(2021, 0, 4, 0, 0, 0);
  const series = bars([
    [10, 9],
    [11, 9],
    [12, 11], // swing high @ 12
    [11, 8], // swing low @ 8
    [10, 9],
  ]);

  const swings = findSwings(series, 1);

  assert.deepEqual(
    swings.map((s) => [s.kind, s.price, s.index]),
    [
      ["high", 12, 2],
      ["low", 8, 3],
    ],
  );
});

test("findSwings honours the width parameter", () => {
  clock = Date.UTC(2021, 0, 4, 0, 0, 0);
  const series = bars([
    [10, 9],
    [11, 9],
    [12, 11], // a width-1 high, but not a width-2 high
    [11, 9],
    [12.5, 9],
  ]);

  assert.equal(findSwings(series, 1).filter((s) => s.kind === "high").length, 1);
  assert.equal(findSwings(series, 2).filter((s) => s.kind === "high").length, 0);
});

test("a significant low purged the prior low's liquidity", () => {
  clock = Date.UTC(2021, 0, 4, 0, 0, 0);
  const series = bars([
    [12, 10],
    [11, 8],
    [10, 6], // swing low @ 6 (prior liquidity)
    [11, 9],
    [13, 10], // swing high @ 13
    [12, 9],
    [11, 5], // swing low @ 5 — purges the 6
    [10, 6],
  ]);

  const { lows } = findSignificantPoints(series, { swingWidth: 1 });

  assert.deepEqual(
    lows.map((s) => s.price),
    [5],
    "only the low that took out a prior low is significant",
  );
});

test("a significant high is one that led to a low being broken", () => {
  clock = Date.UTC(2021, 0, 4, 0, 0, 0);
  const series = bars([
    [12, 10],
    [11, 8],
    [10, 6], // swing low @ 6
    [11, 9],
    [13, 10], // swing high @ 13 — followed by a break of the 6 low
    [12, 9],
    [11, 5], // takes out the 6 low
    [10, 6],
  ]);

  const { highs } = findSignificantPoints(series, { swingWidth: 1 });

  assert.deepEqual(
    highs.map((s) => s.price),
    [13],
  );
});

test("an injected key-level predicate can qualify a high that broke nothing", () => {
  clock = Date.UTC(2021, 0, 4, 0, 0, 0);
  const series = bars([
    [10, 9],
    [11, 9],
    [12, 11], // swing high @ 12 — no low is ever broken
    [11, 9],
    [10, 8],
  ]);

  const plain = findSignificantPoints(series, { swingWidth: 1 });
  assert.deepEqual(plain.highs, [], "no mechanical reason to qualify the high");

  const withLevel = findSignificantPoints(series, {
    swingWidth: 1,
    testedKeyLevel: (swing) => swing.price === 12,
  });
  assert.deepEqual(
    withLevel.highs.map((s) => s.price),
    [12],
    "the injected HTF key-level predicate (ticket 09) qualifies it",
  );
});

/**
 * Significant highs @ 13 (i4) and @ 12.5 (i9); significant lows @ 5 (i6) and @ 4 (i11).
 * The most recent of each frames the dealing range.
 */
const RANGE_SERIES: [number, number][] = [
  [12, 10],
  [11, 8],
  [10, 6],
  [11, 9],
  [13, 10],
  [12, 9],
  [11, 5],
  [10, 6],
  [12, 7],
  [12.5, 9],
  [12, 8],
  [11, 4],
  [10, 6],
];

function rangeFixture() {
  clock = Date.UTC(2021, 0, 4, 0, 0, 0);
  const points = findSignificantPoints(bars(RANGE_SERIES), { swingWidth: 1 });
  const range = dealingRange(points);
  assert.ok(range, "a dealing range is defined once a significant high and low exist");
  return { points, range };
}

test("the dealing range follows the most recent leg whatever its order", () => {
  // High first, then low: the leg runs down, so the range is high -> low.
  clock = Date.UTC(2021, 0, 4, 0, 0, 0);
  const downLeg = findSignificantPoints(
    bars([
      [12, 10],
      [11, 8],
      [10, 7], // swing low @ 7
      [11, 9],
      [13, 10], // swing high @ 13 — breaks the 7 low next
      [12, 4], // swing low @ 4, purging the 7
      [11, 7],
    ]),
    { swingWidth: 1 },
  );
  const downRange = dealingRange(downLeg);
  assert.ok(downRange, "a range exists");
  assert.equal(downRange.high.price, 13);
  assert.equal(downRange.low.price, 4);
  assert.ok(downRange.start < downRange.end, "the leg runs high -> low in time");

  // Low first, then high: the leg runs up. The final high is qualified by an injected
  // key level, since nothing after it can break a low.
  clock = Date.UTC(2021, 0, 4, 0, 0, 0);
  const upLeg = findSignificantPoints(
    bars([
      [12, 10],
      [11, 6], // swing low @ 6
      [12, 8],
      [11, 4], // swing low @ 4, purging the 6
      [12, 9],
      [14, 10], // swing high @ 14
      [13, 11],
    ]),
    { swingWidth: 1, testedKeyLevel: (swing) => swing.price === 14 },
  );
  const upRange = dealingRange(upLeg);
  assert.ok(upRange, "a range exists");
  assert.equal(upRange.high.price, 14);
  assert.equal(upRange.low.price, 4);
  assert.ok(upRange.start < upRange.end, "the leg runs low -> high in time");
});

test("the dealing range spans the most recent significant high and low", () => {
  const { range } = rangeFixture();

  assert.equal(range.high.price, 12.5, "most recent significant high");
  assert.equal(range.low.price, 4, "most recent significant low");
  assert.equal(range.equilibrium, 8.25, "equilibrium is the midpoint");
  assert.ok(range.end >= range.start, "start/end bracket the two points in time");
});

test("premium and discount are classified against equilibrium", () => {
  const { range } = rangeFixture();

  assert.equal(classifyPrice(10, range), "premium", "above equilibrium");
  assert.equal(classifyPrice(6, range), "discount", "below equilibrium");
  assert.equal(classifyPrice(8.25, range), "equilibrium", "on equilibrium");
});

test("DOL takes the nearest pool in the delivery direction, and the extreme beyond it", () => {
  const { points, range } = rangeFixture();

  assert.deepEqual(
    drawOnLiquidity(points, range, 6),
    { shortTerm: 12.5, longTerm: 13 },
    "in discount price is drawn up: nearest high 12.5, extreme 13",
  );
  assert.deepEqual(
    drawOnLiquidity(points, range, 10),
    { shortTerm: 5, longTerm: 4 },
    "in premium price is drawn down: nearest low 5, extreme 4",
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

function enterAtIndex(index: number): Strategy {
  return {
    name: `enter-at-${index}`,
    decide: (ctx) => (ctx.index === index ? { direction: "long", reason: "test entry" } : null),
  };
}

test("structure is visible in the decisions log", () => {
  clock = Date.UTC(2021, 0, 4, 0, 0, 0);
  const series = bars(RANGE_SERIES);

  const result = runBacktest({ instrument: "GBPUSD", bars: series }, CFG, {
    strategy: enterAtIndex(11),
  });
  const entry = result.decisions.find((d) => d.action === "enter");

  assert.ok(entry, "the strategy entered");
  assert.deepEqual(entry.structure, {
    range: { high: 12.5, low: 4, equilibrium: 8.25 },
    position: "premium",
    dol: { shortTerm: 5, longTerm: 4 },
  });
});
