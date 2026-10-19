import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import { runBacktest } from "../src/backtest.js";
import type { Strategy } from "../src/strategy.js";
import { DEFAULT_SESSION_CONFIG, dayKey, sessionDayStart } from "../src/time.js";
import type { Bar, BarSeries, StrategyConfig } from "../src/types.js";

function bar(time: number, o: number, h: number, l: number, c: number): Bar {
  return { time, open: o, high: h, low: l, close: c };
}

const T0 = Date.UTC(2021, 0, 4, 0, 0, 0); // Mon 2021-01-04 00:00 UTC
const M15 = 15 * 60 * 1000;
const DAY = 86_400_000;

function approx(actual: number, expected: number, message?: string, eps = 1e-9): void {
  assert.ok(
    Math.abs(actual - expected) < eps,
    `${message ?? "expected approx"}: got ${actual}, expected ${expected}`,
  );
}

function risingSeries(): BarSeries {
  return {
    instrument: "GBPUSD",
    bars: [
      bar(T0, 1.1995, 1.2005, 1.199, 1.2),
      bar(T0 + M15, 1.2, 1.201, 1.1998, 1.2005),
      bar(T0 + 2 * M15, 1.2005, 1.204, 1.2, 1.2035),
    ],
  };
}

function baseConfig(): StrategyConfig {
  return {
    instrument: "GBPUSD",
    session: DEFAULT_SESSION_CONFIG,
    strategy: { stopDistance: 0.001 },
    risk: { rMultiple: 3, maxTradesPerDay: 1, riskPerTradePct: 0.01 },
    costs: { spread: 0, commission: 0, slippage: 0 },
    initialEquity: 10000,
  };
}

/** The session day a time falls in, usable as a key. */
function sessionDayOf(time: number): number {
  return sessionDayStart(time, DEFAULT_SESSION_CONFIG);
}

function sameDay(a: number, b: number): boolean {
  return sessionDayOf(a) === sessionDayOf(b);
}

/** Four bars per session day, rising bar by bar, so each day's long reaches its target. */
function risingDayBars(days: number): BarSeries {
  const bars: Bar[] = [];
  for (let d = 0; d < days; d++) {
    for (let m = 0; m < 4; m++) {
      const base = 1.2 + (d * 4 + m) * 0.002;
      bars.push(bar(T0 + d * DAY + m * M15, base, base + 0.0015, base - 0.0015, base + 0.001));
    }
  }
  return { instrument: "GBPUSD", bars };
}

test("a news day stands down and takes no trade", () => {
  const series = risingDayBars(3);
  const control = runBacktest(series, baseConfig());
  const trigger = control.decisions.find((d) => d.action === "enter");
  assert.ok(trigger !== undefined, "the fixture enters on a day it is allowed to trade");

  const newsCfg = baseConfig();
  newsCfg.session = {
    ...DEFAULT_SESSION_CONFIG,
    newsDays: [dayKey(trigger.time, DEFAULT_SESSION_CONFIG)],
  };
  const news = runBacktest(series, newsCfg);

  const skipped = news.decisions.filter((d) => d.action === "stand-down");
  assert.equal(skipped.length, 1, "the skip is recorded once for the day");
  assert.ok(sameDay(skipped[0]!.time, trigger.time), "on the day the trade would have come from");
  assert.match(skipped[0]!.reason, /news day/);
  assert.equal(skipped[0]!.newsDay, true, "the day is flagged in the log");

  assert.ok(
    !news.decisions.some((d) => d.action === "enter" && sameDay(d.time, trigger.time)),
    "and no trade is taken on it",
  );
  assert.ok(
    news.decisions.some((d) => d.action === "enter" && !sameDay(d.time, trigger.time)),
    "while the other days still trade",
  );

  const overridden = runBacktest(series, { ...newsCfg, news: { standDown: false } });
  assert.ok(
    !overridden.decisions.some((d) => d.action === "stand-down"),
    "the override trades through the news day",
  );
  assert.deepEqual(overridden.trades, control.trades, "and matches the unconfigured run");
});

