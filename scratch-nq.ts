/**
 * NY AM precision scalp prototype — index futures (NQ=F / ES=F), 1m bars.
 *
 * Owner spec: "during those times we wait for liquidity to get taken out, smts to form, key levels
 * being hit prolly in the 15 or 30 mins, all while having an idea of the bias for the day or
 * session … make use of market profiles … even if it's just scalping 10-15 min trades … RR doesn't
 * matter, precision matters."
 *
 * Model:
 *   1. Key levels for the session: overnight H/L (18:00 -> 08:00 ET), prior RTH H/L/close/open
 *      (09:30-16:00 ET), overnight and prior-RTH volume-profile POC/VAH/VAL (70% value area), and
 *      the last two confirmed 15m + 30m swing highs/lows.
 *   2. Bias gate: --bias session (price vs prior RTH close) | prior (prior day candle direction) |
 *      none. Bullish bias = only long raids (sweep of lows + reclaim); bearish = only short raids.
 *   3. Raid: in the scan window (09:30-10:00 default) price trades beyond a level and closes back
 *      inside within 5 bars; the most recently crossed level wins. Each level is raided once/day.
 *   4. SMT: the correlated index must fail the same test. Session levels use the equivalent session
 *      level on the other index; profile/swing levels use the 30-bar structural swing.
 *   5. Order-flow proxy: raid volume spike vs trailing hour OR strong rejection close.
 *   6. Entry at the reclaim close. Stop beyond the raid wick + buffer.
 *   7. Target: fixed --target-r (default 1R) for precision, or pool ladder if --target-r 0.
 *   8. Time stop: --time-stop minutes (default 15) — if neither stop nor target, exit at market.
 *
 *   npx tsx scratch-nq.ts [--bias session|prior|none] [--target-r 1] [--time-stop 15]
 *                         [--from 9:30] [--to 10:00] [--instrument NQ|ES|both]
 *                         [--smt-mode level|swing] [--no-smt] [--ofilter either|volume|reject|none]
 *                         [--entry reclaim|leg|range|limit] [--buffer 4] [--cost 1]
 */
import { readFile } from "node:fs/promises";
import { DateTime } from "luxon";

const NY = "America/New_York";
const FLAT = 15 * 60 + 55; // 15:55 ET

interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Acc {
  open: number;
  high: number;
  low: number;
  close: number;
}

interface Profile {
  poc: number;
  vah: number;
  val: number;
}

interface Swing {
  value: number;
  confirmTime: number;
}

type LevelKind =
  | "overnight"
  | "rth"
  | "asia"
  | "pocON"
  | "vahON"
  | "valON"
  | "pocRTH"
  | "vahRTH"
  | "valRTH"
  | "pocAsia"
  | "vahAsia"
  | "valAsia"
  | "open15"
  | "open30"
  | "swing15"
  | "swing30";

interface Level {
  value: number;
  kind: LevelKind;
}

interface Trade {
  label: string;
  date: string;
  side: "long" | "short";
  entryTime: number;
  entry: number;
  stop: number;
  target: number;
  exit: number;
  r: number;
  plannedR: number;
  riskPoints: number;
  reason: "target" | "stop" | "flat" | "time";
  mfeR: number;
  maeR: number;
}

interface Funnel {
  raids: number;
  smtPass: number;
  ofPass: number;
  triggers: number;
  noDraw: number;
}

// ---------------------------------------------------------------- flags

const rest = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const index = rest.indexOf(name);
  return index === -1 ? undefined : rest[index + 1];
};
const parseTime = (value: string | undefined, fallback: number): number => {
  if (value === undefined) return fallback;
  const [hours, minutes] = value.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
};

