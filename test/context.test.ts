import { test } from "node:test";
import assert from "node:assert/strict";

import { contextSnapshot, contextVetoes } from "../src/context.js";
import { DEFAULT_SESSION_CONFIG, MS_PER_HOUR, sessionWindowStart } from "../src/time.js";
import type { Bar, StrategyConfig } from "../src/types.js";

type Row = [number, number, number, number];

/** 2021-01-04 14:00 UTC = 09:00 New York — after that session day's London open. */
const AFTER_LONDON = Date.UTC(2021, 0, 4, 14, 0, 0);
/** 2021-01-04 22:00 UTC = 17:00 New York — the open of the next session day. */
const NIGHT_BEFORE = Date.UTC(2021, 0, 4, 22, 0, 0);

function cfg(overrides: Partial<StrategyConfig> = {}): StrategyConfig {
  return {
    instrument: "GBPUSD",
    session: DEFAULT_SESSION_CONFIG,
    structure: { swingWidth: 1 },
    strategy: { stopDistance: 0.001 },
    risk: { rMultiple: 3, maxTradesPerDay: 1, riskPerTradePct: 0.01 },
    costs: { spread: 0, commission: 0, slippage: 0 },
    initialEquity: 10000,
    ...overrides,
  };
}

/**
 * Four hours apart, walking down: pivots alternate low/high, each swing low undercutting
 * the last, so every pivot is a significant point (ruleset §4 framing).
 */
const ROWS: Row[] = [
  [1.2525, 1.2535, 1.2515, 1.2525],
  [1.2515, 1.252, 1.25, 1.251], // low pivot 1.250
  [1.251, 1.254, 1.2515, 1.2525], // high pivot 1.254
  [1.2478, 1.248, 1.246, 1.2465], // low pivot 1.246
  [1.2465, 1.25, 1.247, 1.2495], // high pivot 1.250
  [1.2455, 1.2455, 1.242, 1.2425], // low pivot 1.242 — the level the CRT will sweep
  [1.2425, 1.25, 1.243, 1.248], // high pivot 1.250, closing in premium
  [1.2415, 1.2428, 1.241, 1.2425], // sweeps 1.242 back up: a CRT, closing in discount
];

function barsOf(rows: Row[], start: number): Bar[] {
  return rows.map(([open, high, low, close], i) => ({
    time: start + i * 4 * MS_PER_HOUR,
    open,
    high,
    low,
    close,
  }));
}

test("the London open of the session day is resolved in New York time", () => {
  // 2021-01-04 09:00 NY sits in the session day that began 17:00 NY on Jan 3.
  assert.equal(
    sessionWindowStart(AFTER_LONDON, "london", DEFAULT_SESSION_CONFIG),
    Date.UTC(2021, 0, 4, 7, 0, 0), // 02:00 NY
  );
});

test("no bias means no context", () => {
  assert.equal(contextSnapshot(barsOf(ROWS, AFTER_LONDON), 7, cfg(), "none"), null);
});

test("no context is built the night before the London open", () => {
  const nightBefore = barsOf(ROWS, NIGHT_BEFORE);
  const afterLondon = barsOf(ROWS, AFTER_LONDON);

  assert.equal(nightBefore[7]!.time - afterLondon[7]!.time, 8 * MS_PER_HOUR, "same bars, 8h apart");
  assert.notEqual(contextSnapshot(afterLondon, 7, cfg(), "bullish"), null, "the same bar after the open has context");
  assert.equal(contextSnapshot(nightBefore, 7, cfg(), "bullish"), null, "the night before has none");
});

test("context aligns the dealing range to the direction of the bias", () => {
  const bars = barsOf(ROWS, AFTER_LONDON);
  const bullish = contextSnapshot(bars, 7, cfg(), "bullish")!;

  assert.equal(bullish.timeframe, "H4");
  assert.equal(bullish.range.high, 1.25);
  assert.equal(bullish.range.low, 1.242);
  assert.equal(bullish.range.equilibrium, 1.246);
  assert.equal(bullish.position, "discount");
  assert.equal(bullish.aligned, true, "a bullish bias wants the discount half");

  const misaligned = contextSnapshot(bars, 6, cfg(), "bullish")!;
  assert.equal(misaligned.position, "premium");
  assert.equal(misaligned.aligned, false, "a bullish bias rejects the premium half");

  const bearish = contextSnapshot(bars, 6, cfg(), "bearish")!;
  assert.equal(misaligned.position, bearish.position);
  assert.equal(bearish.aligned, true, "a bearish bias wants the premium half");
});

test("the key level and the CRT are read inside the dealing range", () => {
  const bars = barsOf(ROWS, AFTER_LONDON);
  const bullish = contextSnapshot(bars, 7, cfg(), "bullish")!;

  assert.equal(bullish.keyLevel, 1.242, "a bullish bias keys off the discount level");
  assert.equal(contextSnapshot(bars, 7, cfg(), "bearish")!.keyLevel, 1.25, "a bearish one keys off the premium");

  assert.ok(bullish.crt !== null, "the sweep of 1.242 is recorded as the CRT");
  assert.equal(bullish.crt.level, 1.242);
  assert.equal(bullish.crt.side, "low");
  assert.equal(bullish.crt.isCrt, true, "the body continued away from the swept level");

  const inside = contextSnapshot(bars, 5, cfg(), "bullish")!;
  assert.equal(inside.crt, null, "no sweep, no CRT");
});

test("the CRT trigger stays valid for the configured lookback of H4 candles", () => {
  // Quiet H4 candles after the CRT (through the next session day's London open): no fresh
  // sweep, so only the lookback can arm a setup.
  const quiet: Row = [1.2425, 1.244, 1.2428, 1.243];
  const rows: Row[] = [...ROWS, quiet, quiet, quiet, quiet];
  const bars = barsOf(rows, AFTER_LONDON);
  const withTrigger = (lookback: number) =>
    cfg({ execution: { requireCrt: true, crtLookbackBars: lookback } });

  const fresh = contextSnapshot(bars, 7, withTrigger(6), "bullish")!;
  assert.equal(fresh.recentCrt?.barsAgo, 0, "the CRT candle itself is the freshest trigger");

  // Index 11 is 10:00 UTC on Jan 5: the CRT is four H4 candles back, and still in range.
  const later = contextSnapshot(bars, 11, withTrigger(6), "bullish")!;
  assert.equal(later.crt, null, "the new candle has no sweep of its own");
  assert.equal(later.recentCrt?.side, "low", "the prior candle's CRT is still the trigger");
  assert.equal(later.recentCrt?.barsAgo, 4);

  assert.equal(
    contextSnapshot(bars, 11, withTrigger(3), "bullish")!.recentCrt,
    null,
    "a shorter lookback has already expired the CRT",
  );
  assert.equal(
    contextSnapshot(bars, 11, cfg(), "bullish")!.recentCrt,
    null,
    "without the trigger filter nothing is tracked",
  );
});

test("the context vetoes only a misaligned map, and never before the open", () => {
  const context = (aligned: boolean) => ({
    timeframe: "H4" as const,
    range: { high: 1.25, low: 1.242, equilibrium: 1.246 },
    position: aligned ? ("discount" as const) : ("premium" as const),
    keyLevel: 1.242,
    crt: null,
    recentCrt: null,
    aligned,
  });

  assert.equal(contextVetoes(null), null, "no context, nothing to veto");
  assert.equal(contextVetoes(context(true)), null);
  assert.equal(contextVetoes(context(false)), "not aligned with the dealing range");
});
