import { runBacktest, type BacktestOptions } from "./backtest.js";
import { computeStats } from "./stats.js";
import { sessionOf, weekdayOf } from "./time.js";
import type {
  BacktestResult,
  BarSeries,
  EquityPoint,
  Instrument,
  SessionConfig,
  SessionName,
  Stats,
  StrategyConfig,
  Trade,
} from "./types.js";

/** One backtest run and what the report should remember about it. */
export interface ReportRun {
  /** The instrument the run traded. */
  instrument: Instrument;
  /** How many bars it replayed. */
  bars: number;
  result: BacktestResult;
}

/** What one run contributed, so the report says what it was built from. */
export interface RunSummary {
  /** The instrument the run traded. */
  instrument: Instrument;
  /** How many bars it replayed. */
  bars: number;
  /** The hash of the config the run was made with. */
  configHash: string;
  /** The hash of the bars the run replayed. */
  dataHash: string;
  /** The run's own statistics, before any pooling. */
  stats: Stats;
}

/** One line of a breakdown: the trades that shared a session, a weekday or an instrument. */
export interface BreakdownRow {
  /** The group the row stands for: a session name, a weekday name, or an instrument. */
  key: string;
  tradeCount: number;
  winRate: number;
  /** The average R per trade, which is the group's expectancy. */
  avgR: number;
  /** The group's total R. */
  netR: number;
}

/** One spread assumption of the cost-sensitivity sweep and what the scenario returned under it. */
export interface CostPoint {
  label: "optimistic" | "mid" | "pessimistic";
  /** The spread the scenario ran with. */
  spread: number;
  stats: Stats;
}

/**
 * The performance report (spec §Interfaces): the statistics and equity curve of one or more
 * backtest runs, pooled over every trade they took.
 *
 * A report may cover several runs — the two instruments, or one run per dataset — so the
 * statistics are pooled across them and the equity curve is the portfolio of running all of them
 * from one starting balance. Every run is assumed to start from that same balance.
 */
export interface Report {
  /** Pooled over every trade of every run; `maxDrawdown` is on the combined equity curve. */
  stats: Stats;
  /** The runs' equity as one curve: every run's profit and loss summed from the initial balance. */
  equityCurve: EquityPoint[];
  /** One entry per run, in the order they were given. */
  runs: RunSummary[];
  bySession: BreakdownRow[];
  byWeekday: BreakdownRow[];
  byInstrument: BreakdownRow[];
  /** The spread sweep (spec US30), when one was run for this report. */
  costSensitivity?: CostPoint[];
}

/** Sessions are reported in the order the ruleset walks them, off-session trades last. */
const SESSION_ORDER: SessionName[] = ["asia", "london", "newYork", "other"];

/** Luxon's weekday numbering, 1 Monday to 7 Sunday. */
const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Group trades under a key, keeping the order they were first seen in. */
function groupTrades(trades: Trade[], keyOf: (trade: Trade) => string): Map<string, Trade[]> {
  const groups = new Map<string, Trade[]>();
  for (const trade of trades) {
    const key = keyOf(trade);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [trade]);
    else group.push(trade);
  }
  return groups;
}

function summarise(key: string, trades: Trade[]): BreakdownRow {
  const rs = trades.map((trade) => trade.rMultiple ?? 0);
  const netR = rs.reduce((total, r) => total + r, 0);
  return {
    key,
    tradeCount: trades.length,
    winRate: rs.filter((r) => r > 0).length / trades.length,
    avgR: netR / trades.length,
    netR,
  };
}

/** The rows of a breakdown, ordered by the given key order (and alphabetically for instruments). */
function breakdown(
  trades: Trade[],
  keyOf: (trade: Trade) => string,
  order?: string[],
): BreakdownRow[] {
  const groups = groupTrades(trades, keyOf);
  const keys = [...groups.keys()].sort(
    order === undefined
      ? undefined
      : (a, b) => order.indexOf(a) - order.indexOf(b) || a.localeCompare(b),
  );
  return keys.map((key) => summarise(key, groups.get(key)!));
}