type SessionMode = "ny" | "london";
const sessionMode = (flag("--session") ?? "ny") as SessionMode;
const OPEN = parseTime(flag("--from"), sessionMode === "london" ? 3 * 60 : 9 * 60 + 30);
const WINDOW_END = parseTime(flag("--to"), sessionMode === "london" ? 5 * 60 : 10 * 60);
const ORB_START = parseTime(flag("--orb-start"), sessionMode === "london" ? 3 * 60 : 9 * 60 + 30);
const TRIGGER_END = WINDOW_END + 30;
const instrumentFlag = flag("--instrument") ?? "both";
const requireSmt = !rest.includes("--no-smt");
const ofilter = (flag("--ofilter") ?? "either") as "either" | "volume" | "reject" | "none";
type EntryMode = "reclaim" | "leg" | "range" | "limit";
const entryMode = (flag("--entry") ?? "reclaim") as EntryMode;
type BiasMode = "none" | "session" | "prior";
const biasMode = (flag("--bias") ?? "session") as BiasMode;
const smtMode = (flag("--smt-mode") ?? "level") as "level" | "swing";
const minR = Number(flag("--min-r") ?? 0.5);
const maxR = Number(flag("--max-r") ?? Infinity);
const targetR = Number(flag("--target-r") ?? 1);
const timeStop = Number(flag("--time-stop") ?? 15);
const minPenetration = Number(flag("--penetration") ?? 0);
const bufferFlag = flag("--buffer");
const costFlag = flag("--cost");
const profileBinFlag = flag("--profile-bin");
const source = flag("--source") ?? "yahoo";
const monthly = rest.includes("--monthly");
type LevelFilter = "all" | "session" | "profile" | "swing";
const levelFilter = (flag("--levels") ?? "all") as LevelFilter;
const levelKindAllowed = (kind: LevelKind): boolean => {
  if (levelFilter === "all") return true;
  if (levelFilter === "session") return kind === "overnight" || kind === "rth" || kind === "asia";
  if (levelFilter === "profile")
    return ["pocON", "vahON", "valON", "pocRTH", "vahRTH", "valRTH", "pocAsia", "vahAsia", "valAsia"].includes(kind);
  if (levelFilter === "opening") return kind === "open15" || kind === "open30";
  return kind === "swing15" || kind === "swing30";
};

// ---------------------------------------------------------------- data

async function load(label: string): Promise<Bar[]> {
  const file =
    source === "duka"
      ? `data/indices/${label}-duka.json`
      : source === "alpaca5"
        ? `data/indices/${label}-5y.json`
        : `data/indices/${label}.json`;
  return JSON.parse(await readFile(file, "utf8")) as Bar[];
}

/** Overnight (18:00-08:00 ET), Asia (18:00-02:00 ET) and RTH (09:30-16:00 ET) aggregates + bar lists, keyed by ET date. */
function computeLevels(bars: Bar[]): {
  overnight: Map<string, Acc>;
  asia: Map<string, Acc>;
  rth: Map<string, Acc>;
  overnightBars: Map<string, Bar[]>;
  asiaBars: Map<string, Bar[]>;
  rthBars: Map<string, Bar[]>;
} {
  const overnight = new Map<string, Acc>();
  const asia = new Map<string, Acc>();
  const rth = new Map<string, Acc>();
  const overnightBars = new Map<string, Bar[]>();
  const asiaBars = new Map<string, Bar[]>();
  const rthBars = new Map<string, Bar[]>();

  for (const bar of bars) {
    const dt = DateTime.fromMillis(bar.time, { zone: NY });
    const minutes = dt.hour * 60 + dt.minute;
    const date = dt.toFormat("yyyy-MM-dd");

    if (minutes >= 570 && minutes < 960) {
      const acc = rth.get(date) ?? { open: NaN, high: -Infinity, low: Infinity, close: NaN };
      if (!Number.isFinite(acc.open)) acc.open = bar.open;
      acc.high = Math.max(acc.high, bar.high);
      acc.low = Math.min(acc.low, bar.low);
      acc.close = bar.close;
      rth.set(date, acc);
      const list = rthBars.get(date) ?? [];
      list.push(bar);
      rthBars.set(date, list);
    }

    if (minutes >= 1080 || minutes < 480) {
      const key = minutes >= 1080 ? dt.plus({ days: 1 }).toFormat("yyyy-MM-dd") : date;
      const acc = overnight.get(key) ?? { open: NaN, high: -Infinity, low: Infinity, close: NaN };
      if (!Number.isFinite(acc.open)) acc.open = bar.open;
      acc.high = Math.max(acc.high, bar.high);
      acc.low = Math.min(acc.low, bar.low);
      acc.close = bar.close;
      overnight.set(key, acc);
      const list = overnightBars.get(key) ?? [];
      list.push(bar);
      overnightBars.set(key, list);
    }

    if (minutes >= 1080 || minutes < 120) {
      const key = minutes >= 1080 ? dt.plus({ days: 1 }).toFormat("yyyy-MM-dd") : date;
      const acc = asia.get(key) ?? { open: NaN, high: -Infinity, low: Infinity, close: NaN };
      if (!Number.isFinite(acc.open)) acc.open = bar.open;
      acc.high = Math.max(acc.high, bar.high);
      acc.low = Math.min(acc.low, bar.low);
      acc.close = bar.close;
      asia.set(key, acc);
      const list = asiaBars.get(key) ?? [];
      list.push(bar);
      asiaBars.set(key, list);
    }
  }

  return { overnight, asia, rth, overnightBars, asiaBars, rthBars };
}

