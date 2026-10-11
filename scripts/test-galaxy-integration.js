import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSuggestOverlayIndex } from './import-suggest-overlay-index.js';
import { buildPlaceIndex } from './place-index.js';
import { encodeRaster } from './build-region-raster.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixtureRoot = path.join(root, '.tmp-galaxy-integration');
const dataDir = path.join(fixtureRoot, 'data');
const sourcePath = path.join(fixtureRoot, 'galaxy.json.gz');
const importer = path.join(
  root,
  'native',
  'ed-data-importer',
  'target',
  'release',
  process.platform === 'win32' ? 'ed-data-importer.exe' : 'ed-data-importer'
);
const journalDir = path.join(fixtureRoot, 'journals');
const port = 5191;
const keepFixture = process.env.EDSS_KEEP_GALAXY_FIXTURE === '1';

assert.ok(fixtureRoot.startsWith(root), 'Fixture cleanup must remain inside the project.');
rmSync(fixtureRoot, { recursive: true, force: true });
mkdirSync(dataDir, { recursive: true });
assert.ok(existsSync(importer), `Release importer not found at ${importer}`);

const systems = [
  {
    id64: 100,
    name: 'Fixture Station',
    coords: { x: 1, y: 2, z: 3 },
    date: '2026-06-14T12:00:00Z',
    bodyCount: 2,
    population: 120000,
    security: 'High',
    primaryEconomy: 'High Tech',
    secondaryEconomy: 'Tourism',
    government: 'Democracy',
    stations: [{
      name: 'Fixture Port',
      type: 'Coriolis Starport',
      services: ['Market', 'Shipyard'],
      market: { commodities: [{ name: 'Gold' }] },
      shipyard: { ships: [{ name: 'Sidewinder' }] },
    }],
    bodies: [
      { id64: 101, bodyId: 0, name: 'Fixture Station A', type: 'Star', subType: 'G (White-Yellow) Star' },
      {
        id64: 102,
        bodyId: 1,
        name: 'Fixture Station A 1',
        type: 'Planet',
        subType: 'Earth-like world',
        atmosphereType: 'Thin Ammonia',
        volcanismType: 'Major Water Geysers',
        rings: [{ name: 'Fixture ring', type: 'Icy' }],
        terraformingState: 'Terraformable',
      },
    ],
  },
  {
    id64: 200,
    name: 'Fixture Green',
    coords: { x: 4, y: 5, z: 6 },
    date: '2026-06-13T12:00:00Z',
    bodyCount: 1,
    bodies: [{
      id64: 201,
      bodyId: 1,
      name: 'Fixture Green 1',
      type: 'Planet',
      subType: 'Water giant',
      surfaceTemperature: 158,
    }],
    stations: [],
  },
  {
    id64: 300,
    name: 'Fixture Signals',
    coords: { x: 7, y: 8, z: 9 },
    date: '2026-06-12T12:00:00Z',
    bodyCount: 1,
    bodies: [{
      id64: 301,
      bodyId: 1,
      name: 'Fixture Signals 1',
      type: 'Planet',
      subType: 'Icy body',
      isLandable: true,
      signals: { biological: { signals: 2 } },
    }],
    stations: [],
  },
  {
    id64: 400,
    name: 'Fixture Murder Binary',
    coords: { x: 10, y: 11, z: 12 },
    date: '2026-06-11T12:00:00Z',
    bodyCount: 2,
    bodies: [
      {
        id64: 401,
        bodyId: 0,
        name: 'Fixture Murder Binary A',
        type: 'Star',
        subType: 'G (White-Yellow) Star',
        distanceToArrival: 0,
      },
      {
        id64: 402,
        bodyId: 1,
        name: 'Fixture Murder Binary B',
        type: 'Star',
        subType: 'M (Red dwarf) Star',
        distanceToArrival: 8,
      },
    ],
    stations: [],
  },
];
// High-value bio: one DSS-mapped HMC with Stratum, one never mapped. It gets
// its own small rich import so the shared fixture's filter counts stay put.
const bioSystem = {
  id64: 900,
  name: 'Fixture Bio',
  coords: { x: 20, y: 0, z: 20 },
  date: '2026-06-10T12:00:00Z',
  bodyCount: 3,
  bodies: [
    { id64: 501, bodyId: 0, name: 'Fixture Bio A', type: 'Star', subType: 'K (Yellow-Orange) Star', mainStar: true, distanceToArrival: 0 },
    {
      id64: 502, bodyId: 1, name: 'Fixture Bio A 1', type: 'Planet', subType: 'High metal content world', isLandable: true,
      gravity: 0.31, surfaceTemperature: 220, surfacePressure: 0.003, atmosphereType: 'Thin Sulphur dioxide',
      volcanismType: 'No volcanism', distanceToArrival: 900, parents: [{ Star: 0 }],
      signals: { signals: { '$SAA_SignalType_Biological;': 1 }, genuses: ['$Codex_Ent_Stratum_Genus_Name;'] },
    },
    {
      id64: 503, bodyId: 2, name: 'Fixture Bio A 2', type: 'Planet', subType: 'High metal content world', isLandable: true,
      gravity: 0.35, surfaceTemperature: 240, surfacePressure: 0.004, atmosphereType: 'Thin Sulphur dioxide',
      volcanismType: 'No volcanism', distanceToArrival: 1400, parents: [{ Star: 0 }],
    },
  ],
  stations: [],
};
writeFileSync(sourcePath, gzipSync(`[\n${systems.map((system) => JSON.stringify(system)).join(',\n')}\n]\n`));

