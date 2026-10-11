import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JournalLive, LiveJournalState, newestJournalName } from './journal-live.js';

const line = (event) => `${JSON.stringify({ timestamp: '2026-10-10T12:00:00Z', ...event })}\n`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(check, label, timeoutMs = 3000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await wait(20);
  }
}

// Newest journal by name, ignoring other files.
assert.equal(newestJournalName(['Status.json', 'Journal.2026-01-01T000000.01.log', 'Journal.2026-02-01T000000.01.log']), 'Journal.2026-02-01T000000.01.log');
assert.equal(newestJournalName(['Cargo.json']), null);

// State: events outside the current system are ignored; a jump clears bodies.
const state = new LiveJournalState({ regionAt: (x, z) => (x === 10 && z === 30 ? 18 : null) });
assert.equal(state.apply({ event: 'Scan', SystemAddress: 1, BodyID: 2, PlanetClass: 'Rocky body' }), null);
assert.equal(state.apply({ event: 'FSDJump', SystemAddress: 1, StarSystem: 'Alpha', StarPos: [10, 20, 30] }).current.region, 18);
assert.equal(state.apply({ event: 'Scan', SystemAddress: 1, BodyID: 0, StarType: 'K', DistanceFromArrivalLS: 0 }).type, 'star');
state.apply({ event: 'Scan', SystemAddress: 1, BodyID: 2, BodyName: 'Alpha 1', PlanetClass: 'Rocky body', Landable: true });
state.apply({ event: 'FSSBodySignals', SystemAddress: 1, BodyID: 2, Signals: [{ Type: '$SAA_SignalType_Biological;', Count: 2 }] });
state.apply({ event: 'SAASignalsFound', SystemAddress: 1, BodyID: 2, Signals: [{ Type: '$SAA_SignalType_Biological;', Count: 2 }], Genuses: [{ Genus: '$Codex_Ent_Stratum_Genus_Name;' }] });
const organic = state.apply({ event: 'ScanOrganic', SystemAddress: 1, Body: 2, ScanType: 'Log', Genus: '$Codex_Ent_Stratum_Genus_Name;', Species_Localised: 'Stratum Tectonicas' });
assert.equal(organic.organic.species, 'Stratum Tectonicas');
const snapshot = state.snapshot();
assert.equal(snapshot.stars.length, 1);
assert.deepEqual(snapshot.bodies[0], {
  bodyId: 2,
  name: 'Alpha 1',
  scan: snapshot.bodies[0].scan,
  bioCount: 2,
  genuses: ['$Codex_Ent_Stratum_Genus_Name;'],
  speciesFound: ['Stratum Tectonicas'],
});
assert.equal(state.apply({ event: 'FSDJump', SystemAddress: 5, StarSystem: 'Beta', StarPos: [0, 0, 0] }).jumped, true);
assert.equal(state.snapshot().bodies.length, 0);

// Tailing: replay on start, appended lines, split lines, a new journal, debounced persist.
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'edss-live-'));
const changes = [];
let persists = 0;
const live = new JournalLive({
  journalDir: tempDir,
  onChange: (change) => changes.push(change),
  onPersist: () => { persists += 1; },
  pollMs: 25,
  folderPollMs: 50,
  persistAfterBodyMs: 120,
  persistAfterJumpMs: 60,
});
try {
  const first = path.join(tempDir, 'Journal.2026-10-10T120000.01.log');
  await fs.writeFile(first, line({ event: 'Fileheader' }) + line({ event: 'Location', SystemAddress: 7, StarSystem: 'Gamma', StarPos: [1, 2, 3] }));
  await live.start();
  assert.equal(changes[0].type, 'snapshot');
  assert.equal(changes[0].snapshot.current.systemName, 'Gamma');
  assert.equal(changes.length, 1, 'the replayed journal is not re-sent as live events');

  const scan = line({ event: 'Scan', SystemAddress: 7, BodyID: 4, BodyName: 'Gamma 4', PlanetClass: 'High metal content body', Landable: true });
  await fs.appendFile(first, scan.slice(0, 40));
  await wait(80);
  assert.equal(changes.length, 1, 'half a line is held back');
  await fs.appendFile(first, scan.slice(40) + line({ event: 'SAASignalsFound', SystemAddress: 7, BodyID: 4, Signals: [], Genuses: [] }));
  await waitFor(() => changes.length >= 3, 'scan and signals');
  assert.equal(changes[1].type, 'body');
  assert.equal(changes[1].body.name, 'Gamma 4');
  assert.deepEqual(changes[2].body.genuses, []);
  await waitFor(() => persists === 1, 'debounced persist after body events');

  const second = path.join(tempDir, 'Journal.2026-10-10T130000.01.log');
  await fs.writeFile(second, line({ event: 'Fileheader' }) + line({ event: 'FSDJump', SystemAddress: 9, StarSystem: 'Delta', StarPos: [4, 5, 6] }));
  await waitFor(() => changes.some((change) => change.type === 'location' && change.current.systemName === 'Delta'), 'switch to the new journal');
  assert.equal(live.status().file, 'Journal.2026-10-10T130000.01.log');
  await waitFor(() => persists === 2, 'persist after the jump');
} finally {
  live.stop();
  await fs.rm(tempDir, { recursive: true, force: true });
}

console.log('Live journal tests passed.');