/** Last RTH date strictly before `date` (previous session, skipping weekends/holidays). */
function previousRthDate(rth: Map<string, Acc>, date: string): string | undefined {
  let best: string | undefined;
  for (const key of rth.keys()) if (key < date && (best === undefined || key > best)) best = key;
  return best;
}

/** Volume profile from 1m bars: volume spread uniformly across each bar's range. */
function volumeProfile(bars: Bar[], binSize: number): Profile | undefined {
  if (bars.length === 0) return undefined;
  const histogram = new Map<number, number>();
  for (const bar of bars) {
    const lowBin = Math.floor(bar.low / binSize);
    const highBin = Math.floor(bar.high / binSize);
    const bins = highBin - lowBin + 1;
    const share = bar.volume / bins;
    for (let bin = lowBin; bin <= highBin; bin++) histogram.set(bin, (histogram.get(bin) ?? 0) + share);
  }

  let pocBin = 0;
  let pocVolume = -Infinity;
  let total = 0;
  for (const [bin, volume] of histogram) {
    total += volume;
    if (volume > pocVolume) {
      pocVolume = volume;
      pocBin = bin;
    }
  }

  let low = pocBin;
  let high = pocBin;
  let accumulated = histogram.get(pocBin) ?? 0;
  while (accumulated < 0.7 * total) {
    const nextLow = histogram.get(low - 1) ?? 0;
    const nextHigh = histogram.get(high + 1) ?? 0;
    if (nextLow === 0 && nextHigh === 0) break;
    if (nextHigh >= nextLow) {
      high++;
      accumulated += nextHigh;
    } else {
      low--;
      accumulated += nextLow;
    }
  }

  return { poc: (pocBin + 0.5) * binSize, vah: (high + 1) * binSize, val: low * binSize };
}

/** Aggregate 1m bars into aligned N-minute candles (UTC-aligned buckets, whole-hour offsets). */
function aggregate(bars: Bar[], minutes: number): Bar[] {
  const size = minutes * 60_000;
  const out: Bar[] = [];
  let current: Bar | undefined;
  let bucket = -1;
  for (const bar of bars) {
    const key = Math.floor(bar.time / size) * size;
    if (key !== bucket) {
      if (current !== undefined) out.push(current);
      bucket = key;
      current = { time: key, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume };
    } else if (current !== undefined) {
      current.high = Math.max(current.high, bar.high);
      current.low = Math.min(current.low, bar.low);
      current.close = bar.close;
      current.volume += bar.volume;
    }
  }
  if (current !== undefined) out.push(current);
  return out;
}

/** Confirmed swing highs/lows (k bars either side); confirmTime = close of the confirming bar. */
function findSwings(bars: Bar[], minutes: number, k = 2): { highs: Swing[]; lows: Swing[] } {
  const highs: Swing[] = [];
  const lows: Swing[] = [];
  const size = minutes * 60_000;
  for (let i = k; i < bars.length - k; i++) {
    const pivot = bars[i]!;
    let isHigh = true;
    let isLow = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      const other = bars[j]!;
      if (other.high > pivot.high) isHigh = false;
      if (other.low < pivot.low) isLow = false;
    }
    const confirmTime = bars[i + k]!.time + size;
    if (isHigh) highs.push({ value: pivot.high, confirmTime });
    if (isLow) lows.push({ value: pivot.low, confirmTime });
  }
  return { highs, lows };
}

// ---------------------------------------------------------------- simulation

