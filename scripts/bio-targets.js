// Reads the per-boxel high-value bio counts written by the Rust bio-targets
// scan (data/bio-targets.bin + data/bio-targets-meta.json) and turns them into
// estimates for the map overlay and the system details.
//
// Per cell and species the scan stores share-weighted sums:
//   E = found on DSS-mapped bodies, M = all mapped candidates, U = never mapped,
// once over all systems and once over complete systems (every body the FSS
// counted has a record). The rate at which mapped candidates hold the genus
// comes from all systems, shrunk toward the galaxy-wide rate r when few bodies
// were mapped:
//   p = (E + ALPHA * r) / (M + ALPHA)
// Expected finds per system come from complete systems where a cell has
// enough of them: elsewhere the dump tends to hold only the bodies someone
// found worth scanning, which would inflate per-system values.
import fs from 'node:fs/promises';

export const ALPHA = 10;
export const MIN_COMPLETE_SYSTEMS = 10;
const MAGIC = 'EDBIOT01';
const VERSION = 3;
const HEADER_BYTES = 32;
const CELL_BYTES = 24;
const ENTRY_BYTES = 28;
const CELL_FIELDS = 7; // cx, cy, cz, systems, complete, eligible, mapped
const SUMS = 6; // E, M, U over all systems, then over complete systems
export const LEVELS = Object.freeze([320, 640, 1280]);
// Height bands, in 320 ly layers centred on a height: one layer or three.
export const BANDS = Object.freeze([1, 3]);

// The range of 320 ly layers (cell y indexes) in a band around height y.
export function bandLayers(data, y, layers) {
  const centre = Math.floor((y + data.meta.galaxyOrigin[1]) / data.cellLy);
  const half = (layers - 1) / 2;
  return { min: centre - half, max: centre + half };
}

// Unpacks the sparse cell records into flat typed arrays: per cell its grid
// position and counts, and a run of (species, sums) entries.
export function parseBioTargets(buffer, meta) {
  if (buffer.length < HEADER_BYTES || buffer.toString('ascii', 0, 8) !== MAGIC || buffer.readUInt32LE(8) !== VERSION) {
    throw new Error('bio-targets.bin has an unexpected header; rebuild the high-value bio map.');
  }
  const speciesCount = buffer.readUInt32LE(12);
  const count = Number(buffer.readBigUInt64LE(16));
  const cellLy = buffer.readFloatLE(24);
  if (speciesCount !== meta.species.length) throw new Error('bio-targets.bin does not match its metadata.');
  const cells = new Uint32Array(count * CELL_FIELDS);
  const entryStart = new Uint32Array(count + 1);
  const entryCount = (buffer.length - HEADER_BYTES - count * CELL_BYTES) / ENTRY_BYTES;
  if (!Number.isInteger(entryCount) || entryCount < 0) throw new Error('bio-targets.bin is truncated.');
  const entrySpecies = new Uint16Array(entryCount);
  const entrySums = new Float32Array(entryCount * SUMS);
  let at = HEADER_BYTES;
  let entry = 0;
  for (let index = 0; index < count; index += 1) {
    const base = index * CELL_FIELDS;
    cells[base] = buffer.readUInt16LE(at);
    cells[base + 1] = buffer.readUInt16LE(at + 2);
    cells[base + 2] = buffer.readUInt16LE(at + 4);
    const entries = buffer.readUInt16LE(at + 6);
    for (let field = 0; field < 4; field += 1) cells[base + 3 + field] = buffer.readUInt32LE(at + 8 + field * 4);
    at += CELL_BYTES;
    entryStart[index] = entry;
    for (let item = 0; item < entries; item += 1) {
      entrySpecies[entry] = buffer.readUInt16LE(at);
      for (let part = 0; part < SUMS; part += 1) entrySums[entry * SUMS + part] = buffer.readFloatLE(at + 4 + part * 4);
      at += ENTRY_BYTES;
      entry += 1;
    }
  }
  entryStart[count] = entry;
  if (entry !== entryCount) throw new Error('bio-targets.bin is truncated.');
  return { meta, count, speciesCount, cellLy, cells, entryStart, entrySpecies, entrySums };
}

