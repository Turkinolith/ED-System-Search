import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixtureRoot = path.join(root, '.tmp-journal-bodies');
const dataDir = path.join(fixtureRoot, 'data');
const journalDir = path.join(fixtureRoot, 'journals');
const journalPath = path.join(journalDir, 'Journal.2026-06-15T120000.01.log');
const systemAddress = '72057594037927937';
const port = 5192;

assert.ok(fixtureRoot.startsWith(root), 'Fixture cleanup must remain inside the project.');
rmSync(fixtureRoot, { recursive: true, force: true });
mkdirSync(dataDir, { recursive: true });
mkdirSync(journalDir, { recursive: true });

function event(value) {
  return `${JSON.stringify(value).replace(/"SystemAddress":"(\d+)"/, '"SystemAddress":$1')}\n`;
}

writeFileSync(journalPath, [
  event({
    timestamp: '2026-06-15T12:00:00Z',
    event: 'Location',
    StarSystem: 'Journal Fixture',
    SystemAddress: systemAddress,
    StarPos: [1, 2, 3],
    StarClass: 'A',
  }),
  event({
    timestamp: '2026-06-15T12:00:02Z',
    event: 'Scan',
    ScanType: 'AutoScan',
    BodyName: 'Journal Fixture A',
    BodyID: 0,
    SystemAddress: systemAddress,
    DistanceFromArrivalLS: 0,
    StarType: 'A',
    StellarMass: 1.05,
    Radius: 700000000,
    SurfaceTemperature: 5800,
  }),
  event({
    timestamp: '2026-06-15T12:00:30Z',
    event: 'Scan',
    ScanType: 'Detailed',
    StarSystem: 'Journal Fixture',
    BodyName: 'Journal Fixture B',
    BodyID: 1,
    SystemAddress: systemAddress,
    DistanceFromArrivalLS: 1800,
    StarType: 'TTS',
    StellarMass: 0.5,
  }),
  event({
    timestamp: '2026-06-15T12:01:00Z',
    event: 'Scan',
    ScanType: 'Detailed',
    BodyName: 'Journal Fixture A 1',
    BodyID: 2,
    SystemAddress: systemAddress,
    DistanceFromArrivalLS: 950,
    PlanetClass: 'Earthlike body',
    Atmosphere: 'thin ammonia atmosphere',
    Volcanism: 'minor water geysers volcanism',
    MassEM: 1.2,
    Radius: 6500000,
    SurfaceGravity: 10,
    SurfaceTemperature: 290,
    Landable: true,
    TerraformState: 'Terraformable',
    Materials: [{ Name: 'iron', Percent: 20.5 }],
    Rings: [{ Name: 'Journal Fixture A 1 A Ring', RingClass: 'eRingClass_Icy', InnerRad: 7000000, OuterRad: 9000000 }],
  }),
  event({
    timestamp: '2026-06-15T12:02:00Z',
    event: 'SAASignalsFound',
    BodyName: 'Journal Fixture A 1',
    BodyID: 2,
    SystemAddress: systemAddress,
    Signals: [{ Type: '$SAA_SignalType_Biological;', Type_Localised: 'Biological', Count: 3 }],
  }),
].join(''));

