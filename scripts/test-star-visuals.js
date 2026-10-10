import assert from 'node:assert/strict';
import { colorCategoryForMask, colorModes, hexToRgb } from '../public/color-modes.js';
import { GalaxyRenderer, buildCloudTexels, contextRank, flightDuration, flightPose, formatPlaneCoordinate, nebulaSprite, planeTextBasis, densityPriorityFraction, estimatedStarVisual, galaxyGlowAlpha, galaxyGlowQuad, parseGalaxyDensity, dropLineAnchorRange, formatDistanceBadge, gridAxisCueLayout, gridDepthEmphasis, isGiantStarType, prioritizeDrawCandidates, specialKind, starViewVolumeContains, starVisual, visitedBraceGeometry, zoomDrawBudget, zoomLocalPointLimit, zoomStarScalePercent } from '../public/renderer.js';

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
assert.equal(specialKind('T Tauri Star'), 'protostar', 'T Tauri stars should use the distinct protostar flare marker.');
assert.equal(specialKind('Herbig Ae/Be Star'), 'protostar', 'Herbig stars should use the distinct protostar flare marker.');
assert.ok(giant.size > m.size, 'Giants should be larger than their base spectral class.');
assert.ok(supergiant.size > giant.size, 'Supergiants should be larger than giants.');
assert.equal(isGiantStarType('M (Red giant) Star'), true, 'Giant stars should match the Giants preset.');
assert.equal(isGiantStarType('A (Blue-White super giant) Star'), true, 'Supergiant stars should match the Giants preset.');
assert.equal(isGiantStarType('M (Red dwarf) Star'), false, 'Main-sequence and dwarf stars should not match the Giants preset.');
assert.equal(isGiantStarType('Class V gas giant'), false, 'Gas giants should not match the stellar Giants preset.');
assert.equal(specialKind('M (Red giant) Star'), 'giant', 'Giant stars should receive an overlay cage marker.');
assert.equal(specialKind('A (Blue-White super giant) Star'), 'giant', 'Supergiant stars should receive an overlay cage marker.');
assert.equal(specialKind('Class V gas giant'), '', 'Gas giants should not receive the stellar giant marker.');
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

const onGrid = gridDepthEmphasis(0, 5);
const bandEdge = gridDepthEmphasis(10, 5);
const farOffGrid = gridDepthEmphasis(40, 5);
assert.equal(onGrid.alpha, 1, 'Stars on the grid plane should remain fully opaque.');
assert.ok(onGrid.size > 1, 'Stars on the grid plane should receive a modest size boost.');
assert.equal(bandEdge.alpha, 1, 'Stars inside two grid cells should retain full opacity.');
assert.ok(farOffGrid.alpha <= 0.23 && farOffGrid.size < 0.8, 'Stars beyond eight grid cells should recede strongly.');
assert.deepEqual(gridDepthEmphasis(-40, 5), farOffGrid, 'Depth emphasis should be symmetric above and below the grid.');

assert.equal(starViewVolumeContains(50, 10), true, 'The 10 ly view should include the top edge of its 100 ly star band.');
assert.equal(starViewVolumeContains(-50, 10), true, 'The 10 ly view should include the bottom edge of its 100 ly star band.');
assert.equal(starViewVolumeContains(50.01, 10), false, 'The 10 ly view should omit stars above the band.');
assert.equal(starViewVolumeContains(-50.01, 5), false, 'Closer views should retain the same Elite-style star band.');
assert.equal(starViewVolumeContains(5000, 25), true, 'The 25 ly view should restore the existing spherical star volume.');

const dropLineRange = dropLineAnchorRange([
  { x: 3, y: 4, z: 0 },
  { x: -6, y: 0, z: 8 },
  { x: 1, y: 1, z: 1 },
], [0, 0, 0]);
assert.equal(dropLineRange, 10, 'Drop-line range should describe the farthest active anchor.');
assert.equal(formatDistanceBadge(14.74), '14.7', 'Drop-line badges should keep local ranges compact but readable.');
assert.equal(formatDistanceBadge(1234.4), '1,234', 'Drop-line badges should group large distances.');

const eastCue = gridAxisCueLayout(
  { x: 500, y: 400 },
  { x: 200, y: 400 },
  { x: 0, y: 0, width: 1000, height: 800 },
);
assert.ok(eastCue.tip.x <= 300 && eastCue.tip.y === 400, 'Galactic East should use the mirrored grid direction and extend beyond the crowded center area.');
const northCue = gridAxisCueLayout(
  { x: 500, y: 400 },
  { x: 400, y: 200 },
  { x: 0, y: 0, width: 1000, height: 800 },
);
assert.ok(northCue.tip.x < 425 && northCue.tip.y < 250, 'The +Z cue should preserve its direction and extend beyond the crowded center area.');
assert.equal(
  gridAxisCueLayout({ x: 500, y: 400 }, { x: 505, y: 405 }, { x: 0, y: 0, width: 1000, height: 800 }),
  null,
  'A nearly edge-on axis should omit its label instead of showing an unstable direction.',
);

