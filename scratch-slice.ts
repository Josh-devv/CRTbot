import { readFile, writeFile } from "node:fs/promises";

/** Slice the Alpaca 10-year bars to the last 5 years for faster iteration. */
const cutoff = Date.UTC(2021, 9, 20);

for (const symbol of ["SPY", "QQQ"]) {
  const bars = JSON.parse(await readFile(`data/indices/${symbol}.json`, "utf8")) as { time: number }[];
  const sliced = bars.filter((bar) => bar.time >= cutoff);
  await writeFile(`data/indices/${symbol}-5y.json`, JSON.stringify(sliced));
  const first = new Date(sliced[0]!.time).toISOString().slice(0, 10);
  const last = new Date(sliced[sliced.length - 1]!.time).toISOString().slice(0, 10);
  console.log(`${symbol}-5y: bars=${sliced.length} range=${first}..${last}`);
}
