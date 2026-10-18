import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runBacktest } from "../src/backtest.js";
import { buildReport, costSensitivity, parseReport, serializeReport } from "../src/report.js";
import { DEFAULT_SESSION_CONFIG } from "../src/time.js";
import type { Bar, BarSeries, Instrument, StrategyConfig } from "../src/types.js";

function bar(time: number, o: number, h: number, l: number, c: number): Bar {
  return { time, open: o, high: h, low: l, close: c };
}

function approx(actual: number, expected: number, message?: string, eps = 1e-9): void {
  assert.ok(
    Math.abs(actual - expected) < eps,
    `${message ?? "expected approx"}: got ${actual}, expected ${expected}`,
  );
}

const T0 = Date.UTC(2021, 0, 4, 0, 0, 0); // Mon 2021-01-04 00:00 UTC — a Sunday session day
const M15 = 15 * 60 * 1000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** 07:00 UTC is 02:00 New York: London's session and its killzone. */
const LONDON = 7;
/** 13:00 UTC is 08:00 New York: New York's session and its killzone. */
const NEW_YORK = 13;

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

/** Four bars per session day, rising bar by bar, so each day's long reaches its target. */
function risingDayBars(days: number, instrument: Instrument = "GBPUSD"): BarSeries {
  const bars: Bar[] = [];
  for (let d = 0; d < days; d++) {
    for (let m = 0; m < 4; m++) {
      const base = 1.2 + (d * 4 + m) * 0.002;
      bars.push(bar(T0 + d * DAY + m * M15, base, base + 0.0015, base - 0.0015, base + 0.001));
    }
  }
  return { instrument, bars };
}

test("a report carries the headline statistics of the run it was built from", () => {
  const series = risingDayBars(3);
  const result = runBacktest(series, baseConfig());
  const report = buildReport({
    runs: [{ instrument: series.instrument, bars: series.bars.length, result }],
    session: DEFAULT_SESSION_CONFIG,
  });

  assert.equal(report.stats.tradeCount, 3, "one trade a day for three days");
  assert.equal(report.stats.winRate, 1, "every trade reached its target");
  approx(report.stats.avgR, 3, "a clean target hit returns 3R");
  approx(report.stats.expectancyR, 3, "expectancy is the same per trade here");
  assert.equal(report.stats.maxDrawdown, 0, "a run of straight wins never dips");
  assert.equal(report.stats.profitFactor, Infinity, "there are no losses to divide by");
});

/** One day's worth of bars starting at a given UTC hour, rising bar by bar as above. */
function barsAt(hours: number[], instrument: Instrument = "GBPUSD"): BarSeries {
  const bars: Bar[] = [];
  hours.forEach((hour, d) => {
    for (let m = 0; m < 4; m++) {
      const base = 1.2 + (d * 4 + m) * 0.002;
      bars.push(
        bar(T0 + d * DAY + hour * HOUR + m * M15, base, base + 0.0015, base - 0.0015, base + 0.001),
      );
    }
  });
  return { instrument, bars };
}

/** No protocols: six rising session days would otherwise trip the four-day run. */
const NO_PROTOCOLS = { fourDay: false, weeklyProfile: false, asianRange: false };

