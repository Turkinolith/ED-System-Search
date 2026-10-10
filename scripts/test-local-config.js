import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeLocalConfig, saveTrackedCarrier } from '../local-config.js';
import { findCarrierIdentity, parseCarrierQuery } from './carrier-identity.js';

assert.deepEqual(normalizeLocalConfig(), {
  trackedCarrier: null,
  llmSearch: null,
});

const configured = normalizeLocalConfig({
  trackedCarrier: {
    id: '12345',
    name: 'EXAMPLE CARRIER',
    callsign: 'ABC-123',
    fallbackCoords: { x: 1, y: 2, z: 3 },
  },
});

assert.deepEqual(configured.trackedCarrier, {
  id: 12345,
  name: 'EXAMPLE CARRIER',
  callsign: 'ABC-123',
  label: 'EXAMPLE CARRIER [ABC-123]',
  fallbackCoords: { x: 1, y: 2, z: 3 },
});
assert.equal(configured.llmSearch, null);

assert.deepEqual(normalizeLocalConfig({
  llmSearch: {
    provider: 'kobold',
    model: 'local',
    baseUrl: 'http://localhost:5001',
    apiKey: '',
  },
}).llmSearch, {
  provider: 'kobold',
  model: 'local',
  baseUrl: 'http://localhost:5001',
  apiKey: null,
});

assert.equal(normalizeLocalConfig({ trackedCarrier: { id: 'not-a-number' } }).trackedCarrier, null);

assert.deepEqual(parseCarrierQuery('  my   carrier '), { name: 'my carrier', callsign: null });
assert.deepEqual(parseCarrierQuery('abc-123'), { name: null, callsign: 'ABC-123' });
assert.deepEqual(parseCarrierQuery('MY CARRIER [abc-123]'), { name: 'MY CARRIER', callsign: 'ABC-123' });
assert.equal(parseCarrierQuery('   '), null);

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'edss-config-'));
try {
  const journalLines = [
    { timestamp: '2026-01-01T00:00:00Z', event: 'Docked', StationName: 'ABC-123', StationType: 'FleetCarrier', MarketID: 12345 },
    { timestamp: '2026-01-01T00:01:00Z', event: 'CarrierStats', CarrierID: 12345, Callsign: 'ABC-123', Name: 'EXAMPLE CARRIER' },
  ].map((event) => JSON.stringify(event)).join('\n');
  await fs.writeFile(path.join(tempDir, 'Journal.2026-01-01T000000.01.log'), journalLines);
  assert.deepEqual(await findCarrierIdentity(tempDir, parseCarrierQuery('example carrier')), {
    id: 12345,
    name: 'EXAMPLE CARRIER',
    callsign: 'ABC-123',
  });
  assert.equal(await findCarrierIdentity(tempDir, parseCarrierQuery('OTHER CARRIER')), null);

  const configFile = path.join(tempDir, 'config.local.json');
  await fs.writeFile(configFile, JSON.stringify({ llmSearch: { provider: 'kobold', model: 'local' } }));
  const saved = await saveTrackedCarrier({ id: 12345, name: 'EXAMPLE CARRIER', callsign: 'ABC-123', label: 'EXAMPLE CARRIER [ABC-123]' }, configFile);
  assert.equal(saved.trackedCarrier.id, 12345);
  const written = JSON.parse(await fs.readFile(configFile, 'utf8'));
  assert.equal(written.llmSearch.provider, 'kobold', 'saving the carrier keeps other settings');
  assert.equal((await saveTrackedCarrier(null, configFile)).trackedCarrier, null);
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}

console.log('Local configuration checks passed.');
