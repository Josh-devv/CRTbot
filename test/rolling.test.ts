import { test } from "node:test";
import assert from "node:assert/strict";

import { BiasReader, RollingStructuralBias, biasSnapshot, structuralBias } from "../src/bias.js";
import { aggregate, RunningCandles } from "../src/candles.js";
import { ContextReader, contextSnapshot } from "../src/context.js";
import { liquidityEventAt, liquidityEventAtOf } from "../src/liquidity.js";
import { findOrderBlocks, findOrderBlocksOf } from "../src/orderblocks.js";
import { ActivePoints, foldPoints, PointSet, RollingPoints } from "../src/rolling.js";
import { smtDivergence, smtDivergenceOf, type SmtInput } from "../src/smt.js";
import {
  DEFAULT_SWING_WIDTH,
  extremePool,
  findSignificantPoints,
  nearestPool,
  structureSnapshot,
  structureSnapshotOf,
  type StructureRules,
  type Swing,
} from "../src/structure.js";
import { DEFAULT_SESSION_CONFIG, MS_PER_DAY, sessionDayStart } from "../src/time.js";
import type { Bar, BiasDirection, LiquidityEvent, StrategyConfig } from "../src/types.js";

/**
 * The rolling pass against its pure references (ticket 16).
 *
 * The engine's as-of reads used to be re-derived from a prefix per bar or per day — the O(n²)
 * shape. Every rolling primitive must answer exactly what that prefix code answered, at every
 * prefix: these tests fold each series one bar at a time and compare against the pure function
 * over the prefix, so the replay cannot change a decision by construction. As in `time.test.ts`,
 * the old arrow is written out here as the reference.
 */

const BASE = Date.UTC(2021, 0, 4, 0, 0, 0);

function config(rules: StructureRules = {}): StrategyConfig {
  return {
    instrument: "GBPUSD",
    session: DEFAULT_SESSION_CONFIG,
    structure: { swingWidth: rules.swingWidth ?? DEFAULT_SWING_WIDTH },
    strategy: { stopDistance: 0.001 },
    risk: { rMultiple: 3, maxTradesPerDay: 1, riskPerTradePct: 0.01 },
    costs: { spread: 0, commission: 0, slippage: 0 },
    initialEquity: 10000,
  };
}

/** Bars from [high, low] pairs; open = low, close = high. */
function bars(pairs: [number, number][], stepMs = 60_000): Bar[] {
  return pairs.map(([high, low], i) => ({
    time: BASE + i * stepMs,
    open: low,
    high,
    low,
    close: high,
  }));
}

/** A seeded random walk — enough turning points for every qualification path to fire. */
function walk(seed: number, count: number, stepMs = 60_000, from = BASE): Bar[] {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };

  let price = 100;
  const out: Bar[] = [];
  for (let i = 0; i < count; i++) {
    const open = price;
    const close = open + (next() - 0.5) * 2;
    const high = Math.max(open, close) + next() * 0.6;
    const low = Math.min(open, close) - next() * 0.6;
    out.push({ time: from + i * stepMs, open, high, low, close });
    price = close;
  }
  return out;
}

/** The pure `lastAtOrBefore` (structure.ts), kept as the reference. */
function lastAtOrBefore(points: Swing[], uptoIndex: number): Swing | undefined {
  let found: Swing | undefined;
  for (const point of points) {
    if (point.index > uptoIndex) break;
    found = point;
  }
  return found;
}

/** Canonical order for comparing band results, which have no promised ordering. */
function sorted(swings: Swing[]): Swing[] {
  return [...swings].sort((a, b) => a.price - b.price || a.index - b.index);
}

/** The prices probed at every bar: its close, its extremes, and the low half. */
function probes(bar: Bar): number[] {
  return [bar.close, bar.high, bar.low, (bar.high + bar.low) / 2];
}

const CRAFTED: [number, number][][] = [
  [
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
  ],
  [
    [12, 10],
    [11, 7],
    [12, 9],
    [11, 6],
    [12, 8],
    [11, 5],
    [12, 9],
    [11, 3],
    [12, 7],
  ],
];

const RULES: StructureRules[] = [
  {},
  { swingWidth: 1 },
  { swingWidth: 1, testedKeyLevel: (swing) => swing.price === 12 },
  { swingWidth: 1, lowQualifies: (swing) => swing.price === 6 },
];

