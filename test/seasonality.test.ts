import { test } from "node:test";
import assert from "node:assert/strict";

import { runBacktest } from "../src/backtest.js";
import { axisSystem } from "../src/execution.js";
import { macroContext, quarterlyShift, seasonalTendency } from "../src/seasonality.js";
import { DEFAULT_SESSION_CONFIG, monthStart, sessionDayStart } from "../src/time.js";
import type { Bar, BarSeries, StrategyConfig } from "../src/types.js";

function baseConfig(overrides: Partial<StrategyConfig> = {}): StrategyConfig {
  return {
    instrument: "GBPUSD",
    session: DEFAULT_SESSION_CONFIG,
    strategy: { stopDistance: 0.001 },
    risk: { rMultiple: 3, maxTradesPerDay: 1, riskPerTradePct: 0.01 },
    costs: { spread: 0, commission: 0, slippage: 0 },
    initialEquity: 10000,
    ...overrides,
  };
}

/** A monthly candle from `open` to `close`: the high and low sit 0.002 beyond either end. */
function monthCandle(time: number, open: number, close: number): Bar {
  return {
    time,
    open,
    high: Math.max(open, close) + 0.002,
    low: Math.min(open, close) - 0.002,
    close,
  };
}

/** A monthly candle for that month, opening at 1.2 and closing `delta` away from it. */
function monthBar(year: number, month: number, delta: number): Bar {
  const time = monthStart(Date.UTC(year, month - 1, 15, 12), DEFAULT_SESSION_CONFIG);
  return monthCandle(time, 1.2, 1.2 + delta);
}

/**
 * 25 years of monthly history: every April closed up, every November down, every other month
 * alternating by year — the "known historical window" the seasonal read is judged against.
 */
function monthlyHistory(): Bar[] {
  const bars: Bar[] = [];
  for (let year = 1996; year <= 2020; year++) {
    for (let month = 1; month <= 12; month++) {
      const alternating = (year + month) % 2 === 0 ? 0.01 : -0.01;
      bars.push(monthBar(year, month, month === 4 ? 0.01 : month === 11 ? -0.01 : alternating));
    }
  }
  return bars;
}

test("a seasonal tendency is read from the calendar month's own history", () => {
  const months = monthlyHistory();

  const april = seasonalTendency(months, monthBar(2021, 4, 0).time, baseConfig());
  assert.equal(april.direction, "bullish", "every April in the history closed up");
  assert.match(april.reason, /25 of 25/, "and the reason says how much evidence it stands on");

  const november = seasonalTendency(months, monthBar(2021, 11, 0).time, baseConfig());
  assert.equal(november.direction, "bearish", "every November closed down");
  assert.match(november.reason, /0 of 25/);

  const march = seasonalTendency(months, monthBar(2021, 3, 0).time, baseConfig());
  assert.equal(march.direction, "none", "an even split is no tendency at all");
  assert.match(march.reason, /no tendency/);
});

test("a seasonal tendency needs enough history, and says so", () => {
  const months = monthlyHistory().filter((bar) => bar.time >= monthBar(2018, 1, 0).time);

  const april = seasonalTendency(months, monthBar(2021, 4, 0).time, baseConfig());
  assert.equal(april.direction, "none", "three years of history is not a tendency");
  assert.match(april.reason, /only 3/, "and the reason says how little it has");

  const patient = seasonalTendency(
    months,
    monthBar(2021, 4, 0).time,
    baseConfig({ macro: { enforce: false, minYears: 2 } }),
  );
  assert.equal(patient.direction, "bullish", "while three up Aprils read once the bar is lowered");
});

test("the share that counts as a tendency is configurable", () => {
  const months = monthlyHistory();

  // 12 of 25 Marches closed up, so the default bar calls it no tendency.
  const strict = seasonalTendency(months, monthBar(2021, 3, 0).time, baseConfig());
  assert.equal(strict.direction, "none");

  const loose = seasonalTendency(
    months,
    monthBar(2021, 3, 0).time,
    baseConfig({ macro: { enforce: false, bullishShare: 0.4 } }),
  );
  assert.equal(loose.direction, "bullish", "a lower bar lets a weak lean through");
});

