import assert from "node:assert/strict";
import { test } from "node:test";

import { runBacktest } from "../src/backtest.js";
import { correlatedPair, smtDivergence, type SmtInput } from "../src/smt.js";
import { DEFAULT_SESSION_CONFIG } from "../src/time.js";
import type { Bar, BarSeries, Instrument, StrategyConfig } from "../src/types.js";

const DAY = 86_400_000;
const T0 = 1_700_000_000_000;
const SWING_WIDTH = 1;

type Levels = [low: number, high: number];

/** Bars spaced a day apart, from the given low/high pairs. */
function seriesOf(instrument: Instrument, levels: Levels[]): BarSeries {
  return {
    instrument,
    bars: levels.map(([low, high], i) => ({
      time: T0 + i * DAY,
      open: low,
      high,
      low,
      close: low,
    })),
  };
}

/**
 * The correlated instrument's ladder: swing lows 1.2450, 1.2440, 1.2430, and a final bar whose
 * low (1.2445) holds *above* the nearest prior pool (1.2440) — it failed to take its liquidity.
 */
const PAIR_LEVELS: Levels[] = [
  [1.2455, 1.2475],
  [1.2450, 1.2470],
  [1.2458, 1.2480],
  [1.2440, 1.2465],
  [1.2452, 1.2475],
  [1.2430, 1.2460],
  [1.2445, 1.2470],
  [1.2447, 1.2490],
  [1.2450, 1.2470],
  [1.2445, 1.2465],
];

/** The same ladder, but the pair drives through 1.2440 as well — a correlated move, not SMT. */
const PAIR_FOLLOWS_LEVELS: Levels[] = PAIR_LEVELS.map((level, i) =>
  i === PAIR_LEVELS.length - 1 ? ([1.2435, 1.2460] as Levels) : level,
);

const pairSeries = seriesOf("EURUSD", PAIR_LEVELS);

/** A textbook divergence: the traded instrument swept the key level in a killzone, in alignment. */
const textbook: SmtInput = {
  traded: "GBPUSD",
  pair: "EURUSD",
  sweep: { side: "low", level: 1.244, extreme: 1.2435, isCrt: true, kind: null },
  pairBars: pairSeries.bars,
  pairIndex: pairSeries.bars.length - 1,
  bias: "bullish",
  keyLevel: 1.244,
  atKeyTime: true,
  confirmedBy: "order-block",
  structure: { swingWidth: SWING_WIDTH },
};

function smt(overrides: Partial<SmtInput> = {}): SmtInput {
  return { ...textbook, ...overrides };
}

function withFields(overrides: Partial<SmtInput>): SmtInput {
  return { ...textbook, ...overrides };
}

test("all three criteria must hold before a divergence is flagged", () => {
  const divergence = smtDivergence(textbook);

  assert.ok(divergence, "a divergence is flagged");
  assert.equal(divergence.side, "low");
  assert.equal(divergence.took, "GBPUSD", "the traded instrument took the liquidity");
  assert.equal(divergence.failed, "EURUSD", "the correlated instrument failed to");
  assert.equal(divergence.confirmedBy, "order-block");
});

test("a divergence must agree with the HTF bias", () => {
  assert.equal(smtDivergence(withFields({ bias: "bearish" })), null, "a sweep against the bias");
  assert.equal(smtDivergence(withFields({ bias: "none" })), null, "no bias to agree with");
});

test("a divergence must form at the HTF key level", () => {
  assert.equal(smtDivergence(withFields({ keyLevel: 1.25 })), null, "a different level");
  assert.equal(smtDivergence(withFields({ keyLevel: null })), null, "no key level at all");
});

test("a divergence must form at a key time", () => {
  assert.equal(smtDivergence(withFields({ atKeyTime: false })), null);
});

test("a divergence needs both instruments on the same bar", () => {
  assert.equal(smtDivergence(withFields({ sweep: null })), null, "nothing was swept");
  assert.equal(smtDivergence(withFields({ pairIndex: null })), null, "the pair has no bar here");
});

test("a correlated instrument taking its own liquidity too is not a divergence", () => {
  assert.equal(
    smtDivergence(withFields({ pairBars: seriesOf("EURUSD", PAIR_FOLLOWS_LEVELS).bars })),
    null,
  );
});

test("divergence alone does not confirm itself", () => {
  const unconfirmed = smtDivergence(withFields({ confirmedBy: null }));

  assert.ok(unconfirmed, "the divergence is still detected");
  assert.equal(unconfirmed.confirmedBy, null, "but nothing has confirmed it yet");
});

test("the pair is only used when the correlation is configured", () => {
  const correlation: NonNullable<StrategyConfig["smt"]> = {
    enabled: true,
    pairs: [["GBPUSD", "EURUSD"]],
    useDxy: false,
  };

  assert.equal(correlatedPair(config(), "GBPUSD", [pairSeries]), null, "SMT absent means no pair");
  assert.equal(
    correlatedPair(config({ ...correlation, enabled: false }), "GBPUSD", [pairSeries]),
    null,
    "SMT disabled means no pair",
  );
  assert.equal(
    correlatedPair(config({ ...correlation, pairs: [] }), "GBPUSD", [pairSeries]),
    null,
    "an unlisted pair is not a correlation",
  );

  const pair = correlatedPair(config(correlation), "GBPUSD", [pairSeries]);
  assert.ok(pair, "the configured pair is found");
  assert.equal(pair.series.instrument, "EURUSD");
  assert.equal(
    pair.indexByTime.get(pairSeries.bars[3]!.time),
    3,
    "the pair's bars are indexed for lookup by the traded bar's time",
  );
});

test("a run with no correlated instrument never looks for divergence", () => {
  const result = runBacktest(seriesOf("GBPUSD", PAIR_LEVELS), config(correlationOn()));

  assert.ok(result.decisions.length > 0, "the run produced decisions");
  assert.ok(
    result.decisions.every((decision) => decision.smt === undefined),
    "with no pair in the dataset there is nothing to diverge against",
  );
});

test("a correlated instrument in the dataset changes nothing until it diverges", () => {
  const traded = seriesOf("GBPUSD", PAIR_LEVELS);
  const alone = runBacktest(traded, config(correlationOn()));
  const together = runBacktest(traded, config(correlationOn()), { dataset: [pairSeries] });

  assert.deepEqual(
    together.trades,
    alone.trades,
    "no divergence forms on this fixture, so the dataset is inert",
  );
  assert.ok(
    together.decisions.every((decision) => decision.smt === undefined),
    "and nothing is recorded about the pair",
  );
});

/** A full strategy config, with SMT off unless asked for. */
function config(smt?: StrategyConfig["smt"]): StrategyConfig {
  return {
    instrument: "GBPUSD",
    session: DEFAULT_SESSION_CONFIG,
    structure: { swingWidth: SWING_WIDTH },
    strategy: { stopDistance: 0.001 },
    smt,
    risk: { rMultiple: 3, maxTradesPerDay: 1, riskPerTradePct: 0.01 },
    costs: { spread: 0, commission: 0, slippage: 0 },
    initialEquity: 10_000,
  };
}

function correlationOn(): NonNullable<StrategyConfig["smt"]> {
  return { enabled: true, pairs: [["GBPUSD", "EURUSD"]], useDxy: false };
}
