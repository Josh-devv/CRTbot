/**
 * Probe: why does the expansion test's "newYork" verdict never fire on real bars?
 * Walks 6 months folding days exactly as `runBacktest` does, and prints the Asian ratio's
 * distribution and the verdict counts at bars inside a killzone.
 *
 *   npx tsx scratch-expansion.ts [--from YYYY-MM-DD] [--to YYYY-MM-DD]
 */
import { foldDay } from "./src/exceptions.js";
import { DEFAULT_DATA_DIR, loadSeries } from "./src/ingest.js";
import { expansionTest } from "./src/profiles.js";
import { DEFAULT_SESSION_CONFIG, killzoneOf, sessionDayStart } from "./src/time.js";
import type { DayFacts, Instrument, StrategyConfig } from "./src/types.js";

const DAY = 86_400_000;

function config(instrument: Instrument): StrategyConfig {
  return {
    instrument,
    session: DEFAULT_SESSION_CONFIG,
    structure: { swingWidth: 3 },
    strategy: { stopDistance: 0.001 },
    risk: { rMultiple: 3, maxTradesPerDay: 1, riskPerTradePct: 0.01 },
    costs: { spread: 0.0001, commission: 0, slippage: 0 },
    initialEquity: 10000,
    smt: { enabled: true, pairs: [["GBPUSD", "EURUSD"]], useDxy: false },
  };
}

function flag(rest: string[], name: string): string | undefined {
  const index = rest.indexOf(name);
  return index === -1 ? undefined : rest[index + 1];
}

function dayBound(text: string): number {
  return Date.parse(`${text}T00:00:00Z`);
}

const rest = process.argv.slice(2);
const from = dayBound(flag(rest, "--from") ?? "2024-01-01");
const to = dayBound(flag(rest, "--to") ?? "2024-06-30") + DAY - 1;

const cfg = config("GBPUSD");
const series = await loadSeries("GBPUSD", from, to, cfg, { dir: DEFAULT_DATA_DIR });
console.log(`loaded ${series.bars.length} bars`);

const completedDays: DayFacts[] = [];
let today: DayFacts | null = null;
let currentDay = Number.NaN;

const verdicts = new Map<string, number>();
const ratios: number[] = [];
const ratiosEarly = new Map<number, number[]>(); // hour in tz -> ratios (for shape)

const hourFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: DEFAULT_SESSION_CONFIG.tz,
  hour12: false,
  hour: "2-digit",
});

for (const bar of series.bars) {
  const day = sessionDayStart(bar.time, cfg.session);
  if (day !== currentDay) {
    currentDay = day;
    if (today !== null) completedDays.push(today);
    today = null;
  }
  today = foldDay(today, bar, cfg);

  if (killzoneOf(bar.time, cfg.session) === null) continue;

  const read = expansionTest({ completedDays, today, cfg });
  verdicts.set(read.session, (verdicts.get(read.session) ?? 0) + 1);

  const asia = today.asia;
  if (asia !== undefined) {
    const recent = completedDays.slice(-5);
    const history = recent
      .map((d) => (d.asia === undefined ? undefined : d.asia.high - d.asia.low))
      .filter((r): r is number => r !== undefined);
    const average =
      history.length === 5 ? history.reduce((sum, r) => sum + r, 0) / 5 : null;
    const ratio = average === null || average === 0 ? null : (asia.high - asia.low) / average;
    if (ratio !== null) {
      ratios.push(ratio);
      const hour = Number(hourFmt.format(new Date(bar.time)));
      const list = ratiosEarly.get(hour) ?? [];
      list.push(ratio);
      ratiosEarly.set(hour, list);
    }
  }
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[index]!;
}

const sorted = [...ratios].sort((a, b) => a - b);
console.log("verdicts at killzone bars:", Object.fromEntries(verdicts));
console.log(`ratio samples: ${sorted.length}`);
console.log(
  `min ${sorted[0]?.toFixed(2)}  p10 ${quantile(sorted, 0.1).toFixed(2)}  p25 ${quantile(sorted, 0.25).toFixed(2)}` +
    `  median ${quantile(sorted, 0.5).toFixed(2)}  p75 ${quantile(sorted, 0.75).toFixed(2)}` +
    `  p90 ${quantile(sorted, 0.9).toFixed(2)}  max ${sorted[sorted.length - 1]?.toFixed(2)}`,
);
for (const threshold of [0.75, 1.0, 1.25, 1.5, 2.0]) {
  console.log(
    `ratio <= ${threshold}: ${sorted.filter((r) => r <= threshold).length}` +
      `  (${((100 * sorted.filter((r) => r <= threshold).length) / sorted.length).toFixed(1)}%)` +
      `   >= ${threshold}: ${sorted.filter((r) => r >= threshold).length}` +
      `  (${((100 * sorted.filter((r) => r >= threshold).length) / sorted.length).toFixed(1)}%)`,
  );
}
console.log("\nratio by hour (tz):");
for (const [hour, list] of [...ratiosEarly].sort((a, b) => a[0] - b[0])) {
  const s = [...list].sort((a, b) => a - b);
  console.log(
    `  ${String(hour).padStart(2, "0")}:00  n=${String(s.length).padStart(5)}  ` +
      `median ${quantile(s, 0.5).toFixed(2)}  p90 ${quantile(s, 0.9).toFixed(2)}  max ${s[s.length - 1]?.toFixed(2)}`,
  );
}
