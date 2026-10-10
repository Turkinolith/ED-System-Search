import assert from 'node:assert/strict';
import { bodyMatchesType, compactText, knownKeywords, planSearchLocally } from './search-planner.js';

// The panel's example request is fully understood without an AI assistant.
{
  const result = planSearchLocally('Based on the current target, find the nearest systems with icy ring planets, preferably those with tritium hotspots.');
  assert.deepEqual(result.unknown, []);
  assert.deepEqual(result.plan.filters.ringTypes, ['icy']);
  assert.deepEqual(result.plan.keywords, ['tritium']);
  assert.equal(result.plan.filters.requireKeywords, false, '"preferably" makes the material a preference');
}

{
  const result = planSearchLocally('earth-like worlds within 300 ly');
  assert.deepEqual(result.plan.filters.bodyTypes, ['earthLike']);
  assert.equal(result.plan.radiusLy, 300);
  assert.deepEqual(result.unknown, []);
}

{
  const result = planSearchLocally('painite or low temperature diamonds in metallic rings');
  assert.deepEqual(result.plan.filters.ringTypes, ['metallic']);
  assert.deepEqual(result.plan.keywords.sort(), ['lowtemperaturediamond', 'painite']);
  assert.equal(result.plan.filters.requireKeywords, true);
  assert.equal(result.plan.filters.keywordMatch, 'any');
}

{
  const result = planSearchLocally('5 systems with void opals and biological signals within 2,000 light years');
  assert.equal(result.plan.limit, 5);
  assert.equal(result.plan.radiusLy, 2000);
  assert.equal(result.plan.filters.keywordMatch, 'all');
  assert.deepEqual(result.unknown, []);
}

{
  const result = planSearchLocally('terraformable HMCs');
  assert.deepEqual(result.plan.filters.bodyTypes.sort(), ['highMetal', 'terraformable']);
}

// Things the planner cannot do are reported, not silently dropped.
assert.deepEqual(planSearchLocally('water worlds without rings').unknown, ['without', 'rings']);
assert.deepEqual(planSearchLocally('neutron stars near me').unknown, ['neutron']);
assert.ok(!planSearchLocally('systems for mining').plan.filters.keywordMatch.includes('any'), '"for" is not "or"');

// Body types as they are written in the galaxy data.
assert.ok(bodyMatchesType({ subType: 'Earth-like world' }, 'earthLike'));
assert.ok(bodyMatchesType({ subType: 'Gas giant with water based life' }, 'gasWaterLife'));
assert.ok(bodyMatchesType({ subType: 'High metal content body', terraformingState: 'Candidate for terraforming' }, 'terraformable'));
assert.ok(!bodyMatchesType({ subType: 'High metal content body', terraformingState: 'Not terraformable' }, 'terraformable'));
assert.ok(bodyMatchesType({ subType: 'Rocky Ice body' }, 'rockyIce'));
assert.ok(!bodyMatchesType({ subType: 'Rocky body' }, 'rockyIce'));

// Ring hotspot names in the data ("Void Opal", "Low Temperature Diamonds").
const ring = compactText(JSON.stringify({ signals: { 'Void Opal': { count: 1 }, 'Low Temperature Diamonds': { count: 2 } } }));
assert.ok(ring.includes('opal'));
assert.ok(compactText('{"Opal":1}').includes(planSearchLocally('void opals').plan.keywords[0]), 'the dump calls them Opal');
assert.ok(ring.includes('lowtemperaturediamond'));
assert.ok(knownKeywords.includes('tritium') && knownKeywords.includes('geological'));

console.log('Search planner checks passed.');