function simulate(label: string, bars: Bar[], other: Bar[], buffer: number, cost: number): { trades: Trade[]; funnel: Funnel } {
  const funnel: Funnel = { raids: 0, smtPass: 0, ofPass: 0, triggers: 0, noDraw: 0 };
  const mine = computeLevels(bars);
  const theirs = computeLevels(other);
  const otherByTime = new Map<number, Bar>();
  for (const bar of other) otherByTime.set(bar.time, bar);

  const swings15 = findSwings(aggregate(bars, 15), 15);
  const swings30 = findSwings(aggregate(bars, 30), 30);
  const binSize =
    profileBinFlag !== undefined
      ? Number(profileBinFlag)
      : label === "NQ"
        ? 2
        : label === "ES"
          ? 0.5
          : label === "SPY"
            ? 0.05
            : 0.05;

  interface DayLedger {
    highs: Level[];
    lows: Level[];
    takenHighs: Set<number>;
    takenLows: Set<number>;
  }
  const ledgers = new Map<string, DayLedger>();

  const buildLedger = (date: string, prevDate: string, atTime: number): DayLedger => {
    const sessionRange = sessionMode === "london" ? mine.asia.get(date) : mine.overnight.get(date);
    const sessionBarsList = (sessionMode === "london" ? mine.asiaBars.get(date) : mine.overnightBars.get(date)) ?? [];
    const sessionKind: LevelKind = sessionMode === "london" ? "asia" : "overnight";
    const profileKinds: readonly [LevelKind, LevelKind, LevelKind] =
      sessionMode === "london" ? ["pocAsia", "vahAsia", "valAsia"] : ["pocON", "vahON", "valON"];
    const prior = mine.rth.get(prevDate);
    const highs: Level[] = [];
    const lows: Level[] = [];

    if (sessionRange !== undefined) {
      highs.push({ value: sessionRange.high, kind: sessionKind });
      lows.push({ value: sessionRange.low, kind: sessionKind });
    }
    if (prior !== undefined) {
      highs.push({ value: prior.high, kind: "rth" });
      lows.push({ value: prior.low, kind: "rth" });
    }

    if (levelFilter === "opening") {
      const at = DateTime.fromMillis(atTime, { zone: NY });
      const atMinutes = at.hour * 60 + at.minute;
      if (atMinutes >= ORB_START + 15) {
        const or15 = openingRange(date, 15, atTime);
        if (or15 !== undefined) {
          highs.push({ value: or15.high, kind: "open15" });
          lows.push({ value: or15.low, kind: "open15" });
        }
      }
      if (atMinutes >= ORB_START + 30) {
        const or30 = openingRange(date, 30, atTime);
        if (or30 !== undefined) {
          highs.push({ value: or30.high, kind: "open30" });
          lows.push({ value: or30.low, kind: "open30" });
        }
      }
    }

    const onProfile = volumeProfile(sessionBarsList, binSize);
    if (onProfile !== undefined) {
      highs.push(
        { value: onProfile.poc, kind: profileKinds[0] },
        { value: onProfile.vah, kind: profileKinds[1] },
        { value: onProfile.val, kind: profileKinds[2] },
      );
      lows.push(
        { value: onProfile.poc, kind: profileKinds[0] },
        { value: onProfile.vah, kind: profileKinds[1] },
        { value: onProfile.val, kind: profileKinds[2] },
      );
    }

    const rthProfile = volumeProfile(mine.rthBars.get(prevDate) ?? [], binSize);
    if (rthProfile !== undefined) {
      highs.push({ value: rthProfile.poc, kind: "pocRTH" }, { value: rthProfile.vah, kind: "vahRTH" }, { value: rthProfile.val, kind: "valRTH" });
      lows.push({ value: rthProfile.poc, kind: "pocRTH" }, { value: rthProfile.vah, kind: "vahRTH" }, { value: rthProfile.val, kind: "valRTH" });
    }

    for (const swing of swings15.highs.filter((s) => s.confirmTime < atTime).slice(-2)) highs.push({ value: swing.value, kind: "swing15" });
    for (const swing of swings15.lows.filter((s) => s.confirmTime < atTime).slice(-2)) lows.push({ value: swing.value, kind: "swing15" });
    for (const swing of swings30.highs.filter((s) => s.confirmTime < atTime).slice(-2)) highs.push({ value: swing.value, kind: "swing30" });
    for (const swing of swings30.lows.filter((s) => s.confirmTime < atTime).slice(-2)) lows.push({ value: swing.value, kind: "swing30" });

    return {
      highs: highs.filter((level) => Number.isFinite(level.value) && levelKindAllowed(level.kind)),
      lows: lows.filter((level) => Number.isFinite(level.value) && levelKindAllowed(level.kind)),
      takenHighs: new Set<number>(),
      takenLows: new Set<number>(),
    };
  };

  const trades: Trade[] = [];
  const usedSides = new Map<string, Set<string>>();
  const perDay = new Map<string, number>();

  const barsByDate = new Map<string, Bar[]>();
  for (const bar of bars) {
    const key = DateTime.fromMillis(bar.time, { zone: NY }).toFormat("yyyy-MM-dd");
    const list = barsByDate.get(key) ?? [];
    list.push(bar);
    barsByDate.set(key, list);
  }

  /** High/low of the first `lengthMin` minutes of the session, using only bars before `atTime`. */
  const openingRange = (date: string, lengthMin: number, atTime: number): { high: number; low: number } | undefined => {
    let high = -Infinity;
    let low = Infinity;
    let count = 0;
    for (const bar of barsByDate.get(date) ?? []) {
      if (bar.time >= atTime) break;
      const dt = DateTime.fromMillis(bar.time, { zone: NY });
      const m = dt.hour * 60 + dt.minute;
      if (m >= ORB_START && m < ORB_START + lengthMin) {
        high = Math.max(high, bar.high);
        low = Math.min(low, bar.low);
        count++;
      }
    }
    if (count < lengthMin * 0.5) return undefined;
    return { high, low };
  };

  let i = 0;
  while (i < bars.length) {
    const bar = bars[i]!;
    const dt = DateTime.fromMillis(bar.time, { zone: NY });
    const minutes = dt.hour * 60 + dt.minute;
    if (minutes < OPEN || minutes >= WINDOW_END) {
      i++;
      continue;
    }

    const date = dt.toFormat("yyyy-MM-dd");
    const prevDate = previousRthDate(mine.rth, date);
    const otherPrevDate = previousRthDate(theirs.rth, date);
    if (prevDate === undefined) {
      i++;
      continue;
    }
    const priorRth = mine.rth.get(prevDate);
    const otherRth = otherPrevDate === undefined ? undefined : theirs.rth.get(otherPrevDate);
    if (priorRth === undefined || !Number.isFinite(priorRth.high)) {
      i++;
      continue;
    }

    const sides = usedSides.get(date) ?? new Set<string>();
    usedSides.set(date, sides);
    if ((perDay.get(date) ?? 0) >= 2) {
      i++;
      continue;
    }

    // Bias gate.
    let biasUp: boolean | undefined;
    if (biasMode === "session") biasUp = bar.close > priorRth.close;
    if (biasMode === "prior") biasUp = priorRth.close > priorRth.open;
    const allowShort = biasUp === undefined || biasUp === false;
    const allowLong = biasUp === undefined || biasUp === true;
    if (!allowShort && !allowLong) {
      i++;
      continue;
    }

    const ledger = ledgers.get(date) ?? buildLedger(date, prevDate, bar.time);
    ledgers.set(date, ledger);

    // Which raided level is closest to the action? Short = highest crossed, long = lowest crossed.
    let raid: Level | null = null;
    let raidSide: "long" | "short" = "short";
    if (allowShort && !sides.has("short")) {
      let best: Level | undefined;
      for (const level of ledger.highs) {
        if (ledger.takenHighs.has(level.value) || bar.high <= level.value) continue;
        if (best === undefined || level.value > best.value) best = level;
      }
      if (best !== undefined) {
        raid = best;
        raidSide = "short";
      }
    }
    if (raid === null && allowLong && !sides.has("long")) {
      let best: Level | undefined;
      for (const level of ledger.lows) {
        if (ledger.takenLows.has(level.value) || bar.low >= level.value) continue;
        if (best === undefined || level.value < best.value) best = level;
      }
      if (best !== undefined) {
        raid = best;
        raidSide = "long";
      }
    }
    if (raid === null) {
      i++;
      continue;
    }
    const raided = raid;
    const side = raidSide;
    const raidStart = i;

    // Raid window: close back through the level within 5 bars, still inside the scan window.
    let raidEnd = -1;
    for (let j = raidStart; j <= Math.min(bars.length - 1, raidStart + 5); j++) {
      const candle = bars[j]!;
      const endDt = DateTime.fromMillis(candle.time, { zone: NY });
      if (endDt.hour * 60 + endDt.minute >= WINDOW_END) break;
      const back = side === "short" ? candle.close < raided.value : candle.close > raided.value;
      if (back) {
        raidEnd = j;
        break;
      }
    }
    if (raidEnd === -1) {
      if (side === "short") ledger.takenHighs.add(raided.value);
      else ledger.takenLows.add(raided.value);
      i++;
      continue;
    }
    if (side === "short") ledger.takenHighs.add(raided.value);
    else ledger.takenLows.add(raided.value);
    funnel.raids++;

    let extreme = side === "short" ? -Infinity : Infinity;
    let extremeIndex = raidStart;
    let raidVolume = 0;
    for (let j = raidStart; j <= raidEnd; j++) {
      const candle = bars[j]!;
      const extremeHere = side === "short" ? candle.high : candle.low;
      if (side === "short" ? extremeHere > extreme : extremeHere < extreme) {
        extreme = extremeHere;
        extremeIndex = j;
      }
      raidVolume = Math.max(raidVolume, candle.volume);
    }

    const penetration = side === "short" ? extreme - raided.value : raided.value - extreme;
    if (penetration < minPenetration) {
      i = raidEnd + 1;
      continue;
    }

    // SMT.
    if (requireSmt) {
      let otherExtreme = side === "short" ? -Infinity : Infinity;
      for (let j = raidStart; j <= raidEnd; j++) {
        const twin = otherByTime.get(bars[j]!.time);
        if (twin === undefined) continue;
        otherExtreme = side === "short" ? Math.max(otherExtreme, twin.high) : Math.min(otherExtreme, twin.low);
      }

      const isSessionLevel = raided.kind === "overnight" || raided.kind === "rth";
      let took: boolean;
      let otherTook: boolean;
      if (smtMode === "level" && isSessionLevel) {
        const over = theirs.overnight.get(date);
        const otherLevel = raided.kind === "overnight"
          ? (side === "short" ? over?.high : over?.low)
          : (side === "short" ? otherRth?.high : otherRth?.low);
        if (otherLevel === undefined || !Number.isFinite(otherLevel)) {
          i = raidEnd + 1;
          continue;
        }
        took = true; // own session level was taken by construction
        otherTook = side === "short" ? otherExtreme > otherLevel : otherExtreme < otherLevel;
      } else {
        let mineRef = side === "short" ? -Infinity : Infinity;
        let otherRef = side === "short" ? -Infinity : Infinity;
        for (let j = Math.max(0, raidStart - 30); j < raidStart; j++) {
          const mineBar = bars[j]!;
          mineRef = side === "short" ? Math.max(mineRef, mineBar.high) : Math.min(mineRef, mineBar.low);
          const twin = otherByTime.get(mineBar.time);
          if (twin === undefined) continue;
          otherRef = side === "short" ? Math.max(otherRef, twin.high) : Math.min(otherRef, twin.low);
        }
        if (!Number.isFinite(mineRef) || !Number.isFinite(otherRef)) {
          i = raidEnd + 1;
          continue;
        }
        took = side === "short" ? extreme > mineRef : extreme < mineRef;
        otherTook = side === "short" ? otherExtreme > otherRef : otherExtreme < otherRef;
      }

      if (!took || otherTook) {
        i = raidEnd + 1;
        continue;
      }
    }
    funnel.smtPass++;

    // Order-flow proxy.
    let trailingVolume = 0;
    let trailingCount = 0;
    for (let j = Math.max(0, raidStart - 60); j < raidStart; j++) {
      trailingVolume += bars[j]!.volume;
      trailingCount++;
    }
    const volumeOk = trailingCount > 0 && raidVolume >= 1.5 * (trailingVolume / trailingCount);
    const endBar = bars[raidEnd]!;
    const endRange = endBar.high - endBar.low;
    const rejectOk = endRange > 0 && (side === "short"
      ? (endBar.high - endBar.close) / endRange >= 0.6
      : (endBar.close - endBar.low) / endRange >= 0.6);
    const ofOk = ofilter === "none" ? true : ofilter === "volume" ? volumeOk : ofilter === "reject" ? rejectOk : volumeOk || rejectOk;
    if (!ofOk) {
      i = raidEnd + 1;
      continue;
    }
    funnel.ofPass++;

    // Entry.
    let entryIndex = -1;
    let entry = NaN;
    if (entryMode === "reclaim") {
      entryIndex = raidEnd;
      entry = bars[raidEnd]!.close;
    } else if (entryMode === "limit") {
      for (let k = raidEnd + 1; k <= Math.min(bars.length - 1, raidEnd + 30); k++) {
        const candle = bars[k]!;
        const kDt = DateTime.fromMillis(candle.time, { zone: NY });
        if (kDt.hour * 60 + kDt.minute >= TRIGGER_END) break;
        const touched = side === "short" ? candle.high >= raided.value : candle.low <= raided.value;
        if (touched) {
          entryIndex = k;
          break;
        }
      }
      entry = raided.value;
    } else {
      const lookback = entryMode === "range" ? 10 : 3;
      const anchor = entryMode === "range" ? raidStart : extremeIndex;
      let ref = side === "short" ? Infinity : -Infinity;
      for (let j = Math.max(0, anchor - lookback); j < anchor; j++) {
        ref = side === "short" ? Math.min(ref, bars[j]!.low) : Math.max(ref, bars[j]!.high);
      }
      for (let k = raidEnd + 1; k <= Math.min(bars.length - 1, raidEnd + 30); k++) {
        const candle = bars[k]!;
        const kDt = DateTime.fromMillis(candle.time, { zone: NY });
        if (kDt.hour * 60 + kDt.minute >= TRIGGER_END) break;
        const fired = side === "short" ? candle.close < ref : candle.close > ref;
        if (fired) {
          entryIndex = k;
          entry = candle.close;
          break;
        }
      }
    }
    if (entryIndex === -1) {
      i = raidEnd + 1;
      continue;
    }
    funnel.triggers++;

    const stop = side === "short" ? extreme + buffer : extreme - buffer;
    const risk = side === "short" ? stop - entry : entry - stop;
    if (risk <= 0) {
      i = entryIndex + 1;
      continue;
    }

    // Target: fixed R for precision scalps, or the liquidity pool ladder when --target-r 0.
    let target: number;
    if (targetR > 0) {
      target = side === "short" ? entry - targetR * risk : entry + targetR * risk;
    } else {
      const over = mine.overnight.get(date);
      const poolValues = side === "short"
        ? [over?.low, priorRth.low, priorRth.close].filter((v): v is number => v !== undefined && Number.isFinite(v) && v < entry).sort((a, b) => b - a)
        : [over?.high, priorRth.high, priorRth.close].filter((v): v is number => v !== undefined && Number.isFinite(v) && v > entry).sort((a, b) => a - b);
      let found = NaN;
      for (const pool of poolValues) {
        const rr = side === "short" ? (entry - pool) / risk : (pool - entry) / risk;
        if (rr >= minR) {
          found = pool;
          break;
        }
      }
      if (!Number.isFinite(found)) {
        funnel.noDraw++;
        i = entryIndex + 1;
        continue;
      }
      if (Number.isFinite(maxR) && Math.abs(found - entry) / risk > maxR) {
        found = side === "short" ? entry - maxR * risk : entry + maxR * risk;
      }
      target = found;
    }
    const plannedR = side === "short" ? (entry - target) / risk : (target - entry) / risk;

    // Resolve: stop first when both touched in one bar; time stop; flat at 15:55 ET.
    const flatTime = DateTime.fromObject(
      { year: dt.year, month: dt.month, day: dt.day, hour: 15, minute: 55 },
      { zone: NY },
    ).toMillis();
    const entryTime = bars[entryIndex]!.time;
    let resolved: { exit: number; r: number; reason: Trade["reason"] } | null = null;
    let resolveIndex = bars.length - 1;
    let mfeR = 0;
    let maeR = 0;
    for (let m = entryIndex; m < bars.length; m++) {
      const candle = bars[m]!;
      if (candle.time > flatTime) {
        const prev = bars[Math.max(entryIndex, m - 1)]!;
        resolved = {
          exit: prev.close,
          r: (side === "short" ? entry - prev.close : prev.close - entry) / risk - cost / risk,
          reason: "flat",
        };
        resolveIndex = Math.max(entryIndex, m - 1);
        break;
      }
      const favorable = side === "short" ? (entry - candle.low) / risk : (candle.high - entry) / risk;
      const adverse = side === "short" ? (candle.high - entry) / risk : (entry - candle.low) / risk;
      mfeR = Math.max(mfeR, favorable);
      maeR = Math.max(maeR, adverse);
      const stopHit = side === "short" ? candle.high >= stop : candle.low <= stop;
      const targetHit = side === "short" ? candle.low <= target : candle.high >= target;
      if (stopHit) {
        resolved = { exit: stop, r: -1 - cost / risk, reason: "stop" };
        resolveIndex = m;
        break;
      }
      if (targetHit) {
        resolved = { exit: target, r: plannedR - cost / risk, reason: "target" };
        resolveIndex = m;
        break;
      }
      if (timeStop > 0 && candle.time - entryTime >= timeStop * 60_000) {
        resolved = {
          exit: candle.close,
          r: (side === "short" ? entry - candle.close : candle.close - entry) / risk - cost / risk,
          reason: "time",
        };
        resolveIndex = m;
        break;
      }
    }
    if (resolved === null) {
      const last = bars[bars.length - 1]!;
      resolved = {
        exit: last.close,
        r: (side === "short" ? entry - last.close : last.close - entry) / risk - cost / risk,
        reason: "flat",
      };
    }

    trades.push({
      label,
      date,
      side,
      entryTime,
      entry,
      stop,
      target,
      exit: resolved.exit,
      r: resolved.r,
      plannedR,
      riskPoints: risk,
      reason: resolved.reason,
      mfeR,
      maeR,
    });
    sides.add(side);
    perDay.set(date, (perDay.get(date) ?? 0) + 1);
    i = resolveIndex + 1;
  }

  return { trades, funnel };
}

