import assert from 'node:assert/strict';
import { boxelAtMassCode, boxelContains, decodeId64, massCodeFromFlags, sharesBoxel } from '../public/id64.js';
import { massCode, weightedLodDivisor, withMassCode } from './mass-code.js';

// Sol: a hand-named system that still sits in its procedural mass-code d boxel.
const sol = decodeId64('10477373803');
assert.equal(sol.massCode, 3);
assert.equal(sol.letter, 'd');
assert.equal(sol.cellEdge, 80);
assert.deepEqual(sol.min, { x: -65, y: -25, z: -25 });
assert.ok(boxelContains(sol, { x: 0, y: 0, z: 0 }), 'Sol should sit inside its own boxel.');
assert.ok(!boxelContains(sol, { x: 100, y: 0, z: 0 }), 'Points outside the cube should be rejected.');
assert.equal(decodeId64('0'), null);
assert.equal(decodeId64('not a number'), null);
assert.equal(decodeId64('18446744073709551616'), null, 'Values above 64 bits are invalid.');

// Flag packing mirrors the native importer: permit/non-standard bits survive.
const flags = withMassCode(0b11, 10477373803n);
assert.equal(flags & 0b11, 0b11);
assert.equal(massCodeFromFlags(flags), 3);
assert.equal(massCodeFromFlags(flags | 4), 3, 'The runtime visited bit must not disturb the mass code.');
assert.equal(massCodeFromFlags(withMassCode(flags, 0)), -1, 'Systems without an ID64 have no mass code.');
assert.equal(massCode('15'), 7);

// Weighted LODs stay nested and the full LOD keeps everything.
const divisors = [4096, 1024, 256, 64, 16, 4, 1];
for (const code of [null, 0, 1, 2, 3, 4, 5, 6, 7]) {
  assert.equal(weightedLodDivisor(1, code), 1);
  for (let level = 0; level < divisors.length - 1; level += 1) {
    const coarse = weightedLodDivisor(divisors[level], code);
    const fine = weightedLodDivisor(divisors[level + 1], code);
    assert.equal(coarse % fine, 0, `LOD ${level + 1} must contain LOD ${level} for mass code ${code}.`);
  }
}
assert.equal(weightedLodDivisor(1024, 7), 8);
assert.equal(weightedLodDivisor(1024, 1), 2048);
assert.equal(weightedLodDivisor(1024, 2), 1024);

// Eol Prou XL-C b42-36: its 20 ly b boxel sits inside the 40 ly c boxel that
// files the Eol Prou WC-P c20 systems and the 80 ly d boxel of LO-H d10.
const eolProu = decodeId64('79701034157417');
assert.equal(eolProu.letter, 'b');
assert.deepEqual(eolProu.min, { x: -10045, y: -905, z: 20315 });
const eolProuC = boxelAtMassCode(eolProu, 2);
assert.equal(eolProuC.cellEdge, 40);
assert.deepEqual(eolProuC.min, { x: -10065, y: -905, z: 20295 });
assert.deepEqual(boxelAtMassCode(eolProu, 3).min, { x: -10065, y: -905, z: 20295 });
assert.ok(sharesBoxel(boxelAtMassCode(eolProu, 3), 3, { x: -10035.219, y: -899.625, z: 20330.625 }), 'LO-H d10-638 is filed in the d boxel.');
assert.ok(sharesBoxel(eolProuC, 2, { x: -10043.5625, y: -894.59375, z: 20323.875 }), 'WC-P c20-5 is filed in the c boxel.');
assert.ok(!sharesBoxel(eolProuC, 2, { x: -10043.781, y: -877.59375 + 40, z: 20333.906 }), 'A c system in the next cell up is not.');
assert.ok(!sharesBoxel(eolProuC, 1, { x: -10031.75, y: -900.25, z: 20317.938 }), 'A b system inside the cube has a different mass code.');
assert.ok(sharesBoxel(eolProu, 1, { x: -10031.75, y: -900.25, z: 20317.938 }));

console.log('ID64 and mass-code test passed.');
