import assert from 'node:assert/strict';
import { latestPlausibleUpdateTime } from './update-time.js';

assert.equal(
  latestPlausibleUpdateTime('2026-07-07T22:00:01Z', '2026-07-08T03:23:13Z'),
  '2026-07-07T22:00:01.000Z'
);
assert.equal(
  latestPlausibleUpdateTime('2026-07-30T22:44:38Z', '2026-07-08T03:23:13Z'),
  null
);
assert.equal(latestPlausibleUpdateTime('not-a-date', '2026-07-08T03:23:13Z'), null);
assert.equal(latestPlausibleUpdateTime(null, '2026-07-08T03:23:13Z'), null);

console.log('Update-time plausibility tests passed.');
