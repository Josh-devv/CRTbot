/** Throwaway: determine Dukascopy 1m candle field order empirically. */
import { readFile } from "node:fs/promises";
import lzma from "lzma";

function decompress(buffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    lzma.decompress(buffer, (result: unknown, error: unknown) => {
      if (error) reject(error);
      else resolve(Buffer.from(result as ArrayBuffer));
    });
  });
}

const data = await decompress(await readFile("data/indices/duka-raw/USATECHIDXUSD/2026/09/15.bi5"));
const records = Math.floor(data.length / 24);

const permutations = [
  [0, 1, 2, 3], [0, 1, 3, 2], [0, 2, 1, 3], [0, 2, 3, 1], [0, 3, 1, 2], [0, 3, 2, 1],
  [1, 0, 2, 3], [1, 0, 3, 2], [1, 2, 0, 3], [1, 2, 3, 0], [1, 3, 0, 2], [1, 3, 2, 0],
  [2, 0, 1, 3], [2, 0, 3, 1], [2, 1, 0, 3], [2, 1, 3, 0], [2, 3, 0, 1], [2, 3, 1, 0],
  [3, 0, 1, 2], [3, 0, 2, 1], [3, 1, 0, 2], [3, 1, 2, 0], [3, 2, 0, 1], [3, 2, 1, 0],
];
const valid = new Map<string, number>(permutations.map((p) => [p.join(","), 0]));

const examples: string[] = [];
for (let index = 0; index < records; index++) {
  const offset = index * 24;
  const time = data.readUInt32BE(offset);
  const values = [4, 8, 12, 16].map((byte) => data.readUInt32BE(offset + byte) / 1000);
  const volume = data.readFloatBE(offset + 20);
  for (const p of permutations) {
    const open = values[p[0]!]!;
    const high = values[p[1]!]!;
    const low = values[p[2]!]!;
    const close = values[p[3]!]!;
    if (high >= Math.max(open, close) && low <= Math.min(open, close) && high > low) {
      valid.set(p.join(","), (valid.get(p.join(",")) ?? 0) + 1);
    }
  }
  if (examples.length < 6 && !(values[1]! >= Math.max(values[0]!, values[3]!) && values[2]! <= Math.min(values[0]!, values[3]!))) {
    examples.push(`#${index} t=${time} v=${values.join(" / ")} vol=${volume.toFixed(3)}`);
  }
}

console.log("records", records);
const ranked = [...valid.entries()].sort((a, b) => b[1] - a[1]);
console.log("top permutations (open,high,low,close):", ranked.slice(0, 4));
console.log("worst:", ranked.slice(-2));
console.log(examples.join("\n"));
