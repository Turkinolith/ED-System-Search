// Exobiology species model shared by the server and the browser.
//
// A body is first normalised from either a Spansh rich-data body or journal Scan
// event. For each genus, every species whose hard rules pass (EDMC-BioScan
// rulesets), whose colour variants allow the local stars or surface materials,
// and whose logged regions include the body's region gets a weight:
// logged finds for the matching variants x temperature/gravity/pressure density
// (Canonn Bioforge). A species' share is its weight over the genus total, so when
// a genus is known to be on a body the shares split it between its species.
//
// The Rust bio-targets scan (native/ed-data-importer/src/bio.rs) implements the
// same rules; scripts/fixtures/bio-cases.json keeps the two in step.

const GRAVITY_MS2_PER_G = 9.797759;
const PA_PER_ATM = 101231.65625;
const BIO_SIGNAL = '$SAA_SignalType_Biological;';

// "Thin Carbon dioxide-rich" -> "CarbonDioxideRich"; journal values already
// use that form.
export function atmosphereKey(value) {
  const text = String(value ?? '').trim();
  if (!text || /^(none|no atmosphere)$/i.test(text)) return '';
  if (!/\s|-/.test(text)) return text;
  return text
    .replace(/^(hot\s+)?(thin|thick)\s+/i, '')
    .replace(/^hot\s+/i, '')
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase())
    .join('');
}

const BODY_TYPES = {
  'high metal content world': 'High metal content body',
  'high metal content body': 'High metal content body',
  'rocky ice world': 'Rocky ice body',
  'rocky ice body': 'Rocky ice body',
  'metal-rich body': 'Metal rich body',
  'metal rich body': 'Metal rich body',
  'rocky body': 'Rocky body',
  'icy body': 'Icy body',
};

export function bodyTypeKey(value) {
  const text = String(value ?? '').trim();
  return BODY_TYPES[text.toLowerCase()] ?? text;
}

function volcanismKey(value) {
  const text = String(value ?? '').trim().toLowerCase();
  return !text || text === 'no volcanism' ? '' : text;
}

function capitalise(name) {
  const text = String(name ?? '');
  return text ? text[0].toUpperCase() + text.slice(1).toLowerCase() : text;
}

