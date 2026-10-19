import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { asyncBufferFromFile, parquetReadObjects } from "hyparquet";
import { parquetWriteBuffer } from "hyparquet-writer";

import { aggregate, EXECUTION_TIMEFRAME } from "./candles.js";
import type { Bar, BarSeries, Instrument, StrategyConfig } from "./types.js";

/**
 * Real-data ingestion (ticket 02): HistData's M1 ASCII exports in, Parquet out, plus the loader
 * the backtester reads a date range back through.
 *
 * HistData writes `YYYYMMDD HHMMSS;Open;High;Low;Close;Volume`, semicolon-separated, one file per
 * instrument and year, with timestamps in **EST, no DST** — a fixed UTC-5 offset — so every row
 * is shifted five hours onto the UTC milliseconds the seam stores. Volume is dropped: the seam's
 * `Bar` carries none, and HistData's FX volume is a tick count, not size.
 *
 * Bars are partitioned by **UTC year**, so a row late on 31 December EST lands in the year its
 * timestamp belongs to, not the year of the file it came from.
 */

/** Where ingested data lives by default, relative to the working directory. */
export const DEFAULT_DATA_DIR = "data/parquet";

/** How many rejections a report spells out before it only counts them. */
const EXAMPLE_LIMIT = 10;

/** A row the parser refused: the line it was on, and the rule it broke. */
export interface IngestIssue {
  /** The 1-based line in the source file. */
  line: number;
  reason: string;
}

/** Rejected rows by kind. A row is counted once, under the first kind that fits. */
export interface RejectedCounts {
  /** A timestamp already seen in this batch. */
  duplicates: number;
  /** A non-positive price, or an open/close outside the high/low. */
  prices: number;
  /** A line that is not `YYYYMMDD HHMMSS;O;H;L;C;V`. */
  malformed: number;
  /** A row whose timestamp runs before the one above it. Sorted anyway. */
  misordered: number;
}

/** What one CSV file contributed before it reached the store. */
export interface ParsedCsv {
  /** Data lines read (blank lines ignored). */
  rows: number;
  /** The bars that survived validation and dedup, in time order. */
  bars: Bar[];
  rejected: RejectedCounts;
  /** The first few rejections in full, each with its line number. */
  examples: IngestIssue[];
}

/** What one CSV file contributed to the store, and where its bars landed. */
export interface IngestReport {
  source: string;
  instrument: Instrument;
  /** Data lines read (blank lines ignored). */
  rows: number;
  /** The bars this file put in the store — dedup within the file, minus rejected rows. */
  stored: number;
  rejected: RejectedCounts;
  /** The first few rejections in full, each with its line number. */
  examples: IngestIssue[];
  /** The year files this source's bars were merged into. */
  written: string[];
  /** The UTC ms of the first and last stored bar of this source. */
  first: number;
  last: number;
  /** Minutes inside [first, last] with no bar — weekends and dead minutes are expected here. */
  missingMinutes: number;
  /** The longest such stretch, in minutes, for a sanity check on the file. */
  largestGapMinutes: number;
}

/** The whole batch: a report per source, plus every year file the batch wrote. */
export interface IngestBatch {
  reports: IngestReport[];
  written: string[];
}

const ROW = /^(\d{4})(\d{2})(\d{2}) (\d{2})(\d{2})(\d{2});([^;]*);([^;]*);([^;]*);([^;]*);([^;]*)$/;
const FIVE_HOURS = 5 * 60 * 60 * 1000;

/**
 * The wall clock of a HistData row (EST, no DST) as UTC epoch milliseconds. A date that does not
 * exist — 31 February, or hour 25 — yields NaN, so the caller rejects the row instead of letting
 * the calendar roll it over into a neighbouring day.
 */
function toUtcMs(
  year: number,
  month: number,
  day: number,
  hh: number,
  mm: number,
  ss: number,
): number {
  const asEst = Date.UTC(year, month - 1, day, hh, mm, ss);
  const check = new Date(asEst);
  const same =
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day &&
    check.getUTCHours() === hh &&
    check.getUTCMinutes() === mm &&
    check.getUTCSeconds() === ss;
  return same ? asEst + FIVE_HOURS : Number.NaN;
}

/** The first and last millisecond of a UTC year. */
function yearRange(year: number): { from: number; to: number } {
  return { from: Date.UTC(year, 0, 1), to: Date.UTC(year + 1, 0, 1) - 1 };
}

