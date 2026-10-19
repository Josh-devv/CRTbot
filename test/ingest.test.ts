import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ingestHistDataFiles,
  instrumentFromFileName,
  loadBars,
  parseHistDataCsv,
} from "../src/ingest.js";

/** A UTC timestamp, for expecting without duplicating the EST shift. */
function at(year: number, month: number, day: number, hh = 0, mm = 0): number {
  return Date.UTC(year, month - 1, day, hh, mm);
}

/** A fresh scratch directory that the test is responsible for removing. */
function scratch(): string {
  return mkdtempSync(join(tmpdir(), "crtbot-ingest-"));
}

/** One CSV in, the report out. */
async function ingestOne(text: string, name = "DAT_ASCII_GBPUSD_M1_2024.csv"): Promise<{
  dir: string;
  batch: Awaited<ReturnType<typeof ingestHistDataFiles>>;
}> {
  const dir = scratch();
  const file = join(dir, name);
  writeFileSync(file, text);
  const batch = await ingestHistDataFiles([file], { dir: join(dir, "parquet") });
  return { dir, batch };
}

test("a HistData file parses to UTC bars, five hours off its EST wall clock", () => {
  const parsed = parseHistDataCsv(
    [
      "20240101 170000;1.27184;1.27184;1.27184;1.27184;0",
      "20240101 170100;1.27155;1.27208;1.27155;1.27208;0",
      "",
      "20240102 170000;1.27200;1.27250;1.27100;1.27240;0",
    ].join("\n"),
  );

  assert.equal(parsed.rows, 3, "blank lines are not rows");
  assert.equal(parsed.bars.length, 3);
  assert.deepEqual(
    parsed.bars[0],
    { time: at(2024, 1, 1, 22, 0), open: 1.27184, high: 1.27184, low: 1.27184, close: 1.27184 },
    "17:00 EST is 22:00 UTC",
  );
  assert.deepEqual(parsed.rejected, { duplicates: 0, prices: 0, malformed: 0, misordered: 0 });
});

test("bad rows are rejected by name, with their line numbers", () => {
  const parsed = parseHistDataCsv(
    [
      "20240101 170000;1.27184;1.27184;1.27184;1.27184;0",
      "20240101 170000;1.27184;1.27184;1.27184;1.27184;0",
      "20240101 170100;1.30000;1.29000;1.28000;1.30000;0",
      "20240101 170200;0;0;0;0;0",
      "not a row",
      "20231231 170000;1.27184;1.27184;1.27184;1.27184;0",
      "20240231 170000;1.27184;1.27184;1.27184;1.27184;0",
      "20240101 250000;1.27184;1.27184;1.27184;1.27184;0",
    ].join("\n"),
  );

  assert.equal(parsed.rows, 8);
  assert.equal(parsed.bars.length, 2, "the duplicate, the broken candle and the bad price are out");
  assert.deepEqual(parsed.rejected, { duplicates: 1, prices: 2, malformed: 3, misordered: 1 });
  assert.deepEqual(parsed.examples[0], { line: 2, reason: "timestamp already stored" });
  assert.deepEqual(parsed.examples[1], { line: 3, reason: "open/close outside the high/low" });
  assert.deepEqual(parsed.examples[2], { line: 4, reason: "a price is not positive and finite" });
  assert.deepEqual(parsed.examples[3], { line: 5, reason: "not a HistData M1 row" });
  assert.deepEqual(
    parsed.examples[4],
    { line: 7, reason: "no such date and time" },
    "31 February is not a date",
  );
  assert.deepEqual(
    parsed.examples[5],
    { line: 8, reason: "no such date and time" },
    "hour 25 is not a time",
  );
  assert.equal(parsed.bars[0]!.time, at(2023, 12, 31, 22), "the early row is stored, sorted first");
});

