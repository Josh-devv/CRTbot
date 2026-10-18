import assert from "node:assert/strict";
import { test } from "node:test";

import { runBacktest } from "../src/backtest.js";
import { asianProfile, expansionTest, weekHasExpanded } from "../src/profiles.js";
import { DEFAULT_SESSION_CONFIG, sessionDayStart } from "../src/time.js";
import type { Bar, BarSeries, DayFacts, StrategyConfig } from "../src/types.js";

/** A session day that starts at 17:00 New York; January's 22:00 UTC is that boundary. */
function dayOf(isoDate: string): number {
  return sessionDayStart(Date.parse(`${isoDate}T22:00:00Z`), DEFAULT_SESSION_CONFIG);
}

function cfg(overrides: Partial<StrategyConfig> = {}): StrategyConfig {
  return {
    instrument: "GBPUSD",
    session: DEFAULT_SESSION_CONFIG,
    strategy: { stopDistance: 0.001 },
    risk: { rMultiple: 3, maxTradesPerDay: 1, riskPerTradePct: 0.01 },
    costs: { spread: 0, commission: 0, slippage: 0 },
    initialEquity: 10_000,
    ...overrides,
  };
}

/** Ratios come out of divisions of ranges, so they are rarely exact binary fractions. */
function closeTo(actual: number | null, expected: number, message?: string): void {
  assert.ok(
    actual !== null && Math.abs(actual - expected) < 1e-9,
    `${message ?? "expected approx"}: got ${actual}, expected ${expected}`,
  );
}

/** A completed session day with a flat body and the given full-day and Asian ranges. */
function completed(date: string, range: number, asiaRange: number): DayFacts {
  return {
    day: dayOf(date),
    open: 1.2,
    high: 1.2 + range,
    low: 1.2,
    close: 1.2 + range / 2,
    asia: { low: 1.2, high: 1.2 + asiaRange },
  };
}

/**
 * The week before the one in play: one wide day and four quiet ones, so its range (0.04) is
 * wider than the average daily range (0.0096) — enough for the week's expansion to be judged
 * separately from any single day's.
 */
const priorWeek = [
  completed("2020-12-27", 0.04, 0.0002),
  completed("2020-12-28", 0.002, 0.0002),
  completed("2020-12-29", 0.002, 0.0002),
  completed("2020-12-30", 0.002, 0.0002),
  completed("2020-12-31", 0.002, 0.0002),
];

/** A session day in the week in play, with the given full-day and, optionally, Asian range. */
function today(range: number, asiaRange?: number, date = "2021-01-04"): DayFacts {
  const base: DayFacts = {
    day: dayOf(date),
    open: 1.2,
    high: 1.2 + range,
    low: 1.2,
    close: 1.2 + range / 2,
  };
  return asiaRange === undefined ? base : { ...base, asia: { low: 1.2, high: 1.2 + asiaRange } };
}

test("the Asian profile measures Asia against its recent average", () => {
  const profile = asianProfile({
    completedDays: priorWeek,
    today: today(0.003, 0.0004),
    cfg: cfg(),
  });

  closeTo(profile.range, 0.0004, "today's Asian range");
  closeTo(profile.average, 0.0002, "the average of the five days behind it");
  closeTo(profile.ratio, 2, "twice the recent average");

  const noBaseline = asianProfile({ completedDays: [], today: today(0.003, 0.0004), cfg: cfg() });
  assert.equal(noBaseline.average, null, "no completed days is no average");
  assert.equal(noBaseline.ratio, null);

  const short = asianProfile({
    completedDays: priorWeek.slice(0, 4),
    today: today(0.003, 0.0004),
    cfg: cfg(),
  });
  assert.equal(short.average, null, "fewer than the lookback is no baseline");

  const notTraded = asianProfile({ completedDays: priorWeek, today: today(0.003), cfg: cfg() });
  assert.equal(notTraded.range, null, "a day whose Asia has not traded has no range");
  assert.equal(notTraded.ratio, null);

  const shortLookback = cfg({ expansionDay: { enforce: false, lookbackDays: 2 } });
  const quick = asianProfile({
    completedDays: priorWeek.slice(0, 2),
    today: today(0.003, 0.0004),
    cfg: shortLookback,
  });
  closeTo(quick.average, 0.0002, "and the lookback is configurable");
});

test("the weekly profile compares the week in play with the one before it", () => {
  assert.equal(
    weekHasExpanded({ completedDays: priorWeek, today: today(0.05), cfg: cfg() }),
    true,
    "a week as wide as the last one has expanded",
  );
  assert.equal(
    weekHasExpanded({ completedDays: priorWeek, today: today(0.003), cfg: cfg() }),
    false,
    "a narrower week has not",
  );
  assert.equal(
    weekHasExpanded({ completedDays: [], today: today(0.05), cfg: cfg() }),
    false,
    "with no prior week there is nothing to compare",
  );
});

test("a consolidated Asia expects London; an expanded Asia expects New York", () => {
  const london = expansionTest({
    completedDays: priorWeek,
    today: today(0.003, 0.0001),
    cfg: cfg(),
  });
  assert.equal(london.isExpansionDay, true, "a quiet Asia is an expansion day");
  assert.equal(london.session, "london");
  assert.match(london.reason, /Asia consolidated/);

  const newYork = expansionTest({
    completedDays: priorWeek,
    today: today(0.003, 0.0004),
    cfg: cfg(),
  });
  assert.equal(newYork.isExpansionDay, true, "so is an Asia that has already moved");
  assert.equal(newYork.session, "newYork");
  assert.match(newYork.reason, /already expanded/);
});