function run(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited ${code}\n${stdout}\n${stderr}`));
    });
  });
}

let server = null;
try {
  await run(process.execPath, ['scripts/import-journals.js', journalDir, '--all'], { EDSS_DATA_DIR: dataDir });
  const bodyPath = path.join(dataDir, 'journal-bodies.json');
  assert.ok(existsSync(bodyPath));
  let data = JSON.parse(readFileSync(bodyPath, 'utf8'));
  assert.equal(data.systemCount, 1);
  assert.equal(data.bodyCount, 3);
  assert.equal(data.systems[0].id64, systemAddress);
  assert.equal(data.systems[0].name, 'Journal Fixture');
  assert.equal(data.systems[0].bodies[2].atmosphereType, 'thin ammonia atmosphere');
  assert.equal(data.systems[0].bodies[2].signals.Biological.count, 3);
  assert.equal(data.systems[0].bodies[2].rings[0].type, 'Icy');
  const supplementalPath = path.join(dataDir, 'journal-systems.json');
  const initialSupplemental = JSON.parse(readFileSync(supplementalPath, 'utf8')).systems
    .find((system) => system.name === 'Journal Fixture');
  assert.equal(initialSupplemental.mainStar, 'A (Blue-White) Star');
  assert.equal(initialSupplemental.starClass, 'A');
  const originalIndex = initialSupplemental.index;

  appendFileSync(journalPath, event({
    timestamp: '2026-06-15T12:03:00Z',
    event: 'SAAScanComplete',
    BodyName: 'Journal Fixture A 1',
    BodyID: 2,
    SystemAddress: systemAddress,
    ProbesUsed: 4,
    EfficiencyTarget: 6,
  }));
  await run(process.execPath, ['scripts/import-journals.js', journalDir, '--latest', '20'], { EDSS_DATA_DIR: dataDir });
  data = JSON.parse(readFileSync(bodyPath, 'utf8'));
  assert.equal(data.bodyCount, 3);
  assert.equal(data.systems[0].bodies[2].mapped, true);
  assert.equal(data.systems[0].bodies[2].signals.Biological.count, 3);
  assert.equal(JSON.parse(readFileSync(supplementalPath, 'utf8')).systems
    .find((system) => system.name === 'Journal Fixture').mainStar, 'A (Blue-White) Star');

  appendFileSync(journalPath, event({
    timestamp: '2026-06-15T12:04:00Z',
    event: 'Location',
    StarSystem: 'Aardvark Fixture',
    SystemAddress: '1234',
    StarPos: [4, 5, 6],
    StarClass: 'K',
  }));
  await run(process.execPath, ['scripts/import-journals.js', journalDir, '--latest', '20'], { EDSS_DATA_DIR: dataDir });
  await run(process.execPath, ['scripts/import-journals.js', journalDir, '--latest', '20'], { EDSS_DATA_DIR: dataDir });
  const stableIndex = JSON.parse(readFileSync(supplementalPath, 'utf8')).systems
    .find((system) => system.name === 'Journal Fixture').index;
  assert.equal(stableIndex, originalIndex, 'Journal-only system indexes should remain stable across incremental scans.');
  writeFileSync(path.join(dataDir, 'systems.bin'), Buffer.alloc(0));
  mkdirSync(path.join(dataDir, 'suggest'), { recursive: true });

  server = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, EDSS_DATA_DIR: dataDir, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Fixture server did not start.')), 5000);
    server.stdout.on('data', (chunk) => {
      if (chunk.toString().includes(`localhost:${port}`)) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.on('error', reject);
  });
  const searchResponse = await fetch(`http://localhost:${port}/api/search?q=Journal%20Fixture&limit=12`);
  assert.equal(searchResponse.status, 200);
  const search = await searchResponse.json();
  const exact = search.results.find((result) => result.name === 'Journal Fixture');
  assert.ok(exact);
  const detailResponse = await fetch(`http://localhost:${port}/api/system?index=${exact.index}`);
  assert.equal(detailResponse.status, 200);
  assert.equal((await detailResponse.json()).name, 'Journal Fixture');
  const response = await fetch(`http://localhost:${port}/api/system-rich?id64=${systemAddress}&name=Journal%20Fixture`);
  assert.equal(response.status, 200);
  const rich = await response.json();
  assert.equal(rich.segment.kind, 'journal');
  assert.equal(rich.system.name, 'Journal Fixture');
  assert.equal(rich.system.bodies.length, 3);
  assert.equal(rich.system.bodies[2].mapped, true);
} finally {
  if (server) {
    server.kill();
    await new Promise((resolve) => server.once('exit', resolve));
  }
  rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log('Journal body integration test passed.');