/**
 * Every run's cumulative PnL, summed from its own starting equity and walked in time order — the
 * equity of running all of the report's runs from one balance. A report of a single run is that
 * run's own curve.
 */
function combineCurves(runs: ReportRun[]): EquityPoint[] {
  let initial: number | null = null;
  const live: number[] = [];
  const updates: { time: number; index: number; delta: number }[] = [];

  runs.forEach((run, index) => {
    const curve = run.result.equityCurve;
    const first = curve[0];
    if (first === undefined) {
      live.push(0);
      return;
    }
    if (initial === null) initial = first.equity;
    live.push(0);
    for (const point of curve) {
      updates.push({ time: point.time, index, delta: point.equity - first.equity });
    }
  });

  if (initial === null) return [];

  updates.sort((a, b) => a.time - b.time || a.index - b.index);

  const points: EquityPoint[] = [];
  for (let i = 0; i < updates.length; ) {
    const time = updates[i]!.time;
    while (i < updates.length && updates[i]!.time === time) {
      const update = updates[i]!;
      live[update.index] = update.delta;
      i++;
    }
    const equity = live.reduce((sum, delta) => sum + delta, 0);
    points.push({ time, equity: initial + equity });
  }
  return points;
}

/**
 * Build the report of one or more runs: pooled statistics over their trades and equity, plus the
 * breakdowns by session, weekday and instrument. The session config is what places a trade's
 * entry time in a session and gives its session day a weekday.
 */
export function buildReport(input: {
  runs: ReportRun[];
  session: SessionConfig;
  costSensitivity?: CostPoint[];
}): Report {
  const trades = input.runs.flatMap((run) => run.result.trades);
  const { session } = input;
  const equityCurve = combineCurves(input.runs);

  return {
    stats: computeStats(trades, equityCurve),
    equityCurve,
    runs: input.runs.map((run) => ({
      instrument: run.instrument,
      bars: run.bars,
      configHash: run.result.configHash,
      dataHash: run.result.dataHash,
      stats: run.result.stats,
    })),
    bySession: breakdown(trades, (trade) => sessionOf(trade.entryTime, session), SESSION_ORDER),
    byWeekday: breakdown(
      trades,
      (trade) => WEEKDAY_NAMES[weekdayOf(trade.entryTime, session) - 1]!,
      WEEKDAY_NAMES,
    ),
    byInstrument: breakdown(trades, (trade) => trade.instrument),
    costSensitivity: input.costSensitivity,
  };
}

/**
 * The cost-sensitivity mode (spec US30): replay the same scenario under the optimistic and
 * pessimistic spreads the config declares, with the configured spread as the mid case. Returns
 * null when the config declares no bounds — there is nothing to sweep against. The bounds must
 * run optimistic to pessimistic, so that results worsening point to point means bad news.
 */
export function costSensitivity(input: {
  series: BarSeries;
  cfg: StrategyConfig;
  options?: BacktestOptions;
}): CostPoint[] | null {
  const bounds = input.cfg.costs.sensitivity;
  if (bounds === undefined) return null;

  const mid = input.cfg.costs.spread;
  if (!(bounds.optimistic <= mid && mid <= bounds.pessimistic)) {
    throw new Error(
      `cost sensitivity bounds must run optimistic <= mid <= pessimistic, got ` +
        `${bounds.optimistic}, ${mid}, ${bounds.pessimistic}`,
    );
  }

  const variants: [CostPoint["label"], number][] = [
    ["optimistic", bounds.optimistic],
    ["mid", mid],
    ["pessimistic", bounds.pessimistic],
  ];

  return variants.map(([label, spread]) => ({
    label,
    spread,
    stats: runBacktest(
      input.series,
      { ...input.cfg, costs: { ...input.cfg.costs, spread } },
      input.options,
    ).stats,
  }));
}

/** Narrow an unknown to something whose fields can be asked for by name. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** A breakdown row has to carry the key and the count the report prints it by. */
function isBreakdownRow(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value["key"] === "string" &&
    typeof value["tradeCount"] === "number"
  );
}

