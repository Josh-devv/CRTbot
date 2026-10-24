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

/**
 * Zone offsets in milliseconds east of UTC, memoized per UTC day. A day whose offset differs at
 * its two ends contains a DST transition and is memoized as NaN; every helper that reads it then
 * falls back to Luxon for that day. That is a couple of days a year at Luxon speed, instead of a
 * Luxon call per bar for twenty-five years of data (ticket 16).
 */
const DAY_OFFSETS = new Map<string, number>();

/**
 * The last offset resolved, so a day's worth of consecutive calls — every bar of a
 * session day reads the same UTC day, and every load folds thousands of bars — skip the
 * string-keyed map entirely.
 */
let lastDay = Number.NaN;
let lastTz = "";
let lastOffset = Number.NaN;

/** The zone's offset in ms through the UTC day — equal at both ends only on transition-free days. */
function offsetOnDay(day: number, tz: string): number {
  if (day === lastDay && tz === lastTz) return lastOffset;

  const key = `${tz}|${day}`;
  const hit = DAY_OFFSETS.get(key);
  if (hit === undefined) {
    const at = (ms: number): number => DateTime.fromMillis(ms, { zone: tz }).offset * MS_PER_MINUTE;
    const start = at(day * MS_PER_DAY);
    const end = at((day + 1) * MS_PER_DAY - 1);
    const offset = start === end ? start : Number.NaN;
    DAY_OFFSETS.set(key, offset);
    lastDay = day;
    lastTz = tz;
    lastOffset = offset;
    return offset;
  }

  lastDay = day;
  lastTz = tz;
  lastOffset = hit;
  return hit;
}

/**
 * `ms` on `tz`'s wall clock as epoch-like milliseconds — its UTC getters name the local clock —
 * or NaN when it sits on a DST transition day, where a constant offset cannot be trusted.
 */
export function localWallMs(ms: number, tz: string): number {
  const offset = offsetOnDay(Math.floor(ms / MS_PER_DAY), tz);
  return Number.isNaN(offset) ? Number.NaN : ms + offset;
}

/**
 * The instant a wall-clock value names in `tz`, given the offset of the day the reading came
 * from; null when that instant lands on a day with a different offset, so the caller can fall
 * back to Luxon.
 */
export function wallMsToInstant(localMs: number, offset: number, tz: string): number | null {
  const instant = localMs - offset;
  return offsetOnDay(Math.floor(instant / MS_PER_DAY), tz) === offset ? instant : null;
}

/** Non-negative remainder, so wall-clock arithmetic is right on both sides of 1970. */
export function mod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

const CLOCKS = new Map<string, number>();

/** "HH:mm" -> minutes since local midnight, or NaN if malformed. Memoized: read every bar. */
function parseClock(clock: string): number {
  const hit = CLOCKS.get(clock);
  if (hit !== undefined) return hit;

  const [h, m] = clock.split(":").map(Number);
  const minutes =
    Number.isInteger(h) && Number.isInteger(m) && h! >= 0 && h! <= 23 && m! >= 0 && m! <= 59
      ? h! * 60 + m!
      : Number.NaN;
  CLOCKS.set(clock, minutes);
  return minutes;
}

export function localHour(ms: number, tz: string): number {
  const local = localWallMs(ms, tz);
  if (Number.isNaN(local)) return DateTime.fromMillis(ms, { zone: tz }).hour;
  return Math.floor(mod(local, MS_PER_DAY) / MS_PER_HOUR);
}

