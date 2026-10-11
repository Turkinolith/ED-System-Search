// Rebuilds a top-down raster of codex region IDs from data/region-map-vectors.json,
// so region lookups work without the original regionMAP.csv.
//
// The vectors hold the 10 ly region boundaries as edges with the two regions on
// either side, but not which side is which. The grid is split into pieces along
// every edge; each edge around a piece names that piece's region as one of its
// pair, so the region named most often around a piece is its label. Each
// region's cell count must then match the sample count recorded with the vectors.
//
// Output (little-endian): data/region-raster.bin
//   0  8 bytes  ASCII "EDREGR01"
//   8  u32      version (1)
//   12 u32      width (x cells)
//   16 u32      height (z cells)
//   20 f32      x of the first cell centre
//   24 f32      z of the first cell centre
//   28 f32      cell size in ly
//   32 u8[]     region ID per cell, rows of increasing z (0 = outside every region)
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileAtomic } from './atomic-file.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
const vectorsPath = path.join(dataDir, 'region-map-vectors.json');
const outPath = path.join(dataDir, 'region-raster.bin');
const SOURCE_CELL = 10;
const OUTPUT_STEP = 2; // keep every 2nd sample: 20 ly cells

export function fillRegions(vectors) {
  const [minEdgeX, minEdgeZ, maxEdgeX, maxEdgeZ] = vectors.bounds;
  const x0 = minEdgeX + SOURCE_CELL / 2;
  const z0 = minEdgeZ + SOURCE_CELL / 2;
  const width = Math.round((maxEdgeX - minEdgeX) / SOURCE_CELL);
  const height = Math.round((maxEdgeZ - minEdgeZ) / SOURCE_CELL);
  const cellIndex = (i, j) => j * width + i;

  // walls: key = cell * 2 + (0 = edge to +x neighbour, 1 = edge to +z neighbour)
  const walls = new Map();
  for (const [xa, za, xb, zb, a, b] of vectors.boundaries) {
    const pair = (a << 8) | b;
    if (xa === xb) {
      const i = Math.round((xa - SOURCE_CELL / 2 - x0) / SOURCE_CELL);
      for (let z = Math.min(za, zb) + SOURCE_CELL / 2; z < Math.max(za, zb); z += SOURCE_CELL) {
        const j = Math.round((z - z0) / SOURCE_CELL);
        if (i >= 0 && i + 1 < width && j >= 0 && j < height) walls.set(cellIndex(i, j) * 2, pair);
      }
    } else {
      const j = Math.round((za - SOURCE_CELL / 2 - z0) / SOURCE_CELL);
      for (let x = Math.min(xa, xb) + SOURCE_CELL / 2; x < Math.max(xa, xb); x += SOURCE_CELL) {
        const i = Math.round((x - x0) / SOURCE_CELL);
        if (i >= 0 && i < width && j >= 0 && j + 1 < height) walls.set(cellIndex(i, j) * 2 + 1, pair);
      }
    }
  }

  // Pieces: connected cells that no edge separates.
  const piece = new Int32Array(width * height).fill(-1);
  const queue = new Int32Array(width * height);
  let pieceCount = 0;
  for (let seed = 0; seed < piece.length; seed += 1) {
    if (piece[seed] !== -1) continue;
    const id = pieceCount++;
    let head = 0;
    let tail = 0;
    piece[seed] = id;
    queue[tail++] = seed;
    const visit = (to, wallKey) => {
      if (piece[to] !== -1 || walls.has(wallKey)) return;
      piece[to] = id;
      queue[tail++] = to;
    };
    while (head < tail) {
      const cell = queue[head++];
      const i = cell % width;
      const j = (cell - i) / width;
      if (i + 1 < width) visit(cell + 1, cell * 2);
      if (i > 0) visit(cell - 1, (cell - 1) * 2);
      if (j + 1 < height) visit(cell + width, cell * 2 + 1);
      if (j > 0) visit(cell - width, (cell - width) * 2 + 1);
    }
  }

  // Votes: every edge votes for both of its regions on the pieces either side.
  const votes = Array.from({ length: pieceCount }, () => new Map());
  const vote = (cell, pair) => {
    const tally = votes[piece[cell]];
    for (const region of [pair >> 8, pair & 0xff]) tally.set(region, (tally.get(region) ?? 0) + 1);
  };
  for (const [key, pair] of walls) {
    const cell = key >> 1;
    vote(cell, pair);
    vote((key & 1) ? cell + width : cell + 1, pair);
  }
  // A tie (e.g. two regions that only border each other) goes to the region
  // whose label point lies in the piece.
  const labelPiece = new Map();
  for (const region of vectors.regions) {
    const i = Math.round((region.label[0] - x0) / SOURCE_CELL);
    const j = Math.round((region.label[1] - z0) / SOURCE_CELL);
    if (i >= 0 && i < width && j >= 0 && j < height) labelPiece.set(region.id, piece[cellIndex(i, j)]);
  }
  const pieceLabel = new Uint8Array(pieceCount);
  for (let id = 0; id < pieceCount; id += 1) {
    let best = 0;
    let bestVotes = 0;
    for (const [region, count] of votes[id]) {
      const tieWin = count === bestVotes && labelPiece.get(region) === id && labelPiece.get(best) !== id;
      if (count > bestVotes || tieWin) {
        best = region;
        bestVotes = count;
      }
    }
    pieceLabel[id] = best;
  }
  const labels = new Uint8Array(width * height);
  for (let cell = 0; cell < labels.length; cell += 1) labels[cell] = pieceLabel[piece[cell]];
  return { labels, width, height, x0, z0, cell: SOURCE_CELL, pieces: pieceCount };
}