export async function loadBioTargets(dataPath, metaPath) {
  const [buffer, metaText] = await Promise.all([fs.readFile(dataPath), fs.readFile(metaPath, 'utf8')]);
  return parseBioTargets(buffer, JSON.parse(metaText));
}

function cellAt(data, index) {
  const base = index * CELL_FIELDS;
  return { cx: data.cells[base], cy: data.cells[base + 1], cz: data.cells[base + 2] };
}

function emptySums(speciesCount) {
  return { systems: 0, complete: 0, eligible: 0, mapped: 0, sums: new Float64Array(speciesCount * SUMS) };
}

function addCell(target, data, index) {
  const base = index * CELL_FIELDS;
  target.systems += data.cells[base + 3];
  target.complete += data.cells[base + 4];
  target.eligible += data.cells[base + 5];
  target.mapped += data.cells[base + 6];
  for (let entry = data.entryStart[index]; entry < data.entryStart[index + 1]; entry += 1) {
    const species = data.entrySpecies[entry] * SUMS;
    for (let part = 0; part < SUMS; part += 1) target.sums[species + part] += data.entrySums[entry * SUMS + part];
  }
}

// Estimates for one aggregate of cells, over the chosen species indexes.
export function estimate(data, totals, speciesIndexes = null) {
  const useComplete = totals.complete >= MIN_COMPLETE_SYSTEMS;
  const offset = useComplete ? 3 : 0;
  const perSystem = useComplete ? totals.complete : totals.systems;
  const species = [];
  let expectedFinds = 0;
  let expectedCredits = 0;
  let mappedCandidates = 0;
  const indexes = speciesIndexes ?? data.meta.species.map((_, index) => index);
  for (const index of indexes) {
    const info = data.meta.species[index];
    const at = index * SUMS;
    const found = totals.sums[at];
    const mapped = totals.sums[at + 1];
    const unmapped = totals.sums[at + 2];
    const rate = (found + ALPHA * info.rate) / (mapped + ALPHA);
    const finds = totals.sums[at + offset] + rate * totals.sums[at + offset + 2];
    expectedFinds += finds;
    expectedCredits += finds * info.value;
    mappedCandidates += mapped;
    species.push({ key: info.key, name: info.name, genus: info.genus, value: info.value, found, mapped, unmapped, rate, finds });
  }
  return {
    systems: totals.systems,
    completeSystems: totals.complete,
    // 'complete' when the per-system figures come from fully scanned systems.
    basis: useComplete ? 'complete' : 'all',
    eligibleBodies: totals.eligible,
    mappedBodies: totals.mapped,
    mappedCandidates,
    expectedFinds,
    // Expected high-value credits (base values) per scanned system.
    creditsPerSystem: perSystem ? expectedCredits / perSystem : 0,
    // Chance that a scanned system holds at least one of the chosen species.
    chancePerSystem: perSystem ? 1 - Math.exp(-expectedFinds / perSystem) : 0,
    species: species.sort((a, b) => b.finds * b.value - a.finds * a.value),
  };
}

export function speciesIndexes(data, keys) {
  if (!keys?.length) return null;
  const wanted = new Set(keys);
  const indexes = data.meta.species.map((species, index) => (wanted.has(species.key) || wanted.has(species.name) ? index : -1)).filter((index) => index >= 0);
  return indexes.length ? indexes : null;
}