/** The UTC year a timestamp belongs to — the partition key. */
function utcYear(ms: number): number {
  return new Date(ms).getUTCFullYear();
}

/**
 * Parses one HistData M1 CSV export. Rows keep the file's order except that the result is sorted
 * by time; a row is rejected under the first rule it breaks — malformed, bad prices, duplicate.
 */
export function parseHistDataCsv(text: string): ParsedCsv {
  const rejected: RejectedCounts = { duplicates: 0, prices: 0, malformed: 0, misordered: 0 };
  const examples: IngestIssue[] = [];
  const bars: Bar[] = [];
  const seen = new Set<number>();
  let rows = 0;
  let previous = Number.NEGATIVE_INFINITY;

  const reject = (line: number, kind: keyof RejectedCounts, reason: string): void => {
    rejected[kind]++;
    if (examples.length < EXAMPLE_LIMIT) examples.push({ line, reason });
  };

  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    if (raw.trim() === "") return;
    rows++;

    const match = ROW.exec(raw.trim());
    if (match === null) {
      reject(line, "malformed", "not a HistData M1 row");
      return;
    }

    const [, y, mo, d, hh, mm, ss, openText, highText, lowText, closeText] = match;
    const time = toUtcMs(Number(y), Number(mo), Number(d), Number(hh), Number(mm), Number(ss));
    if (!Number.isFinite(time)) {
      reject(line, "malformed", "no such date and time");
      return;
    }
    const open = Number(openText);
    const high = Number(highText);
    const low = Number(lowText);
    const close = Number(closeText);

    if (![open, high, low, close].every((price) => Number.isFinite(price) && price > 0)) {
      reject(line, "prices", "a price is not positive and finite");
      return;
    }
    if (high < Math.max(open, close) || low > Math.min(open, close)) {
      reject(line, "prices", "open/close outside the high/low");
      return;
    }
    if (seen.has(time)) {
      reject(line, "duplicates", "timestamp already stored");
      return;
    }
    if (time < previous) rejected.misordered++;

    seen.add(time);
    bars.push({ time, open, high, low, close });
    previous = time;
  });

  bars.sort((a, b) => a.time - b.time);
  return { rows, bars, rejected, examples };
}

/**
 * The instrument a HistData file name names: a yearly file like `DAT_ASCII_GBPUSD_M1_2024.csv`,
 * or a monthly one like `DAT_ASCII_GBPUSD_M1_202401.csv`.
 */
export function instrumentFromFileName(name: string): Instrument {
  const match = /_([A-Z]{6})_M1_?\d{4,6}\.csv$/i.exec(name);
  const instrument = match?.[1]?.toUpperCase();
  if (instrument !== "GBPUSD" && instrument !== "EURUSD") {
    throw new Error(
      `no instrument in "${name}"; want DAT_ASCII_GBPUSD_M1_2024.csv`,
    );
  }
  return instrument;
}

/** The gap summary of a stored run of bars: minutes without a bar, and the longest such stretch. */
function gaps(bars: Bar[]): { missingMinutes: number; largestGapMinutes: number } {
  const first = bars[0]!;
  const last = bars[bars.length - 1]!;
  const span = Math.round((last.time - first.time) / 60_000) + 1;
  let largest = 0;
  for (let i = 1; i < bars.length; i++) {
    largest = Math.max(largest, Math.round((bars[i]!.time - bars[i - 1]!.time) / 60_000) - 1);
  }
  return { missingMinutes: span - bars.length, largestGapMinutes: largest };
}

/** Writes one year of one instrument as Parquet: `time` as INT64 ms, the four prices as DOUBLE. */
function writeYear(dir: string, instrument: Instrument, year: number, bars: Bar[]): string {
  const partition = join(dir, instrument);
  mkdirSync(partition, { recursive: true });
  const file = join(partition, `${year}.parquet`);
  const sorted = [...bars].sort((a, b) => a.time - b.time);
  const buffer = parquetWriteBuffer({
    columnData: [
      { name: "time", data: BigInt64Array.from(sorted, (bar) => BigInt(bar.time)), type: "INT64" },
      { name: "open", data: Float64Array.from(sorted, (bar) => bar.open), type: "DOUBLE" },
      { name: "high", data: Float64Array.from(sorted, (bar) => bar.high), type: "DOUBLE" },
      { name: "low", data: Float64Array.from(sorted, (bar) => bar.low), type: "DOUBLE" },
      { name: "close", data: Float64Array.from(sorted, (bar) => bar.close), type: "DOUBLE" },
    ],
  });
  writeFileSync(file, new Uint8Array(buffer));
  return file;
}