const gridRenderer = Object.assign(Object.create(GalaxyRenderer.prototype), {
  target: [1234.5, 72, -987.25],
  distance: 30000,
});
const farGrid = gridRenderer.gridSpec();
gridRenderer.distance = 12000;
const nearGrid = gridRenderer.gridSpec();
assert.notEqual(farGrid.step, nearGrid.step, 'Fixture should cross a grid LOD boundary.');
assert.deepEqual(
  [farGrid.centerX, farGrid.centerZ],
  [nearGrid.centerX, nearGrid.centerZ],
  'The emphasized grid intersection should remain fixed while zoom changes grid LOD.',
);
assert.deepEqual(
  [nearGrid.centerX, nearGrid.centerZ],
  [gridRenderer.target[0], gridRenderer.target[2]],
  'The emphasized grid intersection should use the exact map target coordinate.',
);

gridRenderer.overlay = { getBoundingClientRect: () => ({ width: 1500, height: 900 }) };
assert.deepEqual(
  gridRenderer.renderClipRect(),
  { x: 0, y: 0, width: 1500, height: 900 },
  'The grid and its drop lines should cover the full render viewport.',
);
assert.deepEqual(
  gridRenderer.centerClipRect(),
  { x: 250, y: 150, width: 1000, height: 600 },
  'HUD overlays should retain the existing centered safe area.',
);

const placeRenderer = Object.assign(Object.create(GalaxyRenderer.prototype), {
  target: [0, 0, 0],
  places: Array.from({ length: 75 }, (_, index) => ({ id: `place-${index}`, x: index + 1, y: 0, z: 0, category: 'Green Gas Giants' })),
  selectedPlace: null,
  placeDrawKey: '',
  placeDrawList: [],
  showPlaces: false,
  showMurderBinaries: false,
  showAllPlaces: false,
  isolatePlaces: true,
});
assert.equal(placeRenderer.visiblePlaces().length, 75, 'Place isolation should override Nearby/Off and show every selected filtered place.');
placeRenderer.selectedPlace = { id: 'current-target', x: 0, y: 0, z: 0, category: 'Unselected category' };
placeRenderer.placeDrawKey = '';
assert.equal(placeRenderer.visiblePlaces().length, 76, 'Place isolation should retain the current selected target even when its filter is not selected.');
placeRenderer.selectedPlace = null;
placeRenderer.isolatePlaces = false;
placeRenderer.showPlaces = true;
placeRenderer.placeDrawKey = '';
assert.equal(placeRenderer.visiblePlaces().length, 50, 'Turning isolation off should restore the existing Nearby limit.');

let contextPlace = null;
const contextRenderer = Object.assign(Object.create(GalaxyRenderer.prototype), {
  canvas: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
  isolatePlaces: true,
  showPlaces: false,
  showMurderBinaries: false,
  findPlaceNear: () => ({ place: { id: 'candidate', systemName: 'Candidate System' }, screen: { x: 12, y: 18 } }),
  onPlaceContext: (hit) => { contextPlace = hit; },
});
contextRenderer.contextPick({ clientX: 12, clientY: 18 });
assert.equal(contextPlace?.place?.systemName, 'Candidate System', 'Right-click should expose filtered places without selecting or refocusing them.');

// Context fill favours heavy mass codes; nearest-first share is unchanged.
const massCandidates = Array.from({ length: 40 }, (_, index) => {
  const massCode = index < 20 ? 1 : 7;
  return { point: { index, massCode, bucket: index, contextRank: contextRank(massCode, index) }, distanceSq: (1000 - index) ** 2 };
});
const massSample = prioritizeDrawCandidates(massCandidates, 10, 0.5);
const contextPicks = massSample.filter((item) => item.point.index < 35);
assert.ok(contextPicks.every((item) => item.point.massCode === 7), 'Context slots should go to the heaviest mass codes first.');
assert.ok(contextRank(-1, 5) < contextRank(1, 5) && contextRank(-1, 5) > contextRank(4, 5), 'Unknown mass codes should rank like class d.');

const estimatedHeavy = estimatedStarVisual(7);
const estimatedDwarf = estimatedStarVisual(1);
assert.ok(estimatedHeavy.color[2] > estimatedHeavy.color[0], 'Unknown heavy primaries should be estimated blue.');
assert.ok(estimatedDwarf.color[0] > estimatedDwarf.color[2], 'Unknown light primaries should be estimated red.');
assert.equal(estimatedHeavy.estimated, true);