test("the report breaks the trades down by session, weekday and instrument", () => {
  const pound = barsAt([LONDON, NEW_YORK, LONDON, NEW_YORK, LONDON, NEW_YORK]);
  const euro = barsAt([LONDON, NEW_YORK], "EURUSD");
  const cfg = baseConfig({ exceptions: NO_PROTOCOLS });

  const poundResult = runBacktest(pound, cfg);
  const euroResult = runBacktest(euro, { ...cfg, instrument: "EURUSD" });
  assert.equal(poundResult.trades.length, 6, "the fixture trades every session day");
  assert.equal(euroResult.trades.length, 2);

  const report = buildReport({
    runs: [
      { instrument: "GBPUSD", bars: pound.bars.length, result: poundResult },
      { instrument: "EURUSD", bars: euro.bars.length, result: euroResult },
    ],
    session: DEFAULT_SESSION_CONFIG,
  });

  assert.deepEqual(
    report.bySession.map((row) => [row.key, row.tradeCount]),
    [
      ["london", 4],
      ["newYork", 4],
    ],
    "grouped by the session the entry fell in",
  );
  assert.deepEqual(
    report.byWeekday.map((row) => [row.key, row.tradeCount]),
    [
      ["Mon", 2],
      ["Tue", 1],
      ["Wed", 1],
      ["Thu", 1],
      ["Fri", 1],
      ["Sun", 2],
    ],
    "grouped by the session day's weekday, Monday first",
  );
  assert.deepEqual(
    report.byInstrument.map((row) => [row.key, row.tradeCount]),
    [
      ["EURUSD", 2],
      ["GBPUSD", 6],
    ],
    "grouped by instrument",
  );

  for (const rows of [report.bySession, report.byWeekday, report.byInstrument]) {
    assert.equal(
      rows.reduce((total, row) => total + row.tradeCount, 0),
      8,
      "every breakdown accounts for every trade of every run",
    );
  }

  const london = report.bySession[0]!;
  assert.equal(london.winRate, 1, "every London trade reached its target");
  approx(london.avgR, 3, "at 3R each");
  approx(london.netR, 12, "so four of them net 12R");

  assert.deepEqual(
    report.runs.map((run) => [run.instrument, run.bars, run.stats.tradeCount]),
    [
      ["GBPUSD", pound.bars.length, 6],
      ["EURUSD", euro.bars.length, 2],
    ],
    "each run is named in the report",
  );
});

/** One session day whose long is stopped out: the first bar rises, the second takes the stop. */
function losingDayBars(instrument: Instrument = "EURUSD"): BarSeries {
  return {
    instrument,
    bars: [
      bar(T0 + DAY, 1.1995, 1.2005, 1.199, 1.2005),
      bar(T0 + DAY + M15, 1.2005, 1.2007, 1.199, 1.1995),
    ],
  };
}

test("a report of several runs pools their trades and sums their equity", () => {
  const pound = risingDayBars(1);
  const euro = losingDayBars();

  const report = buildReport({
    runs: [
      { instrument: "GBPUSD", bars: pound.bars.length, result: runBacktest(pound, baseConfig()) },
      {
        instrument: "EURUSD",
        bars: euro.bars.length,
        result: runBacktest(euro, baseConfig({ instrument: "EURUSD" })),
      },
    ],
    session: DEFAULT_SESSION_CONFIG,
  });

  assert.equal(report.stats.tradeCount, 2, "both runs' trades are pooled");
  assert.equal(report.stats.winRate, 0.5, "one reached its target, one took its stop");
  approx(report.stats.avgR, 1, "+3R and -1R average to +1R");
  approx(report.stats.profitFactor, 3, "3R won against 1R lost");
  approx(
    report.stats.maxDrawdown,
    100 / 10300,
    "the second run gives back part of what the first made",
  );

  const curve = report.equityCurve;
  assert.equal(curve[0]!.equity, 10000, "the portfolio starts from the initial balance");
  assert.equal(curve.length, 4, "one point per equity event, in time order");
  approx(curve[curve.length - 1]!.equity, 10200, "and ends at both runs' profit and loss");
  assert.deepEqual(
    curve.map((point) => point.time),
    [...curve.map((point) => point.time)].sort((a, b) => a - b),
    "the combined curve is walked in time order",
  );
});

test("cost sensitivity reruns the scenario under three spreads, worse each time", () => {
  const series = risingDayBars(3);
  const cfg = baseConfig({
    costs: {
      spread: 0.0001,
      commission: 0,
      slippage: 0,
      sensitivity: { optimistic: 0.00002, pessimistic: 0.0004 },
    },
  });

  const points = costSensitivity({ series, cfg });
  assert.ok(points !== null, "the mode runs when the config declares its bounds");
  assert.deepEqual(
    points.map((point) => [point.label, point.spread]),
    [
      ["optimistic", 0.00002],
      ["mid", 0.0001],
      ["pessimistic", 0.0004],
    ],
    "the configured spread is the mid case",
  );

  const [optimistic, mid, pessimistic] = points;
  assert.ok(
    optimistic!.stats.expectancyR > mid!.stats.expectancyR,
    "the optimistic spread does better than the mid",
  );
  assert.ok(
    mid!.stats.expectancyR > pessimistic!.stats.expectancyR,
    "and the pessimistic does worse than the mid",
  );
  assert.ok(pessimistic!.stats.expectancyR > 0, "the edge survives the pessimistic spread");
  assert.equal(pessimistic!.stats.tradeCount, 3, "the same trades are taken under every spread");

  assert.equal(
    costSensitivity({ series, cfg: baseConfig() }),
    null,
    "without declared bounds there is nothing to sweep",
  );

  const inverted = baseConfig({
    costs: {
      spread: 0.0001,
      commission: 0,
      slippage: 0,
      sensitivity: { optimistic: 0.0004, pessimistic: 0.00002 },
    },
  });
  assert.throws(
    () => costSensitivity({ series, cfg: inverted }),
    /optimistic <= mid <= pessimistic/,
    "bounds that run the wrong way are refused rather than mislabelled",
  );
});

