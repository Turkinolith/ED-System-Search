import assert from 'node:assert/strict';
import { normalizeLocalConfig } from '../local-config.js';

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

console.log('Local configuration checks passed.');