test("RunningCandles reproduces aggregate at every prefix", () => {
  const cfg = config();
  const series = walk(7, 96 * 3, 15 * 60_000);

  for (const timeframe of ["M15", "H4", "D1", "W1", "MN1"] as const) {
    const running = new RunningCandles(timeframe, cfg);
    for (let i = 0; i < series.length; i++) {
      running.fold(series[i]!);
      assert.deepEqual(
        running.bars,
        aggregate(series.slice(0, i + 1), timeframe, cfg),
        `${timeframe} at prefix ${i + 1}`,
      );
    }
  }
});

test("RollingPoints reproduces findSignificantPoints at every prefix", () => {
  const random = walk(11, 120);
  for (const source of CRAFTED) {
    for (const rules of RULES) {
      const series = bars(source);
      const rolling = new RollingPoints(rules);
      for (let i = 0; i < series.length; i++) {
        rolling.fold(series[i]!);
        assert.deepEqual(
          rolling.toPoints(),
          findSignificantPoints(series.slice(0, i + 1), rules),
          `points at prefix ${i + 1}`,
        );
      }
    }
  }

  for (const rules of RULES) {
    const rolling = new RollingPoints(rules);
    for (let i = 0; i < random.length; i++) {
      rolling.fold(random[i]!);
      assert.deepEqual(
        rolling.toPoints(),
        findSignificantPoints(random.slice(0, i + 1), rules),
        `random points at prefix ${i + 1}`,
      );
    }
  }
});

test("RollingPoints reads answer for the prefix folded so far", () => {
  const random = walk(13, 90);
  for (const rules of RULES) {
    const rolling = new RollingPoints(rules);
    for (let i = 0; i < random.length; i++) {
      const bar = random[i]!;
      rolling.fold(bar);
      const points = findSignificantPoints(random.slice(0, i + 1), rules);
      const at = `prefix ${i + 1}`;

      assert.deepEqual(rolling.lastHigh(), lastAtOrBefore(points.highs, Number.POSITIVE_INFINITY), `lastHigh ${at}`);
      assert.deepEqual(rolling.lastLow(), lastAtOrBefore(points.lows, Number.POSITIVE_INFINITY), `lastLow ${at}`);
      assert.deepEqual(rolling.maxLow(), nearestPool(points, "low", () => true) ?? undefined, `maxLow ${at}`);
      assert.deepEqual(rolling.minHigh(), nearestPool(points, "high", () => true) ?? undefined, `minHigh ${at}`);

      for (const price of probes(bar)) {
        const nearestLow = nearestPool(points, "low", (s) => s.index !== i && s.price < price);
        const nearestHigh = nearestPool(points, "high", (s) => s.index !== i && s.price > price);
        assert.deepEqual(rolling.nearestLowBelow(price, i), nearestLow ?? undefined, `nearestLowBelow ${at} @ ${price}`);
        assert.deepEqual(rolling.nearestHighAbove(price, i), nearestHigh ?? undefined, `nearestHighAbove ${at} @ ${price}`);
        assert.deepEqual(rolling.nearestLowBelow(price), nearestLow ?? undefined, `nearestLowBelow (no skip) ${at} @ ${price}`);
        assert.deepEqual(rolling.nearestHighAbove(price), nearestHigh ?? undefined, `nearestHighAbove (no skip) ${at} @ ${price}`);

        const lowest = extremePool(points, "low", (s) => s.price < price);
        const highest = extremePool(points, "high", (s) => s.price > price);
        assert.deepEqual(rolling.lowestLowBelow(price), lowest ?? undefined, `lowestLowBelow ${at} @ ${price}`);
        assert.deepEqual(rolling.highestHighAbove(price), highest ?? undefined, `highestHighAbove ${at} @ ${price}`);
      }

      for (const side of ["low", "high"] as const) {
        const levels = side === "low" ? points.lows : points.highs;
        assert.deepEqual(
          sorted(rolling.levelsInBand(side, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY, i)),
          sorted(levels.filter((s) => s.index < i)),
          `levelsInBand(${side}, all) ${at}`,
        );
        assert.deepEqual(
          sorted(rolling.levelsInBand(side, bar.low, bar.close, i)),
          sorted(levels.filter((s) => s.index < i && s.price > bar.low && s.price < bar.close)),
          `levelsInBand(${side}, window) ${at}`,
        );
      }
    }
  }
});

