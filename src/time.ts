import { DateTime } from "luxon";

import type { KillzoneName, SessionConfig, SessionName, Window } from "./types.js";

export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

/**
 * Default session model for spot FX on GBPUSD/EURUSD.
 * The 17:00 New York day boundary makes H4 buckets land on 01:00/05:00/09:00
 * New York — the H4 candles the Axis System references.
 */
export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  tz: "America/New_York",
  dayBoundary: { hour: 17, minute: 0 },
  sessions: {
    asia: { start: "18:00", end: "02:00" },
    london: { start: "02:00", end: "08:00" },
    newYork: { start: "08:00", end: "17:00" },
  },
  killzones: {
    london: { start: "02:00", end: "05:00" },
    newYork: { start: "07:00", end: "10:00" },
  },
  keyMacros: ["03:00", "09:00"],
  newsDays: [],
};

/** "HH:mm" -> minutes since local midnight, or NaN if malformed. */
function parseClock(clock: string): number {
  const [h, m] = clock.split(":").map(Number);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h! < 0 || h! > 23 || m! < 0 || m! > 59) {
    return Number.NaN;
  }
  return h! * 60 + m!;
}

export function localHour(ms: number, tz: string): number {
  return DateTime.fromMillis(ms, { zone: tz }).hour;
}

export function minutesOfDay(ms: number, cfg: SessionConfig): number {
  const dt = DateTime.fromMillis(ms, { zone: cfg.tz });
  return dt.hour * 60 + dt.minute;
}

/** Half-open [start, end); wraps over midnight when end <= start. */
export function inWindow(ms: number, w: Window, cfg: SessionConfig): boolean {
  const t = minutesOfDay(ms, cfg);
  const start = parseClock(w.start);
  const end = parseClock(w.end);
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  return start < end ? t >= start && t < end : t >= start || t < end;
}

export function sessionOf(ms: number, cfg: SessionConfig): SessionName {
  if (inWindow(ms, cfg.sessions.london, cfg)) return "london";
  if (inWindow(ms, cfg.sessions.newYork, cfg)) return "newYork";
  if (inWindow(ms, cfg.sessions.asia, cfg)) return "asia";
  return "other";
}

export function killzoneOf(ms: number, cfg: SessionConfig): KillzoneName | null {
  if (inWindow(ms, cfg.killzones.london, cfg)) return "london";
  if (inWindow(ms, cfg.killzones.newYork, cfg)) return "newYork";
  return null;
}

export function isKeyMacro(ms: number, cfg: SessionConfig): boolean {
  const t = minutesOfDay(ms, cfg);
  return cfg.keyMacros.some((macro) => parseClock(macro) === t);
}

export function dayKey(ms: number, cfg: SessionConfig): string {
  return DateTime.fromMillis(ms, { zone: cfg.tz }).toFormat("yyyy-MM-dd");
}

export function isNewsDay(ms: number, cfg: SessionConfig): boolean {
  return cfg.newsDays.includes(dayKey(ms, cfg));
}

/** Epoch ms of the session-day boundary at or before `ms`. */
export function sessionDayStart(ms: number, cfg: SessionConfig): number {
  const dt = DateTime.fromMillis(ms, { zone: cfg.tz });
  let boundary = dt.startOf("day").set({
    hour: cfg.dayBoundary.hour,
    minute: cfg.dayBoundary.minute,
    second: 0,
    millisecond: 0,
  });
  if (boundary.toMillis() > ms) boundary = boundary.minus({ days: 1 });
  return boundary.toMillis();
}

/**
 * Epoch ms at which a named session's window opens on the session day containing `ms`.
 *
 * A window that starts at or after the day boundary (e.g. Asia at 18:00) begins on the
 * boundary's own calendar date; one that starts before it (e.g. London at 02:00) begins on the
 * next calendar date. Resolved in tz, so it is DST-correct.
 */
export function sessionWindowStart(
  ms: number,
  name: Exclude<SessionName, "other">,
  cfg: SessionConfig,
): number {
  const start = parseClock(cfg.sessions[name].start);
  const boundary = cfg.dayBoundary.hour * 60 + cfg.dayBoundary.minute;
  const boundaryDay = DateTime.fromMillis(sessionDayStart(ms, cfg), { zone: cfg.tz });
  const date = start >= boundary ? boundaryDay : boundaryDay.plus({ days: 1 });

  return date
    .startOf("day")
    .set({ hour: Math.floor(start / 60), minute: start % 60, second: 0, millisecond: 0 })
    .toMillis();
}

/** Epoch ms of the FX week start (Sunday at the day boundary) at or before `ms`. */
export function weekStart(ms: number, cfg: SessionConfig): number {
  let start = sessionDayStart(ms, cfg);
  for (let i = 0; i < 7; i++) {
    if (DateTime.fromMillis(start, { zone: cfg.tz }).weekday === 7) break;
    start = sessionDayStart(start - MS_PER_DAY, cfg);
  }
  return start;
}

/** Epoch ms of the month start (at the day boundary) at or before `ms`. */
export function monthStart(ms: number, cfg: SessionConfig): number {
  const dt = DateTime.fromMillis(ms, { zone: cfg.tz });
  const start = dt.startOf("month").set({
    hour: cfg.dayBoundary.hour,
    minute: cfg.dayBoundary.minute,
    second: 0,
    millisecond: 0,
  });
  return start.toMillis() > ms ? start.minus({ months: 1 }).toMillis() : start.toMillis();
}
