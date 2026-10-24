/** Throwaway: sanity-check session levels + raid counts for the index data. */
import { readFile } from "node:fs/promises";
import { DateTime } from "luxon";

const NY = "America/New_York";

interface Bar { time: number; open: number; high: number; low: number; close: number; volume: number; }
interface Acc { high: number; low: number; close: number; }

function computeLevels(bars: Bar[]): { overnight: Map<string, Acc>; rth: Map<string, Acc> } {
  const overnight = new Map<string, Acc>();
  const rth = new Map<string, Acc>();
  for (const bar of bars) {
    const dt = DateTime.fromMillis(bar.time, { zone: NY });
    const minutes = dt.hour * 60 + dt.minute;
    if (minutes >= 570 && minutes < 960) {
      const key = dt.toFormat("yyyy-MM-dd");
      const acc = rth.get(key) ?? { high: -Infinity, low: Infinity, close: NaN };
      acc.high = Math.max(acc.high, bar.high);
      acc.low = Math.min(acc.low, bar.low);
      acc.close = bar.close;
      rth.set(key, acc);
    }
    if (minutes >= 1080 || minutes < 480) {
      const key = minutes >= 1080 ? dt.plus({ days: 1 }).toFormat("yyyy-MM-dd") : dt.toFormat("yyyy-MM-dd");
      const acc = overnight.get(key) ?? { high: -Infinity, low: Infinity, close: NaN };
      acc.high = Math.max(acc.high, bar.high);
      acc.low = Math.min(acc.low, bar.low);
      overnight.set(key, acc);
    }
  }
  return { overnight, rth };
}

const label = process.argv[2] ?? "NQ";
const bars = JSON.parse(await readFile(`data/indices/${label}.json`, "utf8")) as Bar[];
const { overnight, rth } = computeLevels(bars);
const dates = [...new Set(bars.map((bar) => DateTime.fromMillis(bar.time, { zone: NY }).toFormat("yyyy-MM-dd")))].sort();

console.log(`${label}: ${bars.length} bars, ${dates.length} ET dates`);
for (const date of dates) {
  const dt = DateTime.fromISO(date, { zone: NY });
  const prev = dt.minus({ days: 1 }).toFormat("yyyy-MM-dd");
  const over = overnight.get(date);
  const prior = rth.get(prev);
  if (over === undefined || prior === undefined) continue;
  const window = bars.filter((bar) => {
    const t = DateTime.fromMillis(bar.time, { zone: NY });
    return t.toFormat("yyyy-MM-dd") === date && t.hour * 60 + t.minute >= 480 && t.hour * 60 + t.minute < 600;
  });
  if (window.length === 0) continue;
  const winHigh = Math.max(...window.map((bar) => bar.high));
  const winLow = Math.min(...window.map((bar) => bar.low));
  const aboveOver = winHigh > over.high;
  const abovePrior = winHigh > prior.high;
  const belowOver = winLow < over.low;
  const belowPrior = winLow < prior.low;
  console.log(
    `${date} (prev ${prev})  ON ${over.high.toFixed(1)}/${over.low.toFixed(1)}` +
      `  RTH ${prior.high.toFixed(1)}/${prior.low.toFixed(1)} close ${prior.close.toFixed(1)}` +
      `  win ${winHigh.toFixed(1)}/${winLow.toFixed(1)}` +
      `  raidHi: ON=${aboveOver} RTH=${abovePrior}  raidLo: ON=${belowOver} RTH=${belowPrior}`,
  );
}
