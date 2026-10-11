// Regenerates scripts/bio-rules.json from the EDMC-BioScan species rulesets
// (https://github.com/Silarn/EDMC-BioScan, GPL-2.0) at a pinned commit.
// The rulesets are Python dict literals; this converts them to JSON as-is and
// marks the high-value species this app maps.
//
// Usage: node scripts/generate-bio-rules.js [commit-sha]
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, 'bio-rules.json');
const commit = process.argv[2] ?? 'fc6b85c3de48c8fb79fa9e4f79ad780e48f56629';
const base = `https://raw.githubusercontent.com/Silarn/EDMC-BioScan/${commit}/src/bio_scan/bio_data`;
const rulesetFiles = ['aleoida', 'bacterium', 'cactoida', 'clypeus', 'concha', 'fonticulua', 'fumerola', 'osseus', 'recepta', 'stratum', 'tussock'];

// Values match BioScan except where noted; Concha Biconcavis is 19,010,800 in
// game (BioScan carries a 16,777,215 placeholder).
export const targetSpecies = Object.freeze({
  'Stratum Tectonicas': 19010800,
  'Tussock Stigmasis': 19010800,
  'Fonticulua Segmentatus': 19010800,
  'Concha Biconcavis': 19010800,
  'Stratum Cucumisis': 16202800,
  'Clypeus Speculumi': 16202800,
  'Cactoida Vermis': 16202800,
  'Recepta Deltahedronix': 16202800,
  'Fumerola Extremus': 16202800,
  'Tussock Virgam': 14313700,
  'Recepta Conditivus': 14313700,
  'Osseus Discus': 12934900,
  'Aleoida Gravis': 12934900,
  'Recepta Umbrux': 12934900,
  'Clypeus Margaritus': 11873200,
  'Osseus Pellebantus': 9739000,
  'Bacterium Informem': 8418000,
  'Clypeus Lacrimam': 8418000,
});

function stripComments(source) {
  return source.split('\n').map((line) => {
    let quote = null;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (quote) {
        if (char === quote) quote = null;
      } else if (char === '\'' || char === '"') {
        quote = char;
      } else if (char === '#') {
        return line.slice(0, index);
      }
    }
    return line;
  }).join('\n');
}

// Returns the balanced {...} literal that follows `name ... =`.
function dictLiteral(source, name) {
  const start = source.indexOf('{', source.indexOf('=', source.indexOf(name)));
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Unbalanced literal for ${name}`);
}

export function pythonDictToJson(literal) {
  const json = stripComments(literal)
    .replace(/'/g, '"')
    .replace(/\bTrue\b/g, 'true')
    .replace(/\bFalse\b/g, 'false')
    .replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(json);
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'ed-system-search' } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
}

async function main() {
  const regionsSource = await fetchText(`${base}/regions.py`);
  const regionArms = pythonDictToJson(dictLiteral(regionsSource, 'region_map'));
  const genera = {};
  const ruleKeys = new Set();
  const foundTargets = new Set();
  for (const file of rulesetFiles) {
    const catalog = pythonDictToJson(dictLiteral(stripComments(await fetchText(`${base}/rulesets/${file}.py`)), 'catalog'));
    for (const [genusKey, speciesMap] of Object.entries(catalog)) {
      if (!genusKey.endsWith('_Genus_Name;')) continue;
      const species = {};
      for (const [speciesKey, entry] of Object.entries(speciesMap)) {
        for (const ruleset of entry.rulesets) for (const key of Object.keys(ruleset)) ruleKeys.add(key);
        const value = targetSpecies[entry.name];
        if (value) foundTargets.add(entry.name);
        species[speciesKey] = {
          name: entry.name,
          value: value ?? entry.value,
          target: Boolean(value),
          rulesets: entry.rulesets,
        };
      }
      genera[genusKey] = { name: Object.values(species)[0].name.split(' ')[0], species };
    }
  }
  const missing = Object.keys(targetSpecies).filter((name) => !foundTargets.has(name));
  if (missing.length) throw new Error(`Target species not found in rulesets: ${missing.join(', ')}`);
  const payload = {
    source: {
      rules: 'EDMC-BioScan species rulesets by Silarn (GPL-2.0), https://github.com/Silarn/EDMC-BioScan',
      commit,
      values: 'Base values per elitecheatsheet.com/exploration-and-exobiology (verified 2026-09-10)',
      generatedAt: new Date().toISOString(),
    },
    ruleKeys: [...ruleKeys].sort(),
    regionArms,
    genera,
  };
  await fs.writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`);
  const speciesCount = Object.values(genera).reduce((sum, genus) => sum + Object.keys(genus.species).length, 0);
  console.log(`Wrote ${outPath}: ${Object.keys(genera).length} genera, ${speciesCount} species, rule keys ${payload.ruleKeys.join(', ')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
