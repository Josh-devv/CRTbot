import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import { runBacktest } from "../src/backtest.js";
import type { Bar, BarSeries, StrategyConfig } from "../src/types.js";

function bar(time: number, o: number, h: number, l: number, c: number): Bar {
  return { time, open: o, high: h, low: l, close: c };
}

const T0 = Date.UTC(2021, 0, 4, 0, 0, 0); // Mon 2021-01-04 00:00 UTC
const M15 = 15 * 60 * 1000;

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
    sessionTz: "America/New_York",
    strategy: { stopDistance: 0.001 },
    risk: { rMultiple: 3, maxTradesPerDay: 1, riskPerTradePct: 0.01 },
    costs: { spread: 0, commission: 0, slippage: 0 },
    initialEquity: 10000,
  };
}

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

  const changed = baseConfig();
  changed.risk = { ...changed.risk, riskPerTradePct: 0.02 };
  assert.notEqual(
    a.configHash,
    runBacktest(risingSeries(), changed).configHash,
    "hash tracks the config",
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
