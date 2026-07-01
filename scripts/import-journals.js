import { createReadStream, existsSync, promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { loadLocalConfig } from '../local-config.js';
import { nameLookupKey } from './name-lookup-key.js';
import { suggestKey } from './suggest-key.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.dirname(__dirname);
const dataDir = process.env.EDSS_DATA_DIR ? path.resolve(process.env.EDSS_DATA_DIR) : path.join(rootDir, 'data');
const defaultJournalDir = process.env.EDSS_JOURNAL_DIR
  ? path.resolve(process.env.EDSS_JOURNAL_DIR)
  : path.join(homedir(), 'Saved Games', 'Frontier Developments', 'Elite Dangerous');
const searchPath = path.join(dataDir, 'systems-search.tsv');
const metaPath = path.join(dataDir, 'systems-meta.json');
const visitedPath = path.join(dataDir, 'visited.json');
const visitedIndexesPath = path.join(dataDir, 'visited-indexes.json');
const supplementalPath = path.join(dataDir, 'journal-systems.json');
const journalBodiesPath = path.join(dataDir, 'journal-bodies.json');
const journalStatePath = path.join(dataDir, 'journal-tail-state.json');
const lookupDir = path.join(dataDir, 'name-lookup');
const lookupOverlayPath = path.join(dataDir, 'name-lookup-overlay.tsv');
const suggestDir = path.join(dataDir, 'suggest');
const recordsPath = path.join(dataDir, 'systems.bin');
const recordBytes = 32;
const trackedCarrier = loadLocalConfig().trackedCarrier;
const carrierBootstrapBytes = 4 * 1024 * 1024;

const visitEvents = new Set([
  'Location',
  'FSDJump',
  'CarrierJump',
  'CarrierLocation',
  'Docked',
  'Undocked',
  'SupercruiseEntry',
  'SupercruiseExit',
  'Scan',
  'FSSDiscoveryScan',
  'FSSAllBodiesFound',
  'SAAScanComplete',
  'SAASignalsFound',
  'ScanOrganic',
  'SellExplorationData',
  'MultiSellExplorationData',
  'SellOrganicData',
]);

const bodyDataEvents = new Set([
  'Scan',
  'SAAScanComplete',
  'SAASignalsFound',
  'FSSBodySignals',
  'FSSDiscoveryScan',
  'FSSAllBodiesFound',
  'NavBeaconScan',
]);

function journalSystemAddress(event) {
  const value = event._systemAddress ?? event.SystemAddress;
  if (value === undefined || value === null || value === '') return null;
  return String(value);
}

function preserveSystemAddress(line, event) {
  const match = line.match(/"SystemAddress"\s*:\s*(\d+)/);
  if (match) event._systemAddress = match[1];
  return event;
}

function systemName(event) {
  if (typeof event.StarSystem === 'string') return event.StarSystem.trim();
  if (typeof event.System === 'string') return event.System.trim();
  if (typeof event.SystemName === 'string') return event.SystemName.trim();
  if (typeof event.Body === 'string') return event.Body.replace(/\s+[A-Z0-9 -]+$/, '').trim();
  return null;
}

function systemKey(name) {
  return String(name ?? '').trim().toLowerCase();
}

async function matchExactLookupFile(filePath, names, addImportedMatch) {
  if (!existsSync(filePath) || names.size === 0) return new Set();
  const found = new Set();
  const rl = readline.createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const [lowerName, indexText] = line.split('\t');
    if (names.has(lowerName) && addImportedMatch(lowerName, indexText)) found.add(lowerName);
  }
  return found;
}

async function findExactLookupIndex(filePath, lowerName) {
  if (!existsSync(filePath) || !lowerName) return null;
  const rl = readline.createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const [candidate, indexText] = line.split('\t');
    if (candidate === lowerName) {
      const index = Number(indexText);
      return Number.isInteger(index) ? index : null;
    }
  }
  return null;
}

function starClassToMainStar(starClass) {
  const key = String(starClass ?? '').trim();
  const map = new Map([
    ['O', 'O (Blue-White) Star'],
    ['B', 'B (Blue-White) Star'],
    ['A', 'A (Blue-White) Star'],
    ['F', 'F (White) Star'],
    ['G', 'G (White-Yellow) Star'],
    ['K', 'K (Yellow-Orange) Star'],
    ['M', 'M (Red dwarf) Star'],
    ['L', 'L (Brown dwarf) Star'],
    ['T', 'T (Brown dwarf) Star'],
    ['Y', 'Y (Brown dwarf) Star'],
    ['N', 'Neutron Star'],
    ['H', 'Black Hole'],
    ['SupermassiveBlackHole', 'Supermassive Black Hole'],
    ['D', 'White Dwarf (D) Star'],
    ['DA', 'White Dwarf (DA) Star'],
    ['DAB', 'White Dwarf (DAB) Star'],
    ['DAV', 'White Dwarf (DAV) Star'],
    ['DAZ', 'White Dwarf (DAZ) Star'],
    ['DB', 'White Dwarf (DB) Star'],
    ['DBV', 'White Dwarf (DBV) Star'],
    ['DBZ', 'White Dwarf (DBZ) Star'],
    ['DC', 'White Dwarf (DC) Star'],
    ['DCV', 'White Dwarf (DCV) Star'],
    ['DQ', 'White Dwarf (DQ) Star'],
    ['TTS', 'T Tauri Star'],
    ['AeBe', 'Herbig Ae/Be Star'],
    ['W', 'Wolf-Rayet Star'],
    ['WN', 'Wolf-Rayet N Star'],
    ['WNC', 'Wolf-Rayet NC Star'],
    ['WC', 'Wolf-Rayet C Star'],
    ['WO', 'Wolf-Rayet O Star'],
    ['C', 'C Star'],
    ['CJ', 'CJ Star'],
    ['CN', 'CN Star'],
    ['S', 'S-type Star'],
    ['MS', 'MS-type Star'],
  ]);
  return map.get(key) ?? (key ? `${key} Star` : 'Unknown');
}