// Star class code used by Bioforge colour variants, from a Spansh subType
// ("K (Yellow-Orange) Star") or a journal StarType ("K", "DA", "TTS", "AeBe").
export function starCode(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (/^white dwarf/i.test(text) || /^D[A-Z]*$/.test(text)) return 'D';
  if (/^wolf-rayet/i.test(text) || /^W[A-Z]*$/.test(text)) return 'W';
  if (/^neutron/i.test(text) || text === 'N') return 'N';
  if (/^t tauri/i.test(text) || text === 'TTS') return 'TTS';
  if (/^herbig/i.test(text) || text === 'AeBe') return 'Ae';
  if (/^black hole/i.test(text) || text === 'H' || text === 'SupermassiveBlackHole') return null;
  const match = /^([OBAFGKMLTY])(\b|_|\s|\()/.exec(text);
  return match ? match[1] : null;
}

function parentStarIds(parents) {
  const ids = [];
  for (const parent of parents ?? []) {
    if (parent && Object.hasOwn(parent, 'Star')) ids.push(Number(parent.Star));
  }
  return ids;
}

// Stars that count for a body's colour: the stars it orbits plus the arrival star.
function localStarCodes(parentIds, stars) {
  const codes = new Set();
  for (const star of stars) {
    if (star.isArrival || parentIds.includes(star.bodyId)) {
      const code = starCode(star.type);
      if (code) codes.add(code);
    }
  }
  return codes;
}

// Spansh rich-data body, possibly overlaid with fields from the app's own
// journal import (pressure in Pa, composition as a list, journal-style signals).
// `system` holds every body of the system and its region.
export function normaliseSpanshBody(body, system = {}) {
  const stars = (system.bodies ?? [])
    .filter((item) => item?.type === 'Star')
    .map((item) => ({ bodyId: Number(item.bodyId), type: item.subType, isArrival: Number(item.distanceToArrival ?? -1) === 0 || item.mainStar === true }));
  const components = {};
  const composition = body.atmosphereComposition;
  const entries = Array.isArray(composition)
    ? composition.map((item) => [item.Name, item.Percent])
    : Object.entries(composition ?? {});
  for (const [name, percent] of entries) components[atmosphereKey(name)] = Number(percent);
  const materials = new Set(Object.keys(body.materials ?? {}).map(capitalise));
  const signals = body.signals ?? null;
  let bioCount = null;
  if (signals?.signals) {
    // A Spansh signal list without a biological entry means the FSS found none.
    bioCount = Number(signals.signals[BIO_SIGNAL] ?? 0);
  } else if (signals && typeof signals === 'object') {
    const entry = Object.values(signals).find((item) => item?.type === BIO_SIGNAL);
    bioCount = entry ? Number(entry.count ?? 0) : Object.keys(signals).length ? 0 : null;
  }
  const genusList = Array.isArray(signals?.genuses) ? signals.genuses : Array.isArray(body.genuses) ? body.genuses : null;
  const pressure = Number.isFinite(body.surfacePressure) ? body.surfacePressure : null;
  return {
    name: body.name ?? null,
    bodyId: body.bodyId ?? null,
    landable: body.isLandable === true,
    bodyType: bodyTypeKey(body.subType),
    atmosphere: atmosphereKey(body.atmosphereType),
    components,
    gravity: Number.isFinite(body.gravity) ? body.gravity : null,
    temperature: Number.isFinite(body.surfaceTemperature) ? body.surfaceTemperature : null,
    // Journal pressures are in pascals; thin atmospheres are well under 1 atm.
    pressure: pressure !== null && pressure > 5 ? pressure / PA_PER_ATM : pressure,
    volcanism: volcanismKey(body.volcanismType),
    distance: Number.isFinite(body.distanceToArrival) ? body.distanceToArrival : null,
    materials,
    starCodes: localStarCodes(parentStarIds(body.parents), stars),
    region: system.region ?? null,
    genuses: genusList ? genusList.map((item) => (typeof item === 'string' ? item : item?.Genus)).filter(Boolean) : null,
    bioCount,
    speciesFound: [],
  };
}

// Journal Scan event (plus any signal/organic events gathered for the body).
// `stars` holds the system's star Scan events.
export function normaliseJournalBody(scan, { stars = [], region = null, genuses = null, bioCount = null, speciesFound = [] } = {}) {
  const starList = stars.map((star) => ({
    bodyId: Number(star.BodyID),
    type: star.StarType,
    isArrival: Number(star.DistanceFromArrivalLS ?? -1) === 0,
  }));
  const components = {};
  for (const item of scan.AtmosphereComposition ?? []) components[atmosphereKey(item.Name)] = Number(item.Percent);
  return {
    name: scan.BodyName ?? null,
    bodyId: scan.BodyID ?? null,
    landable: scan.Landable === true,
    bodyType: bodyTypeKey(scan.PlanetClass),
    atmosphere: atmosphereKey(scan.AtmosphereType ?? scan.Atmosphere),
    components,
    gravity: Number.isFinite(scan.SurfaceGravity) ? scan.SurfaceGravity / GRAVITY_MS2_PER_G : null,
    temperature: Number.isFinite(scan.SurfaceTemperature) ? scan.SurfaceTemperature : null,
    pressure: Number.isFinite(scan.SurfacePressure) ? scan.SurfacePressure / PA_PER_ATM : null,
    volcanism: volcanismKey(scan.Volcanism),
    distance: Number.isFinite(scan.DistanceFromArrivalLS) ? scan.DistanceFromArrivalLS : null,
    materials: new Set((scan.Materials ?? []).map((item) => capitalise(item.Name))),
    starCodes: localStarCodes(parentStarIds(scan.Parents), starList),
    region,
    genuses,
    bioCount,
    speciesFound,
  };
}

// One BioScan ruleset (normalised by scripts/build-bio-model.js).
export function rulesetMatches(rule, body) {
  if (rule.atmosphere !== undefined) {
    if (rule.atmosphere === 'Any') {
      if (!body.atmosphere) return false;
    } else if (!rule.atmosphere.includes(body.atmosphere)) {
      return false;
    }
  }
  if (rule.bodyTypes && !rule.bodyTypes.includes(body.bodyType)) return false;
  if (rule.atmosphereComponents) {
    for (const [gas, percent] of Object.entries(rule.atmosphereComponents)) {
      if ((body.components[gas] ?? 0) < percent) return false;
    }
  }
  if (body.gravity !== null) {
    if (rule.maxGravity !== undefined && body.gravity > rule.maxGravity) return false;
    if (rule.minGravity !== undefined && body.gravity < rule.minGravity) return false;
  }
  if (body.temperature) {
    if (rule.maxTemperature !== undefined && body.temperature > rule.maxTemperature) return false;
    if (rule.minTemperature !== undefined && body.temperature < rule.minTemperature) return false;
  }
  if (body.pressure) {
    if (rule.minPressure !== undefined && body.pressure < rule.minPressure) return false;
    if (rule.maxPressure !== undefined && body.pressure >= rule.maxPressure) return false;
  }
  if (rule.volcanism) {
    const volcanism = body.volcanism;
    const mode = rule.volcanism.mode;
    if (mode === 'none' && volcanism) return false;
    if (mode === 'any' && !volcanism) return false;
    if (mode === 'not' && (!volcanism || rule.volcanism.values.some((value) => volcanism.includes(value)))) return false;
    if (mode === 'list') {
      const found = rule.volcanism.exact.includes(volcanism) || rule.volcanism.values.some((value) => volcanism.includes(value));
      if (!found) return false;
    }
  }
  if (rule.minDistance !== undefined && body.distance !== null && body.distance < rule.minDistance) return false;
  if (rule.regions && body.region) {
    if (rule.regions.exclude.includes(body.region)) return false;
    if (rule.regions.include.length && !rule.regions.include.includes(body.region)) return false;
  }
  return true;
}

function density(hist, value) {
  if (!hist || value === null || value === undefined || !Number.isFinite(value)) return 1;
  const index = Math.floor((value - hist.min) / hist.step);
  if (index < 0 || index >= hist.density.length) return hist.floor;
  return hist.density[index];
}

// Weight of a species on a body, 0 when it cannot be there.
export function speciesWeight(species, body) {
  if (!species.rulesets.some((rule) => rulesetMatches(rule, body))) return 0;
  if (species.regions && body.region && !species.regions.includes(body.region)) return 0;
  let finds = Math.max(species.count, 1);
  if (species.variants) {
    const keys = species.variantKind === 'material' ? body.materials : body.starCodes;
    if (keys.size) {
      finds = 0;
      for (const key of keys) finds += species.variants[key] ?? 0;
      if (finds === 0) return 0;
    }
  }
  return finds
    * density(species.hist.temperature, body.temperature)
    * density(species.hist.gravity, body.gravity)
    * density(species.hist.pressure, body.pressure);
}

// Per genus: the species that can be on the body and their shares of the genus.
export function speciesShares(model, body) {
  const out = [];
  if (!body.landable || !body.atmosphere) return out;
  for (const genus of model.genera) {
    const weighted = genus.species
      .map((species) => ({ species, weight: speciesWeight(species, body) }))
      .filter((item) => item.weight > 0);
    const total = weighted.reduce((sum, item) => sum + item.weight, 0);
    if (!total) continue;
    out.push({
      genus,
      species: weighted.map((item) => ({ species: item.species, share: item.weight / total })),
    });
  }
  return out;
}

// High-value species likely on one body. `rates` maps species key -> the share-
// weighted rate at which its genus is found on mapped candidate bodies (from the
// bio-targets scan); without it unmapped bodies only list what is possible.
export function bodyPrediction(model, body, rates = null) {
  const found = new Set(body.speciesFound ?? []);
  const results = [];
  for (const { genus, species } of speciesShares(model, body)) {
    const confirmedInGenus = genus.species.find((item) => found.has(item.name));
    for (const { species: item, share } of species) {
      if (!item.target) continue;
      let probability = null;
      let basis = 'conditions';
      if (confirmedInGenus) {
        probability = confirmedInGenus === item ? 1 : 0;
        basis = 'confirmed';
      } else if (body.genuses) {
        probability = body.genuses.includes(genus.key) ? share : 0;
        basis = 'genus';
      } else if (body.bioCount === 0) {
        probability = 0;
        basis = 'signals';
      } else if (rates?.[item.key] !== undefined) {
        probability = Math.min(1, rates[item.key] * share);
        basis = body.bioCount ? 'signals' : 'conditions';
      }
      if (probability === 0) continue;
      results.push({ key: item.key, name: item.name, genus: genus.name, value: item.value, share, probability, basis });
    }
  }
  return results.sort((a, b) => (b.probability ?? b.share * 0.01) * b.value - (a.probability ?? a.share * 0.01) * a.value);
}

// Region raster lookup (data/region-raster.bin, see scripts/build-region-raster.js).
export function parseRegionRaster(buffer) {
  const view = new DataView(buffer.buffer ?? buffer, buffer.byteOffset ?? 0, buffer.byteLength);
  const magic = String.fromCharCode(...new Uint8Array(view.buffer, view.byteOffset, 8));
  if (magic !== 'EDREGR01') throw new Error('Not a region raster');
  const width = view.getUint32(12, true);
  const height = view.getUint32(16, true);
  return {
    width,
    height,
    x0: view.getFloat32(20, true),
    z0: view.getFloat32(24, true),
    cell: view.getFloat32(28, true),
    cells: new Uint8Array(view.buffer, view.byteOffset + 32, width * height),
  };
}

export function regionAt(raster, x, z) {
  if (!raster || !Number.isFinite(x) || !Number.isFinite(z)) return null;
  const i = Math.round((x - raster.x0) / raster.cell);
  const j = Math.round((z - raster.z0) / raster.cell);
  if (i < 0 || j < 0 || i >= raster.width || j >= raster.height) return null;
  return raster.cells[j * raster.width + i] || null;
}