test("RollingPoints reproduces findSignificantPoints over a live aggregate at every bar", () => {
  const cfg = config({ swingWidth: 1 });
  const series = walk(17, 96 * 2, 15 * 60_000);
  const h4 = new RunningCandles("H4", cfg);
  const points = new RollingPoints(cfg.structure);

  for (let i = 0; i < series.length; i++) {
    const bar = series[i]!;
    if (h4.fold(bar)) points.fold(h4.current!);
    else points.update(h4.current!);

    const live = aggregate(series.slice(0, i + 1), "H4", cfg);
    const last = live.length - 1;
    const reference = findSignificantPoints(live, cfg.structure);
    const at = `bar ${i}`;

    assert.deepEqual(points.toPoints(), reference, `points ${at}`);
    assert.deepEqual(
      structureSnapshotOf(points, bar.close),
      structureSnapshot(reference, last, bar.close),
      `structure ${at}`,
    );
    assert.deepEqual(
      liquidityEventAtOf(live[last]!, last, points),
      liquidityEventAt(live[last]!, last, reference),
      `liquidity ${at}`,
    );
  }
});

test("ContextReader reproduces contextSnapshot at every bar", () => {
  const base = config({ swingWidth: 1 });
  // The CRT trigger makes the reader track the lookback window too, not just the live candle.
  const configs: StrategyConfig[] = [base, { ...base, execution: { requireCrt: true } }];
  const biases: BiasDirection[] = ["bullish", "bearish", "none"];

  // A winter week and a summer week, so the H4 grid is walked on both sides of a DST change.
  for (const cfg of configs) {
    for (const from of [BASE, Date.UTC(2021, 5, 1)]) {
      const series = walk(19, 96 * 3, 15 * 60_000, from);
      const reader = new ContextReader(cfg);
      for (let i = 0; i < series.length; i++) {
        const bar = series[i]!;
        reader.fold(bar);
        for (const bias of biases) {
          assert.deepEqual(
            reader.at(bar, bias),
            contextSnapshot(series, i, cfg, bias),
            `bar ${i} from ${from} ${bias}`,
          );
        }
      }
    }
  }
});

test("PointSet answers the full-set reads exactly", () => {
  const series = walk(23, 120);
  const points = findSignificantPoints(series, { swingWidth: 1 });
  const set = PointSet.fromPoints(points);

  assert.deepEqual(set.lastHigh(), lastAtOrBefore(points.highs, Number.POSITIVE_INFINITY));
  assert.deepEqual(set.lastLow(), lastAtOrBefore(points.lows, Number.POSITIVE_INFINITY));
  assert.deepEqual(set.maxLow(), nearestPool(points, "low", () => true) ?? undefined);
  assert.deepEqual(set.minHigh(), nearestPool(points, "high", () => true) ?? undefined);

  for (let i = 0; i < series.length; i++) {
    const bar = series[i]!;
    const at = `bar ${i}`;

    for (const side of ["low", "high"] as const) {
      const levels = side === "low" ? points.lows : points.highs;
      assert.deepEqual(
        sorted(set.levelsInBand(side, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY, i)),
        sorted(levels.filter((s) => s.index < i)),
        `levelsInBand(${side}, all) ${at}`,
      );
      assert.deepEqual(
        sorted(set.levelsInBand(side, bar.low, bar.close, i)),
        sorted(levels.filter((s) => s.index < i && s.price > bar.low && s.price < bar.close)),
        `levelsInBand(${side}, window) ${at}`,
      );
    }

    for (const price of probes(bar)) {
      assert.deepEqual(
        set.nearestLowBelow(price, i),
        nearestPool(points, "low", (s) => s.index !== i && s.price < price) ?? undefined,
        `nearestLowBelow ${at}`,
      );
      assert.deepEqual(
        set.nearestHighAbove(price, i),
        nearestPool(points, "high", (s) => s.index !== i && s.price > price) ?? undefined,
        `nearestHighAbove ${at}`,
      );
      assert.deepEqual(
        set.lowestLowBelow(price),
        extremePool(points, "low", (s) => s.price < price) ?? undefined,
        `lowestLowBelow ${at}`,
      );
      assert.deepEqual(
        set.highestHighAbove(price),
        extremePool(points, "high", (s) => s.price > price) ?? undefined,
        `highestHighAbove ${at}`,
      );
    }
  }
});

test("liquidityEventAtOf with the full-set reads equals liquidityEventAt at every bar", () => {
  for (const rules of RULES) {
    const series = walk(29, 120);
    const points = findSignificantPoints(series, rules);
    const set = PointSet.fromPoints(points);

    for (let i = 0; i < series.length; i++) {
      assert.deepEqual(
        liquidityEventAtOf(series[i]!, i, set),
        liquidityEventAt(series[i]!, i, points),
        `bar ${i}`,
      );
    }
  }
});