function mainStarEvidence(event) {
  const systemStarClass = typeof event.StarClass === 'string' && event.StarClass.trim()
    ? event.StarClass.trim()
    : null;
  if (systemStarClass) return { starClass: systemStarClass, priority: 3 };

  const scannedStarClass = typeof event.StarType === 'string' && event.StarType.trim()
    ? event.StarType.trim()
    : null;
  if (!scannedStarClass) return null;
  const bodyId = finiteNumber(event.BodyID);
  const distance = finiteNumber(event.DistanceFromArrivalLS);
  const isArrivalStar = bodyId === 0 || (distance !== undefined && Math.abs(distance) < 0.001);
  return { starClass: scannedStarClass, priority: isArrivalStar ? 2 : 1 };
}

function systemMainStarPriority(system) {
  const explicit = Number(system?.mainStarPriority);
  if (Number.isFinite(explicit)) return explicit;
  return system?.starClass || (system?.mainStar && system.mainStar !== 'Unknown') ? 2 : 0;
}

function journalCoords(event) {
  const pos = event.StarPos;
  if (!Array.isArray(pos) || pos.length < 3) return null;
  const coords = { x: Number(pos[0]), y: Number(pos[1]), z: Number(pos[2]) };
  return Number.isFinite(coords.x) && Number.isFinite(coords.y) && Number.isFinite(coords.z) ? coords : null;
}

function finiteNumber(value, transform = (number) => number) {
  const number = Number(value);
  return Number.isFinite(number) ? transform(number) : undefined;
}

function localizedValue(event, key) {
  const localized = event[`${key}_Localised`];
  if (typeof localized === 'string' && localized.trim()) return localized.trim();
  const value = event[key];
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return value.replace(/^\$/, '').replace(/;$/, '').replaceAll('_', ' ').trim();
}

function journalMaterials(materials) {
  if (!materials) return undefined;
  if (!Array.isArray(materials)) return typeof materials === 'object' ? materials : undefined;
  return Object.fromEntries(materials
    .map((material) => [material.Name ?? material.name, finiteNumber(material.Percent ?? material.percent)])
    .filter(([name, percent]) => name && percent !== undefined));
}

function journalRings(rings) {
  if (!Array.isArray(rings)) return undefined;
  return rings.map((ring) => ({
    name: ring.Name ?? ring.name,
    type: ring.RingClass_Localised
      ?? String(ring.RingClass ?? ring.type ?? '').replace(/^eRingClass_/, '').replaceAll('_', ' ').trim()
      ?? undefined,
    mass: finiteNumber(ring.MassMT ?? ring.mass),
    innerRadius: finiteNumber(ring.InnerRad ?? ring.innerRadius, (value) => value / 1000),
    outerRadius: finiteNumber(ring.OuterRad ?? ring.outerRadius, (value) => value / 1000),
  }));
}

function journalSignals(event) {
  if (!Array.isArray(event.Signals)) return undefined;
  return Object.fromEntries(event.Signals.map((signal, index) => {
    const label = signal.Type_Localised ?? localizedValue(signal, 'Type') ?? `Signal ${index + 1}`;
    return [label, {
      count: finiteNumber(signal.Count) ?? 0,
      type: signal.Type,
    }];
  }));
}

function journalBodyKey(body) {
  if (body?.bodyId !== undefined && body?.bodyId !== null) return `id:${body.bodyId}`;
  return `name:${systemKey(body?.name)}`;
}

function mergeJournalBody(existing, incoming) {
  if (!existing) return incoming;
  return {
    ...existing,
    ...Object.fromEntries(Object.entries(incoming).filter(([, value]) => value !== undefined)),
    materials: { ...(existing.materials ?? {}), ...(incoming.materials ?? {}) },
    composition: { ...(existing.composition ?? {}), ...(incoming.composition ?? {}) },
    signals: { ...(existing.signals ?? {}), ...(incoming.signals ?? {}) },
    rings: incoming.rings?.length ? incoming.rings : existing.rings,
    genuses: incoming.genuses?.length ? incoming.genuses : existing.genuses,
    updateTime: latestTimestamp(existing.updateTime, incoming.updateTime),
  };
}

function journalScanBody(event) {
  const isStar = typeof event.StarType === 'string' && event.StarType.length > 0;
  const planetClass = localizedValue(event, 'PlanetClass');
  const name = event.BodyName ?? (typeof event.Body === 'string' ? event.Body : undefined);
  const bodyId = finiteNumber(event.BodyID);
  const body = {
    bodyId,
    name,
    type: isStar ? 'Star' : planetClass ? 'Planet' : 'Body',
    subType: isStar ? starClassToMainStar(event.StarType) : planetClass,
    spectralClass: event.StarType,
    luminosity: event.Luminosity,
    solarMasses: finiteNumber(event.StellarMass),
    solarRadius: finiteNumber(event.Radius, (value) => value / 695700000),
    earthMasses: finiteNumber(event.MassEM),
    gravity: finiteNumber(event.SurfaceGravity, (value) => value / 9.80665),
    radius: finiteNumber(event.Radius, (value) => value / 1000),
    surfaceTemperature: finiteNumber(event.SurfaceTemperature),
    surfacePressure: finiteNumber(event.SurfacePressure),
    distanceToArrival: finiteNumber(event.DistanceFromArrivalLS),
    atmosphereType: localizedValue(event, 'AtmosphereType') ?? localizedValue(event, 'Atmosphere'),
    atmosphereComposition: event.AtmosphereComposition,
    volcanismType: localizedValue(event, 'Volcanism'),
    terraformingState: localizedValue(event, 'TerraformState'),
    reserveLevel: localizedValue(event, 'ReserveLevel'),
    isLandable: event.Landable === true,
    orbitalPeriod: finiteNumber(event.OrbitalPeriod, (value) => value / 86400),
    rotationalPeriod: finiteNumber(event.RotationPeriod, (value) => value / 86400),
    axialTilt: finiteNumber(event.AxialTilt),
    semiMajorAxis: finiteNumber(event.SemiMajorAxis),
    eccentricity: finiteNumber(event.Eccentricity),
    orbitalInclination: finiteNumber(event.OrbitalInclination),
    periapsis: finiteNumber(event.Periapsis),
    materials: journalMaterials(event.Materials),
    composition: event.Composition,
    rings: journalRings(event.Rings),
    parents: event.Parents,
    scanType: event.ScanType,
    updateTime: event.timestamp,
    source: 'Player Journal',
  };
  return Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined));
}

