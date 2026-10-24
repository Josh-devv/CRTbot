/**
 * Parse Dukascopy bi5 1m candles (downloaded by scratch-fetch-duka.ps1) into JSON series.
 *
 * Record layout (24 bytes, big-endian): u32 seconds-from-midnight, u32 open, u32 close, u32 low,
 * u32 high (price * 1000), f32 volume.
 *
 * Output: data/indices/NQ-duka.json, data/indices/ES-duka.json in the same shape as the Yahoo files.
 *
 *   npx tsx scratch-fetch-duka.ts
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import lzma from "lzma";

interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const SOURCE: Record<string, string> = { USATECHIDXUSD: "NQ", USA500IDXUSD: "ES" };
const ROOT = "data/indices/duka-raw";

function decompress(buffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    lzma.decompress(buffer, (result: unknown, error: unknown) => {
      if (error) reject(error);
      else resolve(Buffer.from(result as ArrayBuffer));
    });
  });
}

for (const [symbol, label] of Object.entries(SOURCE)) {
  const entries = await readdir(`${ROOT}/${symbol}`, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".bi5"))
    .map((entry) => `${entry.parentPath}\\${entry.name}`);
  files.sort();

  const bars = new Map<number, Bar>();
  let zeroRecords = 0;
  let invalid = 0;

  for (const file of files) {
    const match = file.match(/(\d{4})[\\/](\d{2})[\\/](\d{2})\.bi5$/);
    if (match === null) continue;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const dayStart = Date.UTC(year, month, day) / 1000;

    let data: Buffer;
    try {
      data = await decompress(await readFile(file));
    } catch {
      continue;
    }

    for (let offset = 0; offset + 24 <= data.length; offset += 24) {
      const seconds = data.readUInt32BE(offset);
      const open = data.readUInt32BE(offset + 4) / 1000;
      const close = data.readUInt32BE(offset + 8) / 1000;
      const low = data.readUInt32BE(offset + 12) / 1000;
      const high = data.readUInt32BE(offset + 16) / 1000;
      const volume = data.readFloatBE(offset + 20);
      if (open === 0 && high === 0 && low === 0 && close === 0) {
        zeroRecords++;
        continue;
      }
      if (open <= 0 || high <= 0 || low <= 0 || close <= 0 || high < Math.max(open, close) || low > Math.min(open, close)) {
        invalid++;
        continue;
      }
      const time = (dayStart + seconds) * 1000;
      bars.set(time, { time, open, high, low, close, volume });
    }
  }

  const series = [...bars.values()].sort((a, b) => a.time - b.time);
  await writeFile(`data/indices/${label}-duka.json`, JSON.stringify(series));

  const first = new Date(series[0]!.time).toISOString();
  const last = new Date(series[series.length - 1]!.time).toISOString();
  const withVolume = series.filter((bar) => bar.volume > 0).length;
  console.log(
    `${symbol} -> ${label}-duka.json: files=${files.length} bars=${series.length}` +
      ` zero=${zeroRecords} invalid=${invalid} volume>0=${withVolume} range=${first}..${last}`,
  );
}