/** Months from January 2020, each closing `delta` from its open, chained into one another. */
function monthChain(deltas: number[], startYear = 2020, startMonth = 1): Bar[] {
  const bars: Bar[] = [];
  let price = 1.2;
  deltas.forEach((delta, i) => {
    const close = price + delta;
    const monthIndex = startMonth - 1 + i;
    bars.push(
      monthCandle(
        monthStart(
          Date.UTC(startYear + Math.floor(monthIndex / 12), monthIndex % 12, 15, 12),
          DEFAULT_SESSION_CONFIG,
        ),
        price,
        close,
      ),
    );
    price = close;
  });
  return bars;
}

/** One quarter that delivers up 0.01: the months it is built from. */
const UP_QUARTER = [0.006, 0.002, 0.002];
/** And one that delivers down 0.01. */
const DOWN_QUARTER = [-0.006, -0.002, -0.002];
/** Two years and a month of trading, with the last completed quarter delivered by `q4`. */
function quarters2020(q4: number[]): Bar[] {
  return monthChain([...UP_QUARTER, ...UP_QUARTER, ...UP_QUARTER, ...q4, 0.001]);
}

test("the quarterly shift is the last completed quarter's delivery", () => {
  const up = quarterlyShift(quarters2020(UP_QUARTER), monthBar(2021, 2, 0).time, baseConfig());
  assert.equal(up.direction, "bullish", "the quarter that just completed closed up");
  assert.match(up.reason, /Q4 2020 closed up/, "and the reason names it");

  const down = quarterlyShift(quarters2020(DOWN_QUARTER), monthBar(2021, 2, 0).time, baseConfig());
  assert.equal(down.direction, "bearish", "and a quarter that closed down reads down");
  assert.match(down.reason, /Q4 2020 closed down/);
});

test("a quarter that has not finished, or went nowhere, gives no shift", () => {
  const incomplete = quarters2020(UP_QUARTER).slice(0, 11); // October and November only
  const unfinished = quarterlyShift(incomplete, monthBar(2021, 2, 0).time, baseConfig());
  assert.equal(unfinished.direction, "none", "the last quarter is not all there");
  assert.match(unfinished.reason, /not complete/);

  // The deltas are dyadic so the three add up to exactly nothing in binary floating point.
  const flat = quarterlyShift(
    quarters2020([0.001953125, -0.0009765625, -0.0009765625]),
    monthBar(2021, 2, 0).time,
    baseConfig(),
  );
  assert.equal(flat.direction, "none", "a quarter that closed where it opened delivered nothing");
  assert.match(flat.reason, /closed flat/);
});

/** The 25-year history, carried on to a first quarter of 2021 delivered by `q1`. */
function historyInto2021(q1: number[]): Bar[] {
  const throughSeptember = monthlyHistory().filter((bar) => bar.time < monthBar(2020, 10, 0).time);
  return [
    ...throughSeptember,
    ...monthChain(UP_QUARTER, 2020, 10),
    ...monthChain(q1, 2021, 1),
  ];
}

test("the macro context is only read when the quarter and the season agree", () => {
  const april = monthBar(2021, 4, 0).time;

  const agree = macroContext(historyInto2021(UP_QUARTER), april, baseConfig());
  assert.equal(agree.direction, "bullish", "a quarter that closed up, in a month that rises");
  assert.equal(agree.seasonal.direction, "bullish", "and both reads are published");
  assert.equal(agree.quarterly.direction, "bullish");

  const disagree = macroContext(historyInto2021(DOWN_QUARTER), april, baseConfig());
  assert.equal(disagree.direction, "none", "a quarter pointing the other way dumps the hypothesis");
  assert.match(disagree.reason, /disagree/);
  assert.equal(disagree.seasonal.direction, "bullish", "while both reads still say what they saw");
  assert.equal(disagree.quarterly.direction, "bearish");
  assert.match(disagree.quarterly.reason, /Q1 2021 closed down/);

  const noSeason = macroContext(
    monthChain([...UP_QUARTER], 2021, 1),
    april,
    baseConfig(),
  );
  assert.equal(noSeason.direction, "none", "and so does a month with no history behind it");
  assert.equal(noSeason.seasonal.direction, "none");
  assert.equal(noSeason.quarterly.direction, "bullish", "however clear the quarter itself is");
  assert.match(noSeason.reason, /history/);
});

