/**
 * Ticket 20, phase 1 — where the edge is. Runs once over stored data (or reads a previous dump),
 * then slices every realised trade by the signals its *arming* decision carried — the bar the
 * setup was actually built on, which is where `axisSystem` read the block, killzone, expansion
 * verdict and structure. Prints n / winRate / avgR / netR per slice.
 *
 *   npx tsx scratch-filters.ts [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--in dump.json] [--out dump.json]
 */
import { readFileSync, writeFileSync } from "node:fs";

import { runBacktest } from "./src/backtest.js";
import { axisSystem } from "./src/execution.js";
import { DEFAULT_DATA_DIR, loadSeries } from "./src/ingest.js";
import { DEFAULT_SWING_WIDTH } from "./src/structure.js";
import { DEFAULT_SESSION_CONFIG, isKeyMacro, killzoneOf } from "./src/time.js";
import type {
  BarSeries,
  BiasDirection,
  Decision,
  Instrument,
  OrderBlock,
  PricePosition,
  StrategyConfig,
} from "./src/types.js";

const DAY = 86_400_000;
const tz = DEFAULT_SESSION_CONFIG.tz;
const session = DEFAULT_SESSION_CONFIG;

/** One armed setup: the arm-bar snapshot, plus the realised trade it filled (if any). */
interface ArmRow {
  armTime: number;
  direction: "long" | "short";
  session: string;
  killzone: string | null;
  bias: BiasDirection;
  expansion: string | null;
  macro: string | null;
  structurePosition: PricePosition | null;
  contextAligned: boolean | null;
  contextCrt: boolean;
  smtConfirmed: string | null;
  smtFlagged: boolean;
  liqKind: string | null;
  liqIsCrt: boolean;
  liqSide: string | null;
  blockBehaviours: string[];
  blockPart: string | null;
  blockPropulsion: boolean;
  blockCandles: number;
  blockAtKeyTime: boolean;
  /** The block zone's open / top / bottom, and the risk the trade would take in pips. */
  blockOpen: number | null;
  blockTop: number | null;
  blockBottom: number | null;
  riskPips: number | null;
  /** The fill. */
  fillTime: number | null;
  fillKillzone: string | null;
  rMultiple: number | null;
}

interface Dump {
  from: number;
  to: number;
  bars: number;
  stats: unknown;
  arms: ArmRow[];
}

function demoConfig(): StrategyConfig {
  return {
    instrument: "GBPUSD",
    session: DEFAULT_SESSION_CONFIG,
    structure: { swingWidth: DEFAULT_SWING_WIDTH },
    strategy: { stopDistance: 0.001 },
    risk: { rMultiple: 3, maxTradesPerDay: 1, riskPerTradePct: 0.01 },
    costs: {
      spread: 0.0001,
      commission: 0,
      slippage: 0,
      sensitivity: { optimistic: 0.00005, pessimistic: 0.00025 },
    },
    initialEquity: 10000,
  };
}

function realConfig(instrument: Instrument): StrategyConfig {
  return {
    ...demoConfig(),
    instrument,
    smt: { enabled: true, pairs: [["GBPUSD", "EURUSD"]], useDxy: false },
  };
}

function flag(rest: string[], name: string): string | undefined {
  const index = rest.indexOf(name);
  return index === -1 ? undefined : rest[index + 1];
}

function dayBound(text: string, bound: "start" | "end"): number {
  const start = Date.parse(`${text}T00:00:00Z`);
  if (Number.isNaN(start)) throw new Error(`cannot read the date "${text}"`);
  return bound === "start" ? start : start + DAY - 1;
}

