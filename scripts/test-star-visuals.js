import assert from 'node:assert/strict';
import { densityPriorityFraction, prioritizeDrawCandidates, starVisual, visitedBraceGeometry, zoomDrawBudget, zoomLocalPointLimit, zoomStarScalePercent } from '../public/renderer.js';

const o = starVisual('O (Blue-White) Star');
const a = starVisual('A (Blue-White) Star');
const g = starVisual('G (White-Yellow) Star');
const m = starVisual('M (Red dwarf) Star');
const t = starVisual('T (Brown dwarf) Star');
const young = starVisual('Herbig Ae/Be Star');
const giant = starVisual('M (Red giant) Star');
const supergiant = starVisual('M (Red super giant) Star');

assert.ok(o.color[2] > o.color[0], 'O stars should read blue.');
assert.ok(a.color[2] > a.color[0], 'A stars should retain a cool violet cast.');
assert.ok(g.color[0] >= g.color[2], 'G stars should read white-warm.');
assert.ok(m.color[0] > m.color[2], 'M stars should read orange-red.');
assert.ok(t.size < m.size, 'T dwarfs should be more compact than M dwarfs.');
assert.equal(young.style, 6, 'Herbig and T Tauri stars should use the young-star ray profile.');
assert.ok(giant.size > m.size, 'Giants should be larger than their base spectral class.');
assert.ok(supergiant.size > giant.size, 'Supergiants should be larger than giants.');
assert.equal(zoomStarScalePercent(850), 300, 'Local journal views should use 300% stars.');
assert.equal(zoomStarScalePercent(30000), 60, 'Whole-galaxy views should use 60% stars.');
assert.ok(zoomStarScalePercent(7500) < 300 && zoomStarScalePercent(7500) > 60, 'Intermediate zoom should scale smoothly.');

const priorityCandidates = Array.from({ length: 100 }, (_, index) => ({
  point: { index, bucket: (index * 37) % 101 },
  distanceSq: (100 - index) ** 2,
}));
const prioritySample = prioritizeDrawCandidates(priorityCandidates, 20, 0.8);
const priorityDistances = new Set(prioritySample.map((item) => Math.sqrt(item.distanceSq)));
for (let distance = 1; distance <= 16; distance += 1) {
  assert.ok(priorityDistances.has(distance), `Nearest system at distance ${distance} should receive priority.`);
}
assert.ok(prioritySample.some((item) => Math.sqrt(item.distanceSq) > 16), 'The draw budget should retain a stable distant context sample.');
const moderatePriority = densityPriorityFraction(200, 10, 100);
const densePriority = densityPriorityFraction(400, 50, 100);
const corePriority = densityPriorityFraction(1600, 200, 100);
assert.ok(moderatePriority >= 0.8 && moderatePriority < densePriority, 'Moderate density should favor nearby stars without eliminating context.');
assert.ok(densePriority > moderatePriority && densePriority <= 0.97, 'Dense views should tighten near-system priority.');
assert.equal(corePriority, 0.97, 'Exceptional core density should reserve 97% of the budget for nearest systems.');
assert.ok(zoomDrawBudget(340) > zoomDrawBudget(360), 'Zooming out across the 50 ly transition should reduce visible local density.');
assert.ok(zoomLocalPointLimit(340) > zoomLocalPointLimit(360), 'Zooming out across the 50 ly transition should request fewer local systems.');
assert.equal(zoomLocalPointLimit(2500), 0, 'Whole-galaxy views should use the global LOD without a dense local sphere.');
assert.ok(zoomDrawBudget(50) > zoomDrawBudget(100) && zoomDrawBudget(100) > zoomDrawBudget(250), 'Close-grid draw density should decrease continuously while zooming out.');
assert.ok(zoomLocalPointLimit(50) > zoomLocalPointLimit(100) && zoomLocalPointLimit(100) > zoomLocalPointLimit(250), 'Close-grid local requests should decrease continuously while zooming out.');

const visitedBraces = visitedBraceGeometry();
assert.equal(visitedBraces.length, 2, 'Visited systems should draw one brace on each side.');
assert.equal(visitedBraces[0].curves.length, 4, 'Each visited brace should use a smooth four-curve path.');
assert.equal(visitedBraces[0].start[0], -visitedBraces[1].start[0], 'Visited braces should mirror around the star.');
assert.equal(visitedBraces[0].start[1], visitedBraces[1].start[1], 'Visited braces should share vertical alignment.');

console.log('Star visual profile test passed.');
