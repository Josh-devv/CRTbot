/**
 * Fetch ~30 days of 1-minute bars for the index futures (NQ=F, ES=F) from Yahoo Finance,
 * paginating in 7-day windows (Yahoo rejects 1m requests larger than that per call).
 * Writes data/indices/<label>.json as [{ time: epoch ms UTC, open, high, low, close, volume }].
 *
 *   npx tsx scratch-fetch-indices.ts [--days 30]
 */
import { mkdir, writeFile } from "node:fs/promises";

interface YahooBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const SYMBOLS: [string, string][] = [
  ["NQ", "NQ=F"],
  ["ES", "ES=F"],
];

const daysIndex = process.argv.indexOf("--days");
const DAYS = daysIndex === -1 ? 29 : Number(process.argv[daysIndex + 1]);

async function fetchChunk(symbol: string, period1: number, period2: number): Promise<YahooBar[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&period1=${period1}&period2=${period2}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${symbol}: HTTP ${response.status} — ${body.slice(0, 300)}`);
  }
  const json = (await response.json()) as {
    chart: { result?: { timestamp?: number[]; indicators: { quote: { open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }[] } }[]; error?: unknown };
  };
  const result = json.chart.result?.[0];
  if (result === undefined || result.timestamp === undefined) return [];
  const quote = result.indicators.quote[0]!;
  const bars: YahooBar[] = [];
  for (let i = 0; i < result.timestamp.length; i++) {
    const open = quote.open?.[i];
    const high = quote.high?.[i];
    const low = quote.low?.[i];
    const close = quote.close?.[i];
    if (open === null || open === undefined || high === null || high === undefined || low === null || low === undefined || close === null || close === undefined) continue;
    bars.push({ time: result.timestamp[i]! * 1000, open, high, low, close, volume: quote.volume?.[i] ?? 0 });
  }
  return bars;
}

await mkdir("data/indices", { recursive: true });
const now = Math.floor(Date.now() / 1000);
for (const [label, symbol] of SYMBOLS) {
  const merged = new Map<number, YahooBar>();
  for (let end = now; end > now - DAYS * 86400; end -= 7 * 86400) {
    const start = end - 7 * 86400;
    let bars: YahooBar[] = [];
    try {
      bars = await fetchChunk(symbol, start, end);
    } catch (error) {
      console.warn(`${symbol}: skipping chunk ${new Date(start * 1000).toISOString()} .. ${new Date(end * 1000).toISOString()} (${(error as Error).message.slice(0, 80)})`);
      continue;
    }
    for (const bar of bars) merged.set(bar.time, bar);
  }
  const bars = [...merged.values()].sort((a, b) => a.time - b.time);
  await writeFile(`data/indices/${label}.json`, JSON.stringify(bars));
  const first = bars[0]!;
  const last = bars[bars.length - 1]!;
  const withVolume = bars.filter((bar) => bar.volume > 0).length;
  console.log(
    `${label} (${symbol}): ${bars.length} bars  ${new Date(first.time).toISOString()} .. ${new Date(last.time).toISOString()}` +
      `  volume>0: ${withVolume}/${bars.length}`,
  );
}
