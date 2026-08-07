import { createReadStream, createWriteStream, existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { suggestKey } from './suggest-key.js';
import { withImportActivity } from './import-activity.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.dirname(__dirname);
const defaultDataDir = process.env.EDSS_DATA_DIR
  ? path.resolve(process.env.EDSS_DATA_DIR)
  : path.join(rootDir, 'data');
const partitionCount = 64;

function partitionFor(key) {
  let hash = 2166136261;
  for (const char of key) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % partitionCount;
}

async function buildSuggestOverlayIndexUnlocked(dataDir) {
  const sourcePath = path.join(dataDir, 'suggest-overlay.tsv');
  const outputDir = path.join(dataDir, 'suggest-overlay-index');
  if (!existsSync(sourcePath)) {
    await fs.rm(outputDir, { recursive: true, force: true });
    return { count: 0, bucketCount: 0, removed: true };
  }

  const sourceBefore = await fs.stat(sourcePath);
  const tempDir = path.join(dataDir, `.suggest-overlay-index-${process.pid}-${Date.now()}.tmp`);
  const partitionDir = path.join(tempDir, 'partitions');
  await fs.mkdir(partitionDir, { recursive: true });
  const activeWriters = new Set();
  const bucketKeys = new Set();
  let count = 0;

  function createTrackedWriter(filePath) {
    const writer = createWriteStream(filePath);
    activeWriters.add(writer);
    writer.once('close', () => activeWriters.delete(writer));
    return writer;
  }

  async function writeAll(writer, line) {
    if (!writer.write(line)) await new Promise((resolve) => writer.once('drain', resolve));
  }

  async function closeWriters(writers) {
    await Promise.all([...writers.values()].map((writer) => new Promise((resolve, reject) => {
      writer.once('error', reject);
      writer.end(resolve);
    })));
    writers.clear();
  }

  try {
    // The native delta overlay is intentionally unordered. A fixed partition
    // pass keeps only 64 files open; each partition then fans out to fewer than
    // 96 final three-character buckets without repeated open/close churn.
    const partitionWriters = new Map();
    const input = createReadStream(sourcePath, { encoding: 'utf8', highWaterMark: 8 * 1024 * 1024 });
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    for await (const line of lines) {
      const firstTab = line.indexOf('\t');
      if (firstTab <= 0) continue;
      const key = suggestKey(line.slice(0, firstTab));
      if (!key) continue;
      const partition = partitionFor(key);
      let writer = partitionWriters.get(partition);
      if (!writer) {
        writer = createTrackedWriter(path.join(partitionDir, `${String(partition).padStart(2, '0')}.tsv`));
        partitionWriters.set(partition, writer);
      }
      await writeAll(writer, `${line}\n`);
      count += 1;
      if (count % 1000000 === 0) console.log(`Indexed ${count.toLocaleString()} suggestion overlay rows...`);
    }
    await closeWriters(partitionWriters);

    for (let partition = 0; partition < partitionCount; partition += 1) {
      const partitionPath = path.join(partitionDir, `${String(partition).padStart(2, '0')}.tsv`);
      if (!existsSync(partitionPath)) continue;
      const bucketWriters = new Map();
      const partitionInput = createReadStream(partitionPath, { encoding: 'utf8', highWaterMark: 4 * 1024 * 1024 });
      const partitionLines = readline.createInterface({ input: partitionInput, crlfDelay: Infinity });
      for await (const line of partitionLines) {
        const firstTab = line.indexOf('\t');
        if (firstTab <= 0) continue;
        const key = suggestKey(line.slice(0, firstTab));
        if (!key) continue;
        let writer = bucketWriters.get(key);
        if (!writer) {
          writer = createTrackedWriter(path.join(tempDir, `${key}.tsv`));
          bucketWriters.set(key, writer);
          bucketKeys.add(key);
        }
        await writeAll(writer, `${line}\n`);
      }
      await closeWriters(bucketWriters);
      await fs.rm(partitionPath, { force: true });
    }
    await fs.rm(partitionDir, { recursive: true, force: true });

    const sourceAfter = await fs.stat(sourcePath);
    if (sourceAfter.size !== sourceBefore.size || sourceAfter.mtimeMs !== sourceBefore.mtimeMs) {
      throw new Error('Suggestion overlay changed while its search index was being built.');
    }
    const meta = {
      formatVersion: 1,
      builtAt: new Date().toISOString(),
      sourceFile: path.basename(sourcePath),
      sourceSize: sourceAfter.size,
      sourceMtimeMs: sourceAfter.mtimeMs,
      count,
      bucketCount: bucketKeys.size,
      keyLength: 3,
    };
    await fs.writeFile(path.join(tempDir, 'meta.json'), JSON.stringify(meta, null, 2));
    await fs.rm(outputDir, { recursive: true, force: true });
    await fs.rename(tempDir, outputDir);
    return meta;
  } catch (error) {
    for (const writer of activeWriters) writer.destroy();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => null);
    throw error;
  }
}

export async function buildSuggestOverlayIndex(dataDir = defaultDataDir) {
  return withImportActivity(dataDir, 'suggestion overlay index build', () => buildSuggestOverlayIndexUnlocked(dataDir));
}

async function main() {
  const result = await buildSuggestOverlayIndex();
  if (result.removed) console.log('No suggestion overlay is present; removed its stale search index.');
  else console.log(`Indexed ${result.count.toLocaleString()} suggestion overlay rows into ${result.bucketCount.toLocaleString()} buckets.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
