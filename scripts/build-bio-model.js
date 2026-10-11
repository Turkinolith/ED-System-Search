// Builds data/bio-model.json from the committed species rules
// (scripts/bio-rules.json, EDMC-BioScan) and the downloaded Canonn Bioforge
// statistics (data/bioforge/, see fetch-bioforge.js).
//
// Per species the model keeps the hard rulesets, the number of logged finds per
// colour variant (star class or surface material), the regions it has been
// found in, and smoothed temperature/gravity/pressure densities. The evaluator
// in public/bio-model.js and the Rust bio-targets scan both read this file.
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileAtomic } from './atomic-file.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const rulesPath = path.join(__dirname, 'bio-rules.json');
const bioforgeDir = path.join(root, 'data', 'bioforge');
const outPath = path.join(root, 'data', 'bio-model.json');

export const MODEL_VERSION = 1;
const HISTOGRAM_STEPS = 40;
// Region lists only rule a species out where it has been logged often enough
// for absence to mean something.
const REGION_GATE_MIN_COUNT = 1000;
const MATERIALS = new Set(['Antimony', 'Arsenic', 'Cadmium', 'Carbon', 'Chromium', 'Germanium', 'Iron', 'Manganese',
  'Mercury', 'Molybdenum', 'Nickel', 'Niobium', 'Phosphorus', 'Polonium', 'Ruthenium', 'Selenium', 'Sulphur',
  'Technetium', 'Tellurium', 'Tin', 'Tungsten', 'Vanadium', 'Yttrium', 'Zinc', 'Zirconium']);

// Codex region IDs as the game numbers them (same as regionID_numsort.csv).
const CODEX_REGIONS = ['Galactic Centre', 'Empyrean Straits', "Ryker's Hope", "Odin's Hold", 'Norma Arm', 'Arcadian Stream',
  'Izanami', 'Inner Orion-Perseus Conflux', 'Inner Scutum-Centaurus Arm', 'Norma Expanse', 'Trojan Belt', 'The Veils',
  "Newton's Vault", 'The Conduit', 'Outer Orion-Perseus Conflux', 'Orion-Cygnus Arm', 'Temple', 'Inner Orion Spur',
  "Hawking's Gap", "Dryman's Point", 'Sagittarius Carina Arm', 'Mare Somnia', 'Acheron', 'Formorian Frontier',
  'Heironymous Delta', 'Outer Scutum-Centaurus Arm', 'Outer Arm', "Aquila's Halo", 'Errant Marches', 'Perseus Arm',
  'Formidine Rift', 'Vulcan Gate', 'Elysian Shore', 'Sanguineous Rim', 'Outer Orion Spur', "Achilles' Altar", 'Xibalba',
  "Lyra's Song", 'Tenebrae', 'The Abyss', "Kepler's Crest", 'The Void'];

// Bioforge region spellings that differ from the codex region list.
const REGION_ALIASES = {
  'achillessaltar': 'achillesaltar',
  'hieronymusdelta': 'heironymousdelta',
  'theformidinerift': 'formidinerift',
};
const regionKey = (name) => {
  const key = String(name).toLowerCase().replace(/[^a-z]/g, '');
  return REGION_ALIASES[key] ?? key;
};