const systemRecords = Buffer.alloc(32 * systems.length);
const lodRecords = Buffer.alloc(20 * systems.length);
const nameParts = [];
const searchLines = [];
let nameOffset = 0;
for (const [index, system] of systems.entries()) {
  const nameBytes = Buffer.from(system.name, 'utf8');
  const systemOffset = index * 32;
  systemRecords.writeFloatLE(system.coords.x, systemOffset);
  systemRecords.writeFloatLE(system.coords.y, systemOffset + 4);
  systemRecords.writeFloatLE(system.coords.z, systemOffset + 8);
  systemRecords.writeUInt16LE(0, systemOffset + 12);
  systemRecords.writeUInt32LE(nameOffset, systemOffset + 16);
  systemRecords.writeUInt16LE(nameBytes.length, systemOffset + 20);
  systemRecords.writeBigUInt64LE(BigInt(system.id64), systemOffset + 24);
  nameParts.push(nameBytes);
  nameOffset += nameBytes.length;
  searchLines.push(`${system.name.toLowerCase()}\t${system.name}\t${index}\t0\t${system.coords.x}\t${system.coords.y}\t${system.coords.z}`);

  const lodOffset = index * 20;
  lodRecords.writeFloatLE(system.coords.x, lodOffset);
  lodRecords.writeFloatLE(system.coords.y, lodOffset + 4);
  lodRecords.writeFloatLE(system.coords.z, lodOffset + 8);
  lodRecords.writeUInt16LE(0, lodOffset + 12);
  lodRecords.writeUInt32LE(index, lodOffset + 16);
}
writeFileSync(path.join(dataDir, 'systems.bin'), systemRecords);
// LOD 0 only holds a coarse subset so rich-filter requests must hop to the
// deeper LOD 1 to see every matching system.
const coarseLodCount = 2;
writeFileSync(path.join(dataDir, 'systems-lod-0.bin'), lodRecords.subarray(0, coarseLodCount * 20));
writeFileSync(path.join(dataDir, 'systems-lod-1.bin'), lodRecords);
writeFileSync(path.join(dataDir, 'systems-names.txt'), Buffer.concat(nameParts));
writeFileSync(path.join(dataDir, 'systems-search.tsv'), `${searchLines.join('\n')}\n`);
mkdirSync(path.join(dataDir, 'suggest'), { recursive: true });
writeFileSync(path.join(dataDir, 'suggest', 'fix.tsv'), `${searchLines.join('\n')}\n`);
writeFileSync(path.join(dataDir, 'suggest-overlay.tsv'), [
  searchLines[1],
  'fix marker fixture hidden\tFix Marker Fixture Hidden\t99\t0\t40\t50\t60',
].join('\n') + '\n');
writeFileSync(path.join(dataDir, 'systems-meta.json'), JSON.stringify({
  count: systems.length,
  importedCount: systems.length,
  importedAt: new Date().toISOString(),
  typeNames: ['Fixture star'],
  lodLevels: [
    { level: 0, count: coarseLodCount, file: 'systems-lod-0.bin' },
    { level: 1, count: systems.length, file: 'systems-lod-1.bin' },
  ],
  sol: { coords: { x: 0, y: 0, z: 0 } },
}));
writeFileSync(path.join(dataDir, 'places.json'), JSON.stringify({
  sourceUrl: 'https://edastro.com/gec/search?catID=9',
  places: [{
    name: 'Fixture Green Giant',
    systemName: 'Fixture Green',
    type: 'Green Gas Giants',
    coords: { x: 4, y: 5, z: 6 },
  }],
}));