test("ActivePoints answers the cursor-scoped structure reads exactly", () => {
  const series = walk(31, 120);
  for (const rules of RULES) {
    const points = findSignificantPoints(series, rules);
    const active = new ActivePoints(points.highs, points.lows);

    for (let i = 0; i < series.length; i++) {
      active.activateThrough(i);
      const bar = series[i]!;
      const at = `bar ${i}`;

      assert.deepEqual(active.lastHigh(), lastAtOrBefore(points.highs, i), `lastHigh ${at}`);
      assert.deepEqual(active.lastLow(), lastAtOrBefore(points.lows, i), `lastLow ${at}`);

      for (const price of probes(bar)) {
        assert.deepEqual(
          active.nearestLowBelow(price),
          nearestPool(points, "low", (s) => s.index <= i && s.price < price) ?? undefined,
          `nearestLowBelow ${at}`,
        );
        assert.deepEqual(
          active.nearestHighAbove(price),
          nearestPool(points, "high", (s) => s.index <= i && s.price > price) ?? undefined,
          `nearestHighAbove ${at}`,
        );
        assert.deepEqual(
          active.lowestLowBelow(price),
          extremePool(points, "low", (s) => s.index <= i && s.price < price) ?? undefined,
          `lowestLowBelow ${at}`,
        );
        assert.deepEqual(
          active.highestHighAbove(price),
          extremePool(points, "high", (s) => s.index <= i && s.price > price) ?? undefined,
          `highestHighAbove ${at}`,
        );

        assert.deepEqual(
          structureSnapshotOf(active, price),
          structureSnapshot(points, i, price),
          `structureSnapshotOf ${at} @ ${price}`,
        );
      }
    }
  }
});

test("foldPoints materializes findSignificantPoints for the whole series", () => {
  for (const rules of RULES) {
    const series = walk(37, 150);
    assert.deepEqual(foldPoints(series, rules).toPoints(), findSignificantPoints(series, rules));
  }
});

/** Explicit candles for the bias tracker, one "day" apart. */
function ohlc(rows: [number, number, number, number][], stepMs = MS_PER_DAY): Bar[] {
  return rows.map(([open, high, low, close], i) => ({
    time: BASE + i * stepMs,
    open,
    high,
    low,
    close,
  }));
}

const BIAS_CANDLES: [number, number, number, number][] = [
  [10, 11, 9, 10],
  [10, 13, 10, 12],
  [12, 12, 8, 9],
  [9, 11, 8.5, 10],
  [10, 14, 9.9, 13.5],
  [13, 13, 7, 8],
  [8, 12, 8, 11],
  [11, 15, 10.9, 14],
  [10, 12, 6, 7],
  [7, 13, 6.9, 12],
];

test("RollingStructuralBias reproduces structuralBias at every candle, updates included", () => {
  const mutationSets: ((bar: Bar) => Bar)[] = [
    (bar) => ({ ...bar, high: bar.high + 1.5 }),
    (bar) => ({ ...bar, low: bar.low - 1.5 }),
    (bar) => ({ ...bar, close: bar.close + 2, high: Math.max(bar.high, bar.close + 2) }),
    (bar) => ({ ...bar, close: bar.close - 2, low: Math.min(bar.low, bar.close - 2) }),
    (bar) => ({
      ...bar,
      high: Math.max(bar.open, bar.close) + 0.05,
      low: Math.min(bar.open, bar.close) - 0.05,
    }),
    (bar) => ({ ...bar, close: bar.close + 4, high: Math.max(bar.high, bar.close + 4) }),
  ];

  for (const rules of [{}, { swingWidth: 1 }, { swingWidth: 3 }] as StructureRules[]) {
    const original = ohlc(BIAS_CANDLES);
    const current = [...original];
    const tracker = new RollingStructuralBias(rules);
    const refCfg = config(rules);
    const at = (upto: number): ReturnType<typeof structuralBias> =>
      structuralBias(current.slice(0, upto + 1), refCfg);

    for (let i = 0; i < original.length; i++) {
      tracker.fold(original[i]!);
      assert.equal(tracker.value(), at(i), `fold ${i} ${JSON.stringify(rules)}`);

      // The live candle is refreshed as the bucket builds: wicks extend, closes move, and a
      // moving candle can also take a pivot away again.
      for (const mutate of mutationSets) {
        const live = mutate(current[i]!);
        current[i] = live;
        tracker.update(live);
        assert.equal(tracker.value(), at(i), `update ${i} ${JSON.stringify(rules)}`);
      }
    }
  }
});

