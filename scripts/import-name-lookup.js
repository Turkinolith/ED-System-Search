import { createReadStream, createWriteStream, existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { nameLookupKey, nameLookupShardCount } from './name-lookup-key.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.dirname(__dirname);
const dataDir = process.env.EDSS_DATA_DIR ? path.resolve(process.env.EDSS_DATA_DIR) : path.join(rootDir, 'data');
const searchPath = path.join(dataDir, 'systems-search.tsv');
const lookupDir = path.join(dataDir, 'name-lookup');
const lookupOverlayPath = path.join(dataDir, 'name-lookup-overlay.tsv');
const lookupOverlayMetaPath = path.join(dataDir, 'name-lookup-overlay-meta.json');
const streaming = process.argv.includes('--streaming');
const maxOpenWriters = 96;

function writerPath(key) {
  return path.join(lookupDir, `${key}.tsv`);
}

function memoryMiB() {
  return Math.round(process.memoryUsage().heapUsed / 1024 / 1024).toLocaleString();
}

async function writeMemoryLookup() {
  const buckets = Array.from({ length: nameLookupShardCount }, () => []);
  let count = 0;
  const rl = readline.createInterface({
    input: createReadStream(searchPath, { encoding: 'utf8', highWaterMark: 8 * 1024 * 1024 }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const firstTab = line.indexOf('\t');
    if (firstTab <= 0) continue;
    const secondTab = line.indexOf('\t', firstTab + 1);
    const thirdTab = line.indexOf('\t', secondTab + 1);
    if (secondTab < 0 || thirdTab < 0) continue;
    const lowerName = line.slice(0, firstTab);
    const indexText = line.slice(secondTab + 1, thirdTab);
    const key = Number(nameLookupKey(lowerName));
    buckets[key].push(`${lowerName}\t${indexText}\n`);
    count += 1;
    if (count % 1000000 === 0) {
      console.log(`Loaded ${count.toLocaleString()} exact-name rows into RAM. Heap: ${memoryMiB()} MiB`);
    }
  }

  let writtenBuckets = 0;
  for (let index = 0; index < buckets.length; index += 1) {
    const rows = buckets[index];
    if (!rows.length) continue;
    const key = String(index).padStart(4, '0');
    await fs.writeFile(writerPath(key), rows.join(''), 'utf8');
    writtenBuckets += 1;
    if (writtenBuckets % 256 === 0) {
      console.log(`Wrote ${writtenBuckets.toLocaleString()} lookup shards...`);
    }
  }

  return { count, bucketCount: writtenBuckets, mode: 'memory' };
}

async function writeStreamingLookup() {
  const writers = new Map();
  let count = 0;

  async function closeOldestWriter() {
    const [oldestKey, oldest] = writers.entries().next().value;
    await new Promise((resolve) => oldest.end(resolve));
    writers.delete(oldestKey);
  }

  async function writerFor(key) {
    if (writers.has(key)) {
      const writer = writers.get(key);
      writers.delete(key);
      writers.set(key, writer);
      return writer;
    }
    if (writers.size >= maxOpenWriters) await closeOldestWriter();
    const writer = createWriteStream(writerPath(key), { flags: 'a' });
    writers.set(key, writer);
    return writer;
  }

  async function writeAll(writer, line) {
    if (!writer.write(line)) await new Promise((resolve) => writer.once('drain', resolve));
  }

  const rl = readline.createInterface({
    input: createReadStream(searchPath, { encoding: 'utf8', highWaterMark: 8 * 1024 * 1024 }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const firstTab = line.indexOf('\t');
    if (firstTab <= 0) continue;
    const secondTab = line.indexOf('\t', firstTab + 1);
    const thirdTab = line.indexOf('\t', secondTab + 1);
    if (secondTab < 0 || thirdTab < 0) continue;
    const lowerName = line.slice(0, firstTab);
    const indexText = line.slice(secondTab + 1, thirdTab);
    await writeAll(await writerFor(nameLookupKey(lowerName)), `${lowerName}\t${indexText}\n`);
    count += 1;
    if (count % 1000000 === 0) console.log(`Indexed ${count.toLocaleString()} exact-name rows...`);
  }

  await Promise.all([...writers.values()].map((writer) => new Promise((resolve) => writer.end(resolve))));
  const files = await fs.readdir(lookupDir);
  return {
    count,
    bucketCount: files.filter((name) => name.endsWith('.tsv')).length,
    mode: 'streaming',
  };
}

async function main() {
  if (!existsSync(searchPath)) {
    console.error(`Cannot find ${searchPath}. Run npm run import:systems first.`);
    process.exit(1);
  }

  await fs.rm(lookupDir, { recursive: true, force: true });
  await fs.mkdir(lookupDir, { recursive: true });

  const startedAt = Date.now();
  const result = streaming ? await writeStreamingLookup() : await writeMemoryLookup();
  const meta = {
    importedAt: new Date().toISOString(),
    sourcePath: searchPath,
    count: result.count,
    bucketCount: result.bucketCount,
    shardCount: nameLookupShardCount,
    mode: result.mode,
    durationSeconds: Math.round((Date.now() - startedAt) / 1000),
  };
  await fs.writeFile(path.join(dataDir, 'name-lookup-meta.json'), JSON.stringify(meta, null, 2));
  await fs.rm(lookupOverlayPath, { force: true });
  await fs.rm(lookupOverlayMetaPath, { force: true });
  console.log(`Indexed ${result.count.toLocaleString()} exact-name rows into ${result.bucketCount.toLocaleString()} shards using ${result.mode} mode.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
