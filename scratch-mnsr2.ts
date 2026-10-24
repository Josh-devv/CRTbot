/**
 * MNSR v2 — the rules as stated:
 *
 *  1. Directional bias from D1 market structure (HH/HL vs LH/LL, confirmed pivots only).
 *  2. Key level is a D1 or W1 A/V level (close-based pivot; A = peak/resistance, V = valley/support).
 *  3. In H4, price returns to the level, reacts (wick through, close back), then prints an H4 MSS
 *     in the bias direction (close beyond the last confirmed H4 swing).
 *  4. After the H4 MSS, drop to 15m: find the last opposing candle before the MSS impulse —
 *     that is the order block. A failed/retested OB is the breaker. Entry is a limit at the OB
 *     demarcation; stop beyond the OB candle; target is the next opposing D1/W1 level.
 *
 * Usage:
 *   npx tsx scratch-mnsr2.ts --from 2024-08-01 --to 2024-10-31 --instrument both
 */

import { loadBars } from "./src/ingest.js";
import type { Bar, Instrument } from "./src/types.js";

const PIP = 0.0001;
const BUFFER = 1.5 * PIP;
const EPS = 0.2 * PIP;
const H4_MSS_WINDOW = 18; // H4 bars (3 days)
const ENTRY_WINDOW_MS = 3 * 86_400_000; // 3 days after the H4 MSS
const MIN_TARGET_R = 2;
const K_D1 = 2;
const K_W1 = 1;

const cliArgs = process.argv.slice(2);
const cliGet = (flag: string, fallback: string): string => {
  const i = cliArgs.indexOf(flag);
  return i >= 0 && cliArgs[i + 1] !== undefined ? cliArgs[i + 1]! : fallback;
};
const TEST_FROM = Date.parse(`${cliGet("--from", "2024-08-01")}T00:00:00Z`);
const TEST_TO = Date.parse(`${cliGet("--to", "2024-10-31")}T23:59:59Z`);
const WARMUP_FROM = Date.parse("2022-01-01T00:00:00Z");

type Dir = 1 | -1;
type Bias = 1 | -1 | 0;

interface Pivot {
  time: number;
  confirmed: number;
  price: number;
  kind: "A" | "V";
  tf: "D1" | "W1";
}

interface Level extends Pivot {
  broken: boolean;
  brokenAt: number;
  used: boolean;
}

interface MssEvent {
  time: number;
  dir: Dir;
  level: Level;
  reactionTime: number;
  extreme: number;
}

interface Setup {
  time: number; // H4 MSS time
  dir: Dir;
  level: Level;
  zone: "OB" | "Breaker";
  obHigh: number;
  obLow: number;
  obTime: number;
  stop: number;
  expiry: number;
}

interface Trade {
  instrument: Instrument;
  dir: Dir;
  tf: "D1" | "W1";
  kind: "A" | "V";
  zone: "OB" | "Breaker";
  entryTime: number;
  entry: number;
  stop: number;
  target: number;
  targetR: number;
  exitTime: number;
  exit: number;
  grossR: number;
  netR: number;
  riskPips: number;
  reason: string;
}

function aggregate(bars: Bar[], ms: number, offset = 0): Bar[] {
  const out = new Map<number, Bar>();
  for (const b of bars) {
    const t = Math.floor((b.time - offset) / ms) * ms + offset;
    const cur = out.get(t);
    if (cur === undefined) {
      out.set(t, { time: t, open: b.open, high: b.high, low: b.low, close: b.close });
    } else {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
    }
  }
  return [...out.values()].sort((a, b) => a.time - b.time);
}

function weekStart(t: number): number {
  return Math.floor((t - 4 * 86_400_000) / (7 * 86_400_000)) * 7 * 86_400_000 + 4 * 86_400_000;
}

function weekly(bars: Bar[]): Bar[] {
  const out = new Map<number, Bar>();
  for (const b of bars) {
    const t = weekStart(b.time);
    const cur = out.get(t);
    if (cur === undefined) {
      out.set(t, { time: t, open: b.open, high: b.high, low: b.low, close: b.close });
    } else {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
    }
  }
  return [...out.values()].sort((a, b) => a.time - b.time);
}

