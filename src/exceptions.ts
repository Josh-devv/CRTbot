import { sessionDayStart, sessionOf, weekStart, weekdayOf } from "./time.js";
import type { Bar, ExceptionProtocol, StrategyConfig } from "./types.js";

/**
 * The exception protocols (ruleset §8), and the news-day filter (§9).
 *
 * §8 recognises exactly three protocols — 4-day, weekly-profile (including TGIF), and
 * Asian-range — and names no others. When one is in play Sham's action is to skip the day
 * entirely, so detection and enforcement are kept apart here: `exceptionsInPlay` reports what
 * the day looks like, `dayStandDown` decides whether the configuration skips it.
 *
 * The protocols are anticipation, not validation: they never flip the bias, they only say the
 * day carries counter-move risk.
 */

/** A day counts as already expanded once its Asian range reaches this multiple of the average. */
const ASIAN_RANGE_FACTOR = 1.5;

/** How many completed days the Asian range is measured against. */
const ASIAN_AVERAGE_DAYS = 5;

/** One session day, as the day itself is forming. */
export interface DayFacts {
  /** Epoch ms of the session day's start. */
  day: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** The Asian window's range, once that window has traded inside this session day. */
  asia?: { high: number; low: number };
}

/** An exception protocol that is in play, with the reason to show for it. */
export interface ExceptionInPlay {
  protocol: ExceptionProtocol;
  reason: string;
}

/** The stand-down verdict for a session day. */
export interface DayStandDown {
  standDown: boolean;
  /** One line per enforced reason. */
  reasons: string[];
}

/**
 * Fold one bar into the session day's facts. Returns a new object each time, so a completed day
 * stays intact once the boundary rolls over.
 */
export function foldDay(previous: DayFacts | null, bar: Bar, cfg: StrategyConfig): DayFacts {
  const day = sessionDayStart(bar.time, cfg.session);
  const continuing = previous !== null && previous.day === day;

  let asia = continuing ? previous.asia : undefined;
  if (sessionOf(bar.time, cfg.session) === "asia") {
    asia =
      asia === undefined
        ? { high: bar.high, low: bar.low }
        : { high: Math.max(asia.high, bar.high), low: Math.min(asia.low, bar.low) };
  }

  if (!continuing) {
    return { day, open: bar.open, high: bar.high, low: bar.low, close: bar.close, asia };
  }

  return {
    day,
    open: previous.open,
    high: Math.max(previous.high, bar.high),
    low: Math.min(previous.low, bar.low),
    close: bar.close,
    asia,
  };
}

/** Which way a completed day moved: its body, close against open. */
function dayDirection(day: DayFacts): "up" | "down" | "flat" {
  if (day.close > day.open) return "up";
  if (day.close < day.open) return "down";
  return "flat";
}

/** The range a set of days spanned, high to low. */
function rangeOf(days: DayFacts[]): number {
  return Math.max(...days.map((day) => day.high)) - Math.min(...days.map((day) => day.low));
}

/** The exception protocols in play for the day being built (§8), in ruleset order. */
export function exceptionsInPlay(input: {
  /** Every session day strictly before the one being built. */
  completedDays: DayFacts[];
  /** The day being built, as it stands on this bar. */
  today: DayFacts;
  cfg: StrategyConfig;
}): ExceptionInPlay[] {
  const { completedDays, today, cfg } = input;
  const inPlay: ExceptionInPlay[] = [];

  // §8.1 — four consecutive days one way: the next day tends to counter.
  const lastFour = completedDays.slice(-4);
  if (lastFour.length === 4) {
    const direction = dayDirection(lastFour[0]!);
    if (direction !== "flat" && lastFour.every((day) => dayDirection(day) === direction)) {
      inPlay.push({
        protocol: "four-day",
        reason: `four-day protocol: four consecutive days ${direction}`,
      });
    }
  }

  // §8.2 — the weekly profile has already delivered the move, and it is late in the week
  // (TGIF, so Thursday or Friday). Expansion is read as this week's range having reached the
  // previous week's.
  const weekday = weekdayOf(today.day, cfg.session);
  if (weekday === 4 || weekday === 5) {
    // Only the current and previous week can bear on the comparison; two weeks always contain
    // both, which keeps this scan bounded however long the run is.
    const byWeek = new Map<number, DayFacts[]>();
    for (const day of [...completedDays.slice(-14), today]) {
      const week = weekStart(day.day, cfg.session);
      const bucket = byWeek.get(week);
      if (bucket === undefined) byWeek.set(week, [day]);
      else bucket.push(day);
    }

    const weeks = [...byWeek.keys()].sort((a, b) => a - b);
    const thisWeek = byWeek.get(weeks[weeks.length - 1]!);
    const priorWeek = byWeek.get(weeks[weeks.length - 2]!);
    if (thisWeek !== undefined && priorWeek !== undefined) {
      if (rangeOf(thisWeek) >= rangeOf(priorWeek)) {
        inPlay.push({
          protocol: "weekly-profile",
          reason: "weekly-profile protocol (TGIF): the week has already expanded",
        });
      }
    }
  }

  // §8.3 — Asia expanded early, so London and New York tend to move counter to rebalance.
  const history = completedDays
    .slice(-ASIAN_AVERAGE_DAYS)
    .map((day) => day.asia)
    .filter((asia): asia is { high: number; low: number } => asia !== undefined);
  if (today.asia !== undefined && history.length === ASIAN_AVERAGE_DAYS) {
    const total = history.reduce((sum, asia) => sum + (asia.high - asia.low), 0);
    const average = total / history.length;
    const factor = cfg.exceptions?.asianRangeFactor ?? ASIAN_RANGE_FACTOR;
    const expanded = today.asia.high - today.asia.low;
    if (expanded >= factor * average) {
      const multiple = (expanded / average).toFixed(1);
      inPlay.push({
        protocol: "asian-range",
        reason: `asian-range protocol: Asia expanded early (${multiple}x its recent average)`,
      });
    }
  }

  return inPlay;
}

/** The config switch for each protocol, so the protocol names never drift from the config. */
const ENFORCED_BY: Record<ExceptionProtocol, "fourDay" | "weeklyProfile" | "asianRange"> = {
  "four-day": "fourDay",
  "weekly-profile": "weeklyProfile",
  "asian-range": "asianRange",
};

/**
 * Whether a detected protocol is enforced. An absent `exceptions` block means the ruleset's own
 * action — skip the day entirely (§8) — so it takes an explicit `false` to trade through one.
 */
function enforced(protocol: ExceptionProtocol, cfg: StrategyConfig): boolean {
  const exceptions = cfg.exceptions;
  if (exceptions === undefined) return true;
  return exceptions[ENFORCED_BY[protocol]];
}

/** The news-day filter (§9): no trading on NFP / CPI / FOMC. Enforced unless configured off. */
function newsStandDown(cfg: StrategyConfig): boolean {
  return cfg.news?.standDown ?? true;
}

/** Skip the day entirely (§8) if any protocol in play is enforced, or it is a news day (§9). */
export function dayStandDown(input: {
  exceptions: ExceptionInPlay[];
  newsDay: boolean;
  cfg: StrategyConfig;
}): DayStandDown {
  const reasons = input.exceptions
    .filter((exception) => enforced(exception.protocol, input.cfg))
    .map((exception) => exception.reason);

  if (input.newsDay && newsStandDown(input.cfg)) reasons.push("news day (NFP/CPI/FOMC)");

  return { standDown: reasons.length > 0, reasons };
}