const imported = spawnSync(importer, [
  'galaxy',
  '--source', sourcePath,
  '--data-dir', dataDir,
  '--threads', '2',
  '--batch-size', '2',
], { cwd: root, encoding: 'utf8' });
assert.equal(imported.status, 0, `${imported.stdout}\n${imported.stderr}`);

const greenGasGiants = spawnSync(importer, [
  'green-gas-giants',
  '--data-dir', dataDir,
  '--threads', '2',
  '--batch-size', '2',
], { cwd: root, encoding: 'utf8' });
assert.equal(greenGasGiants.status, 0, `${greenGasGiants.stdout}\n${greenGasGiants.stderr}`);
const greenGasGiantDatabase = JSON.parse(readFileSync(path.join(dataDir, 'green-gas-giants.json'), 'utf8'));
assert.equal(greenGasGiantDatabase.knownSystemCount, 1);
assert.equal(greenGasGiantDatabase.highCandidateCount, 1);
assert.equal(greenGasGiantDatabase.systems[0].name, 'Fixture Green');
assert.equal(greenGasGiantDatabase.systems[0].known, true);
assert.equal(greenGasGiantDatabase.systems[0].bodies[0].surfaceTemperature, 158);

const spatial = spawnSync(importer, [
  'spatial-index',
  '--data-dir', dataDir,
  '--threads', '2',
], { cwd: root, encoding: 'utf8' });
assert.equal(spatial.status, 0, `${spatial.stdout}\n${spatial.stderr}`);
const spatialMeta = JSON.parse(readFileSync(path.join(dataDir, 'systems-spatial-meta.json'), 'utf8'));
assert.equal(spatialMeta.count, systems.length);
assert.equal(spatialMeta.cellSizeLy, 100);

const analyzed = spawnSync(importer, [
  'murder-binaries',
  '--data-dir', dataDir,
  '--threads', '2',
  '--batch-size', '2',
], { cwd: root, encoding: 'utf8' });
assert.equal(analyzed.status, 0, `${analyzed.stdout}\n${analyzed.stderr}`);

const murderMeta = JSON.parse(readFileSync(path.join(dataDir, 'murder-binaries-meta.json'), 'utf8'));
const murderData = readFileSync(path.join(dataDir, 'murder-binaries.bin'));
const murderNames = readFileSync(path.join(dataDir, 'murder-binaries-names.txt'), 'utf8');
assert.equal(murderMeta.count, 1);
assert.equal(murderMeta.recordBytes, 32);
assert.equal(murderData.subarray(0, 8).toString('ascii'), 'EDMBIN01');
assert.equal(murderData.byteLength, 64);
assert.equal(murderNames, 'Fixture Murder Binary');

