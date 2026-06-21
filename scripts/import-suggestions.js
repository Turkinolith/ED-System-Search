import { createReadStream, createWriteStream, existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { suggestKey } from './suggest-key.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.dirname(__dirname);
const dataDir = process.env.EDSS_DATA_DIR ? path.resolve(process.env.EDSS_DATA_DIR) : path.join(rootDir, 'data');
const searchPath = path.join(dataDir, 'systems-search.tsv');
const suggestDir = path.join(dataDir, 'suggest');
const suggestOverlayPath = path.join(dataDir, 'suggest-overlay.tsv');
const suggestOverlayMetaPath = path.join(dataDir, 'suggest-overlay-meta.json');
const maxOpenWriters = 96;

const writers = new Map();

function writerPath(key) {
  return path.join(suggestDir, `${key}.tsv`);
}

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

async function main() {
  if (!existsSync(searchPath)) {
    console.error(`Cannot find ${searchPath}. Run npm run import:systems first.`);
    process.exit(1);
  }

  await fs.rm(suggestDir, { recursive: true, force: true });
  await fs.mkdir(suggestDir, { recursive: true });

  const startedAt = Date.now();
  let count = 0;
  const rl = readline.createInterface({
    input: createReadStream(searchPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const lowerName = line.slice(0, line.indexOf('\t'));
    const key = suggestKey(lowerName);
    if (!key) continue;
    await writeAll(await writerFor(key), `${line}\n`);
    count += 1;
    if (count % 1000000 === 0) console.log(`Indexed ${count.toLocaleString()} suggestion rows...`);
  }

  await Promise.all([...writers.values()].map((writer) => new Promise((resolve) => writer.end(resolve))));
  const files = await fs.readdir(suggestDir);
  const meta = {
    importedAt: new Date().toISOString(),
    sourcePath: searchPath,
    count,
    bucketCount: files.filter((name) => name.endsWith('.tsv')).length,
    keyLength: 3,
    durationSeconds: Math.round((Date.now() - startedAt) / 1000),
  };
  await fs.writeFile(path.join(dataDir, 'suggest-meta.json'), JSON.stringify(meta, null, 2));
  await fs.rm(suggestOverlayPath, { force: true });
  await fs.rm(suggestOverlayMetaPath, { force: true });
  console.log(`Indexed ${count.toLocaleString()} suggestion rows into ${meta.bucketCount.toLocaleString()} buckets.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
