import { test } from "node:test";
import assert from "node:assert/strict";

import { biasSnapshot, biasVetoes, resolveBias, structuralBias } from "../src/bias.js";
import { DEFAULT_SESSION_CONFIG } from "../src/time.js";
import type { Bar, StrategyConfig } from "../src/types.js";

const DAY = 86_400_000;
/** Monday 2021-01-04 — a clean week start, so W1/MN1 buckets land predictably. */
const START = Date.UTC(2021, 0, 4);
const WICK = 0.0001;

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
 * One bar per close, one day apart. The wick is tiny and taken from the close (not the open)
 * so consecutive bars never share an extreme — otherwise a pullback bar's high would tie the
 * peak's high and the pivot would not register.
 */
function dailyBars(closes: number[]): Bar[] {
  return closes.map((close, i) => ({
    time: START + i * DAY,
    open: i === 0 ? close : closes[i - 1]!,
    high: close + WICK,
    low: close - WICK,
    close,
  }));
}

/** Alternating legs (three up, two back), so pivots exist and the last leg sets the read. */
function wave(leg: number, retrace: number, cycles: number): number[] {
  const closes: number[] = [1.2];
  for (let c = 0; c < cycles; c++) {
    for (let i = 0; i < 3; i++) closes.push(closes.at(-1)! + leg);
    for (let i = 0; i < 2; i++) closes.push(closes.at(-1)! + retrace);
  }
  return closes;
}

const BULLISH = wave(0.004, -0.001, 20);
const BEARISH = wave(-0.004, 0.001, 20);

test("structuralBias reads bullish when highs are broken most recently", () => {
  assert.equal(structuralBias(dailyBars(BULLISH), cfg()), "bullish");
});

test("structuralBias reads bearish when lows are broken most recently", () => {
  assert.equal(structuralBias(dailyBars(BEARISH), cfg()), "bearish");
});

test("structuralBias reads none when no structure is broken", () => {
  const flat = dailyBars(new Array(40).fill(1.2));
  assert.equal(structuralBias(flat, cfg()), "none");
});

test("the daily read governs, and an opposing higher timeframe vetoes it", () => {
  assert.equal(resolveBias("bullish", "bullish", "bullish"), "bullish");
  assert.equal(resolveBias("bearish", "bearish", "bearish"), "bearish");
  assert.equal(resolveBias("bullish", "none", "none"), "bullish", "neutral tfs do not veto");
  assert.equal(resolveBias("bullish", "bearish", "bullish"), "none", "weekly vetoes");
  assert.equal(resolveBias("bearish", "bullish", "bearish"), "none", "weekly vetoes");
  assert.equal(resolveBias("bullish", "bullish", "bearish"), "none", "monthly vetoes");
  assert.equal(resolveBias("none", "bullish", "bullish"), "none", "no daily read, no bias");
});

test("biasSnapshot refines Monthly to Daily and reports each read", () => {
  const snapshot = biasSnapshot(dailyBars(BULLISH), cfg());

  assert.equal(snapshot.daily, "bullish");
  assert.equal(snapshot.direction, "bullish");
  assert.notEqual(snapshot.weekly, "bearish", "the weekly read does not oppose the daily");
});

test("biasSnapshot reports no bias when nothing is broken on any timeframe", () => {
  const snapshot = biasSnapshot(dailyBars(new Array(120).fill(1.2)), cfg());

  assert.equal(snapshot.direction, "none");
});

test("a trade against the bias is rejected; a neutral bias does not veto", () => {
  assert.equal(biasVetoes("bullish", "long"), null);
  assert.equal(biasVetoes("bearish", "short"), null);
  assert.match(biasVetoes("bearish", "long")!, /bias/i, "the reason names the bias");
  assert.match(biasVetoes("bullish", "short")!, /bias/i);
  assert.equal(biasVetoes("none", "long"), null, "a neutral bias does not veto");
  assert.equal(biasVetoes("none", "short"), null);
});
