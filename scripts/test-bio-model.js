import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  atmosphereKey,
  bodyPrediction,
  bodyTypeKey,
  normaliseJournalBody,
  normaliseSpanshBody,
  parseRegionRaster,
  regionAt,
  speciesShares,
  starCode,
} from '../public/bio-model.js';
import { checkRegionCounts, encodeRaster, fillRegions } from './build-region-raster.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'bio-cases.json'), 'utf8'));

// Spelling normalisation (Spansh and journal forms).
assert.equal(atmosphereKey('Thin Sulphur dioxide'), 'SulphurDioxide');
assert.equal(atmosphereKey('Thin Carbon dioxide-rich'), 'CarbonDioxideRich');
assert.equal(atmosphereKey('Hot thin Neon-rich'), 'NeonRich');
assert.equal(atmosphereKey('Sulphur dioxide'), 'SulphurDioxide');
assert.equal(atmosphereKey('No atmosphere'), '');
assert.equal(atmosphereKey('CarbonDioxide'), 'CarbonDioxide');
assert.equal(bodyTypeKey('High metal content world'), 'High metal content body');
assert.equal(bodyTypeKey('Rocky Ice world'), 'Rocky ice body');
assert.equal(starCode('K (Yellow-Orange) Star'), 'K');
assert.equal(starCode('K'), 'K');
assert.equal(starCode('M_RedGiant'), 'M');
assert.equal(starCode('White Dwarf (DA) Star'), 'D');
assert.equal(starCode('DAB'), 'D');
assert.equal(starCode('T Tauri Star'), 'TTS');
assert.equal(starCode('TTS'), 'TTS');
assert.equal(starCode('T (Brown dwarf) Star'), 'T');
assert.equal(starCode('AeBe'), 'Ae');
assert.equal(starCode('Black Hole'), null);
assert.equal(starCode('H'), null);

// Shared fixture: the Rust bio module checks the same expectations.
for (const testCase of fixture.cases) {
  const body = normaliseSpanshBody(testCase.system.bodies[testCase.bodyIndex], testCase.system);
  const actual = speciesShares(fixture.model, body)
    .flatMap(({ species }) => species.map((item) => [item.species.name, item.share]))
    .sort((a, b) => a[0].localeCompare(b[0]));
  assert.equal(actual.length, testCase.expected.length, `${testCase.name}: ${JSON.stringify(actual)}`);
  actual.forEach(([name, share], index) => {
    assert.equal(name, testCase.expected[index][0], testCase.name);
    assert.ok(Math.abs(share - testCase.expected[index][1]) < 1e-9, `${testCase.name}: ${name} ${share}`);
  });
}

// Journal units: gravity m/s^2 -> g, pressure Pa -> atm, parents and stars.
const journalStars = [{ BodyID: 0, StarType: 'K', DistanceFromArrivalLS: 0 }];
const journalBody = normaliseJournalBody({
  BodyName: 'Test 1', BodyID: 3, PlanetClass: 'High metal content body', Landable: true,
  SurfaceGravity: 0.31 * 9.797759, SurfaceTemperature: 220, SurfacePressure: 0.003 * 101231.65625,
  AtmosphereType: 'SulphurDioxide', Volcanism: '', DistanceFromArrivalLS: 900, Parents: [{ Star: 0 }],
  Materials: [{ Name: 'iron', Percent: 20 }],
}, { stars: journalStars, region: 18 });
assert.ok(Math.abs(journalBody.gravity - 0.31) < 1e-9);
assert.ok(Math.abs(journalBody.pressure - 0.003) < 1e-9);
assert.deepEqual([...journalBody.starCodes], ['K']);
assert.deepEqual([...journalBody.materials], ['Iron']);
assert.equal(speciesShares(fixture.model, journalBody)[0].species[0].species.name, 'Stratum Tectonicas');

// Predictions: confirmed species, mapped genus, FSS-only and conditions-only.
const rates = { '$Codex_Ent_Stratum_07_Name;': 0.5 };
assert.equal(bodyPrediction(fixture.model, { ...journalBody, speciesFound: ['Stratum Tectonicas'] })[0].probability, 1);
assert.equal(bodyPrediction(fixture.model, { ...journalBody, speciesFound: ['Stratum Paleas'] }).length, 0);
assert.equal(bodyPrediction(fixture.model, { ...journalBody, genuses: ['$Codex_Ent_Stratum_Genus_Name;'] })[0].probability, 1);
assert.equal(bodyPrediction(fixture.model, { ...journalBody, genuses: [] }).length, 0);
assert.equal(bodyPrediction(fixture.model, { ...journalBody, bioCount: 0 }, rates).length, 0);
const unmapped = bodyPrediction(fixture.model, journalBody, rates);
assert.equal(unmapped[0].probability, 0.5);
assert.equal(unmapped[0].basis, 'conditions');
assert.equal(bodyPrediction(fixture.model, journalBody)[0].probability, null);

// A Spansh signal list without a biological entry means none were found.
const spanshNoBio = normaliseSpanshBody({ ...fixture.cases[0].system.bodies[1], signals: { signals: { '$SAA_SignalType_Geological;': 2 } } }, fixture.cases[0].system);
assert.equal(spanshNoBio.bioCount, 0);

// Region raster: two regions split by one boundary, rebuilt and looked up.
const vectors = {
  bounds: [-25, -15, 25, 15],
  regions: [
    { id: 1, name: 'West', sampleCount: 6, label: [-10, 0] },
    { id: 2, name: 'East', sampleCount: 9, label: [10, 0] },
  ],
  boundaries: [[-5, -15, -5, 15, 1, 2]],
};
const fill = fillRegions(vectors);
assert.deepEqual(checkRegionCounts(fill, vectors.regions).map((row) => row.actual), [6, 9]);
const raster = parseRegionRaster(encodeRaster(fill, 1));
assert.equal(regionAt(raster, -20, 0), 1);
assert.equal(regionAt(raster, 0, 10), 2);
assert.equal(regionAt(raster, 500, 0), null);

console.log('Bio model tests passed.');