test("a report survives being saved and re-read", () => {
  const series = risingDayBars(3);
  const cfg = baseConfig({
    costs: {
      spread: 0.0001,
      commission: 0,
      slippage: 0,
      sensitivity: { optimistic: 0.00002, pessimistic: 0.0004 },
    },
  });

  const report = buildReport({
    runs: [
      {
        instrument: "GBPUSD",
        bars: series.bars.length,
        result: runBacktest(series, cfg),
      },
    ],
    session: DEFAULT_SESSION_CONFIG,
    costSensitivity: costSensitivity({ series, cfg })!,
  });

  const readBack = parseReport(serializeReport(report));

  assert.deepEqual(readBack, report, "what is read back is what was saved");
  assert.equal(readBack.stats.profitFactor, Infinity, "including a profit factor of infinity");
  assert.equal(readBack.costSensitivity!.length, 3, "and the spread sweep it carried");

  assert.throws(() => parseReport("{"), /not a CRTbot report/, "truncated files are rejected");
  assert.throws(() => parseReport("{}"), /not a CRTbot report/, "and so is JSON that is not one");
  assert.throws(
    () => parseReport('{"stats": {"tradeCount": 1}}'),
    /not a CRTbot report/,
    "a report without its breakdowns is not a report",
  );

  const reportShape = JSON.parse(serializeReport(report)) as Record<string, unknown>;
  const missingStats = structuredClone(reportShape);
  delete (missingStats["runs"] as Record<string, unknown>[])[0]!["stats"];
  assert.throws(
    () => parseReport(JSON.stringify(missingStats)),
    /not a CRTbot report/,
    "a run without its statistics would not survive being printed",
  );

  const namelessRow = structuredClone(reportShape);
  delete (namelessRow["bySession"] as Record<string, unknown>[])[0]!["key"];
  assert.throws(
    () => parseReport(JSON.stringify(namelessRow)),
    /not a CRTbot report/,
    "and neither would a breakdown row with no key",
  );
});

test("the CLI saves a report and reads it back", () => {
  const dir = mkdtempSync(join(tmpdir(), "crtbot-report-"));
  const file = join(dir, "report.json");
  const raw = join(dir, "run.json");

  try {
    const run = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "src/cli.ts",
        "backtest",
        "--out",
        file,
        "--result",
        raw,
        "--sensitivity",
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.equal(run.status, 0, run.stderr);

    const saved = parseReport(readFileSync(file, "utf8"));
    assert.ok(saved.stats.tradeCount > 0, "the saved report has the demo run's statistics");
    assert.ok(saved.bySession.length > 0 && saved.byWeekday.length > 0, "and its breakdowns");
    assert.equal(saved.costSensitivity?.length, 3, "and the spread sweep it was asked for");

    const decisionLog = JSON.parse(readFileSync(raw, "utf8")) as { decisions?: unknown[] };
    assert.ok(
      Array.isArray(decisionLog.decisions) && decisionLog.decisions.length > 0,
      "the raw run is saved too, with the decisions behind it",
    );

    const again = spawnSync(
      process.execPath,
      ["--import", "tsx", "src/cli.ts", "report", "--in", file],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.equal(again.status, 0, again.stderr);
    assert.equal(again.stdout.trim(), run.stdout.trim(), "the re-read report prints identically");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