export function checkRegionCounts(fill, regions) {
  const counts = new Map();
  for (const id of fill.labels) counts.set(id, (counts.get(id) ?? 0) + 1);
  return regions.map((region) => ({
    id: region.id,
    name: region.name,
    expected: region.sampleCount,
    actual: counts.get(region.id) ?? 0,
  }));
}

export function encodeRaster(fill, step = OUTPUT_STEP) {
  const width = Math.ceil(fill.width / step);
  const height = Math.ceil(fill.height / step);
  const buffer = Buffer.alloc(32 + width * height);
  buffer.write('EDREGR01', 0, 'ascii');
  buffer.writeUInt32LE(1, 8);
  buffer.writeUInt32LE(width, 12);
  buffer.writeUInt32LE(height, 16);
  buffer.writeFloatLE(fill.x0, 20);
  buffer.writeFloatLE(fill.z0, 24);
  buffer.writeFloatLE(fill.cell * step, 28);
  for (let j = 0; j < height; j += 1) {
    for (let i = 0; i < width; i += 1) {
      buffer[32 + j * width + i] = fill.labels[(j * step) * fill.width + i * step];
    }
  }
  return buffer;
}

export async function buildRegionRaster() {
  const vectors = JSON.parse(await fs.readFile(vectorsPath, 'utf8'));
  const fill = fillRegions(vectors);
  const checks = checkRegionCounts(fill, vectors.regions);
  const mismatched = checks.filter((check) => check.actual !== check.expected);
  for (const check of mismatched) {
    console.warn(`Region ${check.id} ${check.name}: ${check.actual} cells, expected ${check.expected}`);
  }
  const worst = Math.max(0, ...checks.map((check) => Math.abs(check.actual - check.expected) / check.expected));
  if (worst > 0.01) throw new Error(`Region raster self-check failed (worst region off by ${(worst * 100).toFixed(2)}%).`);
  const raster = encodeRaster(fill);
  await writeFileAtomic(outPath, raster);
  console.log(`Region raster written: ${raster.readUInt32LE(12)} x ${raster.readUInt32LE(16)} cells of ${raster.readFloatLE(28)} ly, ${checks.length - mismatched.length}/${checks.length} regions exact.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildRegionRaster().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
