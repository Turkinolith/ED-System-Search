import { createReadStream, createWriteStream, existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { createGunzip } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { parseUpdateSeconds, secondsToIso, unknownUpdateSeconds } from './update-time.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.dirname(__dirname);
const sourcePath = path.resolve(rootDir, process.argv[2] ?? 'systems.json.gz');
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

const typeNames = [];
const typeCodes = new Map();
const typeCounts = new Map();
const lodCounts = new Array(lodDefs.length).fill(0);
let nameBytes = 0;
let minUpdateSeconds = unknownUpdateSeconds;
let maxUpdateSeconds = 0;

async function writeAll(writer, buffer) {
  if (!writer.write(buffer)) {
    await new Promise((resolve) => writer.once('drain', resolve));
  }
}

function typeCode(name) {
  const key = name || 'Unknown';
  if (!typeCodes.has(key)) {
    typeCodes.set(key, typeNames.length);
    typeNames.push(key);
  }
  const code = typeCodes.get(key);
  typeCounts.set(code, (typeCounts.get(code) ?? 0) + 1);
  return code;
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

function cleanJsonLine(line) {
  let text = line.trim();
  if (!text || text === '[' || text === ']') return '';
  if (text.endsWith(',')) text = text.slice(0, -1);
  return text;
}

async function writeSystem(system, index, writers, bounds) {
  const star = system.mainStar ?? 'Unknown';
  const code = typeCode(star);
  const nameBuffer = Buffer.from(system.name ?? `Unknown ${index}`, 'utf8');
  const nameOffset = nameBytes;
  nameBytes += nameBuffer.length;
  await writeAll(writers.names, nameBuffer);

  const flags = (system.needsPermit ? 1 : 0) | (nonStandard(star) ? 2 : 0);
  const record = Buffer.allocUnsafe(recordBytes);
  record.writeFloatLE(Number(system.coords?.x ?? 0), 0);
  record.writeFloatLE(Number(system.coords?.y ?? 0), 4);
  record.writeFloatLE(Number(system.coords?.z ?? 0), 8);
  record.writeUInt16LE(code, 12);
  record.writeUInt16LE(flags, 14);
  record.writeUInt32LE(nameOffset, 16);
  record.writeUInt16LE(Math.min(nameBuffer.length, 65535), 20);
  record.writeUInt16LE(0, 22);
  record.writeBigUInt64LE(BigInt(system.id64 ?? 0), 24);
  await writeAll(writers.records, record);

  const updateSeconds = parseUpdateSeconds(system.updateTime);
  const update = Buffer.allocUnsafe(4);
  update.writeUInt32LE(updateSeconds, 0);
  await writeAll(writers.updates, update);
  if (updateSeconds !== unknownUpdateSeconds) {
    minUpdateSeconds = Math.min(minUpdateSeconds, updateSeconds);
    maxUpdateSeconds = Math.max(maxUpdateSeconds, updateSeconds);
  }

  const x = Number(system.coords?.x ?? 0);
  const y = Number(system.coords?.y ?? 0);
  const z = Number(system.coords?.z ?? 0);
  bounds.min.x = Math.min(bounds.min.x, x);
  bounds.min.y = Math.min(bounds.min.y, y);
  bounds.min.z = Math.min(bounds.min.z, z);
  bounds.max.x = Math.max(bounds.max.x, x);
  bounds.max.y = Math.max(bounds.max.y, y);
  bounds.max.z = Math.max(bounds.max.z, z);

  await writeAll(writers.search, `${String(system.name ?? '').toLowerCase()}\t${system.name ?? ''}\t${index}\t${code}\t${x}\t${y}\t${z}\n`);

  const point = Buffer.allocUnsafe(lodBytes);
  point.writeFloatLE(x, 0);
  point.writeFloatLE(y, 4);
  point.writeFloatLE(z, 8);
  point.writeUInt16LE(code, 12);
  point.writeUInt16LE(flags, 14);
  point.writeUInt32LE(index, 16);
  const hash = hashIndex(system.id64, index);
  for (let i = 0; i < lodDefs.length; i += 1) {
    if (hash % lodDefs[i].divisor === 0) {
      await writeAll(writers.lods[i], point);
      lodCounts[i] += 1;
    }
  }
}

async function parseByLines(writers) {
  const stream = createReadStream(sourcePath).pipe(createGunzip());
  let pending = '';
  let index = 0;
  const bounds = {
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity },
  };

  for await (const chunk of stream) {
    pending += chunk.toString('utf8');
    let newline;
    while ((newline = pending.indexOf('\n')) >= 0) {
      const line = cleanJsonLine(pending.slice(0, newline));
      pending = pending.slice(newline + 1);
      if (!line) continue;
      const system = JSON.parse(line);
      await writeSystem(system, index, writers, bounds);
      index += 1;
      if (index % 1000000 === 0) console.log(`Imported ${index.toLocaleString()} systems...`);
    }
  }

  const finalLine = cleanJsonLine(pending);
  if (finalLine) {
    await writeSystem(JSON.parse(finalLine), index, writers, bounds);
    index += 1;
  }
  return { count: index, bounds };
}

async function main() {
  if (!existsSync(sourcePath)) {
    console.error(`Cannot find ${sourcePath}`);
    process.exit(1);
  }

  await fs.mkdir(dataDir, { recursive: true });
  const writers = {
    records: createWriteStream(path.join(dataDir, 'systems.bin')),
    names: createWriteStream(path.join(dataDir, 'systems-names.txt')),
    search: createWriteStream(path.join(dataDir, 'systems-search.tsv')),
    updates: createWriteStream(path.join(dataDir, 'systems-updates.u32')),
    lods: lodDefs.map((lod) => createWriteStream(path.join(dataDir, lod.file))),
  };

  console.log(`Importing ${sourcePath}`);
  const startedAt = new Date();
  const result = await parseByLines(writers);

  await Promise.all([
    new Promise((resolve) => writers.records.end(resolve)),
    new Promise((resolve) => writers.names.end(resolve)),
    new Promise((resolve) => writers.search.end(resolve)),
    new Promise((resolve) => writers.updates.end(resolve)),
    ...writers.lods.map((writer) => new Promise((resolve) => writer.end(resolve))),
  ]);

  const meta = {
    sourcePath,
    importedAt: new Date().toISOString(),
    durationSeconds: Math.round((Date.now() - startedAt.getTime()) / 1000),
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
    sol: { name: 'Sol', coords: { x: 0, y: 0, z: 0 } },
  };
  await fs.writeFile(path.join(dataDir, 'systems-meta.json'), JSON.stringify(meta, null, 2));
  await fs.writeFile(path.join(dataDir, 'systems-updates-meta.json'), JSON.stringify({
    sourcePath,
    importedAt: meta.importedAt,
    count: result.count,
    bytesPerRecord: 4,
    epoch: '2000-01-01T00:00:00.000Z',
    unknownValue: unknownUpdateSeconds,
    minSeconds: minUpdateSeconds === unknownUpdateSeconds ? null : minUpdateSeconds,
    maxSeconds: maxUpdateSeconds || null,
    minUpdateTime: meta.updateTimeRange.minUpdateTime,
    maxUpdateTime: meta.updateTimeRange.maxUpdateTime,
  }, null, 2));
  console.log(`Imported ${result.count.toLocaleString()} systems.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
