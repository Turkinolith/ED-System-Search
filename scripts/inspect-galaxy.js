import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import readline from 'node:readline';
import path from 'node:path';

const source = path.resolve(process.argv[2] ?? 'galaxy.json.gz');
const limit = Math.max(1, Number(process.argv[3] ?? 20000));

function observe(map, object) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) return;
  for (const [key, value] of Object.entries(object)) {
    const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    const entry = map.get(key) ?? { count: 0, types: new Set() };
    entry.count += 1;
    entry.types.add(type);
    map.set(key, entry);
  }
}

function sortedFields(map) {
  return [...map.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .map(([name, value]) => ({
      name,
      count: value.count,
      types: [...value.types].sort(),
    }));
}

const topFields = new Map();
const bodyFields = new Map();
const stationFields = new Map();
const marketFields = new Map();
const bodyTypes = new Map();
const stationTypes = new Map();
const atmosphereTypes = new Map();
const volcanismTypes = new Map();
const ringTypes = new Map();
const securityTypes = new Map();
const primaryEconomies = new Map();
const secondaryEconomies = new Map();
const governments = new Map();
let systems = 0;
let bodies = 0;
let stations = 0;
let populated = 0;
let systemsWithStations = 0;
let systemsWithFactions = 0;
let systemsWithPowers = 0;
let systemsWithThargoidWar = 0;
let systemsWithLandables = 0;
let minBodies = Infinity;
let maxBodies = 0;

const input = createReadStream(source);
const gunzip = createGunzip();
input.pipe(gunzip);
const lines = readline.createInterface({ input: gunzip, crlfDelay: Infinity });

try {
  for await (const line of lines) {
    let text = line.trim();
    if (!text || text === '[' || text === ']') continue;
    if (text.endsWith(',')) text = text.slice(0, -1);
    const system = JSON.parse(text);
    systems += 1;
    observe(topFields, system);
    for (const [map, value] of [
      [securityTypes, system.security],
      [primaryEconomies, system.primaryEconomy],
      [secondaryEconomies, system.secondaryEconomy],
      [governments, system.government],
    ]) {
      if (value) map.set(value, (map.get(value) ?? 0) + 1);
    }
    if (Number(system.population ?? 0) > 0) populated += 1;
    if (Array.isArray(system.factions) && system.factions.length) systemsWithFactions += 1;
    if ((Array.isArray(system.powers) && system.powers.length) || system.controllingPower) systemsWithPowers += 1;
    if (system.thargoidWar) systemsWithThargoidWar += 1;

    const systemBodies = Array.isArray(system.bodies) ? system.bodies : [];
    const declaredBodies = Number(system.bodyCount ?? systemBodies.length);
    minBodies = Math.min(minBodies, declaredBodies);
    maxBodies = Math.max(maxBodies, declaredBodies);
    let systemStationCount = Array.isArray(system.stations) ? system.stations.length : 0;
    let hasLandable = false;

    for (const body of systemBodies) {
      bodies += 1;
      observe(bodyFields, body);
      const type = body.subType ?? body.type ?? 'Unknown';
      bodyTypes.set(type, (bodyTypes.get(type) ?? 0) + 1);
      if (body.atmosphereType) atmosphereTypes.set(body.atmosphereType, (atmosphereTypes.get(body.atmosphereType) ?? 0) + 1);
      if (body.volcanismType) volcanismTypes.set(body.volcanismType, (volcanismTypes.get(body.volcanismType) ?? 0) + 1);
      for (const ring of Array.isArray(body.rings) ? body.rings : []) {
        const type = ring.type ?? 'Unknown';
        ringTypes.set(type, (ringTypes.get(type) ?? 0) + 1);
      }
      if (body.isLandable) hasLandable = true;
      const bodyStations = Array.isArray(body.stations) ? body.stations : [];
      systemStationCount += bodyStations.length;
      for (const station of bodyStations) {
        stations += 1;
        observe(stationFields, station);
        const stationType = station.type ?? 'Unknown';
        stationTypes.set(stationType, (stationTypes.get(stationType) ?? 0) + 1);
        if (station.market) observe(marketFields, station.market);
      }
    }
    for (const station of Array.isArray(system.stations) ? system.stations : []) {
      stations += 1;
      observe(stationFields, station);
      const stationType = station.type ?? 'Unknown';
      stationTypes.set(stationType, (stationTypes.get(stationType) ?? 0) + 1);
      if (station.market) observe(marketFields, station.market);
    }
    if (systemStationCount > 0) systemsWithStations += 1;
    if (hasLandable) systemsWithLandables += 1;
    if (systems >= limit) break;
  }
} finally {
  lines.close();
  input.destroy();
  gunzip.destroy();
}

const report = {
  source,
  sampledSystems: systems,
  bodies,
  stations,
  populatedSystems: populated,
  systemsWithStations,
  systemsWithFactions,
  systemsWithPowers,
  systemsWithThargoidWar,
  systemsWithLandables,
  bodyCountRange: {
    min: Number.isFinite(minBodies) ? minBodies : null,
    max: maxBodies,
  },
  topLevelFields: sortedFields(topFields),
  bodyFields: sortedFields(bodyFields),
  stationFields: sortedFields(stationFields),
  marketFields: sortedFields(marketFields),
  commonBodyTypes: [...bodyTypes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([name, count]) => ({ name, count })),
  commonStationTypes: [...stationTypes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([name, count]) => ({ name, count })),
  atmosphereTypes: [...atmosphereTypes.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
  volcanismTypes: [...volcanismTypes.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
  ringTypes: [...ringTypes.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
  securityTypes: [...securityTypes.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
  primaryEconomies: [...primaryEconomies.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
  secondaryEconomies: [...secondaryEconomies.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
  governments: [...governments.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
};

console.log(JSON.stringify(report, null, 2));