function normaliseRuleset(ruleset, regionArms) {
  const out = {};
  if (ruleset.atmosphere !== undefined) out.atmosphere = ruleset.atmosphere === 'Any' ? 'Any' : [...ruleset.atmosphere];
  if (ruleset.body_type) out.bodyTypes = [...ruleset.body_type];
  for (const [from, to] of [['min_gravity', 'minGravity'], ['max_gravity', 'maxGravity'], ['min_temperature', 'minTemperature'],
    ['max_temperature', 'maxTemperature'], ['min_pressure', 'minPressure'], ['max_pressure', 'maxPressure'], ['distance', 'minDistance']]) {
    if (ruleset[from] !== undefined) out[to] = Number(ruleset[from]);
  }
  if (ruleset.atmosphere_component) out.atmosphereComponents = { ...ruleset.atmosphere_component };
  if (ruleset.volcanism !== undefined) {
    const value = ruleset.volcanism;
    if (Array.isArray(value)) {
      out.volcanism = {
        mode: 'list',
        values: value.filter((item) => !item.startsWith('=')),
        exact: value.filter((item) => item.startsWith('=')).map((item) => item.slice(1)),
      };
    } else if (value === 'None') out.volcanism = { mode: 'none' };
    else if (value === 'Any') out.volcanism = { mode: 'any' };
    else if (value.startsWith('!')) out.volcanism = { mode: 'not', values: [value.slice(1)] };
    else throw new Error(`Unknown volcanism rule ${value}`);
  }
  if (ruleset.regions) {
    const include = new Set();
    const exclude = new Set();
    for (const arm of ruleset.regions) {
      const target = arm.startsWith('!') ? exclude : include;
      const ids = regionArms[arm.replace(/^!/, '')];
      if (!ids) throw new Error(`Unknown region arm ${arm}`);
      for (const id of ids) target.add(id);
    }
    out.regions = { include: [...include].sort((a, b) => a - b), exclude: [...exclude].sort((a, b) => a - b) };
  }
  return out;
}

// Spreads Bioforge bins (which differ per variant) over one fixed grid.
function mergeHistogram(binLists) {
  const bins = binLists.flat().filter((bin) => Number.isFinite(bin?.min) && Number.isFinite(bin?.max) && bin.value > 0);
  if (!bins.length) return null;
  const min = Math.min(...bins.map((bin) => bin.min));
  const max = Math.max(...bins.map((bin) => bin.max));
  if (!(max > min)) return null;
  const step = (max - min) / HISTOGRAM_STEPS;
  const counts = new Array(HISTOGRAM_STEPS).fill(0);
  for (const bin of bins) {
    const width = Math.max(bin.max - bin.min, 1e-12);
    for (let index = 0; index < HISTOGRAM_STEPS; index += 1) {
      const lo = min + index * step;
      const overlap = Math.min(bin.max, lo + step) - Math.max(bin.min, lo);
      if (overlap > 0) counts[index] += bin.value * (overlap / width);
    }
  }
  const total = counts.reduce((sum, count) => sum + count, 0);
  const prior = 0.5;
  const density = counts.map((count) => (count + prior) / (total + prior * HISTOGRAM_STEPS) / step);
  const floor = Math.min(...density) * 0.1;
  return { min, step, density: density.map((value) => Number(value.toPrecision(5))), floor: Number(floor.toPrecision(5)) };
}

const DEFAULT_RANGES = { temperature: [0, 1000], gravity: [0, 1], pressure: [0, 0.1] };

function uniformHistogram(rulesets, field) {
  const suffix = field[0].toUpperCase() + field.slice(1);
  const mins = rulesets.map((rule) => rule[`min${suffix}`]).filter(Number.isFinite);
  const maxes = rulesets.map((rule) => rule[`max${suffix}`]).filter(Number.isFinite);
  let [min, max] = DEFAULT_RANGES[field];
  if (mins.length === rulesets.length) min = Math.min(...mins);
  if (maxes.length === rulesets.length) max = Math.max(...maxes);
  const width = Math.max(max - min, 1e-9);
  return { min, step: width, density: [Number((1 / width).toPrecision(5))], floor: Number((0.1 / width).toPrecision(5)) };
}

function speciesKeyFromVariant(fdevname) {
  const match = /^(\$Codex_Ent_[A-Za-z]+_\d+)_([A-Za-z]+)_Name;$/.exec(fdevname);
  if (match) return { species: `${match[1]}_Name;`, code: match[2] };
  return { species: fdevname, code: null };
}

