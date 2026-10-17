import { test } from "node:test";
import assert from "node:assert/strict";

import { aggregate, bucketStart } from "../src/candles.js";
import { DEFAULT_SESSION_CONFIG } from "../src/time.js";
import { isNewsDay, killzoneOf, localHour, sessionOf } from "../src/time.js";
import { runBacktest } from "../src/backtest.js";
import type { Bar, SessionConfig, StrategyConfig } from "../src/types.js";

const tz = "America/New_York";

function approx(actual: number, expected: number, message?: string, eps = 1e-9): void {
  assert.ok(
    Math.abs(actual - expected) < eps,
    `${message ?? "expected approx"}: got ${actual}, expected ${expected}`,
  );
}

function config(session: SessionConfig = DEFAULT_SESSION_CONFIG): StrategyConfig {
  return {
    instrument: "GBPUSD",
    session,
    strategy: { stopDistance: 0.001 },
    risk: { rMultiple: 3, maxTradesPerDay: 1, riskPerTradePct: 0.01 },
    costs: { spread: 0, commission: 0, slippage: 0 },
    initialEquity: 10000,
  };
}

test("M1 bars aggregate into an M15 candle at the session-aligned boundary", () => {
  // 2021-01-04 17:00 America/New_York (EST) === 22:00 UTC, a valid M15 bucket start.
  const start = Date.UTC(2021, 0, 4, 22, 0, 0);
  const bars: Bar[] = [];
  for (let i = 0; i < 15; i++) {
    bars.push({
      time: start + i * 60_000,
      open: 1.2,
      high: 1.2005 + (i === 7 ? 0.001 : 0),
      low: 1.1995 - (i === 3 ? 0.001 : 0),
      close: 1.2001,
    });
  }

  const candles = aggregate(bars, "M15", config());

  assert.equal(candles.length, 1, "one M15 candle from fifteen M1 bars");
  const c = candles[0]!;
  assert.equal(c.time, start, "candle is stamped at its bucket start");
  approx(c.open, 1.2, "open is the first bar's open");
  approx(c.close, 1.2001, "close is the last bar's close");
  approx(c.high, 1.2015, "high is the maximum across the bucket");
  approx(c.low, 1.1985, "low is the minimum across the bucket");
});

test("D1 candles are cut at the configured day boundary (17:00 New York)", () => {
  const beforeBoundary = Date.UTC(2021, 0, 4, 21, 59, 0); // 16:59 NY
  const atBoundary = Date.UTC(2021, 0, 4, 22, 0, 0); // 17:00 NY
  const bars: Bar[] = [
    { time: beforeBoundary, open: 1.2, high: 1.201, low: 1.199, close: 1.2005 },
    { time: atBoundary, open: 1.2005, high: 1.202, low: 1.2, close: 1.2015 },
  ];

  const candles = aggregate(bars, "D1", config());

  assert.equal(candles.length, 2, "the two bars fall in different trading days");
  assert.equal(candles[0]!.time, Date.UTC(2021, 0, 3, 22, 0, 0), "day starting 17:00 NY on Jan 3");
  assert.equal(candles[1]!.time, Date.UTC(2021, 0, 4, 22, 0, 0), "day starting 17:00 NY on Jan 4");
});

test("timezone rendering is DST-correct across both US transitions", () => {
  const winter = Date.UTC(2021, 0, 4, 13, 0, 0); // EST (UTC-5) -> 08:00
  const summer = Date.UTC(2021, 6, 5, 12, 0, 0); // EDT (UTC-4) -> 08:00

  assert.equal(localHour(winter, tz), 8, "winter 13:00Z is 08:00 New York");
  assert.equal(localHour(summer, tz), 8, "summer 12:00Z is 08:00 New York");

  assert.equal(sessionOf(winter, config().session), "newYork");
  assert.equal(sessionOf(summer, config().session), "newYork");
});

test("killzone labels are derived from the configured windows", () => {
  const session = DEFAULT_SESSION_CONFIG;
  assert.equal(killzoneOf(Date.UTC(2021, 0, 4, 8, 0, 0), session), "london", "03:00 NY is the London killzone");
  assert.equal(killzoneOf(Date.UTC(2021, 0, 4, 14, 0, 0), session), "newYork", "09:00 NY is the New York killzone");
  assert.equal(killzoneOf(Date.UTC(2021, 0, 4, 18, 0, 0), session), null, "13:00 NY is outside both killzones");
});

test("news days are recognised from the configured list", () => {
  const session: SessionConfig = { ...DEFAULT_SESSION_CONFIG, newsDays: ["2021-01-06"] };
  assert.equal(isNewsDay(Date.UTC(2021, 0, 6, 14, 0, 0), session), true, "configured news date matches");
  assert.equal(isNewsDay(Date.UTC(2021, 0, 7, 14, 0, 0), session), false, "other dates do not match");
});

