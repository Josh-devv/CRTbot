import { DateTime } from "luxon";

import {
  MS_PER_DAY,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  localWallMs,
  mod,
  monthStart,
  sessionDayStart,
  wallMsToInstant,
  weekStart,
} from "./time.js";
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
 * (where the trading day is 23 or 25 hours long). Elapsed minutes and the
 * cached zone offset keep this Luxon-free on ordinary days; transition days
 * fall back to `luxonSubDayBucketStart` (ticket 16).
 */
function subDayBucketStart(ms: number, timeframe: "M15" | "H4", cfg: StrategyConfig): number {
  const session = cfg.session;
  const boundary = session.dayBoundary.hour * 60 + session.dayBoundary.minute;
  const duration = SUB_DAY_MINUTES[timeframe];

  const local = localWallMs(ms, session.tz);
  const dayStart = sessionDayStart(ms, session);
  const localDayStart = localWallMs(dayStart, session.tz);
  if (Number.isNaN(local) || Number.isNaN(localDayStart)) {
    return luxonSubDayBucketStart(ms, timeframe, cfg);
  }

  const elapsed = Math.floor((ms - dayStart) / MS_PER_MINUTE);
  const sinceBoundary = mod(elapsed, MINUTES_PER_DAY);
  const bucketMinutes = boundary + Math.floor(sinceBoundary / duration) * duration;
  const wraps = bucketMinutes >= MINUTES_PER_DAY;
  const localClock = (wraps ? bucketMinutes - MINUTES_PER_DAY : bucketMinutes) * MS_PER_MINUTE;
  const localBucket =
    Math.floor(localDayStart / MS_PER_DAY) * MS_PER_DAY + localClock + (wraps ? MS_PER_DAY : 0);

  const instant = wallMsToInstant(localBucket, local - ms, session.tz);
  return instant ?? luxonSubDayBucketStart(ms, timeframe, cfg);
}

/** The Luxon path for `subDayBucketStart`'s transition days. */
function luxonSubDayBucketStart(ms: number, timeframe: "M15" | "H4", cfg: StrategyConfig): number {
  const { tz } = cfg.session;
  const boundaryMinutes = cfg.session.dayBoundary.hour * 60 + cfg.session.dayBoundary.minute;
  const durationMinutes = SUB_DAY_MINUTES[timeframe];

  const dt = DateTime.fromMillis(ms, { zone: tz });
  const localMinutes = dt.hour * 60 + dt.minute;
  const sinceBoundary = (localMinutes - boundaryMinutes + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const bucketMinutes =
    boundaryMinutes + Math.floor(sinceBoundary / durationMinutes) * durationMinutes;

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

/**
 * `aggregate` as a fold: each `fold` hands in one lower-timeframe bar, and `bars` is exactly
 * what `aggregate` would return for the prefix folded so far — the last candle live until its
 * bucket completes. The replay folds the daily, weekly, monthly and H4 windows forward instead
 * of re-aggregating a prefix (ticket 16).
 */
export class RunningCandles {
  /** The candles folded so far; the last one is the bucket still being built. */
  readonly bars: Bar[] = [];
  private readonly timeframe: Timeframe;
  private readonly cfg: StrategyConfig;
  private key = Number.NaN;

  constructor(timeframe: Timeframe, cfg: StrategyConfig) {
    this.timeframe = timeframe;
    this.cfg = cfg;
  }

  /** Fold one bar in; returns true when it opened a new bucket. */
  fold(bar: Bar): boolean {
    const key = bucketStart(bar.time, this.timeframe, this.cfg);
    if (key !== this.key) {
      this.key = key;
      this.bars.push({
        time: key,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      });
      return true;
    }

    const current = this.bars[this.bars.length - 1]!;
    current.high = Math.max(current.high, bar.high);
    current.low = Math.min(current.low, bar.low);
    current.close = bar.close;
    return false;
  }

  /** The bucket still being built, or undefined before the first fold. */
  get current(): Bar | undefined {
    return this.bars[this.bars.length - 1];
  }
}