export async function buildBioModel() {
  const rules = JSON.parse(await fs.readFile(rulesPath, 'utf8'));
  if (!existsSync(path.join(bioforgeDir, 'meta.json'))) {
    throw new Error('Bioforge statistics are missing. Run npm run import:bioforge first.');
  }
  const bioforgeMeta = JSON.parse(await fs.readFile(path.join(bioforgeDir, 'meta.json'), 'utf8'));
  const regionIds = new Map(CODEX_REGIONS.map((name, index) => [regionKey(name), index + 1]));

  const variantsBySpecies = new Map();
  for (const file of bioforgeMeta.files) {
    const catalog = JSON.parse(await fs.readFile(path.join(bioforgeDir, file), 'utf8'));
    for (const variant of Object.values(catalog)) {
      const { species, code } = speciesKeyFromVariant(variant.fdevname);
      if (!variantsBySpecies.has(species)) variantsBySpecies.set(species, []);
      variantsBySpecies.get(species).push({ ...variant, code });
    }
  }

  const unknownRegions = new Set();
  const genera = Object.entries(rules.genera).map(([genusKey, genus]) => {
    const species = Object.entries(genus.species).map(([speciesKey, entry]) => {
      const variants = variantsBySpecies.get(speciesKey) ?? [];
      const count = variants.reduce((sum, variant) => sum + (variant.count ?? 0), 0);
      const byCode = {};
      for (const variant of variants) if (variant.code) byCode[variant.code] = (byCode[variant.code] ?? 0) + (variant.count ?? 0);
      const regionSet = new Set();
      for (const variant of variants) {
        for (const name of variant.regions ?? []) {
          const id = regionIds.get(regionKey(name));
          if (id) regionSet.add(id);
          else unknownRegions.add(name);
        }
      }
      const rulesets = entry.rulesets.map((ruleset) => normaliseRuleset(ruleset, rules.regionArms));
      const hist = {};
      for (const field of ['temperature', 'gravity', 'pressure']) {
        // Densities are compared across a genus, so every species needs one:
        // without Bioforge data it is uniform over the rule range.
        hist[field] = mergeHistogram(variants.map((variant) => variant.histograms?.[field] ?? []))
          ?? uniformHistogram(rulesets, field);
      }
      const codes = Object.keys(byCode);
      return {
        key: speciesKey,
        name: entry.name,
        value: entry.value,
        target: entry.target,
        rulesets,
        count,
        // Colour variants follow either the local star class or a rare surface material.
        variantKind: codes.length && codes.every((code) => MATERIALS.has(code)) ? 'material' : 'star',
        variants: codes.length ? byCode : null,
        regions: count >= REGION_GATE_MIN_COUNT && regionSet.size ? [...regionSet].sort((a, b) => a - b) : null,
        hist,
      };
    });
    return { key: genusKey, name: genus.name, species };
  });
  if (unknownRegions.size) throw new Error(`Unmapped Bioforge regions: ${[...unknownRegions].join(', ')}`);

  return {
    format: 'ed-bio-model',
    version: MODEL_VERSION,
    generatedAt: new Date().toISOString(),
    sources: {
      rules: rules.source,
      bioforge: { source: bioforgeMeta.source, commit: bioforgeMeta.commit, fetchedAt: bioforgeMeta.fetchedAt },
    },
    genera,
  };
}

export async function writeBioModel() {
  const model = await buildBioModel();
  await writeFileAtomic(outPath, `${JSON.stringify(model)}\n`);
  const targets = model.genera.flatMap((genus) => genus.species.filter((species) => species.target));
  console.log(`Bio model written: ${model.genera.length} genera, ${targets.length} target species.`);
  for (const species of targets) {
    console.log(`  ${species.name.padEnd(24)} finds ${String(species.count).padStart(7)}  variants ${Object.keys(species.variants ?? {}).join(',') || '-'}  regions ${species.regions?.length ?? 'any'}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeBioModel().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