// Top-down texture: cells summed through y and into `level` ly columns, or,
// with `band` ({ min, max } layers), only the cells at those heights.
// Header (36 bytes): "EDBIOX01", version, width, height, min x, min z, cell ly,
// and the credits per system where the top 10% of columns begin. Then 2 bytes
// per texel, rows of increasing z: the column's rank by credits per system
// (1-255, 0 = no data) and confidence (complete systems, or a fainter value
// from mapped bodies where too few systems are complete).
export function overlayTexture(data, level, keys = null, band = null) {
  const factor = Math.round(level / data.cellLy);
  const indexes = speciesIndexes(data, keys);
  const origin = data.meta.galaxyOrigin;
  const columns = new Map();
  let minI = Infinity;
  let minK = Infinity;
  let maxI = -Infinity;
  let maxK = -Infinity;
  for (let index = 0; index < data.count; index += 1) {
    const cell = cellAt(data, index);
    if (band && (cell.cy < band.min || cell.cy > band.max)) continue;
    const i = Math.floor(cell.cx / factor);
    const k = Math.floor(cell.cz / factor);
    const key = i * 65536 + k;
    if (!columns.has(key)) columns.set(key, { i, k, totals: emptySums(data.speciesCount) });
    addCell(columns.get(key).totals, data, index);
    minI = Math.min(minI, i);
    minK = Math.min(minK, k);
    maxI = Math.max(maxI, i);
    maxK = Math.max(maxK, k);
  }
  const width = columns.size ? maxI - minI + 1 : 0;
  const height = columns.size ? maxK - minK + 1 : 0;
  const values = [];
  for (const column of columns.values()) values.push({ column, result: estimate(data, column.totals, indexes) });
  // Colour by rank: a column's place among all columns with scanned systems,
  // so the ramp shows where the chosen species are richer than elsewhere.
  const ranked = values.filter(({ result }) => result.systems).sort((a, b) => a.result.creditsPerSystem - b.result.creditsPerSystem);
  const rank = new Map(ranked.map((item, index) => [item, ranked.length > 1 ? index / (ranked.length - 1) : 1]));
  const topTenth = ranked.length ? ranked[Math.floor((ranked.length - 1) * 0.9)].result.creditsPerSystem : 0;
  const buffer = Buffer.alloc(36 + width * height * 2);
  buffer.write('EDBIOX01', 0, 'ascii');
  buffer.writeUInt32LE(1, 8);
  buffer.writeUInt32LE(width, 12);
  buffer.writeUInt32LE(height, 16);
  buffer.writeFloatLE(columns.size ? minI * level - origin[0] : 0, 20);
  buffer.writeFloatLE(columns.size ? minK * level - origin[2] : 0, 24);
  buffer.writeFloatLE(level, 28);
  buffer.writeFloatLE(topTenth, 32);
  for (const item of values) {
    const { column, result } = item;
    const at = 36 + ((column.k - minK) * width + (column.i - minI)) * 2;
    buffer[at] = result.systems ? 1 + Math.round(rank.get(item) * 254) : 0;
    buffer[at + 1] = result.basis === 'complete'
      ? Math.min(255, Math.round(Math.log2(1 + result.completeSystems) * 28))
      : Math.min(96, Math.round(Math.log2(1 + result.mappedCandidates) * 12));
  }
  return buffer;
}

// Estimates for the boxel holding (x, y, z) at each level.
export function cellDetail(data, coords, keys = null) {
  const origin = data.meta.galaxyOrigin;
  const indexes = speciesIndexes(data, keys);
  const base = ['x', 'y', 'z'].map((axis, index) => Math.floor((coords[axis] + origin[index]) / data.cellLy));
  const levels = {};
  for (const level of LEVELS) levels[level] = { totals: emptySums(data.speciesCount) };
  for (let index = 0; index < data.count; index += 1) {
    const cell = cellAt(data, index);
    for (const level of LEVELS) {
      const factor = Math.round(level / data.cellLy);
      if (Math.floor(cell.cx / factor) === Math.floor(base[0] / factor)
        && Math.floor(cell.cy / factor) === Math.floor(base[1] / factor)
        && Math.floor(cell.cz / factor) === Math.floor(base[2] / factor)) {
        addCell(levels[level].totals, data, index);
      }
    }
  }
  const out = {};
  for (const level of LEVELS) {
    const factor = Math.round(level / data.cellLy);
    const min = base.map((value, index) => Math.floor(value / factor) * level - origin[index]);
    out[level] = { level, min: { x: min[0], y: min[1], z: min[2] }, ...estimate(data, levels[level].totals, indexes) };
  }
  return out;
}

// Galaxy-wide genus rate per species key, for per-body predictions.
export function speciesRates(meta) {
  return Object.fromEntries(meta.species.map((species) => [species.key, species.rate]));
}