function pivots(bars: Bar[], k: number, tf: "D1" | "W1"): Level[] {
  const out: Level[] = [];
  for (let i = k; i < bars.length - k; i++) {
    const c = bars[i]!.close;
    let high = true;
    let low = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (bars[j]!.close >= c) high = false;
      if (bars[j]!.close <= c) low = false;
    }
    if (high) {
      out.push({
        time: bars[i]!.time,
        confirmed: bars[i + k]!.time,
        price: c,
        kind: "A",
        tf,
        broken: false,
        brokenAt: 0,
        used: false,
      });
    }
    if (low) {
      out.push({
        time: bars[i]!.time,
        confirmed: bars[i + k]!.time,
        price: c,
        kind: "V",
        tf,
        broken: false,
        brokenAt: 0,
        used: false,
      });
    }
  }
  return out;
}

/** Confirmed H4 swing refs, as of each H4 bar (no lookahead). */
function h4Refs(h4: Bar[], k = 2): { high: number[]; low: number[] } {
  const high = new Array<number>(h4.length).fill(NaN);
  const low = new Array<number>(h4.length).fill(NaN);
  let lastHigh = NaN;
  let lastLow = NaN;
  for (let i = 0; i < h4.length; i++) {
    const j = i - k;
    if (j >= k) {
      let isHigh = true;
      let isLow = true;
      for (let q = j - k; q <= j + k; q++) {
        if (q === j) continue;
        if (h4[q]!.high >= h4[j]!.high) isHigh = false;
        if (h4[q]!.low <= h4[j]!.low) isLow = false;
      }
      if (isHigh) lastHigh = h4[j]!.high;
      if (isLow) lastLow = h4[j]!.low;
    }
    high[i] = lastHigh;
    low[i] = lastLow;
  }
  return { high, low };
}

/**
 * D1 market-structure bias: last confirmed break of structure.
 * A completed D1 close above the last confirmed swing high = bullish; below the last swing low =
 * bearish; otherwise the previous bias persists. This is the "good structure" direction, not a
 * one-candle colour.
 */
function buildBias(d1: Bar[], pivots: Level[]): { time: number; bias: Bias }[] {
  const highs = pivots.filter((p) => p.kind === "A").sort((a, b) => a.confirmed - b.confirmed);
  const lows = pivots.filter((p) => p.kind === "V").sort((a, b) => a.confirmed - b.confirmed);
  const out: { time: number; bias: Bias }[] = [];
  let hi = 0;
  let lo = 0;
  let lastHigh = NaN;
  let lastLow = NaN;
  let bias: Bias = 0;
  for (const b of d1) {
    while (hi < highs.length && highs[hi]!.confirmed <= b.time) {
      lastHigh = highs[hi]!.price;
      hi++;
    }
    while (lo < lows.length && lows[lo]!.confirmed <= b.time) {
      lastLow = lows[lo]!.price;
      lo++;
    }
    if (Number.isFinite(lastHigh) && b.close > lastHigh + EPS) bias = 1;
    else if (Number.isFinite(lastLow) && b.close < lastLow - EPS) bias = -1;
    out.push({ time: b.time, bias });
  }
  return out;
}

function biasAt(states: { time: number; bias: Bias }[], t: number): Bias {
  let lo = 0;
  let hi = states.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (states[mid]!.time <= t) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return idx < 0 ? 0 : states[idx]!.bias;
}

/**
 * Opposing 15m candles in [from, to] give two zones:
 *  - OB = the most recent opposing candle (the one the MSS impulse left behind).
 *  - Breaker = the opposing candle before that (a previously failed block).
 */