function recordJournalBodyEvent(bodySystems, namesByAddress, event) {
  const id64 = journalSystemAddress(event);
  if (!id64) return false;
  const existingSystem = bodySystems.get(id64) ?? {
    id64,
    name: namesByAddress.get(id64),
    source: 'Player Journal',
    bodies: new Map(),
  };
  existingSystem.name ??= namesByAddress.get(id64);
  existingSystem.updatedAt = latestTimestamp(existingSystem.updatedAt, event.timestamp);
  const reportedCount = finiteNumber(event.BodyCount ?? event.NumBodies);
  if (reportedCount !== undefined) existingSystem.bodyCount = Math.max(existingSystem.bodyCount ?? 0, reportedCount);

  if (event.event === 'Scan') {
    const body = journalScanBody(event);
    if (!body.name && body.bodyId === undefined) return false;
    const key = journalBodyKey(body);
    existingSystem.bodies.set(key, mergeJournalBody(existingSystem.bodies.get(key), body));
  } else if (['SAAScanComplete', 'SAASignalsFound', 'FSSBodySignals'].includes(event.event)) {
    const body = {
      bodyId: finiteNumber(event.BodyID),
      name: event.BodyName,
      mapped: event.event === 'SAAScanComplete' ? true : undefined,
      probesUsed: finiteNumber(event.ProbesUsed),
      efficiencyTarget: finiteNumber(event.EfficiencyTarget),
      signals: journalSignals(event),
      genuses: event.Genuses,
      updateTime: event.timestamp,
      source: 'Player Journal',
    };
    const key = journalBodyKey(body);
    existingSystem.bodies.set(key, mergeJournalBody(existingSystem.bodies.get(key), body));
  }
  bodySystems.set(id64, existingSystem);
  return true;
}

function matchesTrackedCarrier(event) {
  if (!trackedCarrier) return false;
  const eventNames = [event.Callsign, event.Name, event.StationName]
    .filter(Boolean)
    .map((value) => String(value).toLocaleLowerCase());
  const configuredNames = [trackedCarrier.name, trackedCarrier.callsign, trackedCarrier.label]
    .filter(Boolean)
    .map((value) => String(value).toLocaleLowerCase());
  return (trackedCarrier.id !== null && (
    Number(event.CarrierID) === trackedCarrier.id
    || Number(event.MarketID) === trackedCarrier.id
  )) || configuredNames.some((name) => eventNames.includes(name));
}

function carrierObservation(event) {
  if (!matchesTrackedCarrier(event)) return null;
  if (!['CarrierLocation', 'CarrierJump', 'Location', 'Docked'].includes(event.event)) return null;
  const name = systemName(event);
  if (!name) return null;
  return {
    name: trackedCarrier.label,
    callsign: trackedCarrier.callsign,
    carrierId: trackedCarrier.id,
    systemName: name,
    systemAddress: journalSystemAddress(event),
    timestamp: event.timestamp ?? '',
    event: event.event,
    coords: journalCoords(event),
  };
}

function parseArgs(argv) {
  const options = {
    journalDir: defaultJournalDir,
    latest: null,
    mergeExisting: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--latest') {
      options.latest = Math.max(1, Number(argv[index + 1] ?? 20) || 20);
      options.mergeExisting = true;
      index += 1;
    } else if (arg === '--all') {
      options.latest = null;
      options.mergeExisting = false;
    } else if (arg === '--merge-existing') {
      options.mergeExisting = true;
    } else if (!arg.startsWith('--')) {
      options.journalDir = arg;
    }
  }
  return options;
}

function journalFileKey(file) {
  return path.resolve(file).toLowerCase();
}

async function readJournalFiles(journalDir, latestLimit = null, state = null) {
  if (!existsSync(journalDir)) {
    console.warn(`Journal directory does not exist: ${journalDir}`);
    return { files: [], selectedFiles: [], allFiles: [], totalFileCount: 0 };
  }
  const names = (await fs.readdir(journalDir)).filter((name) => /^Journal\..*\.log$/i.test(name));
  const entries = (await Promise.all(names.map(async (name) => {
    const file = path.join(journalDir, name);
    const stat = await fs.stat(file).catch(() => null);
    return stat?.isFile() ? { file, name, size: stat.size, mtimeMs: stat.mtimeMs } : null;
  }))).filter(Boolean);
  const totalFileCount = entries.length;
  const selected = latestLimit
    ? entries.sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name)).slice(0, latestLimit)
    : entries;
  const selectedFiles = selected.sort((a, b) => a.name.localeCompare(b.name));
  const incremental = Boolean(latestLimit && state?.files);
  const files = selectedFiles
    .map((entry) => {
      const previous = state?.files?.[journalFileKey(entry.file)];
      const start = incremental && previous && previous.size <= entry.size ? previous.size : 0;
      return { ...entry, start };
    })
    .filter((entry) => !incremental || entry.start < entry.size);
  return {
    files,
    selectedFiles,
    allFiles: entries,
    totalFileCount,
  };
}

