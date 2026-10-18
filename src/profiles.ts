import { isLateWeek, weekStart } from "./time.js";
import type { DayFacts, DayRead, ExpansionTest } from "./types.js";

/**
 * The expansion-day test (ruleset §10), with the weekly-profile read it builds on.
 *
 * §10 is anticipatory: before trading each day it asks "is today an expansion day?", from the
 * weekly profile, the weekly and daily OHLC framework, and Asian-session behaviour. Two
 * heuristics steer which session delivers the move — a consolidated Asia favours a London
 * expansion, an already-expanded Asia favours New York — and the ruleset is explicit that not
 * every day expands, so a day that reads neither way is not an expansion day.
 *
 * The weekly and daily OHLC framework enters as `weekHasExpanded`: the range of the week in play
 * against the prior week's, both built from their daily candles. No separate daily range test is
 * applied: while only Asia has traded, the day's range is just the Asian range, so a daily test
 * carries no independent signal, and §8.1's four-day protocol already encodes the "the daily run
 * has already happened" read. §13 tiers this read as codable.
 *
 * §10 names no late-week condition of its own, but a week that has already expanded only says
 * anything late in it, so the weekly read is taken on Thursday and Friday — the window §8.2
 * uses.
 *
 * The test is evaluated per bar, not once per day: Asia only reveals itself as it trades, so the
 * verdict firms up through the Asian window and is settled by its close, ahead of the London
 * killzone.
 */

/** Asia at or below this multiple of its recent average is consolidating (§10). */
const CONSOLIDATION_FACTOR = 0.75;

/** Asia at or above this multiple of its recent average has already expanded (§10). */
const EXPANSION_FACTOR = 1.5;

/** How many completed days a session range is averaged over. */
const LOOKBACK_DAYS = 5;

/** How far back the weekly profile looks: the week in play and the one before it. */
const TWO_WEEKS = 14;

/** The Asian window's range measured against its recent average (§10). */
export interface AsianProfile {
  /** The Asian window's range today, or null while that window has not traded. */
  range: number | null;
  /** The average range of the completed days behind it, or null without a full lookback. */
  average: number | null;
  /** `range` as a multiple of `average`, or null when either is unknown. */
  ratio: number | null;
}

/** The range a set of days spanned, high to low. */
function rangeOf(days: DayFacts[]): number {
  return Math.max(...days.map((day) => day.high)) - Math.min(...days.map((day) => day.low));
}

/** The Asian window's range for a day, or undefined while that window has not traded. */
function asiaRange(day: DayFacts): number | undefined {
  return day.asia === undefined ? undefined : day.asia.high - day.asia.low;
}

/**
 * The average of a set of optional session ranges, or null without a full lookback of them — a
 * short or gappy history is no baseline at all.
 */
function averageOf(ranges: (number | undefined)[], lookback: number): number | null {
  const present = ranges.filter((range): range is number => range !== undefined);
  if (ranges.length < lookback || present.length !== lookback) return null;
  return present.reduce((sum, range) => sum + range, 0) / lookback;
}

/** The Asian window's range for the day being built, against the completed days behind it. */
export function asianProfile(input: DayRead): AsianProfile {
  const lookback = input.cfg.expansionDay?.lookbackDays ?? LOOKBACK_DAYS;
  const history = input.completedDays.slice(-lookback).map(asiaRange);
  const average = averageOf(history, lookback);
  const range = asiaRange(input.today) ?? null;
  const ratio = range === null || average === null || average === 0 ? null : range / average;
  return { range, average, ratio };
}

/**
 * Whether the week in play has already delivered its expansion, judged against the prior week's
 * range (§8.2, §10). Weeks are Sunday-anchored, and only the two weeks at stake are compared.
 */
export function weekHasExpanded(input: DayRead): boolean {
  const week = weekStart(input.today.day, input.cfg.session);
  const prior = weekStart(week - 1, input.cfg.session);
  const recent = input.completedDays.slice(-TWO_WEEKS);

  const thisWeek = [...recent, input.today].filter(
    (day) => weekStart(day.day, input.cfg.session) === week,
  );
  const priorWeek = recent.filter((day) => weekStart(day.day, input.cfg.session) === prior);

  if (thisWeek.length === 0 || priorWeek.length === 0) return false;
  return rangeOf(thisWeek) >= rangeOf(priorWeek);
}

/**
 * The expansion-day verdict for today (§10). The week is read first, and only late in it — when
 * the fact that it has already delivered means something: the day is not where the move is. Asia
 * then picks between the two heuristics — a consolidated window favours London, an expanded one
 * pushes the move to New York — and a day that reads neither way is not an expansion day.
 */
export function expansionTest(input: DayRead): ExpansionTest {
  if (isLateWeek(input.today.day, input.cfg.session) && weekHasExpanded(input)) {
    return {
      isExpansionDay: false,
      session: "neither",
      reason: "the week has already expanded",
    };
  }

  const asia = asianProfile(input);
  if (asia.ratio === null) {
    return {
      isExpansionDay: false,
      session: "neither",
      reason: "Asia has not given a read yet",
    };
  }

  const consolidation = input.cfg.expansionDay?.consolidationFactor ?? CONSOLIDATION_FACTOR;
  if (asia.ratio <= consolidation) {
    return {
      isExpansionDay: true,
      session: "london",
      reason: "Asia consolidated: London expansion likely",
    };
  }

  const expansion = input.cfg.expansionDay?.expansionFactor ?? EXPANSION_FACTOR;
  if (asia.ratio >= expansion) {
    return {
      isExpansionDay: true,
      session: "newYork",
      reason: "Asia already expanded: New York is the true expansion",
    };
  }

  return {
    isExpansionDay: false,
    session: "neither",
    reason: "Asia is neither consolidated nor expanded",
  };
}