/** 2021-04-05 07:00 UTC = 03:00 America/New_York — inside the London killzone. */
const TRADING_DAY = Date.UTC(2021, 3, 5, 7, 0, 0);
const MIN = 60 * 1000;
/** Where the set-up's prices sit, so the trading day shares the monthly history's level. */
const SHIFT = -8.8;
/** The exception protocols are ticket 11's business; this fixture is about the macro read. */
const NO_PROTOCOLS = { fourDay: false, weeklyProfile: false, asianRange: false };

/** The crafted set-up the execution tests trade: a purge, an engulfing block, then the 3R run. */
const SET_UP: [number, number, number, number][] = [
  [10.0, 10.2, 9.6, 9.8],
  [9.8, 9.9, 9.0, 9.1],
  [9.1, 9.5, 9.2, 9.4],
  [9.4, 9.6, 9.3, 9.5],
  [9.5, 9.7, 8.8, 9.6],
  [9.6, 9.9, 9.3, 9.7],
  [9.8, 9.9, 9.2, 9.3],
  [9.5, 9.6, 8.7, 8.9],
  [9.6, 9.9, 9.55, 9.8],
  [9.8, 9.9, 9.5, 9.8],
  [9.8, 10.5, 9.8, 10.4],
  [10.4, 11.2, 10.4, 11.1],
  [11.1, 12.0, 11.0, 11.9],
];

/**
 * Three years of history (enough for a tendency at `minYears: 3`), a first quarter of 2021
 * delivered by `q1`, then one tradable April day. The reading itself is unit-tested against the
 * full 25 years; this fixture is about the wiring, and stays small because the harness re-reads
 * the whole prefix once per session day.
 */
function macroSeries(q1: number[]): BarSeries {
  const throughSeptember = monthlyHistory().filter(
    (bar) =>
      bar.time >= monthStart(Date.UTC(2018, 0, 15, 12), DEFAULT_SESSION_CONFIG) &&
      bar.time < monthBar(2020, 10, 0).time,
  );
  return {
    instrument: "GBPUSD",
    bars: [
      ...throughSeptember,
      ...monthChain(UP_QUARTER, 2020, 10),
      ...monthChain(q1, 2021, 1),
      ...SET_UP.map(([open, high, low, close], i) => ({
        time: TRADING_DAY + i * MIN,
        open: open + SHIFT,
        high: high + SHIFT,
        low: low + SHIFT,
        close: close + SHIFT,
      })),
    ],
  };
}

test("the macro read rides along in the log, and an enforced dump stands the day down", () => {
  const macro = { enforce: false, minYears: 3 };
  const agreeing = runBacktest(
    macroSeries(UP_QUARTER),
    baseConfig({ exceptions: NO_PROTOCOLS, macro }),
    { strategy: axisSystem() },
  );
  const entered = agreeing.decisions.filter((decision) => decision.action === "enter");
  assert.equal(entered.length, 1, "the crafted day trades while the quarter and the season agree");
  assert.equal(entered[0]!.macro?.direction, "bullish", "and the macro read is on the decision");
  assert.match(entered[0]!.macro?.reason ?? "", /Aprils closed up/);

  const disagreed = macroSeries(DOWN_QUARTER);
  const logged = runBacktest(disagreed, baseConfig({ exceptions: NO_PROTOCOLS, macro }), {
    strategy: axisSystem(),
  });
  const stillEntered = logged.decisions.filter((decision) => decision.action === "enter");
  assert.equal(stillEntered.length, 1, "a dumped hypothesis alone does not stop the day trading");
  assert.equal(
    stillEntered[0]!.macro?.direction,
    "none",
    "but the log shows there is no macro bias",
  );
  assert.match(stillEntered[0]!.macro?.reason ?? "", /disagree/);

  const enforced = runBacktest(
    disagreed,
    baseConfig({ exceptions: NO_PROTOCOLS, macro: { enforce: true, minYears: 3 } }),
    { strategy: axisSystem() },
  );
  assert.equal(enforced.trades.length, 0, "enforced, a day with no macro bias stands down");
  const skipped = enforced.decisions.filter(
    (decision) =>
      decision.action === "stand-down" &&
      sessionDayStart(decision.time, DEFAULT_SESSION_CONFIG) ===
        sessionDayStart(TRADING_DAY, DEFAULT_SESSION_CONFIG),
  );
  assert.equal(skipped.length, 1, "the skip is recorded once for the day");
  assert.match(skipped[0]!.reason, /no macro bias/);
});
