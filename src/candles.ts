import { DateTime } from "luxon";

import { MS_PER_HOUR, MS_PER_MINUTE, monthStart, sessionDayStart, weekStart } from "./time.js";
import type { Bar, StrategyConfig, Timeframe } from "./types.js";

const MINUTES_PER_DAY = 24 * 60;

const SUB_DAY_MINUTES: Record<"M15" | "H4", number> = {
  M15: 15,
  H4: 4 * (MS_PER_HOUR / MS_PER_MINUTE),
};

/** The Axis System fixes execution at M15, so every decision names its M15 candle bucket. */
export const EXECUTION_TIMEFRAME: Timeframe = "M15";

/**
 * Sub-day buckets advance on the wall clock, not on elapsed milliseconds, so
 * the H4 grid stays on 01:00/05:00/09:00 local even across a DST transition
 * (where the trading day is 23 or 25 hours long).
 */
function subDayBucketStart(ms: number, timeframe: "M15" | "H4", cfg: StrategyConfig): number {
  const { tz } = cfg.session;
  const boundaryMinutes = cfg.session.dayBoundary.hour * 60 + cfg.session.dayBoundary.minute;
  const durationMinutes = SUB_DAY_MINUTES[timeframe];

  const dt = DateTime.fromMillis(ms, { zone: tz });
  const localMinutes = dt.hour * 60 + dt.minute;
  const sinceBoundary = (localMinutes - boundaryMinutes + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const bucketMinutes = boundaryMinutes + Math.floor(sinceBoundary / durationMinutes) * durationMinutes;

  const dayStart = DateTime.fromMillis(sessionDayStart(ms, cfg.session), { zone: tz });
  const wraps = bucketMinutes >= MINUTES_PER_DAY;
  const local = wraps ? bucketMinutes - MINUTES_PER_DAY : bucketMinutes;
  const bucket = dayStart
    .set({ hour: Math.floor(local / 60), minute: local % 60, second: 0, millisecond: 0 })
    .plus({ days: wraps ? 1 : 0 });

  return bucket.toMillis();
}

/** Epoch ms of the candle bucket containing `ms`, session-anchored. */
export function bucketStart(ms: number, timeframe: Timeframe, cfg: StrategyConfig): number {
  const session = cfg.session;
  switch (timeframe) {
    case "MN1":
      return monthStart(ms, session);
    case "W1":
      return weekStart(ms, session);
    case "D1":
      return sessionDayStart(ms, session);
    default:
      return subDayBucketStart(ms, timeframe, cfg);
  }
}

/**
 * Aggregate lower-timeframe bars into candles of `timeframe`.
 * Expects `bars` sorted ascending by time.
 */
export function aggregate(bars: Bar[], timeframe: Timeframe, cfg: StrategyConfig): Bar[] {
  const out: Bar[] = [];
  let current: Bar | null = null;
  let currentKey = Number.NaN;

  for (const bar of bars) {
    const key = bucketStart(bar.time, timeframe, cfg);
    if (current === null || key !== currentKey) {
      if (current !== null) out.push(current);
      current = { time: key, open: bar.open, high: bar.high, low: bar.low, close: bar.close };
      currentKey = key;
    } else {
      current.high = Math.max(current.high, bar.high);
      current.low = Math.min(current.low, bar.low);
      current.close = bar.close;
    }
  }

  if (current !== null) out.push(current);
  return out;
}