const bioDataDir = path.join(fixtureRoot, 'bio-data');
const bioSourcePath = path.join(fixtureRoot, 'bio-galaxy.json.gz');
mkdirSync(bioDataDir, { recursive: true });
writeFileSync(bioSourcePath, gzipSync(`[\n${JSON.stringify(bioSystem)}\n]\n`));
const bioImported = spawnSync(importer, ['galaxy', '--source', bioSourcePath, '--data-dir', bioDataDir, '--threads', '2', '--batch-size', '2'], { cwd: root, encoding: 'utf8' });
assert.equal(bioImported.status, 0, `${bioImported.stdout}\n${bioImported.stderr}`);
const bioFixture = JSON.parse(readFileSync(path.join(root, 'scripts', 'fixtures', 'bio-cases.json'), 'utf8'));
// One raster cell covering the fixtures: every system is in region 18.
const bioRaster = encodeRaster({ labels: new Uint8Array([18]), width: 1, height: 1, x0: 0, z0: 0, cell: 1e6 }, 1);
for (const dir of [bioDataDir, dataDir]) {
  writeFileSync(path.join(dir, 'bio-model.json'), JSON.stringify(bioFixture.model));
  writeFileSync(path.join(dir, 'region-raster.bin'), bioRaster);
}
const bioRun = spawnSync(importer, [
  'bio-targets',
  '--data-dir', bioDataDir,
  '--threads', '2',
  '--batch-size', '2',
], { cwd: root, encoding: 'utf8' });
assert.equal(bioRun.status, 0, `${bioRun.stdout}\n${bioRun.stderr}`);
for (const file of ['bio-targets.bin', 'bio-targets-meta.json']) copyFileSync(path.join(bioDataDir, file), path.join(dataDir, file));
const bioMeta = JSON.parse(readFileSync(path.join(dataDir, 'bio-targets-meta.json'), 'utf8'));
assert.equal(bioMeta.version, 3);
assert.equal(bioMeta.completeSystems, 1, 'the fixture records all three of its counted bodies');
assert.equal(bioMeta.cellCount, 1);
assert.equal(bioMeta.eligibleBodies, 2);
assert.equal(bioMeta.mappedBodies, 1);
const tectonicas = bioMeta.species.find((item) => item.name === 'Stratum Tectonicas');
assert.deepEqual([tectonicas.found, tectonicas.mapped, tectonicas.unmapped, tectonicas.rate], [1, 1, 1, 1]);
assert.equal(readFileSync(path.join(dataDir, 'bio-targets.bin')).subarray(0, 8).toString('ascii'), 'EDBIOT01');

mkdirSync(journalDir, { recursive: true });
writeFileSync(path.join(journalDir, 'Journal.2026-10-10T120000.01.log'), [
  { timestamp: '2026-10-10T12:00:00Z', event: 'Fileheader' },
  { timestamp: '2026-10-10T12:00:01Z', event: 'Location', SystemAddress: 900, StarSystem: 'Fixture Bio', StarPos: [20, 0, 20] },
].map((event) => JSON.stringify(event)).join('\n') + '\n');