// ---------------------------------------------------------------- run

const isEtf = instrumentFlag === "SPY" || instrumentFlag === "QQQ" || instrumentFlag === "etf";
const universe = isEtf ? ["SPY", "QQQ"] : ["NQ", "ES"];
const labels = instrumentFlag === "etf" ? universe : instrumentFlag === "both" ? universe : [instrumentFlag];
const series = new Map<string, Bar[]>();
for (const label of universe) series.set(label, await load(label));
for (const label of labels) {
  const bars = series.get(label)!;
  const first = DateTime.fromMillis(bars[0]!.time, { zone: NY }).toFormat("yyyy-MM-dd");
  const last = DateTime.fromMillis(bars[bars.length - 1]!.time, { zone: NY }).toFormat("yyyy-MM-dd");
  console.log(`${label}: source=${source} bars=${bars.length} range=${first}..${last}`);
}

const allTrades: Trade[] = [];
for (const label of labels) {
  const otherLabel =
    label === "NQ" ? "ES" : label === "ES" ? "NQ" : label === "SPY" ? "QQQ" : "SPY";
  const buffer =
    bufferFlag !== undefined
      ? Number(bufferFlag)
      : label === "NQ"
        ? 4
        : label === "ES"
          ? 1.5
          : label === "SPY"
            ? 0.15
            : 0.1;
  const cost =
    costFlag !== undefined
      ? Number(costFlag)
      : label === "NQ"
        ? 1
        : label === "ES"
          ? 0.5
          : label === "SPY"
            ? 0.05
            : 0.03;
  const { trades, funnel } = simulate(label, series.get(label)!, series.get(otherLabel)!, buffer, cost);
  allTrades.push(...trades);

  const wins = trades.filter((trade) => trade.reason === "target").length;
  const stops = trades.filter((trade) => trade.reason === "stop").length;
  const times = trades.filter((trade) => trade.reason === "time").length;
  const flats = trades.filter((trade) => trade.reason === "flat").length;
  const netR = trades.reduce((sum, trade) => sum + trade.r, 0);
  const gains = trades.reduce((sum, trade) => (trade.r > 0 ? sum + trade.r : sum), 0);
  const losses = trades.reduce((sum, trade) => (trade.r < 0 ? sum + trade.r : sum), 0);
  const mfeAvg = trades.reduce((sum, trade) => sum + trade.mfeR, 0) / Math.max(1, trades.length);
  const mfe1 = trades.filter((trade) => trade.mfeR >= 1).length;
  console.log(
    `${label}: trades=${trades.length}  precision=${(100 * wins / Math.max(1, trades.length)).toFixed(1)}%` +
      ` (${wins} target / ${stops} stop / ${times} time / ${flats} flat)` +
      `  netR=${netR.toFixed(1)}  avgR=${(netR / Math.max(1, trades.length)).toFixed(3)}` +
      `  PF=${(gains / Math.abs(losses || 1)).toFixed(2)}` +
      `  avgRisk=${(trades.reduce((sum, trade) => sum + trade.riskPoints, 0) / Math.max(1, trades.length)).toFixed(1)}pts`,
  );
  console.log(`  MFE avg=${mfeAvg.toFixed(2)}R  >=1R: ${mfe1}/${trades.length}`);
  console.log(`  funnel: raids=${funnel.raids}  smt=${funnel.smtPass}  of=${funnel.ofPass}  triggers=${funnel.triggers}  noDraw=${funnel.noDraw}`);
}