/**
 * Ingests HistData M1 files: each file is parsed, validated, and merged into
 * `<dir>/<INSTRUMENT>/<year>.parquet` — one file at a time, because a batch of years is far more
 * bars than a heap holds. A timestamp already stored is replaced by the incoming bar, so
 * re-running an ingest of the same (or a corrected) file is safe; the year files it writes are
 * reported back with the batch.
 */
export async function ingestHistDataFiles(
  paths: string[],
  options: { dir?: string } = {},
): Promise<IngestBatch> {
  const dir = options.dir ?? DEFAULT_DATA_DIR;
  const reports: IngestReport[] = [];
  const written = new Set<string>();

  for (const path of paths) {
    const instrument = instrumentFromFileName(path);
    const parsed = parseHistDataCsv(readFileSync(path, "utf8"));

    const byYear = new Map<number, Bar[]>();
    for (const bar of parsed.bars) {
      const year = utcYear(bar.time);
      const yearBars = byYear.get(year) ?? [];
      yearBars.push(bar);
      byYear.set(year, yearBars);
    }

    const report: IngestReport = {
      source: path,
      instrument,
      rows: parsed.rows,
      stored: parsed.bars.length,
      rejected: parsed.rejected,
      examples: parsed.examples,
      written: [],
      first: parsed.bars[0]?.time ?? Number.NaN,
      last: parsed.bars[parsed.bars.length - 1]?.time ?? Number.NaN,
      ...gaps(parsed.bars),
    };
    for (const [year, yearBars] of byYear) {
      const { from, to } = yearRange(year);
      const existing = await loadBars(instrument, from, to, { dir });
      const merged = new Map(existing.map((bar) => [bar.time, bar]));
      for (const bar of yearBars) merged.set(bar.time, bar);
      const file = writeYear(dir, instrument, year, [...merged.values()]);
      report.written.push(file);
      written.add(file);
    }
    reports.push(report);
  }

  return { reports, written: [...written] };
}

/** The UTC years a range touches, from `from` to `to` inclusive. */
function yearsBetween(from: number, to: number): number[] {
  const years: number[] = [];
  for (let year = utcYear(from); year <= utcYear(to); year++) years.push(year);
  return years;
}

/**
 * Reads a stored range back as bars, oldest first: every year file the range touches, filtered to
 * `[from, to]` inclusive. A year file that is not there is skipped, so a partial store yields a
 * partial series and an empty result means the range was never ingested; a year file that is there
 * but unreadable is an error, not a gap.
 */
export async function loadBars(
  instrument: Instrument,
  from: number,
  to: number,
  options: { dir?: string } = {},
): Promise<Bar[]> {
  const dir = options.dir ?? DEFAULT_DATA_DIR;
  const bars: Bar[] = [];
  for (const year of yearsBetween(from, to)) {
    const file = join(dir, instrument, `${year}.parquet`);
    let rows: Record<string, unknown>[];
    try {
      rows = await parquetReadObjects({ file: await asyncBufferFromFile(file) });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    for (const row of rows) {
      const time = Number(row.time);
      if (time < from || time > to) continue;
      bars.push({
        time,
        open: Number(row.open),
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close),
      });
    }
  }
  bars.sort((a, b) => a.time - b.time);
  return bars;
}

/**
 * Reads a stored range as a bar series at the execution timeframe: each year of stored M1 is
 * loaded and aggregated on its own, so a multi-year range never sits in memory at once. M15
 * buckets are defined by the bar itself, so aggregating year by year and joining the results is
 * the same series as aggregating the whole range in one go.
 */
export async function loadSeries(
  instrument: Instrument,
  from: number,
  to: number,
  cfg: StrategyConfig,
  options: { dir?: string } = {},
): Promise<BarSeries> {
  const bars: Bar[] = [];
  for (const year of yearsBetween(from, to)) {
    const { from: yearStart, to: yearEnd } = yearRange(year);
    const chunk = await loadBars(
      instrument,
      Math.max(from, yearStart),
      Math.min(to, yearEnd),
      options,
    );
    bars.push(...aggregate(chunk, EXECUTION_TIMEFRAME, cfg));
  }
  return { instrument, bars };
}