function progress(message) {
  console.log(`PROGRESS\t${message}`);
}

async function parseJournals(files) {
  const systems = new Map();
  const bodySystems = new Map();
  const namesByAddress = new Map();
  const carrierObservations = [];
  let latest = null;
  let eventCount = 0;
  let bodyEventCount = 0;

  for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
    const entry = typeof files[fileIndex] === 'string'
      ? { file: files[fileIndex], name: path.basename(files[fileIndex]), start: 0 }
      : files[fileIndex];
    const file = entry.file;
    progress(`reading ${fileIndex + 1}/${files.length}`);
    const rl = readline.createInterface({
      input: createReadStream(file, { encoding: 'utf8', start: entry.start ?? 0 }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (!line.trim()) continue;
      let event;
      try {
        event = preserveSystemAddress(line, JSON.parse(line));
      } catch {
        continue;
      }
      const name = systemName(event);
      const address = journalSystemAddress(event);
      if (name && address) namesByAddress.set(address, name);
      if (bodyDataEvents.has(event.event) && recordJournalBodyEvent(bodySystems, namesByAddress, event)) {
        bodyEventCount += 1;
      }
      if (!visitEvents.has(event.event)) continue;
      const carrier = carrierObservation(event);
      if (carrier) carrierObservations.push(carrier);
      if (!name) continue;
      const key = systemKey(name);
      if (!key) continue;
      const timestamp = event.timestamp ?? '';
      const previous = systems.get(key);
      const coords = journalCoords(event) ?? previous?.coords;
      const evidence = mainStarEvidence(event);
      const previousPriority = systemMainStarPriority(previous);
      const useEvidence = evidence && (evidence.priority > previousPriority || !previous?.starClass);
      const starClass = useEvidence ? evidence.starClass : previous?.starClass;
      const mainStarPriority = useEvidence ? evidence.priority : previousPriority;
      systems.set(key, {
        name,
        firstVisited: previous?.firstVisited ?? timestamp,
        lastVisited: !previous || timestamp > previous.lastVisited ? timestamp : previous.lastVisited,
        count: (previous?.count ?? 0) + 1,
        systemAddress: address ?? previous?.systemAddress,
        coords,
        starClass,
        mainStar: starClassToMainStar(starClass),
        mainStarPriority,
        lastEvent: !previous || timestamp > previous.lastVisited ? event.event : previous.lastEvent,
      });
      eventCount += 1;
      if (!latest || timestamp > latest.timestamp) {
        latest = {
        name,
        key,
        timestamp,
        event: event.event,
        systemAddress: address,
        coords,
        starClass,
      };
      }
    }
  }

  for (const [id64, system] of bodySystems) system.name ??= namesByAddress.get(id64);
  return { systems, bodySystems, latest, eventCount, bodyEventCount, carrierObservations };
}

async function parseCarrierObservations(files) {
  const carrierObservations = [];
  if (!trackedCarrier) return carrierObservations;
  const carrierNeedles = [trackedCarrier.id, trackedCarrier.name, trackedCarrier.callsign, trackedCarrier.label]
    .filter((value) => value !== null && value !== undefined && value !== '')
    .map(String);
  const newestFirst = [...files].sort((a, b) => (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0) || String(b.name ?? '').localeCompare(String(a.name ?? '')));
  for (let fileIndex = 0; fileIndex < newestFirst.length; fileIndex += 1) {
    const entry = typeof newestFirst[fileIndex] === 'string'
      ? { file: newestFirst[fileIndex], name: path.basename(newestFirst[fileIndex]), start: 0 }
      : { ...newestFirst[fileIndex], start: 0 };
    const fileObservations = [];
    progress(`carrier scan ${fileIndex + 1}/${newestFirst.length}`);
    const streamOptions = { encoding: 'utf8', start: 0 };
    if (entry.size && entry.size > carrierBootstrapBytes) streamOptions.end = carrierBootstrapBytes - 1;
    const rl = readline.createInterface({
      input: createReadStream(entry.file, streamOptions),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (!line.trim()) continue;
      if (!carrierNeedles.some((needle) => line.includes(needle))) continue;
      let event;
      try {
        event = preserveSystemAddress(line, JSON.parse(line));
      } catch {
        continue;
      }
      const carrier = carrierObservation(event);
      if (carrier) fileObservations.push(carrier);
    }
    if (fileObservations.length) {
      carrierObservations.push(...fileObservations);
      break;
    }
  }
  return carrierObservations;
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function systemMapFromList(systems) {
  const map = new Map();
  for (const system of systems ?? []) {
    const key = systemKey(system?.name);
    if (key) map.set(key, system);
  }
  return map;
}

function earliestTimestamp(a, b) {
  if (!a) return b ?? '';
  if (!b) return a;
  return a <= b ? a : b;
}

function latestTimestamp(a, b) {
  if (!a) return b ?? '';
  if (!b) return a;
  return a >= b ? a : b;
}

function mergeSystem(existing, incoming) {
  if (!existing) return incoming;
  const lastVisited = latestTimestamp(existing.lastVisited, incoming.lastVisited);
  const incomingIsLatest = incoming.lastVisited === lastVisited;
  const existingStarPriority = systemMainStarPriority(existing);
  const incomingStarPriority = systemMainStarPriority(incoming);
  const useIncomingStar = incomingStarPriority > existingStarPriority
    || (!existing.starClass && incoming.starClass);
  return {
    ...existing,
    ...incoming,
    name: incoming.name ?? existing.name,
    firstVisited: earliestTimestamp(existing.firstVisited, incoming.firstVisited),
    lastVisited,
    count: Math.max(Number(existing.count ?? 0), Number(incoming.count ?? 0)),
    systemAddress: incoming.systemAddress ?? existing.systemAddress,
    coords: incoming.coords ?? existing.coords,
    starClass: useIncomingStar ? incoming.starClass : existing.starClass,
    mainStar: useIncomingStar ? incoming.mainStar : existing.mainStar,
    mainStarPriority: useIncomingStar ? incomingStarPriority : existingStarPriority,
    lastEvent: incomingIsLatest ? incoming.lastEvent : existing.lastEvent,
  };
}

function mergeParsedWithExisting(parsed, existingPayload) {
  if (!existingPayload?.systems?.length) return parsed;
  const systems = systemMapFromList(existingPayload.systems);
  for (const [key, incoming] of parsed.systems) {
    systems.set(key, mergeSystem(systems.get(key), incoming));
  }
  const previousLatest = existingPayload.latestSystem;
  const latest = !previousLatest || (parsed.latest?.timestamp ?? '') > (previousLatest.timestamp ?? '')
    ? parsed.latest
    : previousLatest;
  return {
    ...parsed,
    systems,
    latest,
    eventCount: existingPayload.eventCount ?? parsed.eventCount,
  };
}

function bodySystemFromJson(system) {
  return {
    ...system,
    bodies: new Map((system?.bodies ?? []).map((body) => [journalBodyKey(body), body])),
  };
}

function mergeBodySystem(existing, incoming) {
  if (!existing) return incoming;
  const bodies = new Map(existing.bodies);
  for (const [key, body] of incoming.bodies) bodies.set(key, mergeJournalBody(bodies.get(key), body));
  return {
    ...existing,
    ...incoming,
    name: incoming.name ?? existing.name,
    bodyCount: Math.max(existing.bodyCount ?? 0, incoming.bodyCount ?? 0, bodies.size),
    updatedAt: latestTimestamp(existing.updatedAt, incoming.updatedAt),
    bodies,
  };
}

function makeJournalBodies(parsed, visitedSystems, existingPayload, mergeExisting) {
  const systems = new Map();
  if (mergeExisting) {
    for (const system of existingPayload?.systems ?? []) {
      if (system?.id64) systems.set(String(system.id64), bodySystemFromJson(system));
    }
  }
  for (const [id64, incoming] of parsed.bodySystems ?? []) {
    systems.set(id64, mergeBodySystem(systems.get(id64), incoming));
  }
  const visitedByAddress = new Map();
  for (const system of visitedSystems.values()) {
    if (system.systemAddress) visitedByAddress.set(String(system.systemAddress), system.name);
  }
  const output = [...systems.values()].map((system) => ({
    ...system,
    name: system.name ?? visitedByAddress.get(String(system.id64)) ?? null,
    bodyCount: Math.max(system.bodyCount ?? 0, system.bodies.size),
    bodies: [...system.bodies.values()].sort((a, b) => (
      Number(a.bodyId ?? Number.MAX_SAFE_INTEGER) - Number(b.bodyId ?? Number.MAX_SAFE_INTEGER)
      || String(a.name ?? '').localeCompare(String(b.name ?? ''))
    )),
  })).sort((a, b) => String(a.name ?? a.id64).localeCompare(String(b.name ?? b.id64)));
  return {
    updatedAt: new Date().toISOString(),
    systemCount: output.length,
    bodyCount: output.reduce((sum, system) => sum + system.bodies.length, 0),
    systems: output,
  };
}

function primaryStarFromBodySystem(bodySystem) {
  const stars = (bodySystem?.bodies ?? []).filter((body) => body?.type === 'Star' || body?.spectralClass);
  if (!stars.length) return null;
  const arrivalStars = stars.filter((body) => (
    Number(body.bodyId) === 0
    || (Number.isFinite(Number(body.distanceToArrival)) && Math.abs(Number(body.distanceToArrival)) < 0.001)
  ));
  const candidate = arrivalStars.sort((a, b) => (
    Number(a.bodyId ?? Number.MAX_SAFE_INTEGER) - Number(b.bodyId ?? Number.MAX_SAFE_INTEGER)
  ))[0] ?? (stars.length === 1 ? stars[0] : null);
  if (!candidate) return null;
  const starClass = candidate.spectralClass;
  const mainStar = candidate.subType ?? starClassToMainStar(starClass);
  if (!starClass && !mainStar) return null;
  return {
    starClass,
    mainStar,
    priority: arrivalStars.includes(candidate) ? 2 : 1,
  };
}

function reconcileMainStarsFromBodies(visitedSystems, journalBodies) {
  const byAddress = new Map();
  const byName = new Map();
  for (const bodySystem of journalBodies?.systems ?? []) {
    if (bodySystem?.id64) byAddress.set(String(bodySystem.id64), bodySystem);
    if (bodySystem?.name) byName.set(systemKey(bodySystem.name), bodySystem);
  }
  for (const [key, system] of visitedSystems) {
    const bodySystem = (system.systemAddress ? byAddress.get(String(system.systemAddress)) : null) ?? byName.get(key);
    const primary = primaryStarFromBodySystem(bodySystem);
    if (!primary) continue;
    const currentPriority = systemMainStarPriority(system);
    if (primary.priority < currentPriority) continue;
    system.starClass = primary.starClass ?? system.starClass;
    system.mainStar = primary.mainStar ?? starClassToMainStar(system.starClass);
    system.mainStarPriority = primary.priority;
  }
}

function makeJournalState(journalDir, entries, previousState = null) {
  const files = previousState?.files ? { ...previousState.files } : {};
  for (const entry of entries) {
    files[journalFileKey(entry.file)] = {
      path: entry.file,
      name: entry.name,
      size: entry.size,
      mtimeMs: entry.mtimeMs,
    };
  }
  return {
    updatedAt: new Date().toISOString(),
    journalDir,
    files,
  };
}

async function resolveImportedSystems(visitedSystems, options = {}) {
  const skipLegacyFallback = Boolean(options.skipLegacyFallback);
  const knownMatchedKeys = options.knownMatchedKeys instanceof Set
    ? options.knownMatchedKeys
    : new Set(options.knownMatchedKeys ?? []);
  const wanted = new Set([...visitedSystems.keys()].filter((key) => !knownMatchedKeys.has(key)));
  const indexes = [];
  const matchedKeys = new Set();
  const matchedIndexes = new Set();
  if (!existsSync(searchPath) || wanted.size === 0) return { indexes, matchedKeys };
  const unresolved = new Set(wanted);

  function addImportedMatch(lowerName, indexText) {
    const index = Number(indexText);
    if (!wanted.has(lowerName) || matchedKeys.has(lowerName) || !Number.isInteger(index)) return false;
    matchedKeys.add(lowerName);
    if (!matchedIndexes.has(index)) {
      matchedIndexes.add(index);
      indexes.push(index);
    }
    return true;
  }

  if (existsSync(lookupOverlayPath)) {
    progress('exact overlay');
    const foundInOverlay = await matchExactLookupFile(lookupOverlayPath, unresolved, addImportedMatch);
    for (const lowerName of foundInOverlay) unresolved.delete(lowerName);
  }

  if (existsSync(lookupDir)) {
    const buckets = new Map();
    for (const lowerName of unresolved) {
      const key = nameLookupKey(lowerName);
      if (!buckets.has(key)) buckets.set(key, new Set());
      buckets.get(key).add(lowerName);
    }

    let bucketNumber = 0;
    for (const [key, names] of buckets) {
      bucketNumber += 1;
      progress(`exact match ${bucketNumber}/${buckets.size}`);
      const bucketPath = path.join(lookupDir, `${key}.tsv`);
      if (!existsSync(bucketPath)) continue;
      const rl = readline.createInterface({
        input: createReadStream(bucketPath, { encoding: 'utf8' }),
        crlfDelay: Infinity,
      });
      const foundInBucket = new Set();
      for await (const line of rl) {
        const [lowerName, indexText] = line.split('\t');
        if (names.has(lowerName) && addImportedMatch(lowerName, indexText)) foundInBucket.add(lowerName);
      }
      for (const lowerName of foundInBucket) unresolved.delete(lowerName);
    }
  }

  if (unresolved.size === 0) return { indexes, matchedKeys };
  if (skipLegacyFallback) {
    progress(`exact miss ${unresolved.size}; treating as journal-only`);
    return { indexes, matchedKeys };
  }

  if (existsSync(suggestDir)) {
    const buckets = new Map();
    for (const lowerName of unresolved) {
      const key = suggestKey(lowerName);
      if (!key) continue;
      if (!buckets.has(key)) buckets.set(key, new Set());
      buckets.get(key).add(lowerName);
    }

    let bucketNumber = 0;
    for (const [key, names] of buckets) {
      bucketNumber += 1;
      progress(`matching ${bucketNumber}/${buckets.size}`);
      const bucketPath = path.join(suggestDir, `${key}.tsv`);
      if (!existsSync(bucketPath)) continue;
      const rl = readline.createInterface({
        input: createReadStream(bucketPath, { encoding: 'utf8' }),
        crlfDelay: Infinity,
      });
      const foundInBucket = new Set();
      for await (const line of rl) {
        const [lowerName, , indexText] = line.split('\t');
        if (names.has(lowerName) && addImportedMatch(lowerName, indexText)) foundInBucket.add(lowerName);
      }
      for (const lowerName of foundInBucket) unresolved.delete(lowerName);
    }
  }

  if (unresolved.size > 0) {
    let lineCount = 0;
    progress(`matching ${unresolved.size} systems`);
    const rl = readline.createInterface({
      input: createReadStream(searchPath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      lineCount += 1;
      if (lineCount % 1000000 === 0) progress(`matching ${lineCount.toLocaleString()} rows`);
      const [lowerName, , indexText] = line.split('\t');
      if (unresolved.has(lowerName) && addImportedMatch(lowerName, indexText)) unresolved.delete(lowerName);
    }
  }
  return { indexes, matchedKeys };
}

async function readImportedSystemRecord(index) {
  if (!existsSync(recordsPath) || !Number.isInteger(index) || index < 0) return null;
  const fd = await fs.open(recordsPath, 'r');
  const buffer = Buffer.allocUnsafe(recordBytes);
  try {
    const { bytesRead } = await fd.read(buffer, 0, recordBytes, index * recordBytes);
    if (bytesRead !== recordBytes) return null;
    return {
      index,
      coords: {
        x: buffer.readFloatLE(0),
        y: buffer.readFloatLE(4),
        z: buffer.readFloatLE(8),
      },
      typeCode: buffer.readUInt16LE(12),
      id64: buffer.readBigUInt64LE(24).toString(),
    };
  } finally {
    await fd.close();
  }
}

async function findImportedSystemByName(name) {
  const lowerName = systemKey(name);
  if (!lowerName) return null;
  const overlayIndex = await findExactLookupIndex(lookupOverlayPath, lowerName);
  if (overlayIndex !== null) return readImportedSystemRecord(overlayIndex);
  if (existsSync(lookupDir)) {
    const bucketPath = path.join(lookupDir, `${nameLookupKey(lowerName)}.tsv`);
    const bucketIndex = await findExactLookupIndex(bucketPath, lowerName);
    if (bucketIndex !== null) return readImportedSystemRecord(bucketIndex);
    return null;
  }
  if (!existsSync(searchPath)) return null;
  const rl = readline.createInterface({
    input: createReadStream(searchPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const [candidate, , indexText] = line.split('\t');
    if (candidate === lowerName) return readImportedSystemRecord(Number(indexText));
  }
  return null;
}

async function resolveCarrierObservation(observation, supplemental, visitedSystems = null) {
  if (!observation) return null;
  if (observation.coords) {
    return {
      ...observation,
      resolved: true,
      resolvedSource: 'journal',
      stale: false,
    };
  }
  const visitedSystem = visitedSystems?.get(systemKey(observation.systemName));
  if (visitedSystem?.coords) {
    return {
      ...observation,
      coords: visitedSystem.coords,
      resolved: true,
      resolvedSource: 'visited-journal',
      stale: false,
    };
  }
  const supplementalSystem = (supplemental?.systems ?? []).find((system) => systemKey(system.name) === systemKey(observation.systemName));
  if (supplementalSystem?.coords) {
    return {
      ...observation,
      coords: supplementalSystem.coords,
      resolved: true,
      resolvedSource: 'journal-systems',
      stale: false,
    };
  }
  const imported = await findImportedSystemByName(observation.systemName);
  if (imported?.coords) {
    return {
      ...observation,
      coords: imported.coords,
      importedIndex: imported.index,
      id64: imported.id64,
      resolved: true,
      resolvedSource: 'spansh',
      stale: false,
    };
  }
  return {
    ...observation,
    resolved: false,
    stale: true,
  };
}

async function resolveCarrierLocation(observations, existingCarrier, supplemental, visitedSystems = null) {
  const sorted = [...(observations ?? [])]
    .filter((observation) => observation?.systemName && observation?.timestamp)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const latest = sorted[0] ?? null;
  if (!latest) {
    if (!existingCarrier?.stale) return existingCarrier ?? null;
    const refreshedExisting = await resolveCarrierObservation({
      ...existingCarrier,
      systemName: existingCarrier.unresolvedSystemName ?? existingCarrier.systemName,
      coords: null,
    }, supplemental, visitedSystems);
    if (refreshedExisting?.coords && refreshedExisting.resolved) {
      return {
        ...refreshedExisting,
        timestamp: existingCarrier.timestamp,
        lastKnownAt: existingCarrier.timestamp,
        lastKnownSystemName: refreshedExisting.systemName,
        unresolvedSystemName: undefined,
      };
    }
    return existingCarrier ?? null;
  }
  if (existingCarrier?.timestamp && existingCarrier.timestamp > latest.timestamp) {
    if (!existingCarrier.stale) return existingCarrier;
    const refreshedExisting = await resolveCarrierObservation({
      ...existingCarrier,
      systemName: existingCarrier.unresolvedSystemName ?? existingCarrier.systemName,
      coords: null,
    }, supplemental, visitedSystems);
    if (refreshedExisting?.coords && refreshedExisting.resolved) {
      return {
        ...refreshedExisting,
        timestamp: existingCarrier.timestamp,
        lastKnownAt: existingCarrier.timestamp,
        lastKnownSystemName: refreshedExisting.systemName,
        unresolvedSystemName: undefined,
      };
    }
    return existingCarrier;
  }

  const resolvedLatest = await resolveCarrierObservation(latest, supplemental, visitedSystems);
  if (resolvedLatest?.coords && resolvedLatest.resolved) {
    return {
      ...resolvedLatest,
      lastKnownAt: resolvedLatest.timestamp,
      lastKnownSystemName: resolvedLatest.systemName,
    };
  }

  let lastKnown = null;
  for (const observation of sorted) {
    const resolved = await resolveCarrierObservation(observation, supplemental, visitedSystems);
    if (resolved?.coords && resolved.resolved) {
      lastKnown = resolved;
      break;
    }
  }
  if (!lastKnown && existingCarrier?.coords) lastKnown = existingCarrier;

  return {
    ...resolvedLatest,
    coords: lastKnown?.coords ?? null,
    stale: true,
    lastKnownAt: lastKnown?.lastKnownAt ?? lastKnown?.timestamp ?? null,
    lastKnownSystemName: lastKnown?.lastKnownSystemName ?? lastKnown?.systemName ?? null,
    unresolvedSystemName: latest.systemName,
  };
}

function makeSupplementalSystems(visitedSystems, matchedKeys, importedCount, typeNames, previousSupplemental = null) {
  const extraTypeNames = [...typeNames];
  const typeCodes = new Map(extraTypeNames.map((name, index) => [name, index]));
  const supplemental = [];
  const reusableIndexes = new Map((previousSupplemental?.systems ?? [])
    .map((system) => [systemKey(system?.name), Number(system?.index)])
    .filter(([key, index]) => key && Number.isInteger(index) && index >= importedCount));
  const usedIndexes = new Set();
  let nextIndex = Math.max(importedCount - 1, ...reusableIndexes.values()) + 1;

  const candidates = [...visitedSystems.entries()].sort(([, a], [, b]) => a.name.localeCompare(b.name));
  for (const [key, system] of candidates) {
    if (matchedKeys.has(key) || !system.coords) continue;
    const mainStar = system.mainStar ?? 'Unknown';
    if (!typeCodes.has(mainStar)) {
      typeCodes.set(mainStar, extraTypeNames.length);
      extraTypeNames.push(mainStar);
    }
    const reusableIndex = reusableIndexes.get(key);
    const index = Number.isInteger(reusableIndex) && !usedIndexes.has(reusableIndex)
      ? reusableIndex
      : nextIndex++;
    usedIndexes.add(index);
    supplemental.push({
      index,
      name: system.name,
      id64: system.systemAddress ? String(system.systemAddress) : `journal:${system.name}`,
      systemAddress: system.systemAddress,
      mainStar,
      starClass: system.starClass,
      typeCode: typeCodes.get(mainStar),
      coords: system.coords,
      updateTime: system.lastVisited,
      visited: true,
      source: 'Player Journal',
      firstVisited: system.firstVisited,
      lastVisited: system.lastVisited,
      lastEvent: system.lastEvent,
      visitCount: system.count,
    });
  }

  return {
    updatedAt: new Date().toISOString(),
    importedCount,
    typeNames: extraTypeNames,
    systems: supplemental,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await fs.mkdir(dataDir, { recursive: true });
  progress('listing files');
  const previousJournalState = options.mergeExisting ? await readJson(journalStatePath, null) : null;
  const previousSupplemental = await readJson(supplementalPath, { systems: [] });
  const { files, selectedFiles, allFiles, totalFileCount } = await readJournalFiles(options.journalDir, options.latest, previousJournalState);
  if (options.latest && files.length === 0) {
    progress(`no new journal lines in latest ${selectedFiles.length}`);
    await fs.writeFile(journalStatePath, JSON.stringify(makeJournalState(options.journalDir, selectedFiles, previousJournalState), null, 2));
    console.log(`Read 0 changed journal files from ${selectedFiles.length} selected files; existing journal outputs are unchanged.`);
    return;
  }
  const parsedScan = await parseJournals(files);
  progress('merging visits');
  const existing = options.mergeExisting ? await readJson(visitedPath, null) : null;
  const existingBodies = options.mergeExisting ? await readJson(journalBodiesPath, null) : null;
  if (options.mergeExisting && !existing?.carrierLocation && parsedScan.carrierObservations.length === 0 && selectedFiles.length) {
    parsedScan.carrierObservations = await parseCarrierObservations(selectedFiles);
  }
  const previousIndexes = options.mergeExisting
    ? await readJson(visitedIndexesPath, { indexes: [] })
    : { indexes: [] };
  const parsed = options.mergeExisting ? mergeParsedWithExisting(parsedScan, existing) : parsedScan;
  const meta = await readJson(metaPath, { count: 0, typeNames: [] });
  const previousMatchedKeys = options.mergeExisting && Array.isArray(previousIndexes.matchedKeys)
    ? new Set(previousIndexes.matchedKeys)
    : null;
  const systemsToResolve = previousMatchedKeys ? parsedScan.systems : parsed.systems;
  const imported = await resolveImportedSystems(systemsToResolve, {
    skipLegacyFallback: options.mergeExisting,
    knownMatchedKeys: previousMatchedKeys,
  });
  const matchedKeys = previousMatchedKeys
    ? new Set([...previousMatchedKeys, ...imported.matchedKeys])
    : imported.matchedKeys;
  progress('writing results');
  const journalBodies = makeJournalBodies(parsedScan, parsed.systems, existingBodies, options.mergeExisting);
  reconcileMainStarsFromBodies(parsed.systems, journalBodies);
  const supplemental = makeSupplementalSystems(
    parsed.systems,
    matchedKeys,
    meta.count ?? 0,
    meta.typeNames ?? [],
    previousSupplemental,
  );
  const carrierLocation = await resolveCarrierLocation(parsedScan.carrierObservations, existing?.carrierLocation ?? null, supplemental, parsed.systems);
  const supplementalIndexes = supplemental.systems.map((system) => system.index);
  const previousIndexList = Array.isArray(previousIndexes.indexes)
    ? previousIndexes.indexes.filter((index) => Number.isInteger(index) && index >= 0 && index < (meta.count ?? 0))
    : [];
  const indexes = [...new Set([...previousIndexList, ...imported.indexes, ...supplementalIndexes])];
  const systems = [...parsed.systems.values()].sort((a, b) => a.name.localeCompare(b.name));

  const payload = {
    journalDir: options.journalDir,
    updatedAt: new Date().toISOString(),
    scanMode: options.latest ? `latest-${options.latest}` : 'all',
    fileCount: totalFileCount,
    scannedFileCount: options.latest ? selectedFiles.length : files.length,
    readFileCount: files.length,
    eventCount: parsed.eventCount,
    bodyEventCount: parsedScan.bodyEventCount,
    journalBodyCount: journalBodies.bodyCount,
    visitedCount: systems.length,
    matchedIndexCount: imported.indexes.length,
    supplementalCount: supplemental.systems.length,
    latestSystem: parsed.latest,
    carrierLocation,
    systems,
  };

  await fs.writeFile(visitedPath, JSON.stringify(payload, null, 2));
  await fs.writeFile(path.join(dataDir, 'visited-indexes.json'), JSON.stringify({
    updatedAt: payload.updatedAt,
    indexes,
    matchedKeys: [...matchedKeys].sort(),
  }));
  await fs.writeFile(path.join(dataDir, 'journal-systems.json'), JSON.stringify(supplemental, null, 2));
  await fs.writeFile(journalBodiesPath, JSON.stringify(journalBodies, null, 2));
  const stateEntries = options.latest ? selectedFiles : allFiles;
  await fs.writeFile(journalStatePath, JSON.stringify(makeJournalState(options.journalDir, stateEntries, previousJournalState), null, 2));
  console.log(`Read ${files.length} changed journal files from ${options.latest ? selectedFiles.length : files.length} selected files, found ${systems.length} visited systems and ${journalBodies.bodyCount} journal body records, matched ${imported.indexes.length} imported systems, added ${supplemental.systems.length} journal-only systems.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
