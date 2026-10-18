import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classifyRejection,
  findCrts,
  findPurges,
  isCrt,
  isPurge,
  liquidityEventAt,
} from "../src/liquidity.js";
import { findSignificantPoints } from "../src/structure.js";
import { runBacktest } from "../src/backtest.js";
import { DEFAULT_SESSION_CONFIG } from "../src/time.js";
import type { Strategy } from "../src/strategy.js";
import type { Bar, StrategyConfig } from "../src/types.js";

const BASE = Date.UTC(2021, 0, 4, 0, 0, 0);

/** Bars from [high, low] pairs; open = low, close = high. */
function bars(pairs: [number, number][]): Bar[] {
  return pairs.map(([high, low], i) => ({
    time: BASE + i * 60_000,
    open: low,
    high,
    low,
    close: high,
  }));
}

/** Arbitrary explicit OHLC bars. */
function ohlc(rows: [number, number, number, number][]): Bar[] {
  return rows.map(([open, high, low, close], i) => ({
    time: BASE + i * 60_000,
    open,
    high,
    low,
    close,
  }));
}

test("a purge is a wick through a level that closes back on the origin side", () => {
  const sweep = { time: BASE, open: 10, high: 11, low: 4, close: 10.5 };

  assert.equal(isPurge(sweep, 5, "low"), true, "wick below the low, body closes back above");
  assert.equal(isPurge(sweep, 3, "low"), false, "the wick never reached 3");
  assert.equal(
    isPurge({ time: BASE, open: 10, high: 11, low: 4, close: 4.5 }, 5, "low"),
    false,
    "closing below the level is not a purge — the level failed",
  );
  assert.equal(
    isPurge({ time: BASE, open: 10, high: 16, low: 9, close: 10.5 }, 15, "high"),
    true,
    "wick above the high, body closes back below",
  );
});

test("a CRT is a purge whose body then continues", () => {
  const bullish = { time: BASE, open: 6, high: 10, low: 4, close: 9 };
  assert.equal(isCrt(bullish, 5, "low"), true, "wick purges, body closes up");

  const noContinuation = { time: BASE, open: 9, high: 9.5, low: 4, close: 5.5 };
  assert.equal(
    isCrt(noContinuation, 5, "low"),
    false,
    "purged and reclaimed, but the body did not continue up",
  );

  const notAPurge = { time: BASE, open: 6, high: 10, low: 5.5, close: 9 };
  assert.equal(isCrt(notAPurge, 5, "low"), false, "no purge, so no CRT");
});

/**
 * Swings from the fixture below: significant lows @ 6 (i3), @ 5 (i5), @ 3 (i7);
 * significant highs @ 12 (i2), @ 12 (i4), @ 12 (i6).
 * The bar at i5 sweeps the 6 low.
 */
const PURGE_SERIES: [number, number][] = [
  [12, 10],
  [11, 7],
  [12, 9],
  [11, 6],
  [12, 8],
  [11, 5],
  [12, 9],
  [11, 3],
  [12, 7],
];

test("findPurges finds the bar that sweeps a significant low", () => {
  const series = bars(PURGE_SERIES);
  const points = findSignificantPoints(series, { swingWidth: 1 });

  const purges = findPurges(series, points);

  assert.deepEqual(
    purges.map((p) => [p.index, p.side, p.level, p.extreme]),
    [
      [5, "low", 6, 5],
      [7, "low", 6, 3],
      [7, "low", 5, 3],
    ],
  );
});

test("findCrts keeps only the purges whose body continues", () => {
  const series = bars(PURGE_SERIES);
  const points = findSignificantPoints(series, { swingWidth: 1 });

  const crts = findCrts(series, points);

  assert.deepEqual(
    crts.map((c) => c.index),
    [5, 7, 7],
    "every purge in this fixture has an up-closing body",
  );
});

test("a rejection before the relative DOL is a purge; at or after it is a CSD", () => {
  assert.equal(classifyRejection(5, 3, "low"), "purge", "stopped short of the 3 pool");
  assert.equal(classifyRejection(3, 3, "low"), "csd", "reached the 3 pool");
  assert.equal(classifyRejection(2, 3, "low"), "csd", "drove through the 3 pool");

  assert.equal(classifyRejection(16, 18, "high"), "purge", "stopped short of the 18 pool");
  assert.equal(classifyRejection(18, 18, "high"), "csd", "reached the 18 pool");
  assert.equal(classifyRejection(19, 18, "high"), "csd", "drove through the 18 pool");
});

test("liquidityEventAt labels a purge before the DOL and flags the CRT", () => {
  const series = bars(PURGE_SERIES);
  const points = findSignificantPoints(series, { swingWidth: 1 });

  assert.equal(
    liquidityEventAt(series[0]!, 0, points),
    null,
    "nothing has been swept at the first bar",
  );

  assert.deepEqual(liquidityEventAt(series[5]!, 5, points), {
    side: "low",
    level: 6,
    extreme: 5,
    isCrt: true,
    kind: "purge",
  }, "rejected at 5, short of the 3 pool → purge");
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

test("liquidity is visible in the decisions log", () => {
  const series = bars(PURGE_SERIES);
  const strategy: Strategy = {
    name: "enter-on-purge",
    decide: (ctx) => (ctx.index === 5 ? { direction: "long", reason: "test entry" } : null),
  };

  const result = runBacktest({ instrument: "GBPUSD", bars: series }, CFG, { strategy });
  const entry = result.decisions.find((d) => d.action === "enter");

  assert.ok(entry, "the strategy entered");
  assert.deepEqual(entry.liquidity, {
    side: "low",
    level: 6,
    extreme: 5,
    isCrt: true,
    kind: "purge",
  });
});

test("a bar without a sweep carries no liquidity event", () => {
  const series = ohlc([
    [10, 11, 9, 10.5],
    [10, 11.5, 9.5, 11],
  ]);
  const points = findSignificantPoints(series, { swingWidth: 1 });

  assert.equal(liquidityEventAt(series[1]!, 1, points), null);
});