test("a year file round-trips exactly, and the loader filters the range", async () => {
  const text = [
    "20240101 170000;1.27184;1.27184;1.27184;1.27184;0",
    "20240101 170100;1.27155;1.27208;1.27155;1.27208;0",
    "20240102 170000;1.27200;1.27250;1.27100;1.27240;0",
  ].join("\n");
  const { dir, batch } = await ingestOne(text);
  try {
    assert.equal(batch.written.length, 1, "one year, one file");
    assert.match(batch.written[0]!, /GBPUSD[\\/]2024\.parquet$/);
    const report = batch.reports[0]!;
    assert.equal(report.stored, 3);
    assert.equal(report.first, at(2024, 1, 1, 22));
    assert.equal(report.last, at(2024, 1, 2, 22));

    const all = await loadBars("GBPUSD", at(2024, 1, 1), at(2024, 12, 31), {
      dir: join(dir, "parquet"),
    });
    assert.deepEqual(all, parseHistDataCsv(text).bars, "stored bars come back bit for bit");

    const oneDay = await loadBars("GBPUSD", at(2024, 1, 2), at(2024, 1, 2, 23, 59), {
      dir: join(dir, "parquet"),
    });
    assert.equal(oneDay.length, 1, "the range filter is inclusive and trims the rest");
    assert.equal(oneDay[0]!.time, at(2024, 1, 2, 22));

    const nothing = await loadBars("GBPUSD", at(2023, 1, 1), at(2023, 12, 31), {
      dir: join(dir, "parquet"),
    });
    assert.deepEqual(nothing, [], "a year with no file loads as nothing, not as an error");

    writeFileSync(join(dir, "parquet", "GBPUSD", "2024.parquet"), "not parquet at all");
    await assert.rejects(
      loadBars("GBPUSD", at(2024, 1, 1), at(2024, 12, 31), { dir: join(dir, "parquet") }),
      "a year file that is there but unreadable is an error, not a silent gap",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a New Year's Eve bar lands in the year its UTC timestamp names", async () => {
  const { dir, batch } = await ingestOne(
    [
      "20241231 180000;1.25000;1.25100;1.24900;1.25050;0",
      "20241231 230000;1.25050;1.25200;1.25000;1.25180;0",
    ].join("\n"),
  );
  try {
    const years = batch.written.map((file) => file.replace(/^.*[\\/]/, ""));
    assert.deepEqual(years.sort(), ["2024.parquet", "2025.parquet"], "one file for each UTC year");

    const stored2025 = await loadBars("GBPUSD", at(2025, 1, 1), at(2025, 12, 31), {
      dir: join(dir, "parquet"),
    });
    assert.equal(stored2025.length, 1, "the 23:00 EST row is 04:00 UTC on 1 January 2025");
    assert.equal(stored2025[0]!.time, at(2025, 1, 1, 4));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the instrument comes from the file name, and an unknown name is refused", () => {
  assert.equal(instrumentFromFileName("DAT_ASCII_GBPUSD_M1_2024.csv"), "GBPUSD");
  assert.equal(instrumentFromFileName("DAT_ASCII_EURUSD_M1_2010.csv"), "EURUSD");
  assert.equal(
    instrumentFromFileName("DAT_ASCII_GBPUSD_M1_202401.csv"),
    "GBPUSD",
    "monthly exports name the instrument the same way",
  );
  assert.equal(instrumentFromFileName("DAT_ASCII_EURUSD_M1_202412.csv"), "EURUSD");
  assert.throws(() => instrumentFromFileName("bars.csv"), /no instrument in "bars\.csv"/);
});

test("the CLI ingests a file and backtests the stored range", () => {
  const dir = scratch();
  try {
    const csv = join(dir, "DAT_ASCII_GBPUSD_M1_2021.csv");
    const setUp: [number, number, number, number][] = [
      [10.0, 10.2, 9.6, 9.8],
      [9.8, 9.9, 9.0, 9.1],
      [9.1, 9.5, 9.0, 9.4],
      [9.4, 9.6, 9.3, 9.5],
      [9.5, 9.7, 8.8, 9.6],
      [9.6, 9.9, 9.3, 9.7],
      [9.8, 9.9, 9.2, 9.3],
      [9.5, 9.6, 8.7, 8.9],
      [9.6, 9.9, 9.55, 9.8],
      [9.8, 9.9, 9.5, 9.8],
      [9.8, 10.5, 9.8, 10.4],
      [10.4, 11.2, 10.4, 11.1],
      [11.1, 12.0, 11.0, 11.9],
    ];
    // One row per M15 candle, walking the London killzone: 07:00 UTC is 02:00 EST.
    const price = (value: number) => value.toFixed(5);
    const rows = setUp.map(([open, high, low, close], i) => {
      const hour = 2 + Math.floor(i / 4);
      const minute = (i % 4) * 15;
      const stamp = `20210104 ${String(hour).padStart(2, "0")}${String(minute).padStart(2, "0")}00`;
      return `${stamp};${price(open)};${price(high)};${price(low)};${price(close)};0`;
    });
    writeFileSync(csv, `${rows.join("\n")}\n`);

    const parquet = join(dir, "parquet");
    const ingest = spawnSync(
      process.execPath,
      ["--import", "tsx", "src/cli.ts", "ingest", csv, "--data", parquet],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.equal(ingest.status, 0, ingest.stderr);
    assert.match(ingest.stdout, /13 rows, 13 stored/, "every crafted row survives validation");
    assert.match(ingest.stdout, /13 bars stored across 1 year files/);

    const raw = join(dir, "run.json");
    const run = spawnSync(
      process.execPath,
      [
        "--import", "tsx", "src/cli.ts", "backtest",
        "--instrument", "GBPUSD",
        "--from", "2021-01-04",
        "--to", "2021-01-04",
        "--data", parquet,
        "--result", raw,
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /CRTbot backtest report/);
    assert.match(run.stdout, /GBPUSD 13 bars/, "the stored range loads as M15 at the seam");

    const dump = JSON.parse(readFileSync(raw, "utf8")) as { decisions: unknown[] };
    assert.equal(dump.decisions.length, 13, "every stored bar made a decision");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
