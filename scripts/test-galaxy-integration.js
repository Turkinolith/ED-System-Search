import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
    name: 'Fixture Empty',
    coords: { x: 4, y: 5, z: 6 },
    date: '2026-06-13T12:00:00Z',
    bodyCount: 0,
    bodies: [],
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
writeFileSync(path.join(dataDir, 'systems-lod-0.bin'), lodRecords);
writeFileSync(path.join(dataDir, 'systems-names.txt'), Buffer.concat(nameParts));
writeFileSync(path.join(dataDir, 'systems-search.tsv'), `${searchLines.join('\n')}\n`);
mkdirSync(path.join(dataDir, 'suggest'), { recursive: true });
writeFileSync(path.join(dataDir, 'suggest', 'fix.tsv'), `${searchLines.join('\n')}\n`);
writeFileSync(path.join(dataDir, 'systems-meta.json'), JSON.stringify({
  count: systems.length,
  importedCount: systems.length,
  importedAt: new Date().toISOString(),
  typeNames: ['Fixture star'],
  lodLevels: [{ level: 0, count: systems.length, file: 'systems-lod-0.bin' }],
  sol: { coords: { x: 0, y: 0, z: 0 } },
}));

const imported = spawnSync(importer, [
  'galaxy',
  '--source', sourcePath,
  '--data-dir', dataDir,
  '--threads', '2',
  '--batch-size', '2',
], { cwd: root, encoding: 'utf8' });
assert.equal(imported.status, 0, `${imported.stdout}\n${imported.stderr}`);

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

const manifest = JSON.parse(readFileSync(path.join(dataDir, 'galaxy', 'manifest.json'), 'utf8'));
assert.equal(manifest.mapFilters.recordBytes, 40);
assert.equal(manifest.mapFilters.lodLevels[0].count, systems.length);
assert.equal(readFileSync(path.join(dataDir, 'galaxy', 'systems-lod-0-rich.bin')).byteLength, systems.length * 40);

const server = spawn(process.execPath, ['server.js'], {
  cwd: root,
  env: { ...process.env, EDSS_DATA_DIR: dataDir, PORT: String(port) },
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

  const richResponse = await fetch(`http://localhost:${port}/api/system-rich?id64=100`);
  assert.equal(richResponse.status, 200);
  const rich = await richResponse.json();
  assert.equal(rich.system.name, 'Fixture Station');
  assert.equal(rich.system.bodies.length, 2);
  assert.equal(rich.summary.stationCount, 1);

  const placesResponse = await fetch(`http://localhost:${port}/api/places`);
  assert.equal(placesResponse.status, 200);
  const places = await placesResponse.json();
  assert.equal(places.categories['Murder Binaries'], 1);
  assert.equal(places.murderBinaries.count, 1);
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
} finally {
  server.kill();
  await new Promise((resolve) => server.once('exit', resolve));
  if (!keepFixture) rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log('Galaxy rich-data integration test passed.');