if (monthly && allTrades.length > 0) {
  const months = [...new Set(allTrades.map((trade) => trade.date.slice(0, 7)))].sort();
  console.log("\nmonthly:");
  for (const month of months) {
    const rows = allTrades.filter((trade) => trade.date.slice(0, 7) === month);
    for (const label of labels) {
      const subset = rows.filter((trade) => trade.label === label);
      if (subset.length === 0) continue;
      const wins = subset.filter((trade) => trade.reason === "target").length;
      const net = subset.reduce((sum, trade) => sum + trade.r, 0);
      console.log(
        `  ${month} ${label}: n=${subset.length} precision=${((100 * wins) / subset.length).toFixed(0)}% netR=${net.toFixed(1)}`,
      );
    }
  }
}

console.log(
  `\nconfig: source=${source}  session=${sessionMode}  levels=${levelFilter}  bias=${biasMode}  targetR=${targetR || "pools"}  timeStop=${timeStop}m  window=${String(Math.floor(OPEN / 60)).padStart(2, "0")}:${String(OPEN % 60).padStart(2, "0")}-${String(Math.floor(WINDOW_END / 60)).padStart(2, "0")}:${String(WINDOW_END % 60).padStart(2, "0")}` +
    `  entry=${entryMode}  smt=${requireSmt ? smtMode : "off"}  ofilter=${ofilter}  buffer=${bufferFlag ?? "by-instrument"}  cost=${costFlag ?? "by-instrument"}`,
);
if (allTrades.length > 0 && !rest.includes("--quiet")) {
  console.log("trades:");
  for (const trade of allTrades) {
    const et = DateTime.fromMillis(trade.entryTime, { zone: NY }).toFormat("MM-dd HH:mm");
    console.log(
      `  ${trade.label}  ${et}  ${trade.side.padEnd(5)}  R=${trade.r.toFixed(2).padStart(6)}` +
        `  planned=${trade.plannedR.toFixed(2).padStart(5)}  mfe=${trade.mfeR.toFixed(2)}  mae=${trade.maeR.toFixed(2)}` +
        `  risk=${trade.riskPoints.toFixed(1)}pts  ${trade.reason}`,
    );
  }
}