test("H4 buckets align to the day boundary, yielding 01:00/05:00/09:00 New York", () => {
  const at0110 = Date.UTC(2021, 0, 5, 6, 10, 0); // 01:10 NY (EST)
  assert.equal(bucketStart(at0110, "H4", config()), Date.UTC(2021, 0, 5, 6, 0, 0), "01:10 NY -> 01:00 bucket");
});

test("killzones are config-driven, not hard-coded", () => {
  const session: SessionConfig = {
    ...DEFAULT_SESSION_CONFIG,
    killzones: { london: { start: "02:00", end: "05:00" }, newYork: { start: "12:00", end: "14:00" } },
  };
  // 13:00 NY is outside the default New York killzone but inside the reconfigured one.
  assert.equal(killzoneOf(Date.UTC(2021, 0, 4, 18, 0, 0), session), "newYork");
});

test("session and killzone are visible in the decisions log", () => {
  // A series whose first bar is 02:00 New York -> a fresh day inside the London killzone.
  const start = Date.UTC(2021, 0, 4, 7, 0, 0);
  const bars: Bar[] = [
    { time: start, open: 1.2, high: 1.2005, low: 1.1995, close: 1.2 },
    { time: start + 60_000, open: 1.2, high: 1.206, low: 1.1999, close: 1.205 },
  ];

  const result = runBacktest({ instrument: "GBPUSD", bars }, config());

  const entry = result.decisions.find((d) => d.action === "enter");
  assert.ok(entry, "an entry decision was logged");
  assert.equal(entry.session, "london");
  assert.equal(entry.killzone, "london");
});

test("killzone labels are DST-correct in summer as well as winter", () => {
  const session = DEFAULT_SESSION_CONFIG;
  assert.equal(killzoneOf(Date.UTC(2021, 6, 5, 6, 0, 0), session), "london", "02:00 EDT is the London killzone");
  assert.equal(killzoneOf(Date.UTC(2021, 6, 5, 12, 0, 0), session), "newYork", "08:00 EDT is the New York killzone");
});

test("H4 buckets stay on local clock time through the spring-forward transition", () => {
  const cfg = config();
  // 2021-03-14: 02:00 EST jumps forward to 03:00 EDT.
  assert.equal(
    bucketStart(Date.UTC(2021, 2, 14, 6, 30, 0), "H4", cfg),
    Date.UTC(2021, 2, 14, 6, 0, 0),
    "01:30 EST lands in the 01:00 local bucket",
  );
  assert.equal(
    bucketStart(Date.UTC(2021, 2, 14, 9, 30, 0), "H4", cfg),
    Date.UTC(2021, 2, 14, 9, 0, 0),
    "05:30 EDT lands in the 05:00 local bucket",
  );
});

test("W1 and MN1 buckets are session-anchored", () => {
  const cfg = config();
  assert.equal(
    bucketStart(Date.UTC(2021, 0, 6, 15, 0, 0), "W1", cfg),
    Date.UTC(2021, 0, 3, 22, 0, 0),
    "a midweek bar belongs to the Sunday 17:00 NY week",
  );
  assert.equal(
    bucketStart(Date.UTC(2021, 0, 10, 22, 0, 0), "W1", cfg),
    Date.UTC(2021, 0, 10, 22, 0, 0),
    "the next Sunday 17:00 NY starts a new week",
  );
  assert.equal(
    bucketStart(Date.UTC(2021, 0, 15, 12, 0, 0), "MN1", cfg),
    Date.UTC(2021, 0, 1, 22, 0, 0),
    "a mid-month bar belongs to the month's start at 17:00 NY",
  );
  assert.equal(
    bucketStart(Date.UTC(2021, 0, 1, 10, 0, 0), "MN1", cfg),
    Date.UTC(2020, 11, 1, 22, 0, 0),
    "before the Jan 1 boundary belongs to December",
  );
});

test("the execution candle is visible in the decisions log", () => {
  const start = Date.UTC(2021, 0, 4, 7, 0, 0); // 02:00 NY
  const bars: Bar[] = [
    { time: start, open: 1.2, high: 1.2005, low: 1.1995, close: 1.2 },
    { time: start + 60_000, open: 1.2, high: 1.206, low: 1.1999, close: 1.205 },
  ];

  const result = runBacktest({ instrument: "GBPUSD", bars }, config());
  const entry = result.decisions.find((d) => d.action === "enter");

  assert.deepEqual(
    entry?.candle,
    { timeframe: "M15", time: Date.UTC(2021, 0, 4, 7, 0, 0) },
    "the M15 candle is logged with the decision",
  );
});