const densityBuffer = new ArrayBuffer(32 + 2 * 2 * 2);
const densityView = new DataView(densityBuffer);
'EDGDENS1'.split('').forEach((char, index) => densityView.setUint8(index, char.charCodeAt(0)));
densityView.setUint32(8, 1, true);
densityView.setUint32(12, 2, true);
densityView.setUint32(16, 2, true);
densityView.setFloat32(20, -100, true);
densityView.setFloat32(24, 0, true);
densityView.setFloat32(28, 50, true);
const densityImage = parseGalaxyDensity(densityBuffer);
assert.equal(densityImage.texels.length, 8);
assert.equal(parseGalaxyDensity(new ArrayBuffer(16)), null);
const glowQuad = galaxyGlowQuad(densityImage);
assert.deepEqual([...glowQuad.positions.slice(0, 3)], [100, 0, 0], 'Glow quad corners use mirrored render x.');
assert.deepEqual([...glowQuad.uvs], [0, 0, 1, 0, 0, 1, 1, 1]);
assert.equal(galaxyGlowAlpha(500, -0.5), 0, 'The glow stays hidden at local zoom.');
assert.ok(galaxyGlowAlpha(20000, -Math.PI / 2) > galaxyGlowAlpha(20000, -0.05), 'Edge-on views soften the flat glow.');

// Camera fly-to: ends exactly on target, eases, and lifts on long jumps.
const flightFrom = { target: [0, 0, 0], distance: 850 };
const flightTo = { target: [20000, 0, 0], distance: 850 };
assert.deepEqual(flightPose(flightFrom, flightTo, 0).target, [0, 0, 0]);
assert.ok(Math.abs(flightPose(flightFrom, flightTo, 0).distance - 850) < 1e-6);
assert.deepEqual(flightPose(flightFrom, flightTo, 1).target, [20000, 0, 0]);
assert.ok(Math.abs(flightPose(flightFrom, flightTo, 1).distance - 850) < 1e-6);
assert.ok(flightPose(flightFrom, flightTo, 0.5).distance > 5000, 'Long flights should pull the camera back mid-way.');
assert.ok(flightPose(flightFrom, flightTo, 0.1).target[0] < 2000, 'Flights should ease in.');
assert.ok(flightDuration(flightFrom, flightTo) <= 1.2 && flightDuration(flightFrom, { target: [1, 0, 0], distance: 850 }) >= 0.55);

// In-plane text always reads left to right and is never mirrored.
for (const [a, b] of [[{ x: 10, y: 2 }, { x: 1, y: 8 }], [{ x: -10, y: 2 }, { x: 1, y: 8 }], [{ x: 1, y: 8 }, { x: -10, y: -2 }]]) {
  const basis = planeTextBasis({ x: 0, y: 0 }, a, b);
  assert.ok(basis.right.x > 0, 'Plane labels should read left to right.');
  assert.ok(basis.right.x * basis.down.y - basis.right.y * basis.down.x > 0, 'Plane labels must not be mirrored.');
}
assert.equal(planeTextBasis({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }), null);

// Nebula clouds: soft-edged mask and stable per-nebula look.
const cloud = buildCloudTexels(64);
assert.equal(cloud[0], 0, 'Cloud corners should fade to nothing.');
assert.ok(Math.max(...cloud) > 120, 'Cloud centres should be visible.');
assert.deepEqual(nebulaSprite({ name: 'Orion Nebula' }), nebulaSprite({ name: 'Orion Nebula' }));
assert.ok(nebulaSprite({ name: 'Orion Nebula' }).radius >= 60 && nebulaSprite({ name: 'Orion Nebula' }).radius <= 160);

// Colour-by categories follow color-modes.js; 0 means no data.
const economy = colorModes.economy;
const bit = (mode, value) => mode.values.find((entry) => entry.value === value).bit;
assert.equal(colorCategoryForMask(economy, 0), 0);
assert.equal(colorCategoryForMask(economy, bit(economy, 'agriculture')), 4);
assert.equal(colorCategoryForMask(economy, bit(economy, 'highTech') | bit(economy, 'service')), 5, 'The less common economy should win.');
assert.equal(colorCategoryForMask(colorModes.security, bit(colorModes.security, 'high')), 4);
for (const mode of Object.values(colorModes)) assert.ok(mode.values.length <= 15, 'Categories must fit flag bits 12..15.');
assert.deepEqual(hexToRgb('#ff0000'), [1, 0, 0]);

assert.equal(formatPlaneCoordinate(-10030, 10), '-10,030');
assert.equal(formatPlaneCoordinate(25000, 2500), '25.0k');

console.log('Star visual profile test passed.');