test("an exception protocol skips the day without asking the strategy", () => {
  const series = risingDayBars(8);
  const overridden = runBacktest(series, {
    ...baseConfig(),
    exceptions: { fourDay: false, weeklyProfile: false, asianRange: false },
  });
  const enforced = runBacktest(series, baseConfig());

  const skipped = enforced.decisions.filter((d) => d.action === "stand-down");
  assert.ok(skipped.length >= 3, "the protocols stand days down");
  assert.match(skipped[0]!.reason, /four-day protocol: four consecutive days up/);
  assert.ok(skipped[0]!.exceptions!.includes("four-day"), "the reason names the protocol");

  const skippedDays = new Set(skipped.map((d) => sessionDayOf(d.time)));
  assert.equal(skippedDays.size, skipped.length, "the skip is recorded once per day");

  for (const decision of enforced.decisions) {
    if (decision.action !== "enter") continue;
    assert.ok(
      !skippedDays.has(sessionDayOf(decision.time)),
      "no trade on a day that stood down",
    );
  }

  assert.ok(enforced.trades.length < overridden.trades.length, "the protocols cost trades");
  assert.ok(
    overridden.decisions.some(
      (d) => d.action === "enter" && skippedDays.has(sessionDayOf(d.time)),
    ),
    "and the override takes exactly the entries they skipped",
  );
});

test("a setup resting overnight cannot fill on a stand-down day", () => {
  // Day 1 dips into the limit armed on day 0, which would fill before the day expired it.
  const series: BarSeries = {
    instrument: "GBPUSD",
    bars: [
      bar(T0, 1.202, 1.203, 1.2015, 1.2025),
      bar(T0 + M15, 1.2025, 1.203, 1.201, 1.202),
      bar(T0 + DAY, 1.2015, 1.202, 1.1995, 1.2),
    ],
  };

  /** Arms one resting limit on the first bar it is asked about, then says nothing. */
  function arming(): Strategy {
    let armed = false;
    return {
      name: "test-arming",
      decide() {
        if (armed) return null;
        armed = true;
        return { direction: "long", entry: 1.2, stop: 1.199, reason: "test: resting limit" };
      },
    };
  }

  const control = runBacktest(series, baseConfig(), { strategy: arming() });
  const filled = control.decisions.filter((d) => d.action === "enter");
  assert.equal(filled.length, 1, "the limit rests overnight and fills on the next day");
  assert.equal(filled[0]!.time, T0 + DAY, "on the next day's first bar");

  const newsCfg = baseConfig();
  newsCfg.session = {
    ...DEFAULT_SESSION_CONFIG,
    newsDays: [dayKey(T0 + DAY, DEFAULT_SESSION_CONFIG)],
  };
  const news = runBacktest(series, newsCfg, { strategy: arming() });

  assert.ok(
    !news.decisions.some((d) => d.action === "enter"),
    "but a stand-down day fills nothing, whatever rested overnight",
  );
  assert.equal(news.trades.length, 0);
  assert.equal(news.decisions.filter((d) => d.action === "stand-down").length, 1);
});

test("an early Asian expansion stands the day down", () => {
  /** Two Asian-session bars a day (the session day starts 17:00 NY, Asia runs 18:00-02:00). */
  function asianDay(d: number, low: number, high: number, closesUp: boolean): Bar[] {
    const open = closesUp ? low + 0.0002 : high - 0.0002;
    const close = closesUp ? high - 0.0002 : low + 0.0002;
    return [
      bar(T0 + d * DAY, open, high, low, close),
      bar(T0 + d * DAY + M15, open, high, low, close),
    ];
  }

  // Five quiet Asian windows at 15 pips, then a sixth that opens 25 pips wide: two thirds more
  // than the average, so Asia has expanded early and London/New York tend to move against it.
  const bars: Bar[] = [
    ...asianDay(0, 1.2, 1.2015, true),
    ...asianDay(1, 1.2, 1.2015, false),
    ...asianDay(2, 1.2, 1.2015, true),
    ...asianDay(3, 1.2, 1.2015, false),
    ...asianDay(4, 1.2, 1.2015, true),
    ...asianDay(5, 1.2, 1.2025, true),
  ];
  const series: BarSeries = { instrument: "GBPUSD", bars };

  const enforced = runBacktest(series, baseConfig());
  const skipped = enforced.decisions.filter((d) => d.action === "stand-down");

  assert.equal(skipped.length, 1, "only the expanded day stands down");
  assert.equal(sessionDayOf(skipped[0]!.time), sessionDayOf(T0 + 5 * DAY));
  assert.match(skipped[0]!.reason, /asian-range protocol/);
  assert.equal(skipped[0]!.exceptions!.join(), "asian-range");
  assert.ok(
    !enforced.decisions.some(
      (d) => d.action === "enter" && sessionDayOf(d.time) === sessionDayOf(T0 + 5 * DAY),
    ),
    "and no trade is taken on it",
  );

  const overridden = runBacktest(series, {
    ...baseConfig(),
    exceptions: { fourDay: false, weeklyProfile: false, asianRange: false },
  });
  assert.ok(
    !overridden.decisions.some((d) => d.action === "stand-down"),
    "the override trades through the expanded day",
  );
});