test("BiasReader reproduces biasSnapshot at every bar and keeps the monthly window", () => {
  for (const rules of [{}, { swingWidth: 1 }] as StructureRules[]) {
    const cfg = config(rules);
    const series = walk(43, 96 * 3, 15 * 60_000);
    const reader = new BiasReader(cfg);

    for (let i = 0; i < series.length; i++) {
      reader.fold(series[i]!);
      assert.deepEqual(reader.snapshot(), biasSnapshot(series.slice(0, i + 1), cfg), `bar ${i}`);
      if (i % 32 === 0) {
        assert.deepEqual(reader.months, aggregate(series.slice(0, i + 1), "MN1", cfg), `months ${i}`);
      }
    }
  }
});

test("BiasReader reproduces biasSnapshot at every session day over months of data", () => {
  const cfg = config({ swingWidth: 1 });
  // ~60 days of M30 starting Feb 20: across the March DST change and several weekly/monthly turns.
  const series = walk(47, 48 * 60, 30 * 60_000).map((bar) => ({
    ...bar,
    time: bar.time + 47 * MS_PER_DAY,
  }));
  const reader = new BiasReader(cfg);
  let day = Number.NaN;
  let reads = 0;

  for (let i = 0; i < series.length; i++) {
    const bar = series[i]!;
    reader.fold(bar);
    const current = sessionDayStart(bar.time, cfg.session);
    if (current !== day) {
      day = current;
      reads += 1;
      assert.deepEqual(
        reader.snapshot(),
        biasSnapshot(series.slice(0, i + 1), cfg),
        `session day starting ${current}`,
      );
    }
  }

  assert.ok(reads > 50, `expected many session days, saw ${reads}`);
});

test("smtDivergenceOf with folded pair points equals smtDivergence at every bar", () => {
  const rules: StructureRules = { swingWidth: 1 };
  const pairBars = walk(59, 200, 15 * 60_000);
  const rolling = new RollingPoints(rules);

  for (let i = 0; i < pairBars.length; i++) {
    const pairBar = pairBars[i]!;
    rolling.fold(pairBar);

    const poolLow = rolling.maxLow();
    const poolHigh = rolling.minHigh();
    const sweeps: (LiquidityEvent | null)[] = [
      null,
      { side: "low", level: pairBar.low - 0.5, extreme: pairBar.low, isCrt: false, kind: "purge" },
      { side: "low", level: pairBar.low + 0.5, extreme: pairBar.low, isCrt: true, kind: "csd" },
      { side: "high", level: pairBar.high + 0.5, extreme: pairBar.high, isCrt: false, kind: "purge" },
      { side: "high", level: pairBar.high - 0.5, extreme: pairBar.high, isCrt: true, kind: "csd" },
    ];
    if (poolLow !== undefined) {
      sweeps.push({
        side: "low",
        level: poolLow.price,
        extreme: pairBar.low,
        isCrt: true,
        kind: "csd",
      });
    }
    if (poolHigh !== undefined) {
      sweeps.push({
        side: "high",
        level: poolHigh.price,
        extreme: pairBar.high,
        isCrt: false,
        kind: "purge",
      });
    }

    for (const sweep of sweeps) {
      const bias: BiasDirection =
        sweep === null ? "none" : sweep.side === "low" ? "bullish" : "bearish";
      // The key level equals the swept level (criterion 2 holding), or is missing.
      for (const keyLevel of [sweep?.level ?? null, null]) {
        const input: SmtInput = {
          traded: "GBPUSD",
          pair: "EURUSD",
          sweep,
          pairBars,
          pairIndex: i,
          bias,
          keyLevel,
          atKeyTime: true,
          confirmedBy: "csd",
          structure: rules,
        };
        assert.deepEqual(
          smtDivergenceOf(input, rolling),
          smtDivergence(input),
          `bar ${i}, ${JSON.stringify(sweep)}`,
        );
      }
    }
  }
});

test("findOrderBlocksOf with a point set equals findOrderBlocks", () => {
  const rules: StructureRules = { swingWidth: 1 };
  const series = walk(61, 240, 15 * 60_000);
  const points = findSignificantPoints(series, rules);
  const queries = PointSet.fromPoints(points);
  const obRules = {
    points,
    testedKeyLevel: (_bar: Bar, index: number) => index % 17 === 0,
  };

  const expected = findOrderBlocks(series, obRules);
  assert.ok(expected.length > 0, "the walk should form at least one block");
  assert.deepEqual(findOrderBlocksOf(series, obRules, queries), expected);
});