test("an Asia that reads neither way, or has not traded, is not an expansion day", () => {
  const between = expansionTest({
    completedDays: priorWeek,
    today: today(0.003, 0.00025),
    cfg: cfg(),
  });
  assert.equal(between.isExpansionDay, false, "an in-between Asia gives no lead");
  assert.equal(between.session, "neither");
  assert.match(between.reason, /neither consolidated nor expanded/);

  const before = expansionTest({ completedDays: priorWeek, today: today(0.003), cfg: cfg() });
  assert.equal(before.isExpansionDay, false, "and neither does an Asia still to trade");
  assert.match(before.reason, /not given a read/);
});

test("a week that has already delivered its expansion is not an expansion day", () => {
  // The Asian window is as quiet as it gets, which alone would favour London. Late in the week
  // (§8.2's Thursday–Friday window) the week's own expansion is the read that wins.
  const late = expansionTest({
    completedDays: priorWeek,
    today: today(0.05, 0.0001, "2021-01-07"),
    cfg: cfg(),
  });

  assert.equal(late.isExpansionDay, false, "the week's expansion is the read that wins");
  assert.equal(late.session, "neither");
  assert.match(late.reason, /week has already expanded/);

  const early = expansionTest({
    completedDays: priorWeek,
    today: today(0.05, 0.0001, "2021-01-05"),
    cfg: cfg(),
  });
  assert.equal(early.isExpansionDay, true, "early in the week the veto has had no say yet");
  assert.equal(early.session, "london");
  assert.match(early.reason, /Asia consolidated/);
});

test("the expansion thresholds are configurable", () => {
  const lenient = cfg({ expansionDay: { enforce: false, consolidationFactor: 1.3 } });
  // Asia at 1.25x its average — above the default consolidation bar, below the lenient one.
  const verdict = expansionTest({
    completedDays: priorWeek,
    today: today(0.003, 0.00025),
    cfg: lenient,
  });

  assert.equal(verdict.isExpansionDay, true, "a wider consolidation band still counts it as quiet");
  assert.equal(verdict.session, "london");
});

const HOUR = 3_600_000;
const DAY = 86_400_000;
/** 00:00 UTC Monday — inside the Asian window of the session day that starts Sunday 17:00 NY. */
const T0 = Date.UTC(2021, 0, 4, 0, 0, 0);

function bar(time: number, o: number, h: number, l: number, c: number): Bar {
  return { time, open: o, high: h, low: l, close: c };
}

function sessionDayOf(time: number): number {
  return sessionDayStart(time, DEFAULT_SESSION_CONFIG);
}

/**
 * One session day: an Asian bar whose range the caller sets, then two London bars that carry a
 * long armed at the Asian bar's close to its fixed 3R target the same day.
 */
function tradingDay(index: number, asiaHigh: number): Bar[] {
  const day = T0 + index * DAY;
  return [
    bar(day, 1.2, asiaHigh, 1.2, 1.2),
    bar(day + 7 * HOUR, 1.2, 1.2035, 1.1995, 1.203),
    bar(day + 8 * HOUR, 1.203, 1.204, 1.2025, 1.2035),
  ];
}

const NO_EXCEPTIONS = { fourDay: false, weeklyProfile: false, asianRange: false };

test("the expansion-day gate suppresses non-expansion days, and its verdict is in the log", () => {
  // Five 15-pip Asian windows set the baseline, then a 5-pip one (consolidated) and a 40-pip one
  // (already expanded). Every day would otherwise trade.
  const series: BarSeries = {
    instrument: "GBPUSD",
    bars: [
      ...tradingDay(0, 1.2015),
      ...tradingDay(1, 1.2015),
      ...tradingDay(2, 1.2015),
      ...tradingDay(3, 1.2015),
      ...tradingDay(4, 1.2015),
      ...tradingDay(5, 1.2005),
      ...tradingDay(6, 1.204),
    ],
  };

  const control = runBacktest(series, { ...cfg(), exceptions: NO_EXCEPTIONS });
  const gated = runBacktest(series, {
    ...cfg(),
    exceptions: NO_EXCEPTIONS,
    expansionDay: { enforce: true },
  });

  assert.equal(control.trades.length, 7, "every day trades when the gate is off");
  assert.equal(gated.trades.length, 2, "only the two expansion days trade with it on");

  const skipped = gated.decisions.filter((d) => d.action === "stand-down");
  assert.equal(skipped.length, 5, "the five non-expansion days are each skipped once");
  assert.ok(
    skipped.every((d) => d.expansionTest !== undefined),
    "the verdict rides every logged decision",
  );
  assert.ok(
    skipped.some((d) => /Asia has not given a read yet/.test(d.reason)),
    "and the reason for the skip is the expansion read",
  );

  const entries = gated.decisions.filter((d) => d.action === "enter");
  assert.deepEqual(
    entries.map((d) => sessionDayOf(d.time)),
    [sessionDayOf(T0 + 5 * DAY), sessionDayOf(T0 + 6 * DAY)],
    "the consolidated and expanded days are the ones that trade",
  );
  assert.equal(entries[0]!.expansionTest?.session, "london");
  assert.equal(entries[1]!.expansionTest?.session, "newYork");
});

test("the expansion-day verdict is logged even when nothing is enforced", () => {
  const series: BarSeries = { instrument: "GBPUSD", bars: tradingDay(0, 1.2015) };
  const control = runBacktest(series, { ...cfg(), exceptions: NO_EXCEPTIONS });
  const logged = runBacktest(series, {
    ...cfg(),
    exceptions: NO_EXCEPTIONS,
    expansionDay: { enforce: false },
  });

  assert.deepEqual(logged.trades, control.trades, "an unenforced verdict skips nothing");
  assert.ok(
    logged.decisions.length > 0 && logged.decisions.every((d) => d.expansionTest !== undefined),
    "but every decision still records it",
  );
});
