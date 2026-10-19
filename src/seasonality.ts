import { DateTime } from "luxon";

import { monthStart } from "./time.js";
import type {
  Bar,
  BiasDirection,
  MacroContext,
  QuarterlyShift,
  SeasonalRead,
  StrategyConfig,
} from "./types.js";

/**
 * The macro directional context (ruleset §3.1.1): the quarterly-shift framework and seasonal
 * tendencies, both read from monthly candles. The two must **agree**, otherwise the hypothesis is
 * dumped — there is no macro bias.
 *
 * The ruleset names the framework and leaves the implementation depth open (§15), so these are the
 * readings this bot makes of it, and they are deliberately blunt:
 *
 * - **Seasonal tendency** is per calendar month: how often that month closed up across its own
 *   completed history. A month up in more than `bullishShare` of its years is bullish, one up in
 *   fewer than the rest is bearish, and anything between is no tendency at all. The ruleset's
 *   "best time to be bullish is the start of the month" is a *timing* claim inside a month that
 *   monthly candles cannot evidence, so it is not modelled here.
 * - **Quarterly shift** is the last completed quarter's delivery — its close against its own
 *   open. The ruleset also frames the read as confirmation against the quarter before it, but with
 *   continuously priced months the two are one question (see `quarterlyShift`).
 *
 * Tier B: a tendency wants 20-30 years behind it to be worth anything (§13), so `minYears`
 * defaults to the bottom of that range.
 */

const DEFAULT_MIN_YEARS = 20;
const DEFAULT_BULLISH_SHARE = 0.7;

/** The calendar month of `ms`, 1-12, in the session's timezone. */
function calendarMonth(ms: number, cfg: StrategyConfig): number {
  return DateTime.fromMillis(ms, { zone: cfg.session.tz }).month;
}

function monthName(startOfMonth: number, cfg: StrategyConfig): string {
  return DateTime.fromMillis(startOfMonth, { zone: cfg.session.tz }).toFormat("MMMM");
}

/** Epoch ms of the month start `count` months away from `start` (negative walks back). */
function addMonths(start: number, count: number, cfg: StrategyConfig): number {
  return DateTime.fromMillis(start, { zone: cfg.session.tz }).plus({ months: count }).toMillis();
}

/** The month the quarter containing `monthStartMs` starts in. */
function quarterStart(monthStartMs: number, cfg: StrategyConfig): number {
  return addMonths(monthStartMs, -((calendarMonth(monthStartMs, cfg) - 1) % 3), cfg);
}

/** The quarter starting at `start`, as "Q4 2020". */
function quarterName(start: number, cfg: StrategyConfig): string {
  const dt = DateTime.fromMillis(start, { zone: cfg.session.tz });
  return `Q${Math.floor((dt.month - 1) / 3) + 1} ${dt.year}`;
}

/** The candle of the quarter at `start`, or null unless all three of its months are there. */
function quarterBar(months: Bar[], start: number, cfg: StrategyConfig): Bar | null {
  const end = addMonths(start, 3, cfg);
  const quarter = months.filter((bar) => bar.time >= start && bar.time < end);
  if (quarter.length !== 3) return null;

  return {
    time: start,
    open: quarter[0]!.open,
    high: Math.max(...quarter.map((bar) => bar.high)),
    low: Math.min(...quarter.map((bar) => bar.low)),
    close: quarter[quarter.length - 1]!.close,
  };
}

/**
 * How often the calendar month in play has closed up, across the completed months of history
 * (§3.1.1). The month in play contributes nothing to its own read.
 */
export function seasonalTendency(months: Bar[], ms: number, cfg: StrategyConfig): SeasonalRead {
  const current = monthStart(ms, cfg.session);
  const month = calendarMonth(current, cfg);
  const name = monthName(current, cfg);
  const history = months.filter(
    (bar) => bar.time < current && calendarMonth(bar.time, cfg) === month,
  );

  const minYears = cfg.macro?.minYears ?? DEFAULT_MIN_YEARS;
  if (history.length < minYears) {
    return {
      direction: "none",
      upMonths: 0,
      totalMonths: history.length,
      reason: `only ${history.length} ${name}s of history, need ${minYears}`,
    };
  }

  const up = history.filter((bar) => bar.close > bar.open).length;
  const share = up / history.length;
  const bullishShare = cfg.macro?.bullishShare ?? DEFAULT_BULLISH_SHARE;
  const direction: BiasDirection =
    share > bullishShare ? "bullish" : share < 1 - bullishShare ? "bearish" : "none";

  return {
    direction,
    upMonths: up,
    totalMonths: history.length,
    reason:
      `${up} of ${history.length} ${name}s closed up` +
      (direction === "none" ? ": no tendency" : ""),
  };
}

/**
 * The quarterly shift (§3.1.1): where the last **completed** quarter delivered price, read from
 * its close against its own open. The quarter in play has not finished, so it has no say. With
 * continuously priced months the quarter opens where the one before it closed, so "closed above
 * its open" and "closed above the previous quarter" are the same question — one reading, not two.
 */
export function quarterlyShift(months: Bar[], ms: number, cfg: StrategyConfig): QuarterlyShift {
  const start = addMonths(quarterStart(monthStart(ms, cfg.session), cfg), -3, cfg);
  const quarter = quarterName(start, cfg);
  const bar = quarterBar(months, start, cfg);

  if (bar === null) {
    return {
      direction: "none",
      quarter,
      reason: `the last quarter (${quarter}) is not complete in the data`,
    };
  }

  if (bar.close === bar.open) {
    return { direction: "none", quarter, reason: `${quarter} closed flat` };
  }

  const up = bar.close > bar.open;
  return {
    direction: up ? "bullish" : "bearish",
    quarter,
    reason: `${quarter} closed ${up ? "up" : "down"}`,
  };
}

/**
 * The macro context (§3.1.1): the quarterly shift and the seasonal tendency, which must **agree**
 * before either is believed. When they point different ways — or either has nothing to say —
 * the hypothesis is dumped and there is no macro bias. Both reads are published either way,
 * because a dump is only explainable if the log shows what each side saw.
 */
export function macroContext(months: Bar[], ms: number, cfg: StrategyConfig): MacroContext {
  const seasonal = seasonalTendency(months, ms, cfg);
  const quarterly = quarterlyShift(months, ms, cfg);

  if (seasonal.direction !== "none" && seasonal.direction === quarterly.direction) {
    return {
      direction: seasonal.direction,
      seasonal,
      quarterly,
      reason: `${seasonal.reason}, and ${quarterly.reason}`,
    };
  }

  let reason: string;
  if (seasonal.direction === "none") {
    reason = `no seasonal read: ${seasonal.reason}`;
  } else if (quarterly.direction === "none") {
    reason = `no quarterly read: ${quarterly.reason}`;
  } else {
    reason = "the quarterly shift and the seasonal tendency disagree";
  }

  return { direction: "none", seasonal, quarterly, reason };
}