test("runBacktest returns a well-formed result for a single long trade", () => {
  const result = runBacktest(risingSeries(), baseConfig());

  assert.equal(result.trades.length, 1, "one trade taken");
  const trade = result.trades[0]!;

  assert.equal(trade.direction, "long");
  approx(trade.entryPrice!, 1.2, "entry at the trigger bar close");
  approx(trade.stopPrice, 1.199, "stop is the fixed distance below entry");
  approx(trade.targetPrice, 1.203, "target is a fixed 3R above entry");
  approx(trade.exitPrice!, 1.203, "target was hit and filled");

  // 3R invariant, stated independently of the implementation.
  const reward = trade.targetPrice - trade.entryPrice;
  const risk = trade.entryPrice - trade.stopPrice;
  approx(reward, 3 * risk, "reward is exactly 3x risk");
  approx(trade.rMultiple!, 3, "a clean target hit returns 3R");

  assert.ok(result.equityCurve.length > 0, "equity curve is produced");
  assert.equal(result.stats.tradeCount, 1);
  assert.equal(result.stats.winRate, 1);
  assert.ok(result.decisions.length > 0, "a decisions log is produced");
  assert.ok(result.configHash.length > 0, "a config hash is recorded");
});

test("costs are applied per side (long pays the ask; commission reduces realised R)", () => {
  const cfg = baseConfig();
  cfg.costs = { spread: 0.0001, commission: 1, slippage: 0 };

  const result = runBacktest(risingSeries(), cfg);
  const trade = result.trades[0]!;

  approx(trade.entryPrice!, 1.20005, "long entry adds half the spread");
  approx(trade.exitPrice!, 1.203, "long exit subtracts half the spread");
  approx(trade.rMultiple!, 2.93, "spread and commission are charged on both sides");
});

test("identical input and config produce identical, hash-stable output", () => {
  const a = runBacktest(risingSeries(), baseConfig());
  const b = runBacktest(risingSeries(), baseConfig());

  assert.deepEqual(a, b, "runs are deterministic");
  assert.equal(a.configHash, b.configHash, "hash is stable");
  assert.ok(a.dataHash.length > 0, "a data hash is recorded");
  assert.equal(a.dataHash, b.dataHash, "the data hash is stable");

  const changed = baseConfig();
  changed.risk = { ...changed.risk, riskPerTradePct: 0.02 };
  assert.notEqual(
    a.configHash,
    runBacktest(risingSeries(), changed).configHash,
    "hash tracks the config",
  );

  const touched = risingSeries();
  touched.bars[0] = bar(T0, 1.1995, 1.2005, 1.199, 1.2);
  touched.bars[2] = bar(T0 + 2 * M15, 1.2005, 1.204, 1.2, 1.2036);
  assert.notEqual(
    a.dataHash,
    runBacktest(touched, baseConfig()).dataHash,
    "data hash tracks the bars",
  );
});

test("at most one trade is entered per day", () => {
  const day = 86_400_000;
  const bars: Bar[] = [];
  for (let d = 0; d < 3; d++) {
    for (let m = 0; m < 4; m++) {
      bars.push(bar(T0 + d * day + m * M15, 1.2, 1.204, 1.199, 1.2035));
    }
  }

  const result = runBacktest({ instrument: "GBPUSD", bars }, baseConfig());

  const entriesByDay = new Map<number, number>();
  for (const d of result.decisions.filter((x) => x.action === "enter")) {
    const key = Math.floor(d.time / day);
    entriesByDay.set(key, (entriesByDay.get(key) ?? 0) + 1);
  }

  for (const [, count] of entriesByDay) {
    assert.ok(count <= 1, "no more than one entry per day");
  }
  assert.ok(entriesByDay.size >= 2, "entry logic ran across multiple days");
});

test("the backtest CLI runs end to end and prints a report", () => {
  const run = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", "backtest"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /tradeCount/);
});