const manifestPath = path.join(dataDir, 'galaxy', 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
assert.equal(manifest.mapFilters.recordBytes, 40);
assert.equal(manifest.mapFilters.lodLevels[0].count, coarseLodCount);
assert.equal(manifest.mapFilters.lodLevels[1].count, systems.length);
assert.equal(readFileSync(path.join(dataDir, 'galaxy', 'systems-lod-0-rich.bin')).byteLength, coarseLodCount * 40);
assert.equal(readFileSync(path.join(dataDir, 'galaxy', 'systems-lod-1-rich.bin')).byteLength, systems.length * 40);

const appendedSystemIndex = systems.length;
const appendedRecord = Buffer.alloc(32);
appendedRecord.writeFloatLE(5000, 0);
appendedRecord.writeFloatLE(5000, 4);
appendedRecord.writeFloatLE(5000, 8);
appendedRecord.writeUInt16LE(0, 12);
appendedRecord.writeBigUInt64LE(500n, 24);
writeFileSync(path.join(dataDir, 'systems.bin'), Buffer.concat([systemRecords, appendedRecord]));
const appendedLodRecord = Buffer.alloc(20);
appendedLodRecord.writeFloatLE(5000, 0);
appendedLodRecord.writeFloatLE(5000, 4);
appendedLodRecord.writeFloatLE(5000, 8);
appendedLodRecord.writeUInt16LE(0, 12);
appendedLodRecord.writeUInt32LE(appendedSystemIndex, 16);
writeFileSync(path.join(dataDir, 'systems-lod-1.bin'), Buffer.concat([lodRecords, appendedLodRecord]));
writeFileSync(path.join(dataDir, 'systems-meta.json'), JSON.stringify({
  count: systems.length + 1,
  importedCount: systems.length + 1,
  importedAt: new Date().toISOString(),
  typeNames: ['Fixture star'],
  lodLevels: [
    { level: 0, count: coarseLodCount, file: 'systems-lod-0.bin' },
    { level: 1, count: systems.length + 1, file: 'systems-lod-1.bin' },
  ],
  sol: { coords: { x: 0, y: 0, z: 0 } },
}));
const rebuiltFilters = spawnSync(importer, [
  'galaxy-filters',
  '--data-dir', dataDir,
  '--threads', '2',
], { cwd: root, encoding: 'utf8' });
assert.equal(rebuiltFilters.status, 0, `${rebuiltFilters.stdout}\n${rebuiltFilters.stderr}`);
const rebuiltManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
assert.equal(rebuiltManifest.mapFilters.lodLevels[0].count, coarseLodCount);
assert.equal(rebuiltManifest.mapFilters.lodLevels[1].count, systems.length + 1);
assert.equal(readFileSync(path.join(dataDir, 'galaxy', 'systems-lod-1-rich.bin')).byteLength, (systems.length + 1) * 40);

const suggestOverlayIndex = await buildSuggestOverlayIndex(dataDir);
assert.equal(suggestOverlayIndex.count, 2);
assert.equal(suggestOverlayIndex.bucketCount, 1);
const placeIndex = await buildPlaceIndex(dataDir);
assert.equal(placeIndex.summary.categoryDetails.some((entry) => entry.category === 'Green Gas Giants' && entry.file), true);

const server = spawn(process.execPath, ['server.js'], {
  cwd: root,
  env: { ...process.env, EDSS_DATA_DIR: dataDir, EDSS_JOURNAL_DIR: journalDir, EDSS_CONFIG: path.join(fixtureRoot, 'config.local.json'), PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOutput = '';
server.stdout.on('data', (chunk) => { serverOutput += chunk; });
server.stderr.on('data', (chunk) => { serverOutput += chunk; });

try {
  const startedAt = Date.now();
  while (!serverOutput.includes(`localhost:${port}`)) {
    if (server.exitCode !== null) throw new Error(`Fixture server exited early:\n${serverOutput}`);
    if (Date.now() - startedAt > 10000) throw new Error(`Fixture server did not start:\n${serverOutput}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  async function pointIndexes(query) {
    const response = await fetch(`http://localhost:${port}/api/points?types=0&limit=100&${query}`);
    if (!response.ok) throw new Error(`Point request failed (${response.status}): ${await response.text()}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const indexes = [];
    for (let offset = 0; offset < bytes.length; offset += 20) indexes.push(bytes.readUInt32LE(offset + 16));
    return indexes;
  }

  const stationResponse = await fetch(`http://localhost:${port}/api/points?types=0&limit=100&hasStations=1`);
  assert.equal(stationResponse.status, 200);
  assert.equal(stationResponse.headers.get('x-lod-level'), '1', 'Rich filters should scan the deepest affordable LOD.');

  assert.deepEqual(await pointIndexes('hasStations=1'), [0]);
  assert.deepEqual(await pointIndexes('minBodies=2'), [0, 3]);
  assert.deepEqual(await pointIndexes('landable=1'), [2]);
  assert.deepEqual(await pointIndexes('signals=1'), [2]);
  assert.deepEqual(await pointIndexes('richData=1'), [0, 1, 2, 3]);
  assert.deepEqual(await pointIndexes('bodyType=earthLike'), [0]);
  assert.deepEqual(await pointIndexes('atmosphere=thinAmmonia'), [0]);
  assert.deepEqual(await pointIndexes('ringType=icy'), [0]);
  assert.deepEqual(await pointIndexes('volcanism=water'), [0]);
  assert.deepEqual(await pointIndexes('economy=highTech'), [0]);
  assert.deepEqual(await pointIndexes('security=high'), [0]);
  assert.deepEqual(await pointIndexes('government=democracy'), [0]);
  assert.deepEqual(await pointIndexes('economy=none'), [1, 2, 3, 4], '"none" should select systems without an economy, including ones with no rich record.');
  assert.deepEqual(await pointIndexes('security=high,none'), [0, 1, 2, 3, 4]);

  // Colour-by packs the category (1-based index in color-modes.js) into flag bits 12..15.
  async function pointCategories(pathAndQuery) {
    const response = await fetch(`http://localhost:${port}${pathAndQuery}`);
    if (!response.ok) throw new Error(`Point request failed (${response.status}): ${await response.text()}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const categories = new Map();
    for (let offset = 0; offset < bytes.length; offset += 20) {
      categories.set(bytes.readUInt32LE(offset + 16), bytes.readUInt16LE(offset + 14) >> 12);
    }
    return { colorBy: response.headers.get('x-color-by'), categories };
  }
  const securityColors = await pointCategories('/api/points?types=0&limit=100&colorBy=security');
  assert.equal(securityColors.colorBy, 'security');
  assert.deepEqual([...securityColors.categories.entries()].sort((a, b) => a[0] - b[0]), [[0, 4], [1, 0], [2, 0], [3, 0], [4, 0]]);
  const filteredColors = await pointCategories('/api/points?types=0&limit=100&colorBy=economy&economy=highTech');
  // High Tech + Tourism: two-economy systems take the less common economy (Tourism, 7).
  assert.deepEqual([...filteredColors.categories.entries()], [[0, 7]], 'Colour-by should combine with the existing filters.');
  const localColors = await pointCategories('/api/local-points?x=10&y=11&z=12&types=0&limit=1000&colorBy=government');
  assert.equal(localColors.colorBy, 'government');
  assert.equal(localColors.categories.get(0), 6, 'The local sphere should be coloured too.');
  assert.equal(localColors.categories.get(1), 0);

  const staleManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  staleManifest.mapFilters.lodLevels[0].count += 1;
  writeFileSync(manifestPath, JSON.stringify(staleManifest, null, 2));
  const future = new Date(Date.now() + 2000);
  utimesSync(manifestPath, future, future);
  const staleFilterResponse = await fetch(`http://localhost:${port}/api/points?types=0&limit=100&hasStations=1`);
  assert.equal(staleFilterResponse.status, 409);
  assert.match(await staleFilterResponse.text(), /map filters are out of date/i);

  const richResponse = await fetch(`http://localhost:${port}/api/system-rich?id64=100`);
  assert.equal(richResponse.status, 200);
  const rich = await richResponse.json();
  assert.equal(rich.system.name, 'Fixture Station');
  assert.equal(rich.system.bodies.length, 2);
  assert.equal(rich.summary.stationCount, 1);

  const prefixSearchResponse = await fetch(`http://localhost:${port}/api/search?q=fixture%20green&limit=12`);
  assert.equal(prefixSearchResponse.status, 200);
  const prefixSearch = await prefixSearchResponse.json();
  assert.equal(prefixSearch.results[0].name, 'Fixture Green');
  assert.equal(prefixSearch.results[0].matchType, 'startsWith');
  assert.equal(prefixSearch.results[0].source, 'delta-overlay', 'The delta overlay should retain precedence over the base shard.');

  const containsSearchResponse = await fetch(`http://localhost:${port}/api/search?q=fixture%20hidden&limit=12`);
  const containsSearch = await containsSearchResponse.json();
  assert.equal(containsSearch.results[0].name, 'Fix Marker Fixture Hidden');
  assert.equal(containsSearch.results[0].matchType, 'contains');

  const fuzzySearchResponse = await fetch(`http://localhost:${port}/api/search?q=fixgrn&limit=12`);
  const fuzzySearch = await fuzzySearchResponse.json();
  assert.equal(fuzzySearch.results.some((result) => result.name === 'Fixture Green' && result.matchType === 'fuzzy'), true);

  const placesSummaryResponse = await fetch(`http://localhost:${port}/api/places-summary`);
  assert.equal(placesSummaryResponse.status, 200);
  const placesSummary = await placesSummaryResponse.json();
  assert.equal(Array.isArray(placesSummary.places), false, 'The startup summary must not include the full place array.');
  assert.equal(placesSummary.categoryDetails.some((entry) => entry.category === 'Green Gas Giants' && entry.count === 1), true);

  const selectedPlacesResponse = await fetch(`http://localhost:${port}/api/places?category=${encodeURIComponent('Green Gas Giants')}`);
  assert.equal(selectedPlacesResponse.status, 200);
  const selectedPlaces = await selectedPlacesResponse.json();
  assert.equal(selectedPlaces.places.length, 1);
  assert.equal(selectedPlaces.places[0].category, 'Green Gas Giants');

  const placesResponse = await fetch(`http://localhost:${port}/api/places`);
  assert.equal(placesResponse.status, 200);
  const places = await placesResponse.json();
  assert.equal(places.categories['Murder Binaries'], 1);
  assert.equal(places.murderBinaries.count, 1);
  assert.equal(places.greenGasGiants.knownSystemCount, 1);
  assert.equal(places.greenGasGiants.highCandidateCount, 1);
  assert.equal(places.places.some((place) => place.category === 'Green Gas Giants' && place.name === 'Fixture Green'), true);
  assert.equal(places.places.some((place) => place.category === 'Murder Binaries'), false);

  const murderResponse = await fetch(`http://localhost:${port}/api/murder-binaries?x=10&y=11&z=12&limit=50`);
  assert.equal(murderResponse.status, 200);
  const murder = await murderResponse.json();
  assert.equal(murder.count, 1);
  assert.equal(murder.places[0].name, 'Fixture Murder Binary');
  assert.equal(murder.places[0].details.closestDistanceLs, 8);
  assert.equal(murder.places[0].defaultEnabled, false);

  const localResponse = await fetch(`http://localhost:${port}/api/local-points?x=10&y=11&z=12&types=0&limit=1000`);
  assert.equal(localResponse.status, 200);
  const localBytes = Buffer.from(await localResponse.arrayBuffer());
  assert.equal(localBytes.byteLength, systems.length * 20);
  assert.equal(localResponse.headers.get('x-local-radius'), '1000');
  assert.equal(localResponse.headers.get('x-local-area-count'), String(systems.length));
  assert.equal(localResponse.headers.get('x-local-area-complete'), '1');
  const bioTextureResponse = await fetch(`http://localhost:${port}/api/bio-targets?level=640`);
  assert.equal(bioTextureResponse.status, 200);
  const bioTexture = Buffer.from(await bioTextureResponse.arrayBuffer());
  assert.equal(bioTexture.subarray(0, 8).toString('ascii'), 'EDBIOX01');
  assert.equal(bioTexture.readUInt32LE(12) * bioTexture.readUInt32LE(16), 1);
  assert.ok(bioTexture[36] > 0, 'the fixture boxel has a value');
  const bandTexture = async (query) => Buffer.from(await (await fetch(`http://localhost:${port}/api/bio-targets?level=640&${query}`)).arrayBuffer());
  assert.ok((await bandTexture('band=1&y=0'))[36] > 0, 'the fixture system sits in the 320 ly layer at y = 0');
  assert.equal((await bandTexture('band=3&y=5000')).readUInt32LE(12), 0, 'no scanned systems that high');
  assert.equal((await fetch(`http://localhost:${port}/api/bio-targets?level=640&band=2&y=0`)).status, 400);

  const bioCellResponse = await fetch(`http://localhost:${port}/api/bio-targets/cell?x=20&y=0&z=20`);
  const bioCell = await bioCellResponse.json();
  assert.equal(bioCell.available, true);
  const boxelTop = bioCell.levels[320].species[0];
  assert.equal(boxelTop.name, 'Stratum Tectonicas');
  assert.equal(boxelTop.finds, 2, 'one mapped find plus the unmapped twin at the full rate');
  assert.equal(bioCell.levels[320].systems, 1);
  assert.equal(bioCell.levels[320].completeSystems, 1);
  assert.equal(bioCell.levels[320].basis, 'all', 'one complete system is too few to judge by');

  const bioModelResponse = await fetch(`http://localhost:${port}/api/bio-model`);
  const bioModel = await bioModelResponse.json();
  assert.equal(bioModel.model.genera.length, 3);
  assert.equal(bioModel.rates['$Codex_Ent_Stratum_07_Name;'], 1);

  const richRegion = await (await fetch(`http://localhost:${port}/api/system-rich?id64=100`)).json();
  assert.equal(richRegion.region, 18);

  const liveController = new AbortController();
  const liveResponse = await fetch(`http://localhost:${port}/api/live`, { signal: liveController.signal });
  assert.equal(liveResponse.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  const liveReader = liveResponse.body.getReader();
  let liveText = '';
  while (!liveText.includes('event: snapshot')) {
    const { value, done } = await liveReader.read();
    if (done) break;
    liveText += Buffer.from(value).toString('utf8');
  }
  liveController.abort();
  assert.ok(liveText.includes('"systemName":"Fixture Bio"'), liveText);
  assert.ok(liveText.includes('"region":18'), liveText);
} finally {
  server.kill();
  await new Promise((resolve) => server.once('exit', resolve));
  if (!keepFixture) rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log('Galaxy rich-data integration test passed.');
