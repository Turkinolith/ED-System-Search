import { createReadStream, createWriteStream, existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { createGunzip } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { parseUpdateSeconds, secondsToIso, unknownUpdateSeconds } from './update-time.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.dirname(__dirname);
const sourcePath = path.resolve(rootDir, process.argv[2] ?? 'systems.json.gz');
const dataDir = process.env.EDSS_DATA_DIR ? path.resolve(process.env.EDSS_DATA_DIR) : path.join(rootDir, 'data');

async function writeAll(writer, buffer) {
  if (!writer.write(buffer)) {
    await new Promise((resolve) => writer.once('drain', resolve));
  }
}

function cleanJsonLine(line) {
  let text = line.trim();
  if (!text || text === '[' || text === ']') return '';
  if (text.endsWith(',')) text = text.slice(0, -1);
  return text;
}

async function main() {
  if (!existsSync(sourcePath)) {
    console.error(`Cannot find ${sourcePath}`);
    process.exit(1);
  }

  await fs.mkdir(dataDir, { recursive: true });
  const writer = createWriteStream(path.join(dataDir, 'systems-updates.u32'));
  const stream = createReadStream(sourcePath).pipe(createGunzip());
  const buffer = Buffer.allocUnsafe(4);
  let pending = '';
  let count = 0;
  let min = unknownUpdateSeconds;
  let max = 0;

  async function writeUpdate(system) {
    const seconds = parseUpdateSeconds(system.updateTime);
    buffer.writeUInt32LE(seconds, 0);
    await writeAll(writer, buffer);
    if (seconds !== unknownUpdateSeconds) {
      min = Math.min(min, seconds);
      max = Math.max(max, seconds);
    }
    count += 1;
    if (count % 1000000 === 0) console.log(`Indexed ${count.toLocaleString()} update timestamps...`);
  }

  for await (const chunk of stream) {
    pending += chunk.toString('utf8');
    let newline;
    while ((newline = pending.indexOf('\n')) >= 0) {
      const line = cleanJsonLine(pending.slice(0, newline));
      pending = pending.slice(newline + 1);
      if (!line) continue;
      await writeUpdate(JSON.parse(line));
    }
  }

  const finalLine = cleanJsonLine(pending);
  if (finalLine) await writeUpdate(JSON.parse(finalLine));
  await new Promise((resolve) => writer.end(resolve));

  const meta = {
    sourcePath,
    importedAt: new Date().toISOString(),
    count,
    bytesPerRecord: 4,
    epoch: '2000-01-01T00:00:00.000Z',
    unknownValue: unknownUpdateSeconds,
    minSeconds: min === unknownUpdateSeconds ? null : min,
    maxSeconds: max || null,
    minUpdateTime: min === unknownUpdateSeconds ? null : secondsToIso(min),
    maxUpdateTime: max ? secondsToIso(max) : null,
  };
  await fs.writeFile(path.join(dataDir, 'systems-updates-meta.json'), JSON.stringify(meta, null, 2));
  console.log(`Indexed ${count.toLocaleString()} update timestamps.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