/** A run summary has to carry the instrument and the statistics the report prints it by. */
function isRunSummary(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const stats = value["stats"];
  return (
    typeof value["instrument"] === "string" &&
    typeof value["bars"] === "number" &&
    isRecord(stats) &&
    typeof stats["tradeCount"] === "number"
  );
}

/** The fields a saved report must carry; anything without them is not one. */
function isReport(value: unknown): value is Report {
  if (!isRecord(value)) return false;
  const stats = value["stats"];
  return (
    isRecord(stats) &&
    typeof stats["tradeCount"] === "number" &&
    Array.isArray(value["equityCurve"]) &&
    Array.isArray(value["runs"]) &&
    value["runs"].every(isRunSummary) &&
    Array.isArray(value["bySession"]) &&
    Array.isArray(value["byWeekday"]) &&
    Array.isArray(value["byInstrument"]) &&
    value["bySession"].every(isBreakdownRow) &&
    value["byWeekday"].every(isBreakdownRow) &&
    value["byInstrument"].every(isBreakdownRow)
  );
}

/**
 * A report as text. JSON cannot hold a non-finite number, so a query with no losing trades — one
 * whose profit factor is infinite — would otherwise be written as null and read back wrong; the
 * three non-finite values are written as their names and revived on the way in. No field of a
 * report can hold one of those names as text, so the revival is unambiguous.
 */
export function serializeReport(report: Report): string {
  return JSON.stringify(
    report,
    (_key, value: unknown) =>
      typeof value === "number" && !Number.isFinite(value) ? String(value) : value,
    2,
  );
}

/** Read a report back, rejecting anything that is not one. */
export function parseReport(text: string): Report {
  let value: unknown;
  try {
    value = JSON.parse(text, (_key, item: unknown) =>
      item === "Infinity" || item === "-Infinity" || item === "NaN" ? Number(item) : item,
    );
  } catch {
    throw new Error("not a CRTbot report: the text is not JSON");
  }
  if (!isReport(value)) {
    throw new Error("not a CRTbot report: no statistics, equity curve or breakdowns");
  }
  return value;
}

/** The report as the CLI prints it: headline statistics, each breakdown, then the sweep. */
export function formatReport(report: Report): string {
  const { stats } = report;
  const lines = [
    "CRTbot backtest report",
    `tradeCount: ${stats.tradeCount}`,
    `winRate: ${stats.winRate.toFixed(3)}`,
    `avgR: ${stats.avgR.toFixed(3)}`,
    `expectancyR: ${stats.expectancyR.toFixed(3)}`,
    `profitFactor: ${stats.profitFactor}`,
    `maxDrawdown: ${stats.maxDrawdown.toFixed(3)}`,
    "runs:",
    ...report.runs.map(
      (run, index) =>
        `  ${index + 1}. ${run.instrument} ${run.bars} bars, ${run.stats.tradeCount} trades, ` +
        `expectancyR ${run.stats.expectancyR.toFixed(3)}, config ${run.configHash}, ` +
        `data ${run.dataHash}`,
    ),
  ];

  for (const [title, rows] of [
    ["by session", report.bySession],
    ["by weekday", report.byWeekday],
    ["by instrument", report.byInstrument],
  ] as const) {
    lines.push(`${title}:`);
    if (rows.length === 0) lines.push("  (no trades)");
    for (const row of rows) {
      lines.push(
        `  ${row.key.padEnd(10)} ${row.tradeCount} trades, winRate ${row.winRate.toFixed(3)}, ` +
          `avgR ${row.avgR.toFixed(3)}, netR ${row.netR.toFixed(3)}`,
      );
    }
  }

  const sweep = report.costSensitivity;
  if (sweep !== undefined) {
    lines.push("cost sensitivity:");
    for (const point of sweep) {
      lines.push(
        `  ${point.label.padEnd(11)} spread ${point.spread.toFixed(5)}, ` +
          `expectancyR ${point.stats.expectancyR.toFixed(3)}, ` +
          `profitFactor ${point.stats.profitFactor}`,
      );
    }
  }

  return lines.join("\n");
}
