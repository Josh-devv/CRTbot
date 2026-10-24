import { readFile, writeFile } from "node:fs/promises";

/**
 * Fetch Alpaca 1-minute bars for US stocks/ETFs (free Basic plan).
 *
 * Keys: create a free paper account at https://alpaca.markets, then put these in `.env`:
 *   APCA_API_KEY_ID=...
 *   APCA_API_SECRET_KEY=...
 * Or set the same environment variables in the shell.
 *
 * Usage: npx tsx scratch-fetch-alpaca.ts [--symbols SPY,QQQ] [--start 2016-01-01] [--feed sip|iex]
 */

interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

async function envValue(name: string): Promise<string | undefined> {
  const fromProcess = process.env[name];
  if (fromProcess !== undefined && fromProcess.length > 0) return fromProcess;
  try {
    const text = await readFile(".env", "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (match !== null && match[1] === name) return match[2]!.trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    // no .env
  }
  return undefined;
}

const keyId = (await envValue("APCA_API_KEY_ID")) ?? (await envValue("ALPACA_API_KEY_ID"));
const secret = (await envValue("APCA_API_SECRET_KEY")) ?? (await envValue("ALPACA_API_SECRET_KEY"));
if (keyId === undefined || secret === undefined) {
  console.error("missing APCA_API_KEY_ID / APCA_API_SECRET_KEY (put them in .env at the repo root)");
  process.exit(1);
}

const symbols = (flag("--symbols") ?? "SPY,QQQ").split(",").map((s) => s.trim()).filter(Boolean);
const start = flag("--start") ?? "2016-01-01";
const requestedFeed = (flag("--feed") ?? "sip") as "sip" | "iex";
const end = new Date(Date.now() - 20 * 60_000).toISOString();
const headers = { "APCA-API-KEY-ID": keyId, "APCA-API-SECRET-KEY": secret };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function getPage(symbol: string, feed: "sip" | "iex", pageToken: string | undefined): Promise<Response> {
  const url = new URL(`https://data.alpaca.markets/v2/stocks/${symbol}/bars`);
  url.searchParams.set("timeframe", "1Min");
  url.searchParams.set("start", `${start}T00:00:00Z`);
  url.searchParams.set("end", end);
  url.searchParams.set("limit", "10000");
  url.searchParams.set("adjustment", "all");
  url.searchParams.set("feed", feed);
  url.searchParams.set("sort", "asc");
  if (pageToken !== undefined) url.searchParams.set("page_token", pageToken);
  return fetch(url, { headers });
}

async function fetchSymbol(symbol: string): Promise<{ bars: Bar[]; feed: "sip" | "iex" }> {
  let feed = requestedFeed;
  let fallback = false;
  let pageToken: string | undefined;
  const byTime = new Map<number, Bar>();
  let pages = 0;

  while (true) {
    let response = await getPage(symbol, feed, pageToken);
    if (response.status === 403 && feed === "sip") {
      console.warn(`${symbol}: sip rejected on this plan, falling back to iex`);
      feed = "iex";
      fallback = true;
      pageToken = undefined;
      byTime.clear();
      response = await getPage(symbol, feed, pageToken);
    }

    if (!response.ok) {
      const body = await response.text();
      if (response.status === 429 || response.status >= 500) {
        const wait = 2_000;
        console.warn(`${symbol}: ${response.status}, retrying in ${wait}ms`);
        await sleep(wait);
        continue;
      }
      throw new Error(`${symbol}: HTTP ${response.status} ${body.slice(0, 300)}`);
    }

    const json = (await response.json()) as {
      bars?: { t: string; o: number; h: number; l: number; c: number; v: number }[];
      next_page_token?: string | null;
    };

    for (const bar of json.bars ?? []) {
      const time = Date.parse(bar.t);
      byTime.set(time, { time, open: bar.o, high: bar.h, low: bar.l, close: bar.c, volume: bar.v });
    }

    pages++;
    if (pages % 10 === 0) console.log(`${symbol}: pages=${pages} bars=${byTime.size}`);
    pageToken = json.next_page_token ?? undefined;
    if (pageToken === undefined) break;
    await sleep(100);
  }

  const bars = [...byTime.values()].sort((a, b) => a.time - b.time);
  return { bars, feed: fallback ? "iex" : feed };
}

for (const symbol of symbols) {
  const { bars, feed } = await fetchSymbol(symbol);
  if (bars.length === 0) {
    console.error(`${symbol}: no bars returned`);
    continue;
  }
  await writeFile(`data/indices/${symbol}.json`, JSON.stringify(bars));
  const first = new Date(bars[0]!.time).toISOString().slice(0, 10);
  const last = new Date(bars[bars.length - 1]!.time).toISOString().slice(0, 10);
  const positive = bars.filter((bar) => bar.volume > 0).length;
  console.log(`${symbol}: feed=${feed} bars=${bars.length} range=${first}..${last} volume>0=${positive}`);
}