const clockMinutes = new Intl.DateTimeFormat("en-US", {
  timeZone: tz,
  hour12: false,
  hour: "2-digit",
  minute: "2-digit",
});
function minuteOfDay(time: number): number {
  const parts = clockMinutes.formatToParts(new Date(time));
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

const weekdayFmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" });

/** The block `axisSystem` would have traded: the purge block first, else the first block. */
function chosen(blocks: OrderBlock[]): OrderBlock | null {
  return blocks.find((block) => block.behaviours.includes("purge")) ?? blocks[0] ?? null;
}

/** Slice the arm log the way the engine binds fills: arm → fill, expiry → no arm. */
function collectArms(decisions: Decision[], trades: Map<string, { rMultiple?: number }>): ArmRow[] {
  const arms: ArmRow[] = [];
  let active: ArmRow | null = null;

  const killzone = (time: number): string | null => killzoneOf(time, session);

  for (const decision of decisions) {
    if (decision.action === "wait" && decision.reason.startsWith("setup armed:")) {
      const blocks = decision.orderBlocks ?? [];
      const block = chosen(blocks);
      active = {
        armTime: decision.time,
        direction: decision.direction as "long" | "short",
        session: decision.session ?? "unknown",
        killzone: decision.killzone ?? null,
        bias: decision.bias ?? "none",
        expansion: decision.expansionTest?.session ?? null,
        macro: decision.macro?.direction ?? null,
        structurePosition: decision.structure?.position ?? null,
        contextAligned: decision.context?.aligned ?? null,
        contextCrt: decision.context?.crt != null,
        smtConfirmed: decision.smt?.confirmedBy ?? null,
        smtFlagged: decision.smt != null,
        liqKind: decision.liquidity?.kind ?? null,
        liqIsCrt: decision.liquidity?.isCrt ?? false,
        liqSide: decision.liquidity?.side ?? null,
        blockBehaviours: block?.behaviours ?? [],
        blockPart: block?.part ?? null,
        blockPropulsion: block?.propulsion ?? false,
        blockCandles: block?.candles ?? 0,
        blockAtKeyTime:
          block != null &&
          (killzone(block.time) !== null || isKeyMacro(block.time, session)),
        blockOpen: block?.open ?? null,
        blockTop: block?.top ?? null,
        blockBottom: block?.bottom ?? null,
        riskPips:
          block == null
            ? null
            : Math.abs(block.open - (decision.direction === "long" ? block.bottom : block.top)) *
              10000,
        fillTime: null,
        fillKillzone: null,
        rMultiple: null,
      };
      arms.push(active);
      continue;
    }
    if (decision.action === "wait" && decision.reason === "setup expired with the day") {
      active = null;
      continue;
    }
    if (decision.action === "enter" && active !== null) {
      active.fillTime = decision.time;
      active.fillKillzone = decision.killzone ?? null;
      const trade = trades.get(`${decision.time}|${decision.direction}`);
      active.rMultiple = trade?.rMultiple ?? null;
      active = null;
    }
  }
  return arms;
}

interface Slice {
  label: string;
  of: (row: ArmRow) => boolean;
}

interface Section {
  header: string;
  slices: Slice[];
}

function buildSections(): Section[] {
  const behaviour = (needle: string) => (row: ArmRow) => row.blockBehaviours.includes(needle);
  const exact = (behaviours: string[]) => (row: ArmRow) => {
    const list = row.blockBehaviours;
    return list.length === behaviours.length && behaviours.every((b) => list.includes(b));
  };
  const killzone = (name: string) => (row: ArmRow) => row.killzone === name;
  const expansion = (name: string) => (row: ArmRow) => row.expansion === name;
  const direction = (name: string) => (row: ArmRow) => row.direction === name;
  const rangeAligned = (row: ArmRow): boolean =>
    (row.direction === "long" && row.structurePosition === "discount") ||
    (row.direction === "short" && row.structurePosition === "premium");

  return [
    {
      header: "session / killzone (at arm)",
      slices: [
        { label: "london", of: killzone("london") },
        { label: "newYork", of: killzone("newYork") },
        { label: "fill outside killzone", of: (row) => row.fillTime != null && row.fillKillzone === null },
        { label: "fill back in killzone", of: (row) => row.fillKillzone != null },
        { label: "filled on the arm bar", of: (row) => row.fillTime === row.armTime },
        { label: "filled on a later bar", of: (row) => row.fillTime != null && row.fillTime !== row.armTime },
      ],
    },
    {
      header: "direction",
      slices: [
        { label: "long", of: direction("long") },
        { label: "short", of: direction("short") },
      ],
    },
    {
      header: "chosen block behaviours (at arm)",
      slices: [
        { label: "purge", of: behaviour("purge") },
        { label: "fill", of: behaviour("fill") },
        { label: "generate", of: behaviour("generate") },
        { label: "purge + generate", of: exact(["purge", "generate"]) },
        { label: "purge only", of: exact(["purge"]) },
        { label: "no purge", of: (row) => !behaviour("purge")(row) },
        { label: "no behaviours", of: (row) => row.blockBehaviours.length === 0 },
      ],
    },
    {
      header: "block shape (at arm)",
      slices: [
        { label: "body", of: (row) => row.blockPart === "body" },
        { label: "wick", of: (row) => row.blockPart === "wick" },
        { label: "propulsion", of: (row) => row.blockPropulsion },
        { label: "single candle", of: (row) => row.blockCandles === 1 },
        { label: "multi candle", of: (row) => row.blockCandles > 1 },
        { label: "formed at key time", of: (row) => row.blockAtKeyTime },
      ],
    },
    {
      header: "expansion verdict (at arm)",
      slices: [
        { label: "london", of: expansion("london") },
        { label: "newYork", of: expansion("newYork") },
        { label: "neither", of: expansion("neither") },
        { label: "L trade / london day", of: (row) => killzone("london")(row) && expansion("london")(row) },
        { label: "L trade / newYork day", of: (row) => killzone("london")(row) && expansion("newYork")(row) },
        { label: "L trade / neither", of: (row) => killzone("london")(row) && expansion("neither")(row) },
        { label: "NY trade / newYork day", of: (row) => killzone("newYork")(row) && expansion("newYork")(row) },
        { label: "NY trade / london day", of: (row) => killzone("newYork")(row) && expansion("london")(row) },
        { label: "NY trade / neither", of: (row) => killzone("newYork")(row) && expansion("neither")(row) },
      ],
    },
    {
      header: "weekday (arm, session tz)",
      slices: ["Mon", "Tue", "Wed", "Thu", "Fri"].map((day) => ({
        label: day,
        of: (row: ArmRow) => weekdayFmt.format(new Date(row.armTime)) === day,
      })),
    },
    {
      header: "structure position (at arm)",
      slices: [
        { label: "premium", of: (row) => row.structurePosition === "premium" },
        { label: "discount", of: (row) => row.structurePosition === "discount" },
        { label: "equilibrium", of: (row) => row.structurePosition === "equilibrium" },
        { label: "range-aligned (L@disc / S@prem)", of: rangeAligned },
        { label: "range-against", of: (row) => !rangeAligned(row) },
      ],
    },
    {
      header: "context (H4, at arm)",
      slices: [
        { label: "aligned", of: (row) => row.contextAligned === true },
        { label: "not aligned", of: (row) => row.contextAligned === false },
        { label: "crt present", of: (row) => row.contextCrt },
      ],
    },
    {
      header: "SMT (at arm)",
      slices: [
        { label: "no divergence", of: (row) => !row.smtFlagged },
        { label: "flagged", of: (row) => row.smtFlagged },
        { label: "confirmed", of: (row) => row.smtConfirmed != null },
      ],
    },
    {
      header: "liquidity sweep (at arm)",
      slices: [
        { label: "none", of: (row) => row.liqKind === null && row.liqSide === null },
        { label: "purge", of: (row) => row.liqKind === "purge" },
        { label: "csd", of: (row) => row.liqKind === "csd" },
        { label: "unclassified", of: (row) => row.liqSide != null && row.liqKind === null },
        { label: "is CRT", of: (row) => row.liqIsCrt },
        { label: "low side", of: (row) => row.liqSide === "low" },
        { label: "high side", of: (row) => row.liqSide === "high" },
      ],
    },
    {
      header: "macro context (at arm)",
      slices: [
        { label: "bullish", of: (row) => row.macro === "bullish" },
        { label: "bearish", of: (row) => row.macro === "bearish" },
        { label: "none", of: (row) => row.macro === "none" },
        {
          label: "agrees with trade",
          of: (row) =>
            (row.direction === "long" && row.macro === "bullish") ||
            (row.direction === "short" && row.macro === "bearish"),
        },
        {
          label: "disagrees with trade",
          of: (row) =>
            row.macro != null &&
            row.macro !== "none" &&
            ((row.direction === "long" && row.macro === "bearish") ||
              (row.direction === "short" && row.macro === "bullish")),
        },
      ],
    },
    {
      header: "risk width of the block zone (pips)",
      slices: [
        { label: "< 1 pip", of: (row) => row.riskPips != null && row.riskPips < 1 },
        { label: "1 .. 2 pips", of: (row) => row.riskPips != null && row.riskPips >= 1 && row.riskPips < 2 },
        { label: "2 .. 3 pips", of: (row) => row.riskPips != null && row.riskPips >= 2 && row.riskPips < 3 },
        { label: "3 .. 5 pips", of: (row) => row.riskPips != null && row.riskPips >= 3 && row.riskPips < 5 },
        { label: "5 .. 8 pips", of: (row) => row.riskPips != null && row.riskPips >= 5 && row.riskPips < 8 },
        { label: "8 .. 12 pips", of: (row) => row.riskPips != null && row.riskPips >= 8 && row.riskPips < 12 },
        { label: ">= 12 pips", of: (row) => row.riskPips != null && row.riskPips >= 12 },
      ],
    },
    {
      header: "candidate filters",
      slices: [
        { label: "wick only", of: (row) => row.blockPart === "wick" },
        { label: "risk >= 2", of: (row) => row.riskPips != null && row.riskPips >= 2 },
        { label: "risk >= 3", of: (row) => row.riskPips != null && row.riskPips >= 3 },
        { label: "risk >= 5", of: (row) => row.riskPips != null && row.riskPips >= 5 },
        { label: "wick + risk>=3", of: (row) => row.blockPart === "wick" && row.riskPips != null && row.riskPips >= 3 },
        { label: "wick + risk>=5", of: (row) => row.blockPart === "wick" && row.riskPips != null && row.riskPips >= 5 },
        {
          label: "wick + risk>=3 + purge only",
          of: (row) => row.blockPart === "wick" && row.riskPips != null && row.riskPips >= 3 && exact(["purge"])(row),
        },
        {
          label: "wick + risk>=3 + london",
          of: (row) => row.blockPart === "wick" && row.riskPips != null && row.riskPips >= 3 && row.killzone === "london",
        },
        {
          label: "wick + risk>=3 + newYork",
          of: (row) => row.blockPart === "wick" && row.riskPips != null && row.riskPips >= 3 && row.killzone === "newYork",
        },
        {
          label: "wick + risk>=3 + not Monday",
          of: (row) =>
            row.blockPart === "wick" &&
            row.riskPips != null &&
            row.riskPips >= 3 &&
            weekdayFmt.format(new Date(row.armTime)) !== "Mon",
        },
        {
          label: "risk>=3 + fill outside killzone",
          of: (row) => row.riskPips != null && row.riskPips >= 3 && row.fillKillzone === null,
        },
      ],
    },
    {
      header: "putting conditions together (at arm)",
      slices: [
        {
          label: "range-aligned + purge + keytime",
          of: (row) => rangeAligned(row) && behaviour("purge")(row) && row.blockAtKeyTime,
        },
        { label: "range-aligned + purge", of: (row) => rangeAligned(row) && behaviour("purge")(row) },
        {
          label: "no purge + range-against",
          of: (row) => !behaviour("purge")(row) && !rangeAligned(row),
        },
        {
          label: "NY 8:30-9:30 band (arm)",
          of: (row) => {
            const minutes = minuteOfDay(row.armTime);
            return minutes >= 8 * 60 + 30 && minutes <= 9 * 60 + 30;
          },
        },
        {
          label: "NY 8:30-9:30 band (fill)",
          of: (row) => {
            if (row.fillTime == null) return false;
            const minutes = minuteOfDay(row.fillTime);
            return minutes >= 8 * 60 + 30 && minutes <= 9 * 60 + 30;
          },
        },
        { label: "wick + london", of: (row) => row.blockPart === "wick" && killzone("london")(row) },
        { label: "wick + newYork", of: (row) => row.blockPart === "wick" && killzone("newYork")(row) },
        {
          label: "wick + filled later",
          of: (row) => row.blockPart === "wick" && row.fillTime != null && row.fillTime !== row.armTime,
        },
        {
          label: "wick + purge only",
          of: (row) => row.blockPart === "wick" && exact(["purge"])(row),
        },
        {
          label: "wick + london + filled later",
          of: (row) =>
            row.blockPart === "wick" &&
            killzone("london")(row) &&
            row.fillTime != null &&
            row.fillTime !== row.armTime,
        },
        {
          label: "wick + london + multi candle",
          of: (row) => row.blockPart === "wick" && killzone("london")(row) && row.blockCandles > 1,
        },
        {
          label: "body + newYork",
          of: (row) => row.blockPart === "body" && killzone("newYork")(row),
        },
      ],
    },
  ];
}

/** The shape of the outcome distribution, not just its mean. */
function histogram(label: string, rows: ArmRow[]): void {
  const pool = rows.filter((row) => row.rMultiple != null);
  const buckets: [string, (r: number) => boolean][] = [
    ["<= -0.95 (clean stop)", (r) => r <= -0.95],
    ["-0.95 .. -0.5", (r) => r > -0.95 && r <= -0.5],
    ["-0.5 .. 0", (r) => r > -0.5 && r <= 0],
    ["0 .. 1", (r) => r > 0 && r < 1],
    ["1 .. 2", (r) => r >= 1 && r < 2],
    ["2 .. 2.9", (r) => r >= 2 && r < 2.9],
    [">= 2.9 (clean target)", (r) => r >= 2.9],
  ];
  console.log(`\n-- ${label}: outcome distribution (n=${pool.length}) --`);
  for (const [name, test] of buckets) {
    const count = pool.filter((row) => test(row.rMultiple ?? 0)).length;
    console.log(`${name.padEnd(38)} ${String(count).padStart(5)}  ${((100 * count) / pool.length).toFixed(1)}%`);
  }
}

function report(label: string, rows: ArmRow[], filledOnly = true): string {
  const pool = filledOnly ? rows.filter((row) => row.rMultiple != null) : rows;
  if (pool.length === 0) return `${label.padEnd(38)} n=0`;
  const netR = pool.reduce((sum, row) => sum + (row.rMultiple ?? 0), 0);
  const wins = pool.filter((row) => (row.rMultiple ?? 0) > 0);
  const losses = pool.filter((row) => (row.rMultiple ?? 0) <= 0);
  const avgR = netR / pool.length;
  const avgWin = wins.length === 0 ? 0 : wins.reduce((s, r) => s + r.rMultiple!, 0) / wins.length;
  const avgLoss =
    losses.length === 0 ? 0 : losses.reduce((s, r) => s + r.rMultiple!, 0) / losses.length;
  const fillNote =
    filledOnly && rows.length !== pool.length ? `  (of ${rows.length} armed)` : "";
  return (
    `${label.padEnd(38)} n=${String(pool.length).padStart(5)}` +
    `  win=${((100 * wins.length) / pool.length).toFixed(1).padStart(5)}%` +
    ` w+${avgWin.toFixed(2)} l${avgLoss.toFixed(2)}` +
    `  avgR=${avgR >= 0 ? " " : ""}${avgR.toFixed(3)}` +
    `  netR=${netR >= 0 ? " " : ""}${netR.toFixed(1)}` +
    fillNote
  );
}

async function runAndDump(from: number, to: number, out: string): Promise<Dump> {
  const loaded = new Map<Instrument, BarSeries>();
  for (const instrument of ["GBPUSD", "EURUSD"] as Instrument[]) {
    const series = await loadSeries(instrument, from, to, realConfig(instrument), {
      dir: DEFAULT_DATA_DIR,
    });
    if (series.bars.length > 0) loaded.set(instrument, series);
  }
  const series = loaded.get("GBPUSD");
  if (series === undefined) throw new Error("no GBPUSD bars in range");

  console.log(
    `loading done: GBPUSD ${series.bars.length} bars, EURUSD ${loaded.get("EURUSD")?.bars.length ?? 0} bars`,
  );
  const started = Date.now();
  const result = runBacktest(series, realConfig("GBPUSD"), {
    strategy: axisSystem(),
    dataset: [...loaded.values()].filter((other) => other.instrument !== "GBPUSD"),
  });
  console.log(`run done in ${((Date.now() - started) / 1000).toFixed(1)}s`);

  const byKey = new Map<string, { rMultiple?: number }>();
  for (const trade of result.trades) {
    byKey.set(`${trade.entryTime}|${trade.direction}`, trade);
  }
  const arms = collectArms(result.decisions, byKey);
  const dump: Dump = { from, to, bars: series.bars.length, stats: result.stats, arms };
  writeFileSync(out, JSON.stringify(dump), "utf8");
  console.log(`dump written to ${out} (${arms.length} arms)`);
  return dump;
}

async function main(): Promise<void> {
  const rest = process.argv.slice(2);
  const inFile = flag(rest, "--in");
  const outFile = flag(rest, "--out") ?? "scratch-filters-dump.json";

  const dump: Dump =
    inFile !== undefined
      ? (JSON.parse(readFileSync(inFile, "utf8")) as Dump)
      : await runAndDump(
          dayBound(flag(rest, "--from") ?? "2015-01-01", "start"),
          dayBound(flag(rest, "--to") ?? "2024-12-31", "end"),
          outFile,
        );

  console.log(
    `\nrange ${new Date(dump.from).toISOString().slice(0, 10)} .. ${new Date(dump.to).toISOString().slice(0, 10)}` +
      `  bars=${dump.bars}  arms=${dump.arms.length}  filled=${dump.arms.filter((a) => a.rMultiple != null).length}`,
  );

  const filled = dump.arms.filter((row) => row.rMultiple != null);
  const netR = filled.reduce((sum, row) => sum + (row.rMultiple ?? 0), 0);
  console.log(
    `baseline: filled=${filled.length}  win=${((100 * filled.filter((r) => (r.rMultiple ?? 0) > 0).length) / filled.length).toFixed(1)}%` +
      `  avgR=${(netR / filled.length).toFixed(3)}  netR=${netR.toFixed(1)}`,
  );
  console.log(report("ALL", dump.arms));

  for (const section of buildSections()) {
    console.log(`\n-- ${section.header} --`);
    for (const slice of section.slices) {
      console.log(report(slice.label, dump.arms.filter(slice.of)));
    }
  }

  console.log("\n-- per year --");
  const years = new Map<number, ArmRow[]>();
  for (const row of dump.arms) {
    const year = Number(
      new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric" }).format(
        new Date(row.armTime),
      ),
    );
    const list = years.get(year) ?? [];
    list.push(row);
    years.set(year, list);
  }
  for (const [year, list] of [...years].sort((a, b) => a[0] - b[0])) {
    console.log(report(String(year), list));
  }

  histogram("all", dump.arms);
  histogram(
    "wick blocks",
    dump.arms.filter((row) => row.blockPart === "wick"),
  );
  histogram(
    "body blocks",
    dump.arms.filter((row) => row.blockPart === "body"),
  );
}

await main();
