import { asianProfile, weekHasExpanded } from "./profiles.js";
import { isLateWeek, sessionDayStart, sessionOf } from "./time.js";
import type {
  Bar,
  DayFacts,
  DayRead,
  ExceptionProtocol,
  ExpansionTest,
  MacroContext,
  StrategyConfig,
} from "./types.js";

/**
 * The exception protocols (ruleset §8), the news-day filter (§9), and the enforcement of the
 * expansion-day test (§10).
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

/** The exception protocols in play for the day being built (§8), in ruleset order. */
export function exceptionsInPlay(input: DayRead): ExceptionInPlay[] {
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
  if (isLateWeek(today.day, cfg.session) && weekHasExpanded({ completedDays, today, cfg })) {
    inPlay.push({
      protocol: "weekly-profile",
      reason: "weekly-profile protocol (TGIF): the week has already expanded",
    });
  }

  // §8.3 — Asia expanded early, so London and New York tend to move counter to rebalance.
  const asia = asianProfile({ completedDays, today, cfg });
  if (asia.ratio !== null) {
    const factor = cfg.exceptions?.asianRangeFactor ?? ASIAN_RANGE_FACTOR;
    if (asia.ratio >= factor) {
      const multiple = asia.ratio.toFixed(1);
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

/**
 * Whether the day is skipped entirely: an enforced exception protocol (§8), a news day (§9), an
 * enforced expansion test that did not call today an expansion day (§10), or an enforced macro
 * context with no bias to trade (§3.1.1).
 */
export function dayStandDown(input: {
  exceptions: ExceptionInPlay[];
  newsDay: boolean;
  /** The expansion-day verdict (§10), when the test is configured. */
  expansionTest?: ExpansionTest;
  /** The macro directional context (§3.1.1), when it has been read. */
  macro?: MacroContext;
  cfg: StrategyConfig;
}): DayStandDown {
  const reasons = input.exceptions
    .filter((exception) => enforced(exception.protocol, input.cfg))
    .map((exception) => exception.reason);

  if (input.newsDay && newsStandDown(input.cfg)) reasons.push("news day (NFP/CPI/FOMC)");

  const expansion = input.expansionTest;
  if (expansion !== undefined && input.cfg.expansionDay?.enforce && !expansion.isExpansionDay) {
    reasons.push(expansion.reason);
  }

  const macro = input.macro;
  if (macro !== undefined && input.cfg.macro?.enforce && macro.direction === "none") {
    reasons.push(`no macro bias: ${macro.reason}`);
  }

  return { standDown: reasons.length > 0, reasons };
}