export function minutesOfDay(ms: number, cfg: SessionConfig): number {
  const local = localWallMs(ms, cfg.tz);
  if (Number.isNaN(local)) {
    const dt = DateTime.fromMillis(ms, { zone: cfg.tz });
    return dt.hour * 60 + dt.minute;
  }
  return Math.floor(mod(local, MS_PER_DAY) / MS_PER_MINUTE);
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
  const local = localWallMs(ms, cfg.tz);
  if (Number.isNaN(local)) return DateTime.fromMillis(ms, { zone: cfg.tz }).toFormat("yyyy-MM-dd");

  const date = new Date(local);
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isNewsDay(ms: number, cfg: SessionConfig): boolean {
  return cfg.newsDays.includes(dayKey(ms, cfg));
}

/**
 * The weekday of the session day containing `ms`, in the session timezone: 1 Monday to 7 Sunday
 * (Luxon's numbering).
 */
export function weekdayOf(ms: number, cfg: SessionConfig): number {
  const start = sessionDayStart(ms, cfg);
  const local = localWallMs(start, cfg.tz);
  if (Number.isNaN(local)) return DateTime.fromMillis(start, { zone: cfg.tz }).weekday;
  return ((new Date(local).getUTCDay() + 6) % 7) + 1;
}

/** The day boundary, in minutes since local midnight. */
function boundaryMinutes(cfg: SessionConfig): number {
  return cfg.dayBoundary.hour * 60 + cfg.dayBoundary.minute;
}

/** Epoch ms of the session-day boundary at or before `ms`. */
export function sessionDayStart(ms: number, cfg: SessionConfig): number {
  const local = localWallMs(ms, cfg.tz);
  if (Number.isNaN(local)) return luxonSessionDayStart(ms, cfg);

  const boundary = boundaryMinutes(cfg) * MS_PER_MINUTE;
  const localBoundary = Math.floor((local - boundary) / MS_PER_DAY) * MS_PER_DAY + boundary;
  return wallMsToInstant(localBoundary, local - ms, cfg.tz) ?? luxonSessionDayStart(ms, cfg);
}

/** The Luxon path, kept for the two DST days a year `sessionDayStart` cannot do arithmetically. */
function luxonSessionDayStart(ms: number, cfg: SessionConfig): number {
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
  const dayStart = sessionDayStart(ms, cfg);
  const localDay = localWallMs(dayStart, cfg.tz);
  if (Number.isNaN(localDay)) return luxonSessionWindowStart(ms, name, cfg);

  const nextDate = start >= boundaryMinutes(cfg) ? 0 : MS_PER_DAY;
  const localOpen = Math.floor(localDay / MS_PER_DAY) * MS_PER_DAY + nextDate + start * MS_PER_MINUTE;
  return wallMsToInstant(localOpen, localDay - dayStart, cfg.tz) ?? luxonSessionWindowStart(ms, name, cfg);
}

/** The Luxon path for `sessionWindowStart`'s transition days. */
function luxonSessionWindowStart(
  ms: number,
  name: Exclude<SessionName, "other">,
  cfg: SessionConfig,
): number {
  const start = parseClock(cfg.sessions[name].start);
  const boundary = boundaryMinutes(cfg);
  const boundaryDay = DateTime.fromMillis(sessionDayStart(ms, cfg), { zone: cfg.tz });
  const date = start >= boundary ? boundaryDay : boundaryDay.plus({ days: 1 });

  return date
    .startOf("day")
    .set({ hour: Math.floor(start / 60), minute: start % 60, second: 0, millisecond: 0 })
    .toMillis();
}

/**
 * True on the late-week session days — Thursday and Friday — when a week that has already
 * expanded says something, and a counter move is expected (§8.2, §10).
 */
export function isLateWeek(ms: number, cfg: SessionConfig): boolean {
  const weekday = weekdayOf(ms, cfg);
  return weekday === 4 || weekday === 5;
}

/** Epoch ms of the FX week start (Sunday at the day boundary) at or before `ms`. */
export function weekStart(ms: number, cfg: SessionConfig): number {
  let start = sessionDayStart(ms, cfg);
  for (let i = 0; i < 7; i++) {
    if (weekdayOf(start, cfg) === 7) break;
    start = sessionDayStart(start - MS_PER_DAY, cfg);
  }
  return start;
}

/** Epoch ms of the month start (at the day boundary) at or before `ms`. */
export function monthStart(ms: number, cfg: SessionConfig): number {
  const local = localWallMs(ms, cfg.tz);
  if (Number.isNaN(local)) return luxonMonthStart(ms, cfg);

  const boundary = boundaryMinutes(cfg) * MS_PER_MINUTE;
  const date = new Date(local);
  let localStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) + boundary;
  if (localStart > local) {
    localStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1) + boundary;
  }
  return wallMsToInstant(localStart, local - ms, cfg.tz) ?? luxonMonthStart(ms, cfg);
}

/** The Luxon path for `monthStart`'s transition days. */
function luxonMonthStart(ms: number, cfg: SessionConfig): number {
  const dt = DateTime.fromMillis(ms, { zone: cfg.tz });
  const start = dt.startOf("month").set({
    hour: cfg.dayBoundary.hour,
    minute: cfg.dayBoundary.minute,
    second: 0,
    millisecond: 0,
  });
  return start.toMillis() > ms ? start.minus({ months: 1 }).toMillis() : start.toMillis();
}
