import { createReadStream, createWriteStream, existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { Readable, Transform } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { getHeapStatistics } from 'node:v8';
import { parseUpdateSeconds, secondsToIso, unknownUpdateSeconds } from './update-time.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.dirname(__dirname);
const sourceArg = process.argv[2] ?? 'systems_1month.json.gz';
const sourcePath = isUrl(sourceArg) ? sourceArg : path.resolve(rootDir, sourceArg);
const dataDir = process.env.EDSS_DATA_DIR ? path.resolve(process.env.EDSS_DATA_DIR) : path.join(rootDir, 'data');
const recordBytes = 32;
const lodBytes = 20;

const lodDefs = [
  { level: 0, divisor: 4096, file: 'systems-lod-0.bin' },
  { level: 1, divisor: 1024, file: 'systems-lod-1.bin' },
  { level: 2, divisor: 256, file: 'systems-lod-2.bin' },
  { level: 3, divisor: 64, file: 'systems-lod-3.bin' },
  { level: 4, divisor: 16, file: 'systems-lod-4.bin' },
  { level: 5, divisor: 4, file: 'systems-lod-5.bin' },
  { level: 6, divisor: 1, file: 'systems-lod-6.bin' },
];

const paths = {
  meta: path.join(dataDir, 'systems-meta.json'),
  records: path.join(dataDir, 'systems.bin'),
  names: path.join(dataDir, 'systems-names.txt'),
  search: path.join(dataDir, 'systems-search.tsv'),
  updates: path.join(dataDir, 'systems-updates.u32'),
  updatesMeta: path.join(dataDir, 'systems-updates-meta.json'),
};

const tempSuffix = `.delta-${Date.now()}.tmp`;
const typeNames = [];
const typeCodes = new Map();
const typeCounts = new Map();
const lodCounts = new Array(lodDefs.length).fill(0);
const nameIndexShardCount = 4096;
let nameBytes = 0;
let minUpdateSeconds = unknownUpdateSeconds;
let maxUpdateSeconds = 0;

async function writeAll(writer, buffer) {
  if (!writer.write(buffer)) await new Promise((resolve) => writer.once('drain', resolve));
}

function isUrl(value) {
  return /^https?:\/\//i.test(String(value ?? ''));
}

function progress(message) {
  console.log(`PROGRESS\t${message}`);
}

function formatBytes(bytes) {
  const value = Number(bytes ?? 0);
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GiB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MiB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${value} B`;
}

function downloadProgressStream(totalBytes) {
  let downloaded = 0;
  let lastReportAt = 0;

  function report(force = false) {
    const now = Date.now();
    if (!force && now - lastReportAt < 1000) return;
    lastReportAt = now;
    const totalText = totalBytes ? ` / ${formatBytes(totalBytes)}` : '';
    const percentText = totalBytes ? ` (${Math.floor((downloaded / totalBytes) * 100)}%)` : '';
    progress(`downloading ${formatBytes(downloaded)}${totalText}${percentText}`);
  }

  return new Transform({
    transform(chunk, encoding, callback) {
      downloaded += chunk.length;
      report();
      callback(null, chunk);
    },
    flush(callback) {
      report(true);
      callback();
    },
  });
}

async function sourceStream() {
  if (!isUrl(sourcePath)) {
    progress(`reading ${path.basename(sourcePath)}`);
    return createReadStream(sourcePath).pipe(createGunzip());
  }
  const response = await fetch(sourcePath);
  if (!response.ok) throw new Error(`Could not fetch ${sourcePath}: ${response.status} ${response.statusText}`);
  const totalBytes = Number(response.headers.get('content-length')) || null;
  progress(totalBytes ? `download size ${formatBytes(totalBytes)}` : 'download size unknown');
  return Readable.fromWeb(response.body).pipe(downloadProgressStream(totalBytes)).pipe(createGunzip());
}

function cleanJsonLine(line) {
  let text = line.trim();
  if (!text || text === '[' || text === ']') return '';
  if (text.endsWith(',')) text = text.slice(0, -1);
  return text;
}

function systemKey(name) {
  return String(name ?? '').trim().toLowerCase();
}

function baseType(star) {
  if (!star) return 'Unknown';
  if (star.includes('Black Hole')) return 'Black Hole';
  if (star.includes('Neutron')) return 'Neutron Star';
  if (star.includes('White Dwarf')) return 'White Dwarf';
  if (star.includes('T Tauri')) return 'T Tauri';
  if (star.includes('Wolf-Rayet')) return 'Wolf-Rayet';
  if (star.includes('Herbig')) return 'Herbig Ae/Be';
  const match = star.match(/^([OBAFGKMLTYCS]|CJ|CN|MS)/);
  return match ? match[1] : star;
}

function nonStandard(star) {
  if (!star) return true;
  return /Black Hole|Neutron|White Dwarf|T Tauri|Wolf-Rayet|Herbig|giant|super giant|C Star|CJ Star|CN Star|S-type|MS-type/i.test(star)
    || !/\bStar$/.test(star);
}

function hashIndex(id64, index) {
  try {
    let value = BigInt(id64 ?? index);
    value ^= value >> 33n;
    value *= 0xff51afd7ed558ccdn;
    value ^= value >> 33n;
    return Number(value & 0xffffffffn);
  } catch {
    return index * 2654435761;
  }
}

function seedTypes(meta) {
  for (const name of meta.typeNames ?? []) {
    if (typeCodes.has(name)) continue;
    typeCodes.set(name, typeNames.length);
    typeNames.push(name);
  }
}

function typeCode(name) {
  const key = name || 'Unknown';
  if (!typeCodes.has(key)) {
    typeCodes.set(key, typeNames.length);
    typeNames.push(key);
  }
  return typeCodes.get(key);
}

function countType(code) {
  typeCounts.set(code, (typeCounts.get(code) ?? 0) + 1);
}

function observeUpdate(seconds) {
  if (seconds === unknownUpdateSeconds) return;
  minUpdateSeconds = Math.min(minUpdateSeconds, seconds);
  maxUpdateSeconds = Math.max(maxUpdateSeconds, seconds);
}

function updateBounds(bounds, x, y, z) {
  bounds.min.x = Math.min(bounds.min.x, x);
  bounds.min.y = Math.min(bounds.min.y, y);
  bounds.min.z = Math.min(bounds.min.z, z);
  bounds.max.x = Math.max(bounds.max.x, x);
  bounds.max.y = Math.max(bounds.max.y, y);
  bounds.max.z = Math.max(bounds.max.z, z);
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

class ShardedNameIndex {
  constructor(shardCount = nameIndexShardCount) {
    this.shards = Array.from({ length: shardCount }, () => new Map());
    this.size = 0;
  }

  shardFor(key) {
    const first = key.charCodeAt(0) || 0;
    const second = key.charCodeAt(1) || 0;
    return this.shards[((first * 131) + second) & (this.shards.length - 1)];
  }

  get(key) {
    return this.shardFor(key).get(key);
  }

  set(key, value) {
    const shard = this.shardFor(key);
    if (!shard.has(key)) this.size += 1;
    shard.set(key, value);
  }
}

async function loadExistingSearch(expectedCount) {
  const nameToIndex = new ShardedNameIndex();
  const indexNames = [];
  const rl = readline.createInterface({
    input: createReadStream(paths.search, { encoding: 'utf8', highWaterMark: 8 * 1024 * 1024 }),
    crlfDelay: Infinity,
  });

  let count = 0;
  let skipped = 0;
  for await (const line of rl) {
    const [lowerName, name, indexText] = line.split('\t');
    const index = Number(indexText);
    if (!lowerName || !Number.isInteger(index) || index < 0 || index >= expectedCount) {
      skipped += 1;
      if (skipped <= 5) console.warn(`Skipped malformed search row ${count + skipped}: ${line.slice(0, 180)}`);
      continue;
    }
    if (nameToIndex.get(lowerName) === undefined) nameToIndex.set(lowerName, index);
    indexNames[index] = name;
    count += 1;
    if (count % 1000000 === 0) console.log(`Loaded ${count.toLocaleString()} existing search rows...`);
  }

  if (skipped) console.warn(`Skipped ${skipped.toLocaleString()} malformed or out-of-range search rows.`);
  if (count !== expectedCount) {
    console.warn(`Loaded ${count.toLocaleString()} valid search rows for ${expectedCount.toLocaleString()} indexed systems.`);
  }
  return { nameToIndex, indexNames };
}

async function parseDelta(nameToIndex) {
  const stream = await sourceStream();
  const updates = new Map();
  const additions = new Map();
  let pending = '';
  let count = 0;

  function accept(system) {
    const key = systemKey(system.name);
    if (!key) return;
    const existingIndex = nameToIndex.get(key);
    if (existingIndex !== undefined) updates.set(existingIndex, system);
    else additions.set(key, system);
    count += 1;
    if (count % 250000 === 0) console.log(`Read ${count.toLocaleString()} delta systems...`);
  }

  for await (const chunk of stream) {
    pending += chunk.toString('utf8');
    let newline;
    while ((newline = pending.indexOf('\n')) >= 0) {
      const line = cleanJsonLine(pending.slice(0, newline));
      pending = pending.slice(newline + 1);
      if (line) accept(JSON.parse(line));
    }
  }

  const finalLine = cleanJsonLine(pending);
  if (finalLine) accept(JSON.parse(finalLine));
  return { count, updates, additions };
}

function tempPath(file) {
  return `${file}${tempSuffix}`;
}

function openWriters() {
  return {
    records: createWriteStream(tempPath(paths.records)),
    names: createWriteStream(tempPath(paths.names)),
    search: createWriteStream(tempPath(paths.search)),
    updates: createWriteStream(tempPath(paths.updates)),
    lods: lodDefs.map((lod) => createWriteStream(tempPath(path.join(dataDir, lod.file)))),
  };
}

async function closeWriters(writers) {
  await Promise.all([
    new Promise((resolve) => writers.records.end(resolve)),
    new Promise((resolve) => writers.names.end(resolve)),
    new Promise((resolve) => writers.search.end(resolve)),
    new Promise((resolve) => writers.updates.end(resolve)),
    ...writers.lods.map((writer) => new Promise((resolve) => writer.end(resolve))),
  ]);
}

async function writeOutputRecord(writers, system, index, bounds) {
  const name = system.name ?? `Unknown ${index}`;
  const star = system.mainStar ?? 'Unknown';
  const code = Number.isInteger(system.typeCode) ? system.typeCode : typeCode(star);
  countType(code);

  const nameBuffer = Buffer.from(name, 'utf8');
  const nameOffset = nameBytes;
  nameBytes += nameBuffer.length;
  await writeAll(writers.names, nameBuffer);

  const x = Number(system.coords?.x ?? 0);
  const y = Number(system.coords?.y ?? 0);
  const z = Number(system.coords?.z ?? 0);
  const flags = Number.isInteger(system.flags)
    ? system.flags
    : (system.needsPermit ? 1 : 0) | (nonStandard(star) ? 2 : 0);
  const id64 = system.id64 ?? 0;
  const updateSeconds = Number.isInteger(system.updateSeconds)
    ? system.updateSeconds
    : parseUpdateSeconds(system.updateTime);

  const record = Buffer.allocUnsafe(recordBytes);
  record.writeFloatLE(x, 0);
  record.writeFloatLE(y, 4);
  record.writeFloatLE(z, 8);
  record.writeUInt16LE(code, 12);
  record.writeUInt16LE(flags, 14);
  record.writeUInt32LE(nameOffset, 16);
  record.writeUInt16LE(Math.min(nameBuffer.length, 65535), 20);
  record.writeUInt16LE(0, 22);
  record.writeBigUInt64LE(BigInt(id64), 24);
  await writeAll(writers.records, record);

  const update = Buffer.allocUnsafe(4);
  update.writeUInt32LE(updateSeconds, 0);
  await writeAll(writers.updates, update);
  observeUpdate(updateSeconds);
  updateBounds(bounds, x, y, z);
  await writeAll(writers.search, `${systemKey(name)}\t${name}\t${index}\t${code}\t${x}\t${y}\t${z}\n`);

  const point = Buffer.allocUnsafe(lodBytes);
  point.writeFloatLE(x, 0);
  point.writeFloatLE(y, 4);
  point.writeFloatLE(z, 8);
  point.writeUInt16LE(code, 12);
  point.writeUInt16LE(flags, 14);
  point.writeUInt32LE(index, 16);
  const hash = hashIndex(id64, index);
  for (let i = 0; i < lodDefs.length; i += 1) {
    if (hash % lodDefs[i].divisor === 0) {
      await writeAll(writers.lods[i], point);
      lodCounts[i] += 1;
    }
  }
}

function oldSystemFromRecord(record, updateSeconds, name, meta) {
  const typeCodeValue = record.readUInt16LE(12);
  return {
    name,
    coords: {
      x: record.readFloatLE(0),
      y: record.readFloatLE(4),
      z: record.readFloatLE(8),
    },
    typeCode: typeCodeValue,
    mainStar: meta.typeNames?.[typeCodeValue] ?? 'Unknown',
    flags: record.readUInt16LE(14),
    id64: record.readBigUInt64LE(24).toString(),
    updateSeconds,
  };
}

async function rebuildMergedFiles(meta, indexNames, updates, additions) {
  const writers = openWriters();
  const bounds = {
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity },
  };
  const recordsFd = await fs.open(paths.records, 'r');
  const updatesFd = await fs.open(paths.updates, 'r');
  const record = Buffer.allocUnsafe(recordBytes);
  const update = Buffer.allocUnsafe(4);
  const existingCount = meta.count ?? indexNames.length;

  try {
    for (let index = 0; index < existingCount; index += 1) {
      const { bytesRead } = await recordsFd.read(record, 0, recordBytes, index * recordBytes);
      if (bytesRead !== recordBytes) throw new Error(`Could not read existing record ${index}.`);
      const updateRead = await updatesFd.read(update, 0, 4, index * 4);
      const updateSeconds = updateRead.bytesRead === 4 ? update.readUInt32LE(0) : unknownUpdateSeconds;
      const nextSystem = updates.get(index)
        ? {
          ...updates.get(index),
          id64: updates.get(index).id64 ?? record.readBigUInt64LE(24).toString(),
        }
        : oldSystemFromRecord(record, updateSeconds, indexNames[index] ?? `Unknown ${index}`, meta);
      await writeOutputRecord(writers, nextSystem, index, bounds);
      if ((index + 1) % 1000000 === 0) console.log(`Rebuilt ${(index + 1).toLocaleString()} existing systems...`);
    }

    let appended = 0;
    for (const system of additions.values()) {
      await writeOutputRecord(writers, system, existingCount + appended, bounds);
      appended += 1;
      if (appended % 100000 === 0) console.log(`Appended ${appended.toLocaleString()} new systems...`);
    }
  } finally {
    await recordsFd.close();
    await updatesFd.close();
    await closeWriters(writers);
  }

  return { count: existingCount + additions.size, bounds };
}

async function replaceGeneratedFiles() {
  const files = [
    paths.records,
    paths.names,
    paths.search,
    paths.updates,
    ...lodDefs.map((lod) => path.join(dataDir, lod.file)),
  ];
  for (const file of files) {
    await fs.rm(file, { force: true });
    await fs.rename(tempPath(file), file);
  }
}

async function removeTempFiles() {
  const files = [
    paths.records,
    paths.names,
    paths.search,
    paths.updates,
    ...lodDefs.map((lod) => path.join(dataDir, lod.file)),
  ];
  await Promise.all(files.map((file) => fs.rm(tempPath(file), { force: true }).catch(() => null)));
}

async function main() {
  const heapLimit = getHeapStatistics().heap_size_limit;
  console.log(`Node heap limit: ${formatBytes(heapLimit)}`);
  if (!isUrl(sourcePath) && !existsSync(sourcePath)) {
    console.error(`Cannot find ${sourcePath}`);
    process.exit(1);
  }
  for (const required of [paths.meta, paths.records, paths.search, paths.updates]) {
    if (!existsSync(required)) {
      console.error(`Cannot find ${required}. Run npm run import:systems first.`);
      process.exit(1);
    }
  }

  const startedAt = Date.now();
  const meta = await readJson(paths.meta, null);
  if (!meta?.count || !Array.isArray(meta.typeNames)) throw new Error('systems-meta.json is missing required metadata.');
  seedTypes(meta);

  console.log(`Loading existing system names from ${paths.search}`);
  const { nameToIndex, indexNames } = await loadExistingSearch(meta.count);
  console.log(`Reading delta dump ${sourcePath}`);
  const delta = await parseDelta(nameToIndex);
  console.log(`Delta rows: ${delta.count.toLocaleString()}, updates: ${delta.updates.size.toLocaleString()}, new: ${delta.additions.size.toLocaleString()}`);

  try {
    const result = await rebuildMergedFiles(meta, indexNames, delta.updates, delta.additions);
    await replaceGeneratedFiles();
    const importedAt = new Date().toISOString();
    const nextMeta = {
      ...meta,
      sourcePath: meta.sourcePath,
      importedAt: meta.importedAt,
      lastDeltaImport: {
        sourcePath,
        importedAt,
        durationSeconds: Math.round((Date.now() - startedAt) / 1000),
        inputCount: delta.count,
        updatedCount: delta.updates.size,
        addedCount: delta.additions.size,
      },
      count: result.count,
      bounds: result.bounds,
      typeNames,
      typeCounts: Object.fromEntries([...typeCounts.entries()].map(([k, v]) => [String(k), v])),
      baseTypes: Object.fromEntries(typeNames.map((name, code) => [String(code), baseType(name)])),
      lodLevels: lodDefs.map((lod, i) => ({ level: lod.level, divisor: lod.divisor, file: lod.file, count: lodCounts[i] })),
      updateTimeRange: {
        available: minUpdateSeconds !== unknownUpdateSeconds,
        minUpdateTime: minUpdateSeconds === unknownUpdateSeconds ? null : secondsToIso(minUpdateSeconds),
        maxUpdateTime: maxUpdateSeconds ? secondsToIso(maxUpdateSeconds) : null,
      },
    };
    await fs.writeFile(paths.meta, JSON.stringify(nextMeta, null, 2));
    await fs.writeFile(paths.updatesMeta, JSON.stringify({
      sourcePath: paths.updates,
      importedAt,
      count: result.count,
      bytesPerRecord: 4,
      epoch: '2000-01-01T00:00:00.000Z',
      unknownValue: unknownUpdateSeconds,
      minSeconds: minUpdateSeconds === unknownUpdateSeconds ? null : minUpdateSeconds,
      maxSeconds: maxUpdateSeconds || null,
      minUpdateTime: nextMeta.updateTimeRange.minUpdateTime,
      maxUpdateTime: nextMeta.updateTimeRange.maxUpdateTime,
      lastDeltaImport: nextMeta.lastDeltaImport,
    }, null, 2));
    console.log(`Merged delta into ${result.count.toLocaleString()} systems.`);
    console.log('Next steps: npm run import:name-lookup, npm run import:suggestions, then npm run import:journals');
  } catch (error) {
    await removeTempFiles();
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
