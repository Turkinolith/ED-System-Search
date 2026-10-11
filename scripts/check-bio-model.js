// Checks data/bio-model.json against the species you have analysed in your own
// journals. For every body with a ScanOrganic result in a modelled genus, the
// body is rebuilt from its journal Scan event and the model is asked whether
// the species found can be there (recall) and how much of its genus it gets.
//
// Usage: node scripts/check-bio-model.js [journal-dir]
import { createReadStream, promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { normaliseJournalBody, parseRegionRaster, regionAt, speciesShares, speciesWeight } from '../public/bio-model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
const journalDir = process.argv[2]
  ?? process.env.EDSS_JOURNAL_DIR
  ?? path.join(homedir(), 'Saved Games', 'Frontier Developments', 'Elite Dangerous');

async function readJournalEvents(dir) {
  const names = (await fs.readdir(dir)).filter((name) => /^Journal\..*\.log$/i.test(name)).sort();
  const systems = new Map();
  const system = (address) => {
    if (!systems.has(address)) systems.set(address, { starPos: null, stars: new Map(), bodies: new Map(), genuses: new Map(), organics: new Map() });
    return systems.get(address);
  };
  for (const name of names) {
    const lines = readline.createInterface({ input: createReadStream(path.join(dir, name), 'utf8'), crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.includes('"event"')) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      const address = event.SystemAddress;
      if (address === undefined) continue;
      if ((event.event === 'FSDJump' || event.event === 'Location' || event.event === 'CarrierJump') && event.StarPos) {
        system(address).starPos = event.StarPos;
      } else if (event.event === 'Scan') {
        if (event.StarType) system(address).stars.set(event.BodyID, event);
        else if (event.PlanetClass) system(address).bodies.set(event.BodyID, event);
      } else if (event.event === 'SAASignalsFound' && Array.isArray(event.Genuses)) {
        system(address).genuses.set(event.BodyID, event.Genuses.map((item) => item.Genus));
      } else if (event.event === 'ScanOrganic' && event.ScanType === 'Analyse') {
        const organics = system(address).organics;
        if (!organics.has(event.Body)) organics.set(event.Body, new Set());
        organics.get(event.Body).add(event.Species_Localised);
      }
    }
  }
  return systems;
}

async function main() {
  const model = JSON.parse(await fs.readFile(path.join(dataDir, 'bio-model.json'), 'utf8'));
  const raster = parseRegionRaster(await fs.readFile(path.join(dataDir, 'region-raster.bin')));
  const speciesByName = new Map();
  for (const genus of model.genera) for (const species of genus.species) speciesByName.set(species.name, { genus, species });

  const systems = await readJournalEvents(journalDir);
  const bySpecies = new Map();
  const misses = [];
  let checked = 0;
  let skippedNoScan = 0;
  for (const [, system] of systems) {
    const region = system.starPos ? regionAt(raster, system.starPos[0], system.starPos[2]) : null;
    for (const [bodyId, found] of system.organics) {
      const scan = system.bodies.get(bodyId);
      for (const speciesName of found) {
        const entry = speciesByName.get(speciesName);
        if (!entry) continue;
        if (!scan) {
          skippedNoScan += 1;
          continue;
        }
        checked += 1;
        const body = normaliseJournalBody(scan, { stars: [...system.stars.values()], region, genuses: system.genuses.get(bodyId) ?? null });
        const weight = speciesWeight(entry.species, body);
        const genusShares = speciesShares(model, body).find((item) => item.genus.key === entry.genus.key);
        const ranked = (genusShares?.species ?? []).sort((a, b) => b.share - a.share);
        const rank = ranked.findIndex((item) => item.species === entry.species);
        const share = rank >= 0 ? ranked[rank].share : 0;
        const stats = bySpecies.get(speciesName) ?? { name: speciesName, target: entry.species.target, bodies: 0, gated: 0, top1: 0, shareSum: 0 };
        stats.bodies += 1;
        if (weight > 0) stats.gated += 1;
        if (rank === 0) stats.top1 += 1;
        stats.shareSum += share;
        bySpecies.set(speciesName, stats);
        if (weight === 0) {
          misses.push(`${speciesName} on ${scan.BodyName}: ${body.bodyType}, ${body.atmosphere || 'no atmosphere'}, ${body.temperature?.toFixed(0)} K, ${body.gravity?.toFixed(3)} g, ${body.pressure?.toFixed(4)} atm, volcanism "${body.volcanism}", stars ${[...body.starCodes].join('/') || '?'}, region ${region}`);
        }
      }
    }
  }

  const rows = [...bySpecies.values()].sort((a, b) => Number(b.target) - Number(a.target) || b.bodies - a.bodies);
  const total = rows.reduce((acc, row) => ({ bodies: acc.bodies + row.bodies, gated: acc.gated + row.gated, top1: acc.top1 + row.top1 }), { bodies: 0, gated: 0, top1: 0 });
  const targets = rows.filter((row) => row.target).reduce((acc, row) => ({ bodies: acc.bodies + row.bodies, gated: acc.gated + row.gated, top1: acc.top1 + row.top1 }), { bodies: 0, gated: 0, top1: 0 });
  console.log(`Checked ${checked} species-on-body finds from ${journalDir} (${skippedNoScan} skipped: body never scanned in these journals).`);
  console.log('species                    target bodies  recall  top-1  mean share');
  for (const row of rows) {
    console.log(`${row.name.padEnd(26)} ${row.target ? '  *  ' : '     '} ${String(row.bodies).padStart(6)}  ${(row.gated / row.bodies * 100).toFixed(0).padStart(5)}%  ${(row.top1 / row.bodies * 100).toFixed(0).padStart(4)}%  ${(row.shareSum / row.bodies).toFixed(2).padStart(6)}`);
  }
  console.log(`All species: recall ${(total.gated / total.bodies * 100).toFixed(1)}%, top-1 ${(total.top1 / total.bodies * 100).toFixed(1)}%`);
  if (targets.bodies) console.log(`Target species: recall ${(targets.gated / targets.bodies * 100).toFixed(1)}%, top-1 ${(targets.top1 / targets.bodies * 100).toFixed(1)}%`);
  if (misses.length) {
    console.log(`\nRuled out although found (${misses.length}):`);
    for (const miss of misses.slice(0, 40)) console.log(`  ${miss}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
