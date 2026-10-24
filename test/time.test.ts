import { test } from "node:test";
import assert from "node:assert/strict";

import { DateTime } from "luxon";

import { bucketStart } from "../src/candles.js";
import {
  DEFAULT_SESSION_CONFIG,
  MS_PER_DAY,
  MS_PER_MINUTE,
  dayKey,
  localHour,
  minutesOfDay,
  monthStart,
  sessionDayStart,
  sessionWindowStart,
  weekStart,
  weekdayOf,
} from "../src/time.js";
import type { SessionConfig, StrategyConfig } from "../src/types.js";

/**
 * The slow definitions the fast paths must reproduce exactly: every helper below is what the
 * engine did per call before ticket 16, written out as the reference. The sampled assertions
 * walk real instants — including both DST transition weekends and 25 years of random draws — so
 * the memoized offset tables can never quietly diverge from Luxon.
 */

const tz = "America/New_York";
const session: SessionConfig = DEFAULT_SESSION_CONFIG;

function config(): StrategyConfig {
  return {
    instrument: "GBPUSD",
    session,
    strategy: { stopDistance: 0.001 },
    risk: { rMultiple: 3, maxTradesPerDay: 1, riskPerTradePct: 0.01 },
    costs: { spread: 0, commission: 0, slippage: 0 },
    initialEquity: 10000,
  };
}

function refSessionDayStart(ms: number): number {
  const dt = DateTime.fromMillis(ms, { zone: tz });
  let boundary = dt.startOf("day").set({
    hour: session.dayBoundary.hour,
    minute: session.dayBoundary.minute,
    second: 0,
    millisecond: 0,
  });
  if (boundary.toMillis() > ms) boundary = boundary.minus({ days: 1 });
  return boundary.toMillis();
}

function refWeekStart(ms: number): number {
  let start = refSessionDayStart(ms);
  for (let i = 0; i < 7; i++) {
    if (DateTime.fromMillis(start, { zone: tz }).weekday === 7) break;
    start = refSessionDayStart(start - MS_PER_DAY);
  }
  return start;
}

function refMonthStart(ms: number): number {
  const dt = DateTime.fromMillis(ms, { zone: tz });
  const start = dt.startOf("month").set({
    hour: session.dayBoundary.hour,
    minute: session.dayBoundary.minute,
    second: 0,
    millisecond: 0,
  });
  return start.toMillis() > ms ? start.minus({ months: 1 }).toMillis() : start.toMillis();
}

function refSessionWindowStart(ms: number, name: "asia" | "london" | "newYork"): number {
  const [hours, minutes] = session.sessions[name].start.split(":").map((part) => Number(part));
  const start = hours! * 60 + minutes!;
  const boundary = session.dayBoundary.hour * 60 + session.dayBoundary.minute;
  const boundaryDay = DateTime.fromMillis(refSessionDayStart(ms), { zone: tz });
  const date = start >= boundary ? boundaryDay : boundaryDay.plus({ days: 1 });
  return date
    .startOf("day")
    .set({ hour: Math.floor(start / 60), minute: start % 60, second: 0, millisecond: 0 })
    .toMillis();
}

/** The pre-ticket-16 sub-day bucket: wall-clock arithmetic through Luxon. */
function refSubDayBucketStart(ms: number, timeframe: "M15" | "H4"): number {
  const boundaryMinutes = session.dayBoundary.hour * 60 + session.dayBoundary.minute;
  const durationMinutes = timeframe === "M15" ? 15 : 240;
  const dt = DateTime.fromMillis(ms, { zone: tz });
  const localMinutes = dt.hour * 60 + dt.minute;
  const sinceBoundary = (localMinutes - boundaryMinutes + 24 * 60) % (24 * 60);
  const bucketMinutes = boundaryMinutes + Math.floor(sinceBoundary / durationMinutes) * durationMinutes;
  const dayStart = DateTime.fromMillis(refSessionDayStart(ms), { zone: tz });
  const wraps = bucketMinutes >= 24 * 60;
  const local = wraps ? bucketMinutes - 24 * 60 : bucketMinutes;
  return dayStart
    .set({ hour: Math.floor(local / 60), minute: local % 60, second: 0, millisecond: 0 })
    .plus({ days: wraps ? 1 : 0 })
    .toMillis();
}

function check(ms: number, cfg: StrategyConfig): void {
  const when = DateTime.fromMillis(ms, { zone: "utc" }).toISO() ?? String(ms);
  assert.equal(minutesOfDay(ms, session), DateTime.fromMillis(ms, { zone: tz }).hour * 60 + DateTime.fromMillis(ms, { zone: tz }).minute, `minutesOfDay at ${when}`);
  assert.equal(localHour(ms, tz), DateTime.fromMillis(ms, { zone: tz }).hour, `localHour at ${when}`);
  assert.equal(dayKey(ms, session), DateTime.fromMillis(ms, { zone: tz }).toFormat("yyyy-MM-dd"), `dayKey at ${when}`);
  assert.equal(sessionDayStart(ms, session), refSessionDayStart(ms), `sessionDayStart at ${when}`);
  assert.equal(weekStart(ms, session), refWeekStart(ms), `weekStart at ${when}`);
  assert.equal(monthStart(ms, session), refMonthStart(ms), `monthStart at ${when}`);
  assert.equal(weekdayOf(ms, session), DateTime.fromMillis(refSessionDayStart(ms), { zone: tz }).weekday, `weekdayOf at ${when}`);
  for (const name of ["asia", "london", "newYork"] as const) {
    assert.equal(sessionWindowStart(ms, name, session), refSessionWindowStart(ms, name), `${name} window at ${when}`);
  }
  assert.equal(bucketStart(ms, "M15", cfg), refSubDayBucketStart(ms, "M15"), `M15 bucket at ${when}`);
  assert.equal(bucketStart(ms, "H4", cfg), refSubDayBucketStart(ms, "H4"), `H4 bucket at ${when}`);
  assert.equal(bucketStart(ms, "D1", cfg), refSessionDayStart(ms), `D1 bucket at ${when}`);
  assert.equal(bucketStart(ms, "W1", cfg), refWeekStart(ms), `W1 bucket at ${when}`);
  assert.equal(bucketStart(ms, "MN1", cfg), refMonthStart(ms), `MN1 bucket at ${when}`);
}

test("every time helper matches its Luxon reference through both DST transitions", () => {
  const cfg = config();
  // 2021-03-14 (spring forward) and 2021-11-07 (fall back), ±36 hours, every 15 minutes.
  for (const anchor of [Date.UTC(2021, 2, 14), Date.UTC(2021, 10, 7)]) {
    for (let minute = -36 * 60; minute <= 36 * 60; minute += 15) {
      check(anchor + minute * MS_PER_MINUTE, cfg);
    }
  }
});

test("every time helper matches its Luxon reference on random instants across 25 years", () => {
  const cfg = config();
  // A seeded LCG, so a failure is reproducible from its index.
  let state = 0x2f6e2b1;
  const next = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const from = Date.UTC(2000, 0, 1);
  const span = Date.UTC(2025, 0, 1) - from;

  for (let i = 0; i < 400; i++) {
    check(Math.floor(from + next() * span), cfg);
  }
});
