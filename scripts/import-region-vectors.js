import { createReadStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const idsPath = process.argv[2] ?? path.join(root, 'regionID_numsort.csv');
const mapPath = process.argv[3] ?? path.join(root, 'regionMAP.csv');
const outPath = process.argv[4] ?? path.join(root, 'data', 'region-map-vectors.json');

function parseCsvLine(line) {
  const out = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      out.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  out.push(current);
  return out;
}

async function readRegionNames(file) {
  const text = await fs.readFile(file, 'utf8');
  const regions = new Map();
  for (const [lineIndex, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim() || lineIndex === 0) continue;
    const [idText, name] = parseCsvLine(line);
    const id = Number(idText);
    if (Number.isInteger(id)) regions.set(id, { id, name });
  }
  return regions;
}

function pairKey(a, b) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function splitPair(key) {
  return key.split(':').map((value) => Number(value));
}

function lineTuple(x1, z1, x2, z2, key) {
  const [a, b] = splitPair(key);
  return [x1, z1, x2, z2, a, b];
}

function addHorizontal(active, completed, x, z, step, key, seen) {
  const lineKey = `${z}:${key}`;
  seen.add(lineKey);
  const x1 = x - step / 2;
  const x2 = x + step / 2;
  const existing = active.get(lineKey);
  if (existing && Math.abs(existing.x2 - x1) < 0.001) {
    existing.x2 = x2;
  } else {
    if (existing) completed.push(lineTuple(existing.x1, z, existing.x2, z, key));
    active.set(lineKey, { x1, x2, key, z });
  }
}

function flushMissingHorizontal(active, completed, seen) {
  for (const [lineKey, line] of active) {
    if (seen.has(lineKey)) continue;
    completed.push(lineTuple(line.x1, line.z, line.x2, line.z, line.key));
    active.delete(lineKey);
  }
}

function flushAllHorizontal(active, completed) {
  for (const line of active.values()) {
    completed.push(lineTuple(line.x1, line.z, line.x2, line.z, line.key));
  }
  active.clear();
}

function addVerticalSegments(completed, x, zValues, previousIds, currentIds, step) {
  let open = null;
  const boundaryX = x - step / 2;
  for (let index = 0; index < currentIds.length; index += 1) {
    const left = previousIds[index];
    const right = currentIds[index];
    const key = left !== right ? pairKey(left, right) : null;
    const z1 = zValues[index] - step / 2;
    const z2 = zValues[index] + step / 2;
    if (key && open?.key === key && Math.abs(open.z2 - z1) < 0.001) {
      open.z2 = z2;
      continue;
    }
    if (open) completed.push(lineTuple(boundaryX, open.z1, boundaryX, open.z2, open.key));
    open = key ? { key, z1, z2 } : null;
  }
  if (open) completed.push(lineTuple(boundaryX, open.z1, boundaryX, open.z2, open.key));
}

function updateRegionStats(stats, id, x, z) {
  let stat = stats.get(id);
  if (!stat) {
    stat = { id, count: 0, sumX: 0, sumZ: 0, minX: x, maxX: x, minZ: z, maxZ: z };
    stats.set(id, stat);
  }
  stat.count += 1;
  stat.sumX += x;
  stat.sumZ += z;
  stat.minX = Math.min(stat.minX, x);
  stat.maxX = Math.max(stat.maxX, x);
  stat.minZ = Math.min(stat.minZ, z);
  stat.maxZ = Math.max(stat.maxZ, z);
}

function columnFromRows(rows) {
  return {
    x: rows[0].x,
    zValues: rows.map((row) => row.z),
    ids: rows.map((row) => row.id),
  };
}

async function importRegionMap() {
  const regionNames = await readRegionNames(idsPath);
  const stats = new Map();
  const segments = [];
  const activeHorizontal = new Map();
  let first = true;
  let header = true;
  let previousColumn = null;
  let currentRows = [];
  let lineRemainder = '';
  let rowCount = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let step = 10;
  let lastProgress = Date.now();

  function processCompletedColumn() {
    if (currentRows.length === 0) return;
    const column = columnFromRows(currentRows);
    if (column.zValues.length > 1) {
      step = Math.abs(column.zValues[1] - column.zValues[0]) || step;
    }

    const seenHorizontal = new Set();
    for (let index = 1; index < column.ids.length; index += 1) {
      const a = column.ids[index - 1];
      const b = column.ids[index];
      if (a === b) continue;
      addHorizontal(activeHorizontal, segments, column.x, column.zValues[index] - step / 2, step, pairKey(a, b), seenHorizontal);
    }
    flushMissingHorizontal(activeHorizontal, segments, seenHorizontal);

    if (previousColumn) {
      addVerticalSegments(segments, column.x, column.zValues, previousColumn.ids, column.ids, step);
    }
    previousColumn = column;
    currentRows = [];
  }

  function processLine(rawLine) {
    const line = rawLine.trim();
    if (!line) return;
    if (header) {
      header = false;
      return;
    }
    const firstComma = line.indexOf(',');
    const secondComma = line.indexOf(',', firstComma + 1);
    if (firstComma < 0 || secondComma < 0) return;
    const x = Number(line.slice(0, firstComma));
    const z = Number(line.slice(firstComma + 1, secondComma));
    const id = Number(line.slice(secondComma + 1));
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isInteger(id)) return;

    if (!first && currentRows.length && x !== currentRows[0].x) processCompletedColumn();
    first = false;
    currentRows.push({ x, z, id });
    updateRegionStats(stats, id, x, z);
    rowCount += 1;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);

    const now = Date.now();
    if (now - lastProgress > 5000) {
      lastProgress = now;
      console.log(`Processed ${rowCount.toLocaleString()} samples at x=${x.toLocaleString()}...`);
    }
  }

  await new Promise((resolve, reject) => {
    const stream = createReadStream(mapPath, { encoding: 'utf8', highWaterMark: 1024 * 1024 * 8 });
    stream.on('data', (chunk) => {
      const lines = (lineRemainder + chunk).split(/\r?\n/);
      lineRemainder = lines.pop() ?? '';
      for (const line of lines) processLine(line);
    });
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  if (lineRemainder) processLine(lineRemainder);
  processCompletedColumn();
  flushAllHorizontal(activeHorizontal, segments);

  const regions = [...stats.values()]
    .filter((stat) => stat.id !== 0)
    .map((stat) => {
      const name = regionNames.get(stat.id)?.name ?? `Region ${stat.id}`;
      return {
        id: stat.id,
        name,
        sampleCount: stat.count,
        label: [
          Math.round(stat.sumX / stat.count),
          Math.round(stat.sumZ / stat.count),
        ],
        bounds: [stat.minX, stat.minZ, stat.maxX, stat.maxZ],
      };
    })
    .sort((a, b) => a.id - b.id);

  const payload = {
    generatedAt: new Date().toISOString(),
    source: {
      ids: path.basename(idsPath),
      map: path.basename(mapPath),
      sampleResolutionLy: step,
      sampleCount: rowCount,
    },
    bounds: [minX - step / 2, minZ - step / 2, maxX + step / 2, maxZ + step / 2],
    regions,
    // Segment tuple: [x1, z1, x2, z2, regionA, regionB].
    boundaries: segments,
  };

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(payload)}\n`);
  console.log(`Wrote ${outPath}`);
  console.log(`${regions.length.toLocaleString()} regions, ${segments.length.toLocaleString()} merged boundary segments, ${rowCount.toLocaleString()} samples`);
}

importRegionMap().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