function findZones(
  m15: Bar[],
  from: number,
  to: number,
  dir: Dir,
): { zone: "OB" | "Breaker"; high: number; low: number; time: number; stop: number }[] {
  let lo = 0;
  let hi = m15.length - 1;
  let end = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (m15[mid]!.time <= to) {
      end = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const opposing: Bar[] = [];
  for (let i = end; i >= 0; i--) {
    const b = m15[i]!;
    if (b.time < from) break;
    if (dir === 1 ? b.close < b.open : b.close > b.open) opposing.push(b);
  }
  if (opposing.length === 0) return [];
  const first = opposing[0]!;
  const last = opposing.length > 1 ? opposing[1]! : null;
  const out: { zone: "OB" | "Breaker"; high: number; low: number; time: number; stop: number }[] = [];
  out.push({
    zone: "OB",
    high: Math.max(first.open, first.close),
    low: Math.min(first.open, first.close),
    time: first.time,
    stop: dir === 1 ? first.low - BUFFER : first.high + BUFFER,
  });
  if (last !== null) {
    out.push({
      zone: "Breaker",
      high: Math.max(last.open, last.close),
      low: Math.min(last.open, last.close),
      time: last.time,
      stop: dir === 1 ? last.low - BUFFER : last.high + BUFFER,
    });
  }
  return out;
}

function inSession(t: number): boolean {
  const d = new Date(t);
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  return minutes >= 7 * 60 && minutes < 17 * 60;
}

function run(instrument: Instrument, m1: Bar[]): { trades: Trade[]; mss: number; setups: number } {
  const m15 = aggregate(m1, 15 * 60_000);
  const h4 = aggregate(m1, 240 * 60_000);
  const d1 = aggregate(m1, 1440 * 60_000);
  const w1 = weekly(m1);

  const d1Pivots = pivots(d1, K_D1, "D1");
  const w1Pivots = pivots(w1, K_W1, "W1");
  const levels: Level[] = [...w1Pivots, ...d1Pivots].sort((a, b) => a.confirmed - b.confirmed);
  const biasStates = buildBias(d1, d1Pivots);
  const refs = h4Refs(h4, 1);
  console.log(
    `  data: M15 ${m15.length}, H4 ${h4.length}, D1 ${d1.length}, W1 ${w1.length}; ` +
      `levels ${levels.length}, D1 pivots ${d1Pivots.length}, W1 pivots ${w1Pivots.length}`,
  );

  const costPips = instrument === "EURUSD" ? 0.8 : 1.2;

  // ---- H4: level reaction + H4 MSS -> build setups with the 15m OB -------------
  const events: MssEvent[] = [];
  const funnel = { touch: 0, bias: 0, mss: 0, ob: 0 };
  const activeLevels: Level[] = [];
  let cursor = 0;

  interface Pending {
    level: Level;
    dir: Dir;
    reactionTime: number;
    extreme: number;
    ref: number;
    expires: number;
  }
  const pending: Pending[] = [];

  for (let i = 0; i < h4.length; i++) {
    const bar = h4[i]!;
    while (cursor < levels.length && levels[cursor]!.confirmed < bar.time) {
      const lv = levels[cursor]!;
      // Deduplicate near-identical levels (D1/W1 can sit on the same price).
      if (!activeLevels.some((x) => x.kind === lv.kind && Math.abs(x.price - lv.price) < 3 * PIP)) {
        activeLevels.push(lv);
      }
      cursor++;
    }
    const active = activeLevels.filter((lv) => !lv.broken && !lv.used);

    for (const lv of active) {
      if (lv.kind === "A") {
        if (bar.close > lv.price + EPS) {
          lv.broken = true;
          lv.brokenAt = bar.time;
          continue;
        }
        if (bar.high >= lv.price && bar.close < lv.price) {
          if (bar.time >= TEST_FROM) funnel.touch++;
          const bias = biasAt(biasStates, bar.time);
          if (bias === -1 && bar.time >= TEST_FROM) funnel.bias++;
          if (bias === -1 && !pending.some((p) => p.level === lv)) {
            const ref = Math.min(...h4.slice(Math.max(0, i - 3), i).map((b) => b.low));
            pending.push({
              level: lv,
              dir: -1,
              reactionTime: bar.time,
              extreme: Math.max(lv.price, bar.high),
              ref,
              expires: i + H4_MSS_WINDOW,
            });
          }
        }
      } else {
        if (bar.close < lv.price - EPS) {
          lv.broken = true;
          lv.brokenAt = bar.time;
          continue;
        }
        if (bar.low <= lv.price && bar.close > lv.price) {
          if (bar.time >= TEST_FROM) funnel.touch++;
          const bias = biasAt(biasStates, bar.time);
          if (bias === 1 && bar.time >= TEST_FROM) funnel.bias++;
          if (bias === 1 && !pending.some((p) => p.level === lv)) {
            const ref = Math.max(...h4.slice(Math.max(0, i - 3), i).map((b) => b.high));
            pending.push({
              level: lv,
              dir: 1,
              reactionTime: bar.time,
              extreme: Math.min(lv.price, bar.low),
              ref,
              expires: i + H4_MSS_WINDOW,
            });
          }
        }
      }
    }

    for (let p = pending.length - 1; p >= 0; p--) {
      const s = pending[p]!;
      if (s.level.broken || i - (s.expires - H4_MSS_WINDOW) > H4_MSS_WINDOW) {
        pending.splice(p, 1);
        continue;
      }
      if (bar.time <= s.reactionTime) continue;
      s.extreme = s.dir === 1 ? Math.min(s.extreme, bar.low) : Math.max(s.extreme, bar.high);

      const shifted = s.dir === 1 ? bar.close > s.ref + EPS : bar.close < s.ref - EPS;
      if (!shifted) continue;
      if (bar.time >= TEST_FROM) funnel.mss++;

      // Bias must still agree at the MSS close.
      if (biasAt(biasStates, bar.time) !== s.dir) {
        pending.splice(p, 1);
        continue;
      }

      const zones = findZones(m15, s.reactionTime, bar.time + 240 * 60_000, s.dir);
      if (zones.length > 0 && bar.time >= TEST_FROM) funnel.ob++;
      if (zones.length > 0) {
        events.push({
          time: bar.time,
          dir: s.dir,
          level: s.level,
          reactionTime: s.reactionTime,
          extreme: s.extreme,
        });
        for (const z of zones) {
          // Wider invalidation: beyond the sweep extreme, not just the OB candle.
          const wideStop =
            s.dir === 1
              ? Math.min(z.stop, s.extreme - BUFFER)
              : Math.max(z.stop, s.extreme + BUFFER);
          const setup: Setup = {
            time: bar.time,
            dir: s.dir,
            level: s.level,
            zone: z.zone,
            obHigh: z.high,
            obLow: z.low,
            obTime: z.time,
            stop: wideStop,
            expiry: bar.time + ENTRY_WINDOW_MS,
          };
          setupList.push(setup);
          if (bar.time >= TEST_FROM) {
            console.log(
              `  setup ${new Date(bar.time).toISOString().slice(0, 16)} ${s.dir === 1 ? "LONG" : "SHORT"} ` +
                `${s.level.tf}/${s.level.kind} ${z.zone} ${z.low.toFixed(5)}-${z.high.toFixed(5)} ` +
                `stop ${wideStop.toFixed(5)} (${(Math.abs(z.high - wideStop) / PIP).toFixed(1)}p)`,
            );
          }
        }
      }
      pending.splice(p, 1);
    }
  }

  console.log(`  H4 MSS events ${events.length}, 15m OB setups ${setupList.length}`);
  console.log(
    `  test-window funnel: touches ${funnel.touch}, bias-aligned ${funnel.bias}, H4 MSS ${funnel.mss}, OB ${funnel.ob}`,
  );
  console.log(
    `  event dates: ${events.map((e) => new Date(e.time).toISOString().slice(0, 10)).join(", ")}`,
  );

  // ---- 15m: wait for the retrace into the OB, limit entry, hold to HTF target ----
  const trades: Trade[] = [];
  let position: Trade | null = null;
  const activeSetups = [...setupList].sort((a, b) => a.time - b.time);
  const skipped = { expired: 0, invalid: 0, noFill: 0, noTarget: 0, risk: 0, session: 0 };

  const closePosition = (t: Bar, reason: string, exitOverride?: number): void => {
    if (position === null) return;
    const exit = exitOverride ?? t.close;
    const gross =
      position.dir === 1
        ? (exit - position.entry) / (position.entry - position.stop)
        : (position.entry - exit) / (position.stop - position.entry);
    position.exitTime = t.time;
    position.exit = exit;
    position.grossR = gross;
    position.netR = gross - costPips / position.riskPips;
    position.reason = reason;
    trades.push(position);
    position = null;
  };

  for (const bar of m15) {
    if (position !== null && bar.time > position.entryTime) {
      const p = position;
      if (p.dir === 1) {
        if (bar.low <= p.stop) closePosition(bar, "stop", p.stop);
        else if (bar.high >= p.target) closePosition(bar, "target", p.target);
      } else {
        if (bar.high >= p.stop) closePosition(bar, "stop", p.stop);
        else if (bar.low <= p.target) closePosition(bar, "target", p.target);
      }
    }

    if (bar.time < TEST_FROM || bar.time > TEST_TO) continue;
    if (position !== null) continue;

    for (let s = 0; s < activeSetups.length; s++) {
      const setup = activeSetups[s]!;
      if (bar.time < setup.time) break;
      if (bar.time > setup.expiry || setup.level.used) {
        skipped.expired++;
        activeSetups.splice(s, 1);
        s--;
        continue;
      }

      // Limit fill at the OB demarcation. Check the fill before invalidating: if the bar
      // sweeps the OB and closes through it, the trade is a same-bar stop, not a skipped setup.
      const filled = setup.dir === 1 ? bar.low <= setup.obHigh : bar.high >= setup.obLow;
      if (!filled) {
        if (setup.dir === 1 && bar.close < setup.obLow - EPS) {
          skipped.invalid++;
          activeSetups.splice(s, 1);
          s--;
          continue;
        }
        if (setup.dir === -1 && bar.close > setup.obHigh + EPS) {
          skipped.invalid++;
          activeSetups.splice(s, 1);
          s--;
          continue;
        }
        skipped.noFill++;
        continue;
      }
      if (!inSession(bar.time)) {
        skipped.session++;
        continue;
      }

      const entry = setup.dir === 1 ? setup.obHigh : setup.obLow;
      const stop = setup.stop;
      const risk = Math.abs(entry - stop);
      const riskPips = risk / PIP;
      if (riskPips < 3 || riskPips > 120) {
        skipped.risk++;
        continue;
      }

      // Target: nearest opposing D1/W1 level, at least 2R away.
      let target = 0;
      for (const lv of levels) {
        if (lv.confirmed >= bar.time) break;
        if (lv.brokenAt !== 0 && lv.brokenAt <= bar.time) continue;
        if (setup.dir === 1 && lv.kind === "A" && lv.price > entry + MIN_TARGET_R * risk) {
          if (target === 0 || lv.price < target) target = lv.price;
        }
        if (setup.dir === -1 && lv.kind === "V" && lv.price < entry - MIN_TARGET_R * risk) {
          if (target === 0 || lv.price > target) target = lv.price;
        }
      }
      if (target === 0) {
        skipped.noTarget++;
        continue;
      }
      const targetR = Math.abs(target - entry) / risk;

      position = {
        instrument,
        dir: setup.dir,
        tf: setup.level.tf,
        kind: setup.level.kind,
        zone: setup.zone,
        entryTime: bar.time,
        entry,
        stop,
        target,
        targetR,
        exitTime: 0,
        exit: 0,
        grossR: 0,
        netR: 0,
        riskPips,
        reason: "",
      };
      setup.level.used = true;
      activeSetups.splice(s, 1);

      // Same-bar stop check (conservative, since the entry is a limit inside the bar).
      if (setup.dir === 1 && bar.low <= stop) closePosition(bar, "stop", stop);
      else if (setup.dir === -1 && bar.high >= stop) closePosition(bar, "stop", stop);
      break;
    }
  }

  if (position !== null) closePosition(m15[m15.length - 1]!, "end");
  console.log(`  skipped: ${JSON.stringify(skipped)}`);

  return { trades, mss: events.length, setups: setupList.length };
}

// setupList is shared by the H4 builder and the 15m simulator; declared here so run() can use it.
const setupList: Setup[] = [];

function stats(trades: Trade[]): {
  n: number;
  winRate: number;
  netR: number;
  avgR: number;
  pf: number;
  maxDD: number;
  avgTargetR: number;
} {
  const n = trades.length;
  const wins = trades.filter((t) => t.netR > 0).length;
  const netR = trades.reduce((s, t) => s + t.netR, 0);
  const gw = trades.filter((t) => t.netR > 0).reduce((s, t) => s + t.netR, 0);
  const gl = Math.abs(trades.filter((t) => t.netR < 0).reduce((s, t) => s + t.netR, 0));
  let peak = 0;
  let eq = 0;
  let dd = 0;
  for (const t of trades) {
    eq += t.netR;
    peak = Math.max(peak, eq);
    dd = Math.max(dd, peak - eq);
  }
  return {
    n,
    winRate: n === 0 ? 0 : wins / n,
    netR,
    avgR: n === 0 ? 0 : netR / n,
    pf: gl === 0 ? Infinity : gw / gl,
    maxDD: dd,
    avgTargetR: n === 0 ? 0 : trades.reduce((s, t) => s + t.targetR, 0) / n,
  };
}

function report(label: string, trades: Trade[]): void {
  const s = stats(trades);
  console.log(
    `${label.padEnd(18)} ${String(s.n).padStart(4)}  ${(s.winRate * 100).toFixed(1).padStart(5)}%  ` +
      `${s.netR.toFixed(1).padStart(8)}R  ${s.avgR.toFixed(2).padStart(6)}R/t  ` +
      `PF ${Number.isFinite(s.pf) ? s.pf.toFixed(2) : "inf"}  DD ${s.maxDD.toFixed(1)}R  ` +
      `avg target ${s.avgTargetR.toFixed(1)}R`,
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string): string => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] !== undefined ? args[i + 1]! : fallback;
  };
  const instrumentArg = get("--instrument", "both");
  const instruments: Instrument[] =
    instrumentArg === "both" ? ["EURUSD", "GBPUSD"] : [instrumentArg as Instrument];

  console.log("MNSR v2: D1 bias + D1/W1 A/V level + H4 reaction/MSS + 15m OB limit entry");
  console.log(`Test ${new Date(TEST_FROM).toISOString().slice(0, 10)} -> ${new Date(TEST_TO).toISOString().slice(0, 10)}`);

  const all: Trade[] = [];
  for (const instrument of instruments) {
    setupList.length = 0;
    console.log(`${instrument}: loading M1...`);
    const m1 = await loadBars(instrument, WARMUP_FROM, TEST_TO);
    console.log(`${instrument}: ${m1.length} bars, scanning levels/MSS...`);
    const result = run(instrument, m1);
    report(instrument, result.trades);
    console.log(`    H4 MSS events ${result.mss}, 15m OB setups ${result.setups}`);
    all.push(...result.trades);
  }
  report("TOTAL", all);
  for (const zone of ["OB", "Breaker"] as const) {
    report(`  ${zone}`, all.filter((t) => t.zone === zone));
  }

  for (const t of all) {
    console.log(
      `  ${new Date(t.entryTime).toISOString().slice(0, 16)} ${t.instrument} ${t.dir === 1 ? "LONG " : "SHORT"} ` +
        `${t.tf}/${t.kind}/${t.zone} entry ${t.entry.toFixed(5)} stop ${t.stop.toFixed(5)} ` +
        `target ${t.target.toFixed(5)} (${t.targetR.toFixed(1)}R) -> ${t.reason} ${t.netR.toFixed(2)}R`,
    );
  }
}

await main();
