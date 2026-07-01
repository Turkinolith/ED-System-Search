import { closeSync, createReadStream, existsSync, openSync, promises as fs, readSync } from 'node:fs';
import http from 'node:http';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { zstdDecompressSync } from 'node:zlib';
import { dateInputToSeconds, parseUpdateSeconds, secondsToIso, unknownUpdateSeconds } from './scripts/update-time.js';
import { suggestKey } from './scripts/suggest-key.js';
import { loadLocalConfig } from './local-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const dataDir = process.env.EDSS_DATA_DIR ? path.resolve(process.env.EDSS_DATA_DIR) : path.join(__dirname, 'data');
const journalDir = process.env.EDSS_JOURNAL_DIR
  ? path.resolve(process.env.EDSS_JOURNAL_DIR)
  : path.join(homedir(), 'Saved Games', 'Frontier Developments', 'Elite Dangerous');
const metaPath = path.join(dataDir, 'systems-meta.json');
const searchPath = path.join(dataDir, 'systems-search.tsv');
const recordsPath = path.join(dataDir, 'systems.bin');
const visitedPath = path.join(dataDir, 'visited.json');
const visitedIndexesPath = path.join(dataDir, 'visited-indexes.json');
const supplementalPath = path.join(dataDir, 'journal-systems.json');
const journalBodiesPath = path.join(dataDir, 'journal-bodies.json');
const placesPath = path.join(dataDir, 'places.json');
const discoveriesPath = path.join(dataDir, 'discoveries.json');
const murderBinariesMetaPath = path.join(dataDir, 'murder-binaries-meta.json');
const murderBinariesDataPath = path.join(dataDir, 'murder-binaries.bin');
const murderBinariesNamesPath = path.join(dataDir, 'murder-binaries-names.txt');
const notesPath = path.join(dataDir, 'system-notes.json');
const regionMapPath = path.join(dataDir, 'region-map-vectors.json');
const systemUpdateLogPath = path.join(dataDir, 'system-update-log.json');
const updatesPath = path.join(dataDir, 'systems-updates.u32');
const updatesMetaPath = path.join(dataDir, 'systems-updates-meta.json');
const suggestDir = path.join(dataDir, 'suggest');
const suggestOverlayPath = path.join(dataDir, 'suggest-overlay.tsv');
const galaxyDir = path.join(dataDir, 'galaxy');
const galaxyManifestPath = path.join(galaxyDir, 'manifest.json');
const spatialMetaPath = path.join(dataDir, 'systems-spatial-meta.json');
const spatialDataPath = path.join(dataDir, 'systems-spatial.bin');
const localConfig = loadLocalConfig();
const spatialIndexPath = path.join(dataDir, 'systems-spatial.idx');
const combinedPoiUrl = 'https://edastro.com/mapcharts/files/edsmPOI.csv';
const recordBytes = 32;
const lodBytes = 20;
const richIndexHeaderBytes = 32;
const richIndexMinimumRecordBytes = 40;
const richFilterMinimumRecordBytes = 12;
const systemDetailCacheLimit = 3000;
const systemDetailCacheTtlMs = 10 * 60 * 1000;
const richFlags = {
  bodies: 1 << 0,
  stations: 1 << 1,
  factions: 1 << 2,
  populated: 1 << 3,
  powers: 1 << 4,
  thargoidWar: 1 << 5,
  markets: 1 << 6,
  shipyards: 1 << 7,
  outfitting: 1 << 8,
  signals: 1 << 9,
  landable: 1 << 10,
  richData: 0x80000000,
};
const richCategoryMasks = {
  body: {
    earthLike: 1 << 0,
    waterWorld: 1 << 1,
    ammoniaWorld: 1 << 2,
    icyBody: 1 << 3,
    rockyIce: 1 << 4,
    highMetal: 1 << 5,
    metalRich: 1 << 6,
    gasWaterLife: 1 << 7,
    gasAmmoniaLife: 1 << 8,
    waterGiant: 1 << 9,
    terraformable: 1 << 10,
  },
  atmosphere: {
    thinAmmonia: 1 << 0,
    ammonia: 1 << 1,
    water: 1 << 2,
    oxygen: 1 << 3,
    carbonDioxide: 1 << 4,
    methane: 1 << 5,
    nitrogen: 1 << 6,
    sulphurDioxide: 1 << 7,
    silicate: 1 << 8,
    helium: 1 << 9,
    neon: 1 << 10,
    argon: 1 << 11,
    thin: 1 << 12,
    thick: 1 << 13,
    hot: 1 << 14,
    waterLife: 1 << 15,
  },
  ring: { icy: 1 << 0, rocky: 1 << 1, metalRich: 1 << 2, metallic: 1 << 3 },
  volcanism: {
    silicate: 1 << 0,
    metallic: 1 << 1,
    rocky: 1 << 2,
    water: 1 << 3,
    carbonDioxide: 1 << 4,
    nitrogen: 1 << 5,
    methane: 1 << 6,
    ammonia: 1 << 7,
    major: 1 << 8,
    minor: 1 << 9,
  },
  economy: {
    extraction: 1 << 0,
    refinery: 1 << 1,
    industrial: 1 << 2,
    agriculture: 1 << 3,
    highTech: 1 << 4,
    military: 1 << 5,
    tourism: 1 << 6,
    service: 1 << 7,
    colony: 1 << 8,
    other: 1 << 15,
  },
  security: { anarchy: 1 << 0, low: 1 << 1, medium: 1 << 2, high: 1 << 3 },
  government: {
    anarchy: 1 << 0,
    communism: 1 << 1,
    confederacy: 1 << 2,
    cooperative: 1 << 3,
    corporate: 1 << 4,
    democracy: 1 << 5,
    dictatorship: 1 << 6,
    feudal: 1 << 7,
    patronage: 1 << 8,
    theocracy: 1 << 9,
    other: 1 << 15,
  },
};

let metaCache = null;
let supplementalCache = null;
let visitedCache = null;
let placesCache = null;
let discoveriesCache = null;
let murderBinariesIndexCache = null;
let spatialIndexCache = null;
let notesCache = null;
let updateMetaCache = null;
let updateIndexCache = null;
let suggestOverlayCache = null;
let galaxyManifestCache = null;
let journalBodiesCache = null;
let carrierRefreshPromise = null;
let visitedIndexSet = new Set();
const systemDetailCache = new Map();
let journalScanStatus = {
  running: false,
  id: null,
  mode: null,
  startedAt: null,
  finishedAt: null,
  message: 'Idle',
  ok: null,
  code: null,
  stdout: '',
  stderr: '',
};
let systemUpdateStatus = {
  running: false,
  id: null,
  mode: null,
  startedAt: null,
  finishedAt: null,
  step: null,
  message: 'Idle',
  ok: null,
  code: null,
  stdout: '',
  stderr: '',
};
const systemDeltaSources = {
  '1day': {
    label: 'systems_1day.json.gz',
    url: 'https://downloads.spansh.co.uk/systems_1day.json.gz',
    large: false,
  },
  '1week': {
    label: 'systems_1week.json.gz',
    url: 'https://downloads.spansh.co.uk/systems_1week.json.gz',
    large: false,
  },
  '2weeks': {
    label: 'systems_2weeks.json.gz',
    url: 'https://downloads.spansh.co.uk/systems_2weeks.json.gz',
    large: false,
  },
  '1month': {
    label: 'systems_1month.json.gz',
    url: 'https://downloads.spansh.co.uk/systems_1month.json.gz',
    large: false,
  },
  '6months': {
    label: 'systems_6months.json.gz',
    url: 'https://downloads.spansh.co.uk/systems_6months.json.gz',
    large: true,
  },
};

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.wasm', 'application/wasm'],
]);

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function systemNoteKey(name) {
  return String(name ?? '').trim().toLowerCase();
}

function clampNote(value) {
  return String(value ?? '').trim().slice(0, 512);
}

async function readRequestJson(req, maxBytes = 4096) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > maxBytes) throw new Error('Request body is too large.');
  }
  return body ? JSON.parse(body) : {};
}

async function getNotes() {
  const stat = existsSync(notesPath) ? await fs.stat(notesPath) : null;
  if (!stat) {
    return {
      updatedAt: null,
      count: 0,
      notes: [],
    };
  }
  if (!notesCache || notesCache.mtimeMs !== stat.mtimeMs) {
    const data = await readJson(notesPath, { notes: [] });
    const notes = Array.isArray(data) ? data : data.notes ?? [];
    notesCache = {
      mtimeMs: stat.mtimeMs,
      data: {
        updatedAt: data.updatedAt ?? new Date(stat.mtimeMs).toISOString(),
        count: notes.length,
        notes: notes
          .filter((note) => note?.systemKey && note?.text)
          .sort((a, b) => a.systemName.localeCompare(b.systemName)),
      },
    };
  }
  return notesCache.data;
}

async function getSystemUpdateLog() {
  return readJson(systemUpdateLogPath, { updatedAt: null, runs: [] });
}

async function appendSystemUpdateLog(entry) {
  const log = await getSystemUpdateLog();
  const runs = [entry, ...(log.runs ?? [])].slice(0, 30);
  const next = {
    updatedAt: new Date().toISOString(),
    runs,
  };
  await fs.writeFile(systemUpdateLogPath, JSON.stringify(next, null, 2));
  return next;
}

async function noteForSystem(name) {
  const key = systemNoteKey(name);
  if (!key) return null;
  const notes = await getNotes();
  return notes.notes.find((note) => note.systemKey === key) ?? null;
}

function clearSystemDetailCache() {
  systemDetailCache.clear();
}

function getCachedSystemDetail(index) {
  const entry = systemDetailCache.get(index);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > systemDetailCacheTtlMs) {
    systemDetailCache.delete(index);
    return null;
  }
  systemDetailCache.delete(index);
  systemDetailCache.set(index, entry);
  return entry.detail;
}

function setCachedSystemDetail(index, detail) {
  systemDetailCache.set(index, { detail, cachedAt: Date.now() });
  while (systemDetailCache.size > systemDetailCacheLimit) {
    const oldest = systemDetailCache.keys().next().value;
    systemDetailCache.delete(oldest);
  }
}

async function sendSystemDetail(res, index, detail) {
  setCachedSystemDetail(index, detail);
  return sendJson(res, {
    ...detail,
    note: await noteForSystem(detail.name),
  });
}

async function writeNotes(notes) {
  const payload = {
    updatedAt: new Date().toISOString(),
    count: notes.length,
    notes: notes.sort((a, b) => a.systemName.localeCompare(b.systemName)),
  };
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(notesPath, JSON.stringify(payload, null, 2));
  notesCache = null;
  return payload;
}

async function saveSystemNote(req, res) {
  const payload = await readRequestJson(req);
  const systemName = String(payload.systemName ?? '').trim();
  const systemKey = systemNoteKey(systemName);
  if (!systemKey) return badRequest(res, 'System name is required.');
  const text = clampNote(payload.text);
  const existing = await getNotes();
  const notes = existing.notes.filter((note) => note.systemKey !== systemKey);
  if (text) {
    notes.push({
      systemKey,
      systemName,
      text,
      coords: payload.coords ?? null,
      systemId64: payload.systemId64 ? String(payload.systemId64) : null,
      systemIndex: Number.isInteger(payload.systemIndex) ? payload.systemIndex : null,
      createdAt: existing.notes.find((note) => note.systemKey === systemKey)?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  const next = await writeNotes(notes);
  return sendJson(res, {
    ok: true,
    note: next.notes.find((note) => note.systemKey === systemKey) ?? null,
    count: next.count,
  });
}

async function listSystemNotes(reqUrl, res) {
  const data = await getNotes();
  const q = String(reqUrl.searchParams.get('q') ?? '').trim().toLowerCase();
  const notes = q
    ? data.notes.filter((note) => note.systemName.toLowerCase().includes(q) || note.text.toLowerCase().includes(q))
    : data.notes;
  return sendJson(res, {
    ...data,
    query: q,
    count: notes.length,
    notes,
  });
}

async function getMeta() {
  const stat = existsSync(metaPath) ? await fs.stat(metaPath) : null;
  if (!stat) return null;
  const supplementalStat = existsSync(supplementalPath) ? await fs.stat(supplementalPath) : null;
  const updatesMetaStat = existsSync(updatesMetaPath) ? await fs.stat(updatesMetaPath) : null;
  const cacheKey = `${stat.mtimeMs}:${supplementalStat?.mtimeMs ?? 0}:${updatesMetaStat?.mtimeMs ?? 0}`;
  if (!metaCache || metaCache.cacheKey !== cacheKey) {
    const base = await readJson(metaPath, null);
    const supplemental = await getSupplemental();
    const updateMeta = await getUpdateMeta();
    const typeNames = [...(base?.typeNames ?? [])];
    const typeCounts = { ...(base?.typeCounts ?? {}) };
    for (const name of supplemental.typeNames ?? []) {
      if (!typeNames.includes(name)) typeNames.push(name);
    }
    for (const system of supplemental.systems ?? []) {
      typeCounts[String(system.typeCode)] = (typeCounts[String(system.typeCode)] ?? 0) + 1;
    }
    metaCache = {
      cacheKey,
      data: {
        ...base,
        importedCount: base?.count ?? 0,
        supplementalCount: supplemental.systems?.length ?? 0,
        count: (base?.count ?? 0) + (supplemental.systems?.length ?? 0),
        typeNames,
        typeCounts,
        updateTimeRange: {
          available: Boolean(updateMeta),
          minUpdateTime: updateMeta?.minUpdateTime ?? base?.updateTimeRange?.minUpdateTime ?? null,
          maxUpdateTime: updateMeta?.maxUpdateTime ?? base?.updateTimeRange?.maxUpdateTime ?? null,
        },
      },
    };
  }
  return metaCache.data;
}

async function getGalaxyManifest() {
  const stat = existsSync(galaxyManifestPath) ? await fs.stat(galaxyManifestPath) : null;
  if (!stat) return null;
  if (!galaxyManifestCache || galaxyManifestCache.mtimeMs !== stat.mtimeMs) {
    const manifest = await readJson(galaxyManifestPath, null);
    galaxyManifestCache = {
      mtimeMs: stat.mtimeMs,
      data: manifest,
    };
  }
  return galaxyManifestCache.data;
}

async function getJournalBodies() {
  const stat = existsSync(journalBodiesPath) ? await fs.stat(journalBodiesPath) : null;
  if (!stat) return { updatedAt: null, systemCount: 0, bodyCount: 0, systems: [], byId: new Map(), byName: new Map() };
  if (!journalBodiesCache || journalBodiesCache.mtimeMs !== stat.mtimeMs) {
    const data = await readJson(journalBodiesPath, { systems: [] });
    const byId = new Map();
    const byName = new Map();
    for (const system of data.systems ?? []) {
      if (system?.id64) byId.set(String(system.id64), system);
      if (system?.name) byName.set(systemNameKey(system.name), system);
    }
    journalBodiesCache = {
      mtimeMs: stat.mtimeMs,
      data: { ...data, byId, byName },
    };
  }
  return journalBodiesCache.data;
}

function galaxyDetailsSummary(manifest) {
  if (!manifest) {
    return {
      imported: false,
      formatVersion: null,
      segments: [],
      baseCount: 0,
      deltaRecords: 0,
      indexedRecords: 0,
    };
  }
  const segments = manifest.segments ?? [];
  const baseCount = Number(segments.find((segment) => segment.kind === 'base')?.count ?? 0);
  const deltaRecords = segments
    .filter((segment) => segment.kind === 'delta')
    .reduce((sum, segment) => sum + Number(segment.count ?? 0), 0);
  return {
    imported: segments.length > 0,
    formatVersion: manifest.formatVersion,
    schemaUrl: manifest.schemaUrl,
    updatedAt: manifest.updatedAt,
    baseCount,
    deltaRecords,
    indexedRecords: baseCount + deltaRecords,
    mapFilters: manifest.mapFilters ?? null,
    segments: segments.map((segment) => ({
      kind: segment.kind,
      importedAt: segment.importedAt,
      count: segment.count,
      inputCount: segment.inputCount,
      duplicateCount: segment.duplicateCount,
      dataBytes: segment.dataBytes,
      indexBytes: segment.indexBytes,
      minUpdateTime: segment.minUpdateTime,
      maxUpdateTime: segment.maxUpdateTime,
      summary: segment.summary,
    })),
  };
}

function richPointFilters(reqUrl) {
  const enabled = (name) => reqUrl.searchParams.get(name) === '1';
  const categoryMask = (parameter, category) => String(reqUrl.searchParams.get(parameter) ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .reduce((mask, value) => mask | (richCategoryMasks[category]?.[value] ?? 0), 0);
  const minBodiesRaw = Number(reqUrl.searchParams.get('minBodies') ?? 0);
  const minBodies = Number.isFinite(minBodiesRaw) ? Math.max(0, Math.floor(minBodiesRaw)) : 0;
  const filters = {
    richData: enabled('richData'),
    stations: enabled('hasStations'),
    populated: enabled('populated'),
    landable: enabled('landable'),
    markets: enabled('markets'),
    shipyards: enabled('shipyards'),
    outfitting: enabled('outfitting'),
    signals: enabled('signals'),
    minBodies,
    bodyTypes: categoryMask('bodyType', 'body'),
    atmosphereTypes: categoryMask('atmosphere', 'atmosphere'),
    ringTypes: categoryMask('ringType', 'ring'),
    volcanismTypes: categoryMask('volcanism', 'volcanism'),
    economyTypes: categoryMask('economy', 'economy'),
    securityTypes: categoryMask('security', 'security'),
    governmentTypes: categoryMask('government', 'government'),
  };
  filters.advanced = Boolean(
    filters.bodyTypes
    || filters.atmosphereTypes
    || filters.ringTypes
    || filters.volcanismTypes
    || filters.economyTypes
    || filters.securityTypes
    || filters.governmentTypes
  );
  filters.active = filters.richData
    || filters.stations
    || filters.populated
    || filters.landable
    || filters.markets
    || filters.shipyards
    || filters.outfitting
    || filters.signals
    || filters.minBodies > 0
    || filters.advanced;
  return filters;
}

function richPointAllowed(buffer, offset, filters, recordBytes) {
  if (!filters.active) return true;
  const flags = buffer.readUInt32LE(offset);
  const bodyCount = buffer.readUInt32LE(offset + 4);
  const stationCount = buffer.readUInt32LE(offset + 8);
  if (filters.richData && !(flags & richFlags.richData)) return false;
  if (filters.stations && stationCount === 0) return false;
  if (filters.populated && !(flags & richFlags.populated)) return false;
  if (filters.landable && !(flags & richFlags.landable)) return false;
  if (filters.markets && !(flags & richFlags.markets)) return false;
  if (filters.shipyards && !(flags & richFlags.shipyards)) return false;
  if (filters.outfitting && !(flags & richFlags.outfitting)) return false;
  if (filters.signals && !(flags & richFlags.signals)) return false;
  if (bodyCount < filters.minBodies) return false;
  if (filters.advanced) {
    if (recordBytes < 40) return false;
    if (filters.bodyTypes && !(buffer.readUInt32LE(offset + 12) & filters.bodyTypes)) return false;
    if (filters.atmosphereTypes && !(buffer.readUInt32LE(offset + 16) & filters.atmosphereTypes)) return false;
    if (filters.ringTypes && !(buffer.readUInt32LE(offset + 20) & filters.ringTypes)) return false;
    if (filters.volcanismTypes && !(buffer.readUInt32LE(offset + 24) & filters.volcanismTypes)) return false;
    if (filters.economyTypes && !(buffer.readUInt32LE(offset + 28) & filters.economyTypes)) return false;
    if (filters.securityTypes && !(buffer.readUInt32LE(offset + 32) & filters.securityTypes)) return false;
    if (filters.governmentTypes && !(buffer.readUInt32LE(offset + 36) & filters.governmentTypes)) return false;
  }
  return true;
}

function parseId64(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) return null;
  try {
    const id64 = BigInt(text);
    return id64 >= 0n && id64 <= 0xffffffffffffffffn ? id64 : null;
  } catch {
    return null;
  }
}

function galaxyDataPath(filename) {
  if (!filename || path.basename(filename) !== filename) {
    throw new Error('Invalid rich galaxy segment filename.');
  }
  return path.join(galaxyDir, filename);
}

async function richIndexEntry(segment, id64) {
  const indexPath = galaxyDataPath(segment.indexFile);
  const fd = await fs.open(indexPath, 'r');
  try {
    const header = Buffer.allocUnsafe(richIndexHeaderBytes);
    const headerRead = await fd.read(header, 0, header.length, 0);
    if (headerRead.bytesRead !== header.length || header.toString('ascii', 0, 8) !== 'EDGRIDX1') {
      throw new Error(`Invalid rich galaxy index header in ${segment.indexFile}`);
    }
    const version = header.readUInt32LE(8);
    const bytesPerRecord = header.readUInt32LE(12);
    const count = Number(header.readBigUInt64LE(16));
    if (version !== 1 || bytesPerRecord < richIndexMinimumRecordBytes || !Number.isSafeInteger(count)) {
      throw new Error(`Unsupported rich galaxy index format in ${segment.indexFile}`);
    }

    const row = Buffer.allocUnsafe(bytesPerRecord);
    let low = 0;
    let high = count - 1;
    while (low <= high) {
      const middle = low + Math.floor((high - low) / 2);
      const position = richIndexHeaderBytes + middle * bytesPerRecord;
      const result = await fd.read(row, 0, row.length, position);
      if (result.bytesRead !== row.length) throw new Error(`Truncated rich galaxy index ${segment.indexFile}`);
      const candidate = row.readBigUInt64LE(0);
      if (candidate < id64) {
        low = middle + 1;
      } else if (candidate > id64) {
        high = middle - 1;
      } else {
        return {
          id64: candidate,
          offset: row.readBigUInt64LE(8),
          compressedLength: row.readUInt32LE(16),
          rawLength: row.readUInt32LE(20),
          updateSeconds: row.readUInt32LE(24),
          bodyCount: row.readUInt32LE(28),
          stationCount: row.readUInt32LE(32),
          flags: row.readUInt32LE(36),
          bodyTypes: bytesPerRecord >= 68 ? row.readUInt32LE(40) : 0,
          atmosphereTypes: bytesPerRecord >= 68 ? row.readUInt32LE(44) : 0,
          ringTypes: bytesPerRecord >= 68 ? row.readUInt32LE(48) : 0,
          volcanismTypes: bytesPerRecord >= 68 ? row.readUInt32LE(52) : 0,
          economyTypes: bytesPerRecord >= 68 ? row.readUInt32LE(56) : 0,
          securityTypes: bytesPerRecord >= 68 ? row.readUInt32LE(60) : 0,
          governmentTypes: bytesPerRecord >= 68 ? row.readUInt32LE(64) : 0,
        };
      }
    }
    return null;
  } finally {
    await fd.close();
  }
}

async function readRichSystem(reqUrl, res) {
  const rawId64 = String(reqUrl.searchParams.get('id64') ?? '').trim();
  const id64 = parseId64(rawId64);
  const requestedName = String(reqUrl.searchParams.get('name') ?? '').trim();
  if (id64 === null && !requestedName) return badRequest(res, 'A valid unsigned 64-bit id64 or system name is required.');
  const journalData = await getJournalBodies();
  const journalSystem = (id64 !== null ? journalData.byId.get(id64.toString()) : null)
    ?? (requestedName ? journalData.byName.get(systemNameKey(requestedName)) : null)
    ?? null;
  const manifest = await getGalaxyManifest();
  if (!manifest?.segments?.length && !journalSystem) {
    return sendJson(res, { error: 'Full galaxy details have not been imported yet.' }, 409);
  }

  let richResult = null;
  if (id64 !== null) {
    for (const segment of manifest?.segments ?? []) {
      const entry = await richIndexEntry(segment, id64);
      if (!entry) continue;
      if (entry.offset > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error(`Rich galaxy pack offset exceeds the Node.js safe file-position range.`);
      }
      const dataPath = galaxyDataPath(segment.dataFile);
      const fd = await fs.open(dataPath, 'r');
      try {
        const compressed = Buffer.allocUnsafe(entry.compressedLength);
        const result = await fd.read(compressed, 0, compressed.length, Number(entry.offset));
        if (result.bytesRead !== compressed.length) throw new Error(`Truncated rich galaxy pack ${segment.dataFile}`);
        const raw = zstdDecompressSync(compressed, { maxOutputLength: entry.rawLength });
        richResult = {
          segment,
          entry,
          system: JSON.parse(raw.toString('utf8'), (key, value, context) => (
            key === 'id64' && context?.source ? context.source : value
          )),
        };
      } finally {
        await fd.close();
      }
      break;
    }
  }
  if (!richResult && !journalSystem) return notFound(res);

  const bodyKey = (body) => body?.bodyId !== undefined && body?.bodyId !== null
    ? `id:${body.bodyId}`
    : `name:${systemNameKey(body?.name)}`;
  const bodies = new Map((richResult?.system?.bodies ?? []).map((body) => [bodyKey(body), body]));
  for (const journalBody of journalSystem?.bodies ?? []) {
    const key = bodyKey(journalBody);
    const existing = bodies.get(key) ?? {};
    bodies.set(key, {
      ...existing,
      ...journalBody,
      materials: { ...(existing.materials ?? {}), ...(journalBody.materials ?? {}) },
      composition: { ...(existing.composition ?? {}), ...(journalBody.composition ?? {}) },
      signals: { ...(existing.signals ?? {}), ...(journalBody.signals ?? {}) },
      rings: journalBody.rings?.length ? journalBody.rings : existing.rings,
      stations: existing.stations,
    });
  }
  const mergedBodies = [...bodies.values()].sort((a, b) => (
    Number(a.bodyId ?? Number.MAX_SAFE_INTEGER) - Number(b.bodyId ?? Number.MAX_SAFE_INTEGER)
    || String(a.name ?? '').localeCompare(String(b.name ?? ''))
  ));
  const system = {
    ...(richResult?.system ?? {}),
    ...(journalSystem ? {
      name: journalSystem.name ?? richResult?.system?.name,
      bodies: mergedBodies,
    } : {}),
  };
  const entry = richResult?.entry;
  return sendJson(res, {
    id64: id64?.toString() ?? String(journalSystem.id64),
    segment: richResult ? {
      kind: journalSystem ? `${richResult.segment.kind} + journal` : richResult.segment.kind,
      importedAt: richResult.segment.importedAt,
      sourcePath: richResult.segment.sourcePath,
    } : {
      kind: 'journal',
      importedAt: journalData.updatedAt,
      sourcePath: journalBodiesPath,
    },
    journal: journalSystem ? {
      updatedAt: journalSystem.updatedAt,
      bodyCount: journalSystem.bodies?.length ?? 0,
    } : null,
    summary: {
      bodyCount: Math.max(entry?.bodyCount ?? 0, journalSystem?.bodyCount ?? 0, mergedBodies.length),
      stationCount: entry?.stationCount ?? 0,
      flags: entry?.flags ?? (mergedBodies.length ? richFlags.bodies | richFlags.richData : 0),
      bodyTypes: entry?.bodyTypes ?? 0,
      atmosphereTypes: entry?.atmosphereTypes ?? 0,
      ringTypes: entry?.ringTypes ?? 0,
      volcanismTypes: entry?.volcanismTypes ?? 0,
      economyTypes: entry?.economyTypes ?? 0,
      securityTypes: entry?.securityTypes ?? 0,
      governmentTypes: entry?.governmentTypes ?? 0,
    },
    system,
  });
}

function cleanLlmText(value, maxLength = 4000) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function llmBaseUrl(provider, configured) {
  const value = cleanLlmText(configured, 400).replace(/\/+$/, '');
  if (value) return provider === 'kobold' && !/\/v1$/i.test(value) ? `${value}/v1` : value;
  if (provider === 'anthropic') return 'https://api.anthropic.com';
  if (provider === 'kobold') return 'http://localhost:5001/v1';
  return 'https://api.openai.com/v1';
}

function jsonFromText(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return JSON.parse(fenced[1]);
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
    throw new Error('The LLM did not return JSON.');
  }
}

async function callLlmText(config, systemPrompt, userPrompt, maxTokens = 900) {
  const provider = cleanLlmText(config?.provider, 40) || 'openai';
  const model = cleanLlmText(config?.model, 120);
  const apiKey = cleanLlmText(config?.apiKey, 400);
  const baseUrl = llmBaseUrl(provider, config?.baseUrl);
  if (!model) throw new Error('Choose an LLM model before running augmented search.');
  if (provider !== 'kobold' && !apiKey) throw new Error('Add an API key before running augmented search.');

  if (provider === 'anthropic') {
    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature: 0.1,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error?.message ?? `Claude request failed with HTTP ${response.status}.`);
    return (data.content ?? []).map((part) => part.text ?? '').join('\n').trim();
  }

  if (provider === 'kobold') {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error?.message ?? `KoboldCPP request failed with HTTP ${response.status}.`);
    return String(data.choices?.[0]?.message?.content ?? '').trim();
  }

  const response = await fetch(`${baseUrl}/responses`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_output_tokens: maxTokens,
      input: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message ?? `OpenAI request failed with HTTP ${response.status}.`);
  if (data.output_text) return String(data.output_text).trim();
  return (data.output ?? [])
    .flatMap((item) => item.content ?? [])
    .map((part) => part.text ?? '')
    .join('\n')
    .trim();
}

function heuristicLlmSearchPlan(query) {
  const text = String(query ?? '').toLowerCase();
  const ringTypes = [];
  const bodyTypes = [];
  const keywords = [];
  if (/\bicy\b|ice ring|icy ring/.test(text)) ringTypes.push('icy');
  if (/rocky ice|rocky-ice/.test(text)) bodyTypes.push('rockyIce');
  if (/\btritium\b/.test(text)) keywords.push('tritium');
  if (/hotspot|hot spot/.test(text)) keywords.push('hotspot');
  const radiusMatch = text.match(/(?:within|inside|under|less than)\s+(\d+(?:\.\d+)?)\s*(?:ly|light years?|light-years?)/);
  const radiusLy = radiusMatch ? Number(radiusMatch[1]) : 1000;
  return {
    intent: 'Find nearby systems matching the natural-language request.',
    radiusLy,
    limit: 10,
    scanLimit: 160,
    filters: {
      ringTypes,
      bodyTypes,
      requireSignals: /\bsignal|hotspot|hot spot|tritium/.test(text) && !/\bprefer|preferably|bonus|ideally/.test(text),
    },
    preferences: keywords.length ? ['Prefer exact mentions of requested hotspot/material keywords.'] : [],
    keywords,
  };
}

function sanitizeLlmSearchPlan(value, fallback) {
  const plan = value && typeof value === 'object' ? value : {};
  const cleanList = (items, allowed) => Array.isArray(items)
    ? items.map((item) => String(item ?? '').trim()).filter((item) => allowed.includes(item))
    : [];
  const radiusLy = Number(plan.radiusLy ?? fallback.radiusLy);
  const limit = Number(plan.limit ?? fallback.limit);
  const scanLimit = Number(plan.scanLimit ?? fallback.scanLimit);
  const filters = plan.filters && typeof plan.filters === 'object' ? plan.filters : {};
  const keywords = Array.isArray(plan.keywords)
    ? plan.keywords.map((item) => cleanLlmText(item, 40).toLowerCase()).filter(Boolean).slice(0, 8)
    : fallback.keywords;
  return {
    intent: cleanLlmText(plan.intent, 240) || fallback.intent,
    radiusLy: Number.isFinite(radiusLy) ? Math.max(25, Math.min(5000, radiusLy)) : fallback.radiusLy,
    limit: Number.isFinite(limit) ? Math.max(3, Math.min(20, Math.floor(limit))) : fallback.limit,
    scanLimit: Number.isFinite(scanLimit) ? Math.max(30, Math.min(400, Math.floor(scanLimit))) : fallback.scanLimit,
    filters: {
      ringTypes: [...new Set([...fallback.filters.ringTypes, ...cleanList(filters.ringTypes, Object.keys(richCategoryMasks.ring))])],
      bodyTypes: [...new Set([...fallback.filters.bodyTypes, ...cleanList(filters.bodyTypes, Object.keys(richCategoryMasks.body))])],
      requireSignals: Boolean(filters.requireSignals ?? fallback.filters.requireSignals),
    },
    preferences: Array.isArray(plan.preferences)
      ? plan.preferences.map((item) => cleanLlmText(item, 120)).filter(Boolean).slice(0, 5)
      : fallback.preferences,
    keywords,
  };
}

async function llmSearchPlan(query, config) {
  const fallback = heuristicLlmSearchPlan(query);
  if (!config?.enabled) return { plan: fallback, source: 'heuristic', warning: 'LLM settings are not configured; used local keyword planning.' };
  const systemPrompt = [
    'You translate Elite Dangerous galaxy search requests into constrained JSON search plans.',
    'Use only these filter values:',
    `ringTypes: ${Object.keys(richCategoryMasks.ring).join(', ')}`,
    `bodyTypes: ${Object.keys(richCategoryMasks.body).join(', ')}`,
    'Return JSON only. No prose.',
  ].join('\n');
  const userPrompt = JSON.stringify({
    request: query,
    currentTargetUsage: 'Search should be ranked by distance from the current target unless the request says otherwise.',
    schema: {
      intent: 'short sentence',
      radiusLy: 'number, default 1000',
      limit: 'number 3-20',
      scanLimit: 'number 30-400',
      filters: {
        ringTypes: ['icy'],
        bodyTypes: [],
        requireSignals: true,
      },
      preferences: ['prefer tritium hotspots if present'],
      keywords: ['tritium', 'hotspot'],
    },
  });
  const text = await callLlmText(config, systemPrompt, userPrompt, 700);
  return { plan: sanitizeLlmSearchPlan(jsonFromText(text), fallback), source: config.provider };
}

async function collectNearestSpatialPoints(center, limit, maximumRadius) {
  const index = await getSpatialIndex();
  if (!index) throw new Error('Local spatial detail is not built. Run npm run import:spatial-index.');
  const x = Number(center?.x);
  const y = Number(center?.y);
  const z = Number(center?.z);
  if (![x, y, z].every(Number.isFinite)) throw new Error('A finite current target is required.');
  const cellSize = Number(index.meta.cellSizeLy ?? 100);
  const radius = Math.max(25, Math.min(5000, Number(maximumRadius) || 1000));
  const cellXMin = Math.floor((x - radius) / cellSize);
  const cellXMax = Math.floor((x + radius) / cellSize);
  const cellYMin = Math.floor((y - radius) / cellSize);
  const cellYMax = Math.floor((y + radius) / cellSize);
  const cellZMin = Math.floor((z - radius) / cellSize);
  const cellZMax = Math.floor((z + radius) / cellSize);
  const cells = [];
  for (let cellX = cellXMin; cellX <= cellXMax; cellX += 1) {
    for (let cellY = cellYMin; cellY <= cellYMax; cellY += 1) {
      const first = spatialIndexLowerBound(index, spatialCellKey(cellX, cellY, cellZMin));
      const last = spatialIndexLowerBound(index, spatialCellKey(cellX, cellY, cellZMax) + 1n);
      for (let cellIndex = first; cellIndex < last; cellIndex += 1) {
        const indexRecord = readSpatialIndexRecord(index, cellIndex);
        if (!indexRecord) continue;
        const cellZ = Number(indexRecord.key & spatialCellMask) - spatialCellBias;
        const dx = distanceToCellAxis(x, cellX, cellSize);
        const dy = distanceToCellAxis(y, cellY, cellSize);
        const dz = distanceToCellAxis(z, cellZ, cellSize);
        const minimumDistanceSq = dx * dx + dy * dy + dz * dz;
        if (minimumDistanceSq > radius * radius) continue;
        cells.push({
          offset: indexRecord.offset,
          count: indexRecord.count,
          minimumDistanceSq,
        });
      }
    }
  }
  cells.sort((a, b) => a.minimumDistanceSq - b.minimumDistanceSq);
  const selectedCells = [];
  let selectedPointCount = 0;
  for (const cell of cells) {
    selectedCells.push(cell);
    selectedPointCount += cell.count;
    if (selectedPointCount >= limit * 8) break;
  }
  selectedCells.sort((a, b) => a.offset - b.offset);
  const candidates = [];
  const dataFd = await fs.open(spatialDataPath, 'r');
  try {
    for (const cell of selectedCells) {
      const bytes = Buffer.allocUnsafe(cell.count * spatialPointBytes);
      const { bytesRead } = await dataFd.read(bytes, 0, bytes.length, cell.offset);
      for (let offset = 0; offset + spatialPointBytes <= bytesRead; offset += spatialPointBytes) {
        const px = bytes.readFloatLE(offset);
        const py = bytes.readFloatLE(offset + 4);
        const pz = bytes.readFloatLE(offset + 8);
        const distanceSq = (px - x) ** 2 + (py - y) ** 2 + (pz - z) ** 2;
        if (distanceSq > radius * radius) continue;
        candidates.push({
          index: bytes.readUInt32LE(offset + 16),
          typeCode: bytes.readUInt16LE(offset + 12),
          coords: { x: px, y: py, z: pz },
          distance: Math.sqrt(distanceSq),
        });
      }
    }
  } finally {
    await dataFd.close();
  }
  return candidates.sort((a, b) => a.distance - b.distance).slice(0, limit);
}

async function readImportedSystemAtIndex(index, meta) {
  const importedCount = meta?.importedCount ?? meta?.count ?? 0;
  if (!Number.isInteger(index) || index < 0 || index >= importedCount) return null;
  const fd = await fs.open(recordsPath, 'r');
  const buffer = Buffer.allocUnsafe(recordBytes);
  try {
    const { bytesRead } = await fd.read(buffer, 0, recordBytes, index * recordBytes);
    if (bytesRead !== recordBytes) return null;
  } finally {
    await fd.close();
  }
  const nameOffset = buffer.readUInt32LE(16);
  const nameLength = buffer.readUInt16LE(20);
  const namesFd = await fs.open(path.join(dataDir, 'systems-names.txt'), 'r');
  const nameBuffer = Buffer.allocUnsafe(nameLength);
  try {
    await namesFd.read(nameBuffer, 0, nameLength, nameOffset);
  } finally {
    await namesFd.close();
  }
  const typeCode = buffer.readUInt16LE(12);
  return {
    index,
    id64: buffer.readBigUInt64LE(24).toString(),
    name: nameBuffer.toString('utf8'),
    typeCode,
    mainStar: meta?.typeNames?.[typeCode] ?? 'Unknown',
    coords: {
      x: buffer.readFloatLE(0),
      y: buffer.readFloatLE(4),
      z: buffer.readFloatLE(8),
    },
  };
}

async function richIndexResultById64(id64Text) {
  const id64 = parseId64(id64Text);
  if (id64 === null) return null;
  const manifest = await getGalaxyManifest();
  for (const segment of manifest?.segments ?? []) {
    const entry = await richIndexEntry(segment, id64);
    if (!entry) continue;
    return { entry, segment };
  }
  return null;
}

async function readRichSystemFromIndexResult(richIndexResult) {
  if (!richIndexResult?.entry || !richIndexResult?.segment) return null;
  const { entry, segment } = richIndexResult;
  if (entry.offset > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Rich galaxy pack offset exceeds the Node.js safe file-position range.');
  const dataPath = galaxyDataPath(segment.dataFile);
  const fd = await fs.open(dataPath, 'r');
  try {
    const compressed = Buffer.allocUnsafe(entry.compressedLength);
    const result = await fd.read(compressed, 0, compressed.length, Number(entry.offset));
    if (result.bytesRead !== compressed.length) throw new Error(`Truncated rich galaxy pack ${segment.dataFile}`);
    const raw = zstdDecompressSync(compressed, { maxOutputLength: entry.rawLength });
    return {
      entry,
      segment,
      system: JSON.parse(raw.toString('utf8'), (key, value, context) => (
        key === 'id64' && context?.source ? context.source : value
      )),
    };
  } finally {
    await fd.close();
  }
}

async function readRichSystemById64(id64Text) {
  const richIndexResult = await richIndexResultById64(id64Text);
  if (!richIndexResult) return null;
  return readRichSystemFromIndexResult(richIndexResult);
}

function richSummaryMatches(entry, plan) {
  if (!entry) return false;
  for (const ringType of plan.filters.ringTypes) {
    if (!(entry.ringTypes & (richCategoryMasks.ring[ringType] ?? 0))) return false;
  }
  for (const bodyType of plan.filters.bodyTypes) {
    if (!(entry.bodyTypes & (richCategoryMasks.body[bodyType] ?? 0))) return false;
  }
  if (plan.filters.requireSignals && !(entry.flags & richFlags.signals)) return false;
  return true;
}

function candidateEvidence(system, rich, plan) {
  const ringEvidence = [];
  const bodyEvidence = [];
  const signalEvidence = [];
  const keywordEvidence = [];
  let score = 0;
  const bodies = Array.isArray(rich?.system?.bodies) ? rich.system.bodies : [];
  const requiredRingTypes = new Set(plan.filters.ringTypes.map((item) => item.toLowerCase()));
  const requiredBodyTypes = new Set(plan.filters.bodyTypes.map((item) => item.toLowerCase()));
  const keywords = plan.keywords.map((item) => item.toLowerCase());
  let hasRequiredRing = requiredRingTypes.size === 0;
  let hasRequiredBody = requiredBodyTypes.size === 0;
  let hasSignals = !plan.filters.requireSignals;
  let hasKeyword = keywords.length === 0;
  let signalScoreApplied = false;
  for (const body of bodies) {
    const bodyTypeText = String(body.subType ?? body.type ?? '').toLowerCase();
    if ([...requiredBodyTypes].some((type) => bodyTypeText.includes(type.replace(/[A-Z]/g, (char) => ` ${char.toLowerCase()}`).trim()))) {
      hasRequiredBody = true;
      score += 8;
      bodyEvidence.push(`${body.name ?? 'Body'} matches requested body type.`);
    }
    for (const ring of body.rings ?? []) {
      const ringText = `${ring.name ?? ''} ${ring.type ?? ''}`.toLowerCase();
      if ([...requiredRingTypes].some((type) => ringText.includes(type))) {
        hasRequiredRing = true;
        score += 14;
        ringEvidence.push(`${body.name ?? 'Body'} has ${ring.type ?? 'matching'} ring ${ring.name ?? ''}`.trim());
      }
    }
    const signalKeys = Object.keys(body.signals ?? {})
      .filter((key) => !['signals', 'updatetime', 'genuses'].includes(key.toLowerCase()));
    if (signalKeys.length) {
      hasSignals = true;
      if (!signalScoreApplied) {
        score += 6;
        signalScoreApplied = true;
      }
      signalEvidence.push(`${body.name ?? 'Body'} has ${signalKeys.join(', ')} signals.`);
    }
    const searchable = JSON.stringify({
      name: body.name,
      subType: body.subType,
      type: body.type,
      rings: body.rings,
      signals: body.signals,
      reserveLevel: body.reserveLevel,
    }).toLowerCase();
    const matchedKeywords = keywords.filter((keyword) => searchable.includes(keyword));
    if (matchedKeywords.length) {
      hasKeyword = true;
      score += matchedKeywords.length * 20;
      keywordEvidence.push(`${body.name ?? 'Body'} mentions ${matchedKeywords.join(', ')}.`);
    }
  }
  const matches = hasRequiredRing && hasRequiredBody && hasSignals;
  const evidence = [...keywordEvidence, ...ringEvidence, ...bodyEvidence, ...signalEvidence];
  return {
    matches,
    score: score + (hasKeyword ? 20 : 0),
    evidence: [...new Set(evidence)].slice(0, 5),
    confidence: hasKeyword ? 'high' : matches ? 'medium' : 'low',
  };
}

async function summarizeLlmSearch(query, target, plan, results, config) {
  if (!config?.enabled || !results.length) return '';
  const systemPrompt = 'Summarize grounded Elite Dangerous search results. Only use the provided candidates. Be concise.';
  const userPrompt = JSON.stringify({
    query,
    currentTarget: target,
    plan,
    candidates: results.map((result) => ({
      name: result.name,
      distanceLy: Number(result.distanceLy.toFixed(2)),
      mainStar: result.mainStar,
      evidence: result.evidence,
      confidence: result.confidence,
    })),
  });
  return callLlmText(config, systemPrompt, userPrompt, 600).catch(() => '');
}

async function llmAugmentedSearch(req, res) {
  const payload = await readRequestJson(req, 20000);
  const query = cleanLlmText(payload.query, 1200);
  if (query.length < 8) return badRequest(res, 'Enter a longer augmented-search request.');
  const target = payload.target && typeof payload.target === 'object' ? payload.target : {};
  const targetCoords = {
    x: Number(target.coords?.x),
    y: Number(target.coords?.y),
    z: Number(target.coords?.z),
  };
  if (!Object.values(targetCoords).every(Number.isFinite)) return badRequest(res, 'A current target with finite coordinates is required.');
  const llmConfig = payload.llm && typeof payload.llm === 'object' ? {
    enabled: Boolean(payload.llm.enabled),
    provider: cleanLlmText(payload.llm.provider, 40) || localConfig.llmSearch?.provider,
    model: cleanLlmText(payload.llm.model, 120) || localConfig.llmSearch?.model,
    apiKey: cleanLlmText(payload.llm.apiKey, 400) || localConfig.llmSearch?.apiKey,
    baseUrl: cleanLlmText(payload.llm.baseUrl, 400) || localConfig.llmSearch?.baseUrl,
  } : { enabled: false };

  const meta = await getMeta();
  if (!meta) return sendJson(res, { error: 'Systems have not been imported yet.' }, 409);
  const planResult = await llmSearchPlan(query, llmConfig);
  const plan = planResult.plan;
  const nearest = await collectNearestSpatialPoints(targetCoords, plan.scanLimit, plan.radiusLy);
  const results = [];
  for (const point of nearest) {
    const system = await readImportedSystemAtIndex(point.index, meta);
    if (!system?.id64) continue;
    const richIndexResult = await richIndexResultById64(system.id64).catch(() => null);
    if (!richSummaryMatches(richIndexResult?.entry, plan)) continue;
    const rich = await readRichSystemFromIndexResult(richIndexResult).catch(() => null);
    if (!rich) continue;
    const evidence = candidateEvidence(system, rich, plan);
    if (!evidence.matches) continue;
    results.push({
      ...system,
      source: 'LLM search',
      matchType: 'llm',
      distanceLy: point.distance,
      score: evidence.score - point.distance / 100,
      evidence: evidence.evidence,
      confidence: evidence.confidence,
    });
    if (results.length >= plan.limit * 3) break;
  }
  results.sort((a, b) => b.score - a.score || a.distanceLy - b.distanceLy);
  const trimmed = results.slice(0, plan.limit);
  const answer = await summarizeLlmSearch(query, { name: target.name ?? 'Current target', coords: targetCoords }, plan, trimmed, llmConfig);
  return sendJson(res, {
    query,
    target: { name: target.name ?? null, coords: targetCoords },
    plan,
    planner: planResult.source,
    warning: planResult.warning ?? null,
    answer,
    count: trimmed.length,
    results: trimmed,
  });
}

async function getUpdateMeta() {
  const stat = existsSync(updatesMetaPath) ? await fs.stat(updatesMetaPath) : null;
  if (!stat) return null;
  if (!updateMetaCache || updateMetaCache.mtimeMs !== stat.mtimeMs) {
    updateMetaCache = { mtimeMs: stat.mtimeMs, data: await readJson(updatesMetaPath, null) };
  }
  return updateMetaCache.data;
}

async function getUpdateIndex() {
  const stat = existsSync(updatesPath) ? await fs.stat(updatesPath) : null;
  if (!stat) return null;
  if (!updateIndexCache || updateIndexCache.mtimeMs !== stat.mtimeMs) {
    closeCachedFd(updateIndexCache);
    updateIndexCache = {
      mtimeMs: stat.mtimeMs,
      fd: openSync(updatesPath, 'r'),
      count: Math.floor(stat.size / 4),
      size: stat.size,
      headerBytes: 0,
      pages: new Map(),
    };
  }
  return updateIndexCache;
}

function updateSecondsAt(indexCache, index) {
  const record = readPagedRecord(indexCache, index, 4, updateIndexPageRecords);
  if (!record || record.length < 4) return unknownUpdateSeconds;
  return record.readUInt32LE(0);
}

async function readUpdateSecondsAt(index) {
  return updateSecondsAt(await getUpdateIndex(), index);
}

function updateRange(reqUrl) {
  const from = dateInputToSeconds(reqUrl.searchParams.get('updatedFrom'));
  const before = dateInputToSeconds(reqUrl.searchParams.get('updatedBefore'), true);
  return {
    active: from !== null || before !== null,
    from: from ?? 0,
    before: before ?? unknownUpdateSeconds,
  };
}

function updateAllowed(seconds, range) {
  if (!range.active) return true;
  return seconds !== unknownUpdateSeconds && seconds >= range.from && seconds < range.before;
}

async function getSupplemental() {
  const stat = existsSync(supplementalPath) ? await fs.stat(supplementalPath) : null;
  if (!stat) return { typeNames: [], systems: [] };
  if (!supplementalCache || supplementalCache.mtimeMs !== stat.mtimeMs) {
    supplementalCache = {
      mtimeMs: stat.mtimeMs,
      data: await readJson(supplementalPath, { typeNames: [], systems: [] }),
    };
  }
  return supplementalCache.data;
}

async function getVisited() {
  const stat = existsSync(visitedPath) ? await fs.stat(visitedPath) : null;
  const indexStat = existsSync(visitedIndexesPath) ? await fs.stat(visitedIndexesPath) : null;
  const cacheKey = `${stat?.mtimeMs ?? 0}:${indexStat?.mtimeMs ?? 0}`;
  if (!visitedCache || visitedCache.cacheKey !== cacheKey) {
    const data = await readJson(visitedPath, null);
    const indexes = await readJson(visitedIndexesPath, { indexes: [] });
    visitedIndexSet = new Set(indexes.indexes ?? []);
    visitedCache = { cacheKey, data };
  }
  return visitedCache.data;
}

async function getPlaces() {
  const stat = existsSync(placesPath) ? await fs.stat(placesPath) : null;
  const discoveriesStat = existsSync(discoveriesPath) ? await fs.stat(discoveriesPath) : null;
  const murderStat = existsSync(murderBinariesMetaPath) ? await fs.stat(murderBinariesMetaPath) : null;
  if (!stat && !discoveriesStat && !murderStat) {
    return {
      imported: false,
      importedAt: null,
      source: null,
      sourceUrl: null,
      count: 0,
      categories: {},
      discoveries: null,
      murderBinaries: null,
      places: [],
    };
  }
  const cacheKey = `${stat?.mtimeMs ?? 0}:${discoveriesStat?.mtimeMs ?? 0}:${murderStat?.mtimeMs ?? 0}`;
  if (!placesCache || placesCache.cacheKey !== cacheKey) {
    const data = stat ? await readJson(placesPath, null) : null;
    const discoveries = await getDiscoveries();
    const murderBinaries = murderStat ? await readJson(murderBinariesMetaPath, null) : null;
    const basePlaces = Array.isArray(data) ? data : data?.places ?? [];
    const discoveryPlaces = discoveries?.places ?? [];
    const places = [...basePlaces, ...discoveryPlaces];
    const categories = places.reduce((counts, place) => {
      const category = place.category ?? 'Place';
      counts[category] = (counts[category] ?? 0) + 1;
      return counts;
    }, {});
    if (murderBinaries?.count) categories['Murder Binaries'] = murderBinaries.count;
    placesCache = {
      cacheKey,
      data: {
        imported: true,
        importedAt: data?.importedAt ?? discoveries?.importedAt ?? murderBinaries?.importedAt ?? new Date((stat ?? discoveriesStat ?? murderStat).mtimeMs).toISOString(),
        source: [data?.source, discoveries?.source, murderBinaries?.source].filter(Boolean).join(' + ') || 'Places',
        sourceUrl: data?.sourceUrl ?? null,
        count: data?.count ?? places.length,
        categories,
        sourceGroups: data?.sourceGroups ?? {},
        types: data?.types ?? {},
        carrierRefresh: data?.carrierRefresh ?? null,
        discoveries: discoveries ? {
          importedAt: discoveries.importedAt,
          source: discoveries.source,
          count: discoveries.count ?? discoveryPlaces.length,
          categories: discoveries.categories ?? {},
          sourceGroups: discoveries.sourceGroups ?? {},
          sources: discoveries.sources ?? [],
        } : null,
        murderBinaries: murderBinaries ? {
          importedAt: murderBinaries.importedAt,
          count: murderBinaries.count ?? 0,
          criteria: murderBinaries.criteria,
        } : null,
        places,
      },
    };
    placesCache.data.count = places.length + Number(murderBinaries?.count ?? 0);
  }
  return placesCache.data;
}

async function getMurderBinariesIndex() {
  const [dataStat, namesStat, metaStat] = await Promise.all([
    fs.stat(murderBinariesDataPath),
    fs.stat(murderBinariesNamesPath),
    fs.stat(murderBinariesMetaPath),
  ]);
  const cacheKey = `${dataStat.mtimeMs}:${namesStat.mtimeMs}:${metaStat.mtimeMs}`;
  if (murderBinariesIndexCache?.cacheKey === cacheKey) return murderBinariesIndexCache;
  const [data, names, meta] = await Promise.all([
    fs.readFile(murderBinariesDataPath),
    fs.readFile(murderBinariesNamesPath),
    readJson(murderBinariesMetaPath, null),
  ]);
  if (!meta || data.length < 32 || data.subarray(0, 8).toString('ascii') !== 'EDMBIN01') {
    throw new Error('Invalid Murder Binaries overlay index. Rebuild it from Data > Update controls.');
  }
  const version = data.readUInt32LE(8);
  const recordBytes = data.readUInt32LE(12);
  const count = Number(data.readBigUInt64LE(16));
  if (version !== 1 || recordBytes !== 32 || data.length < 32 + count * recordBytes) {
    throw new Error('Unsupported or truncated Murder Binaries overlay index.');
  }
  murderBinariesIndexCache = { cacheKey, data, names, meta, count, recordBytes };
  return murderBinariesIndexCache;
}

function pushNearest(heap, item, limit) {
  if (heap.length < limit) {
    heap.push(item);
    let index = heap.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (heap[parent].distanceSq >= heap[index].distanceSq) break;
      [heap[parent], heap[index]] = [heap[index], heap[parent]];
      index = parent;
    }
    return;
  }
  if (item.distanceSq >= heap[0].distanceSq) return;
  heap[0] = item;
  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    let largest = index;
    if (left < heap.length && heap[left].distanceSq > heap[largest].distanceSq) largest = left;
    if (right < heap.length && heap[right].distanceSq > heap[largest].distanceSq) largest = right;
    if (largest === index) break;
    [heap[index], heap[largest]] = [heap[largest], heap[index]];
    index = largest;
  }
}

async function queryMurderBinaries(reqUrl, res) {
  if (!existsSync(murderBinariesMetaPath) || !existsSync(murderBinariesDataPath) || !existsSync(murderBinariesNamesPath)) {
    return sendJson(res, {
      error: 'Murder Binaries compact index is not available. Run npm run import:murder-binaries:index once for an existing JSON result, or rebuild the overlay.',
    }, 409);
  }
  const x = Number(reqUrl.searchParams.get('x') ?? 0);
  const y = Number(reqUrl.searchParams.get('y') ?? 0);
  const z = Number(reqUrl.searchParams.get('z') ?? 0);
  const limit = Math.max(1, Math.min(100, Number(reqUrl.searchParams.get('limit') ?? 50) || 50));
  if (![x, y, z].every(Number.isFinite)) return badRequest(res, 'x, y, and z must be finite coordinates.');
  const index = await getMurderBinariesIndex();
  const heap = [];
  for (let rowIndex = 0; rowIndex < index.count; rowIndex += 1) {
    const offset = 32 + rowIndex * index.recordBytes;
    const px = index.data.readFloatLE(offset);
    const py = index.data.readFloatLE(offset + 4);
    const pz = index.data.readFloatLE(offset + 8);
    const dx = px - x;
    const dy = py - y;
    const dz = pz - z;
    pushNearest(heap, { offset, x: px, y: py, z: pz, distanceSq: dx * dx + dy * dy + dz * dz }, limit);
  }
  const places = heap
    .sort((a, b) => a.distanceSq - b.distanceSq)
    .map((item) => {
      const nameOffset = index.data.readUInt32LE(item.offset + 12);
      const nameLength = index.data.readUInt16LE(item.offset + 16);
      const companionCount = index.data.readUInt16LE(item.offset + 18);
      const closestDistanceLs = index.data.readFloatLE(item.offset + 20);
      const id64 = index.data.readBigUInt64LE(item.offset + 24).toString();
      const name = index.names.subarray(nameOffset, nameOffset + nameLength).toString('utf8');
      return {
        id: `murder-${id64}`,
        name,
        category: 'Murder Binaries',
        source: index.meta.source ?? 'Local full galaxy analysis',
        sourceGroup: 'Local Analysis',
        type: 'Murder Binary',
        typeLabel: 'Murder Binary',
        coords: { x: item.x, y: item.y, z: item.z },
        systemName: name,
        description: `Caution: ${companionCount} stellar companion${companionCount === 1 ? '' : 's'} between 5 and 12 ls; closest is ${closestDistanceLs.toFixed(2)} ls from arrival.`,
        details: { id64, companionCount, closestDistanceLs },
        updatedAt: index.meta.importedAt,
        defaultEnabled: false,
        discovery: true,
      };
    });
  return sendJson(res, { count: index.count, places });
}

const spatialHeaderBytes = 32;
const spatialIndexRecordBytes = 24;
const spatialPointBytes = 20;
const spatialCellBias = 1 << 20;
const spatialCellMask = (1n << 21n) - 1n;
const spatialIndexPageRecords = 65536;
const updateIndexPageRecords = 1 << 20;
const maxIndexPages = 16;

function closeCachedFd(cache) {
  if (!cache?.fd) return;
  try {
    closeSync(cache.fd);
  } catch {
    // Ignore close errors during cache replacement.
  }
}

function readPagedRecord(cache, recordIndex, recordBytes, pageRecords) {
  if (!cache || recordIndex < 0 || recordIndex >= cache.count) return null;
  const pageIndex = Math.floor(recordIndex / pageRecords);
  const pageRecordStart = pageIndex * pageRecords;
  const pageByteStart = cache.headerBytes + pageRecordStart * recordBytes;
  const maxBytes = Math.min(pageRecords * recordBytes, cache.size - pageByteStart);
  if (maxBytes <= 0) return null;
  let page = cache.pages.get(pageIndex);
  if (!page) {
    const buffer = Buffer.allocUnsafe(maxBytes);
    const bytesRead = readSync(cache.fd, buffer, 0, maxBytes, pageByteStart);
    page = buffer.subarray(0, bytesRead);
    cache.pages.set(pageIndex, page);
    if (cache.pages.size > maxIndexPages) {
      const oldest = cache.pages.keys().next().value;
      cache.pages.delete(oldest);
    }
  } else {
    cache.pages.delete(pageIndex);
    cache.pages.set(pageIndex, page);
  }
  const offset = (recordIndex - pageRecordStart) * recordBytes;
  if (offset < 0 || offset + recordBytes > page.length) return null;
  return page.subarray(offset, offset + recordBytes);
}

function spatialCellKey(x, y, z) {
  return (BigInt(x + spatialCellBias) << 42n)
    | (BigInt(y + spatialCellBias) << 21n)
    | BigInt(z + spatialCellBias);
}

function spatialIndexLowerBound(index, key) {
  let low = 0;
  let high = index.count;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = readSpatialIndexRecord(index, middle)?.key ?? 0n;
    if (candidate < key) low = middle + 1;
    else high = middle;
  }
  return low;
}

function readSpatialIndexRecord(index, recordIndex) {
  const record = readPagedRecord(index, recordIndex, spatialIndexRecordBytes, spatialIndexPageRecords);
  if (!record) return null;
  return {
    key: record.readBigUInt64LE(0),
    offset: Number(record.readBigUInt64LE(8)),
    count: record.readUInt32LE(16),
  };
}

function distanceToCellAxis(value, cell, cellSize) {
  const minimum = cell * cellSize;
  const maximum = minimum + cellSize;
  if (value < minimum) return minimum - value;
  if (value > maximum) return value - maximum;
  return 0;
}

async function getSpatialIndex() {
  if (!existsSync(spatialMetaPath) || !existsSync(spatialDataPath) || !existsSync(spatialIndexPath)) return null;
  const [metaStat, dataStat, indexStat] = await Promise.all([
    fs.stat(spatialMetaPath),
    fs.stat(spatialDataPath),
    fs.stat(spatialIndexPath),
  ]);
  const cacheKey = `${metaStat.mtimeMs}:${dataStat.mtimeMs}:${indexStat.mtimeMs}`;
  if (spatialIndexCache?.cacheKey === cacheKey) return spatialIndexCache;
  closeCachedFd(spatialIndexCache);
  const meta = await readJson(spatialMetaPath, null);
  const fd = openSync(spatialIndexPath, 'r');
  const header = Buffer.allocUnsafe(spatialHeaderBytes);
  const headerBytes = readSync(fd, header, 0, spatialHeaderBytes, 0);
  if (!meta || headerBytes < spatialHeaderBytes || header.subarray(0, 8).toString('ascii') !== 'EDSPLIDX') {
    closeSync(fd);
    throw new Error('Invalid local spatial index. Rebuild it with npm run import:spatial-index.');
  }
  const version = header.readUInt32LE(8);
  const recordBytes = header.readUInt32LE(12);
  const count = Number(header.readBigUInt64LE(16));
  if (version !== 1 || recordBytes !== spatialIndexRecordBytes || indexStat.size < spatialHeaderBytes + count * recordBytes) {
    closeSync(fd);
    throw new Error('Unsupported or truncated local spatial index.');
  }
  spatialIndexCache = {
    cacheKey,
    meta,
    fd,
    count,
    size: indexStat.size,
    headerBytes: spatialHeaderBytes,
    pages: new Map(),
  };
  return spatialIndexCache;
}

async function readSpatialMeta() {
  return existsSync(spatialMetaPath) ? readJson(spatialMetaPath, null) : null;
}

async function queryLocalPoints(reqUrl, res) {
  const index = await getSpatialIndex();
  if (!index) {
    return sendJson(res, { error: 'Local spatial detail is not built. Run npm run import:spatial-index.' }, 409);
  }
  const x = Number(reqUrl.searchParams.get('x') ?? 0);
  const y = Number(reqUrl.searchParams.get('y') ?? 0);
  const z = Number(reqUrl.searchParams.get('z') ?? 0);
  if (![x, y, z].every(Number.isFinite)) return badRequest(res, 'x, y, and z must be finite coordinates.');
  const limit = Math.max(1000, Math.min(150000, Number(reqUrl.searchParams.get('limit') ?? 100000) || 100000));
  const maximumRadius = Math.max(25, Math.min(1000, Number(reqUrl.searchParams.get('radius') ?? 1000) || 1000));
  const typeSet = new Set(
    (reqUrl.searchParams.get('types') ?? '')
      .split(',')
      .filter((value) => value.trim() !== '')
      .map(Number)
      .filter(Number.isFinite)
  );
  const range = updateRange(reqUrl);
  const updates = range.active ? await getUpdateIndex() : null;
  await getVisited();
  const cellSize = Number(index.meta.cellSizeLy ?? 100);
  const densityRadii = [100, 200, 500];
  const cellXMin = Math.floor((x - maximumRadius) / cellSize);
  const cellXMax = Math.floor((x + maximumRadius) / cellSize);
  const cellYMin = Math.floor((y - maximumRadius) / cellSize);
  const cellYMax = Math.floor((y + maximumRadius) / cellSize);
  const cellZMin = Math.floor((z - maximumRadius) / cellSize);
  const cellZMax = Math.floor((z + maximumRadius) / cellSize);
  const cells = [];
  const densityCounts = new Map(densityRadii.map((radius) => [radius, 0]));
  for (let cellX = cellXMin; cellX <= cellXMax; cellX += 1) {
    for (let cellY = cellYMin; cellY <= cellYMax; cellY += 1) {
      const first = spatialIndexLowerBound(index, spatialCellKey(cellX, cellY, cellZMin));
      const last = spatialIndexLowerBound(index, spatialCellKey(cellX, cellY, cellZMax) + 1n);
      for (let cellIndex = first; cellIndex < last; cellIndex += 1) {
        const indexRecord = readSpatialIndexRecord(index, cellIndex);
        if (!indexRecord) continue;
        const cellZ = Number(indexRecord.key & spatialCellMask) - spatialCellBias;
        const dx = distanceToCellAxis(x, cellX, cellSize);
        const dy = distanceToCellAxis(y, cellY, cellSize);
        const dz = distanceToCellAxis(z, cellZ, cellSize);
        const minimumDistanceSq = dx * dx + dy * dy + dz * dz;
        if (minimumDistanceSq > maximumRadius * maximumRadius) continue;
        const cell = {
          offset: indexRecord.offset,
          count: indexRecord.count,
          minimumDistanceSq,
        };
        cells.push(cell);
        for (const densityRadius of densityRadii) {
          if (minimumDistanceSq <= densityRadius * densityRadius) {
            densityCounts.set(densityRadius, densityCounts.get(densityRadius) + indexRecord.count);
          }
        }
      }
    }
  }
  let radius = densityCounts.get(100) > 100000
    ? 100
    : densityCounts.get(200) > 100000
      ? 200
      : densityCounts.get(500) > 200000
        ? 500
        : maximumRadius;
  const eligibleCells = cells
    .filter((cell) => cell.minimumDistanceSq <= radius * radius)
    .sort((a, b) => a.minimumDistanceSq - b.minimumDistanceSq);
  const selectedCells = [];
  let selectedPointCount = 0;
  const readTarget = limit * 4;
  for (const cell of eligibleCells) {
    selectedCells.push(cell);
    selectedPointCount += cell.count;
    if (selectedPointCount >= readTarget) break;
  }
  selectedCells.sort((a, b) => a.offset - b.offset);
  const candidates = [];
  const dataFd = await fs.open(spatialDataPath, 'r');
  try {
    for (const cell of selectedCells) {
      const bytes = Buffer.allocUnsafe(cell.count * spatialPointBytes);
      const { bytesRead } = await dataFd.read(bytes, 0, bytes.length, cell.offset);
      for (let offset = 0; offset + spatialPointBytes <= bytesRead; offset += spatialPointBytes) {
        const px = bytes.readFloatLE(offset);
        const py = bytes.readFloatLE(offset + 4);
        const pz = bytes.readFloatLE(offset + 8);
        const dx = px - x;
        const dy = py - y;
        const dz = pz - z;
        const distanceSq = dx * dx + dy * dy + dz * dz;
        if (distanceSq > radius * radius) continue;
        const typeCode = bytes.readUInt16LE(offset + 12);
        if (!typeAllowed(typeCode, typeSet)) continue;
        const recordIndex = bytes.readUInt32LE(offset + 16);
        if (range.active && !updateAllowed(updateSecondsAt(updates, recordIndex), range)) continue;
        const record = Buffer.allocUnsafe(spatialPointBytes);
        bytes.copy(record, 0, offset, offset + spatialPointBytes);
        record.writeUInt16LE(record.readUInt16LE(14) | (visitedIndexSet.has(recordIndex) ? 4 : 0), 14);
        candidates.push({ distanceSq, record });
      }
    }
  } finally {
    await dataFd.close();
  }
  candidates.sort((a, b) => a.distanceSq - b.distanceSq);
  const selected = candidates.slice(0, limit);
  const body = Buffer.allocUnsafe(selected.length * spatialPointBytes);
  for (let indexPosition = 0; indexPosition < selected.length; indexPosition += 1) {
    selected[indexPosition].record.copy(body, indexPosition * spatialPointBytes);
  }
  res.writeHead(200, {
    'content-type': 'application/octet-stream',
    'content-length': body.length,
    'x-local-radius': String(radius),
    'x-local-count': String(selected.length),
    'x-local-density': String(densityCounts.get(radius) ?? selected.length),
    'cache-control': 'no-store',
  });
  res.end(body);
}

async function getDiscoveries() {
  const stat = existsSync(discoveriesPath) ? await fs.stat(discoveriesPath) : null;
  if (!stat) return null;
  if (!discoveriesCache || discoveriesCache.mtimeMs !== stat.mtimeMs) {
    discoveriesCache = {
      mtimeMs: stat.mtimeMs,
      data: await readJson(discoveriesPath, null),
    };
  }
  return discoveriesCache.data;
}

function placesSummary(places) {
  return {
    imported: Boolean(places?.imported),
    importedAt: places?.importedAt ?? null,
    source: places?.source ?? null,
    sourceUrl: places?.sourceUrl ?? null,
    count: places?.count ?? 0,
    categories: places?.categories ?? {},
    sourceGroups: places?.sourceGroups ?? {},
    types: places?.types ?? {},
    carrierRefresh: places?.carrierRefresh ?? null,
    discoveries: places?.discoveries ?? null,
    murderBinaries: places?.murderBinaries ?? null,
  };
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function isUrl(value) {
  return /^https?:\/\//i.test(value);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((item) => item.some((value) => value.trim() !== ''));
}

function headerMap(headers) {
  return new Map(headers.map((header, index) => [header.trim().toLowerCase(), index]));
}

function csvValue(row, headers, names) {
  for (const name of names) {
    const index = headers.get(name.toLowerCase());
    if (index !== undefined) return row[index]?.trim() ?? '';
  }
  return '';
}

function numberValue(row, headers, names) {
  const raw = csvValue(row, headers, names);
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
}

function splitWords(value) {
  return String(value ?? '')
    .trim()
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter(Boolean);
}

function titleCase(value) {
  return splitWords(value)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function compactTitle(value) {
  return titleCase(value)
    .replace(/\bPoi\b/g, 'POI')
    .replace(/\bNsp\b/g, 'NSP')
    .replace(/\bDssa\b/g, 'DSSA')
    .replace(/\bCcl\b/g, 'CCL')
    .replace(/\bGgg\b/g, 'GGG');
}

function hashId(input) {
  return createHash('sha1').update(input).digest('hex').slice(0, 16);
}

function dedupePlaceKey(name, coords, type) {
  return [
    name.trim().toLowerCase(),
    coords.x.toFixed(3),
    coords.y.toFixed(3),
    coords.z.toFixed(3),
    type.trim().toLowerCase(),
  ].join('|');
}

function categoryForPoiType(rawType) {
  const key = String(rawType ?? '').trim().toLowerCase();
  if (key.includes('nebula')) return 'Nebulae';
  if (key.includes('carrier')) return 'Fleet Carriers';
  if (key.includes('megaship') || key.includes('outpost') || key === 'inhabited system') return 'Stations / Megaships';
  if (key.includes('guardian') || key.includes('mystery') || key.includes('xenology') || key.includes('glitches')) return 'Mystery / Xenology';
  if (key.includes('blackhole') || key.includes('stellar') || key.includes('pulsar') || key.includes('starcluster') || key.startsWith('star') || key.includes('ggg') || key.includes('green gas giants') || key.includes('notable stellar phenomena') || key.includes('cclnsp')) return 'Stellar Features';
  if (key.includes('planet') || key.includes('surface') || key.includes('geyser') || key.includes('organic') || key.includes('bio')) return 'Planetary / Biological';
  if (key.includes('trit_hwy') || key.includes('jumponium')) return 'Routes / Resources';
  if (key.includes('historical') || key.includes('tourist') || key.includes('sights') || key.includes('scenery') || key.includes('regional') || key.includes('restricted') || key.includes('memorial') || key.includes('community')) return 'Sightseeing / Historical';
  return 'Other POIs';
}

function sourceGroupForPoiType(rawType) {
  const type = String(rawType ?? '').toLowerCase();
  if (type.includes('dssa')) return 'DSSA';
  if (type.includes('canonn') || type.startsWith('ccl')) return 'Canonn';
  if (type.includes('carrier')) return 'Fleet Carrier Network';
  if (type.startsWith('star')) return 'STAR Initiative';
  if (type.startsWith('trit_hwy')) return 'Tritium Highway';
  return 'EDAstro / EDSM / GMP';
}

function isCarrierPlace(place) {
  return String(place?.type ?? '').toLowerCase().includes('carrier')
    || String(place?.category ?? '').toLowerCase() === 'fleet carriers';
}

function normalizeCarrierRow(row, headers, updatedAt) {
  const rawType = csvValue(row, headers, ['POI Type']);
  if (!String(rawType).toLowerCase().includes('carrier')) return null;
  const name = csvValue(row, headers, ['Name']);
  const x = numberValue(row, headers, ['X']);
  const y = numberValue(row, headers, ['Y']);
  const z = numberValue(row, headers, ['Z']);
  if (!name || x === null || y === null || z === null) return null;
  const coords = { x, y, z };
  const key = dedupePlaceKey(name, coords, rawType || 'carrier');
  return {
    id: hashId(key),
    name,
    category: categoryForPoiType(rawType),
    source: 'EDAstro Combined POI',
    sourceGroup: sourceGroupForPoiType(rawType),
    sourceId: csvValue(row, headers, ['ID']) || null,
    type: rawType || 'carrier',
    typeLabel: rawType ? compactTitle(rawType) : 'Carrier',
    coords,
    systemName: csvValue(row, headers, ['Reference System']) || null,
    description: csvValue(row, headers, ['Notes']),
    updatedAt,
  };
}

function countsBy(items, field) {
  const counts = {};
  for (const item of items) {
    const key = item[field] ?? 'Unknown';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

async function fetchText(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function shouldRefreshCarriers(payload) {
  return payload?.source === 'EDAstro Combined POI'
    && payload?.carrierRefresh?.date !== todayKey();
}

async function refreshCarrierPlacesOnceDaily() {
  const payload = await readJson(placesPath, null);
  if (!payload?.places?.length || !shouldRefreshCarriers(payload)) return;
  if (carrierRefreshPromise) return carrierRefreshPromise;
  carrierRefreshPromise = (async () => {
    const checkedAt = new Date().toISOString();
    const date = todayKey();
    try {
      const rows = parseCsv(await fetchText(combinedPoiUrl));
      const headers = headerMap(rows[0] ?? []);
      for (const required of ['poi type', 'id', 'name', 'x', 'y', 'z', 'reference system']) {
        if (!headers.has(required)) throw new Error(`Missing required CSV header: ${required}`);
      }
      const seen = new Set();
      const carriers = [];
      for (const row of rows.slice(1)) {
        const carrier = normalizeCarrierRow(row, headers, checkedAt);
        if (!carrier) continue;
        const key = dedupePlaceKey(carrier.name, carrier.coords, carrier.type);
        if (seen.has(key)) continue;
        seen.add(key);
        carriers.push(carrier);
      }
      const places = [
        ...(payload.places ?? []).filter((place) => !isCarrierPlace(place)),
        ...carriers,
      ].sort((a, b) => a.name.localeCompare(b.name));
      const next = {
        ...payload,
        importedAt: payload.importedAt ?? checkedAt,
        source: 'EDAstro Combined POI',
        sourceUrl: isUrl(payload.sourceUrl) ? payload.sourceUrl : combinedPoiUrl,
        count: places.length,
        categories: countsBy(places, 'category'),
        sourceGroups: countsBy(places, 'sourceGroup'),
        types: countsBy(places, 'type'),
        carrierRefresh: {
          date,
          checkedAt,
          ok: true,
          updatedCount: carriers.length,
          sourceUrl: combinedPoiUrl,
        },
        places,
      };
      await fs.writeFile(placesPath, JSON.stringify(next, null, 2));
      placesCache = null;
    } catch (error) {
      const next = {
        ...payload,
        carrierRefresh: {
          date,
          checkedAt,
          ok: false,
          message: error.message,
          sourceUrl: combinedPoiUrl,
        },
      };
      await fs.writeFile(placesPath, JSON.stringify(next, null, 2));
      placesCache = null;
    } finally {
      carrierRefreshPromise = null;
    }
  })();
  return carrierRefreshPromise;
}

function sendJson(res, data, status = 200) {
  const body = Buffer.from(JSON.stringify(data));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
  });
  res.end(body);
}

function badRequest(res, message) {
  sendJson(res, { error: message }, 400);
}

function notFound(res) {
  sendJson(res, { error: 'Not found' }, 404);
}

function typeAllowed(typeCode, typeSet) {
  return typeSet.size === 0 || typeSet.has(typeCode);
}

function systemNameKey(name) {
  return String(name ?? '').trim().toLowerCase();
}

function finiteCoords(coords) {
  return coords
    && Number.isFinite(Number(coords.x))
    && Number.isFinite(Number(coords.y))
    && Number.isFinite(Number(coords.z));
}

function coordKey(coords) {
  if (!finiteCoords(coords)) return null;
  return `${Math.round(Number(coords.x) * 1000)}:${Math.round(Number(coords.y) * 1000)}:${Math.round(Number(coords.z) * 1000)}`;
}

function coordKeyFromBuffer(buffer, offset = 0) {
  return coordKey({
    x: buffer.readFloatLE(offset),
    y: buffer.readFloatLE(offset + 4),
    z: buffer.readFloatLE(offset + 8),
  });
}

function typeCodeForVisitedSystem(meta, system) {
  const typeNames = meta?.typeNames ?? [];
  const exact = typeNames.indexOf(system.mainStar ?? 'Unknown');
  if (exact >= 0) return exact;
  const unknown = typeNames.indexOf('Unknown');
  return unknown >= 0 ? unknown : 0;
}

function supplementalFlags(system) {
  const star = system.mainStar ?? '';
  const nonStandard = /Black Hole|Neutron|White Dwarf|T Tauri|Wolf-Rayet|Herbig|giant|super giant|C Star|CJ Star|CN Star|S-type|MS-type/i.test(star)
    || !/\bStar$/.test(star);
  return 4 | (nonStandard ? 2 : 0);
}

function virtualVisitedBase(meta, supplemental) {
  const importedCount = meta?.importedCount ?? meta?.count ?? 0;
  let maxIndex = importedCount - 1;
  for (const system of supplemental?.systems ?? []) {
    const index = Number(system.index);
    if (Number.isInteger(index) && index > maxIndex) maxIndex = index;
  }
  return maxIndex + 1;
}

function virtualVisitedSystemAt(index, meta, supplemental, visited) {
  const base = virtualVisitedBase(meta, supplemental);
  const offset = index - base;
  const systems = visited?.systems ?? [];
  if (!Number.isInteger(offset) || offset < 0 || offset >= systems.length) return null;
  const system = systems[offset];
  if (!finiteCoords(system.coords)) return null;
  return { ...system, index };
}

function pointEntryFromVisitedSystem(system, index, typeCode) {
  const entry = Buffer.allocUnsafe(lodBytes);
  entry.writeFloatLE(Number(system.coords.x), 0);
  entry.writeFloatLE(Number(system.coords.y), 4);
  entry.writeFloatLE(Number(system.coords.z), 8);
  entry.writeUInt16LE(Number(typeCode ?? 0), 12);
  entry.writeUInt16LE(supplementalFlags(system), 14);
  entry.writeUInt32LE(Number(index), 16);
  return entry;
}

function chooseLod(meta, requested) {
  if (!meta?.lodLevels?.length) return null;
  if (requested !== null && requested !== undefined) {
    const exact = meta.lodLevels.find((level) => level.level === Number(requested));
    if (exact) return exact;
  }
  return [...meta.lodLevels]
    .filter((level) => level.count > 0 && level.count <= 250000)
    .sort((a, b) => b.count - a.count)[0] ?? meta.lodLevels.at(-1);
}

function pointEntryFromRecord(record, index, forceFlags = 0) {
  const entry = Buffer.allocUnsafe(lodBytes);
  record.copy(entry, 0, 0, 16);
  entry.writeUInt16LE(record.readUInt16LE(14) | forceFlags, 14);
  entry.writeUInt32LE(index, 16);
  return entry;
}

async function appendVisitedImportedPoints(out, included, includedCoords, meta, typeSet, range, updates) {
  const importedCount = meta?.importedCount ?? meta?.count ?? 0;
  const indexes = [...visitedIndexSet]
    .filter((index) => Number.isInteger(index) && index >= 0 && index < importedCount && !included.has(index))
    .sort((a, b) => a - b);
  if (!indexes.length) return;

  const fd = await fs.open(recordsPath, 'r');
  const record = Buffer.allocUnsafe(recordBytes);
  try {
    for (const index of indexes) {
      const { bytesRead } = await fd.read(record, 0, recordBytes, index * recordBytes);
      if (bytesRead !== recordBytes) continue;
      const typeCode = record.readUInt16LE(12);
      if (!typeAllowed(typeCode, typeSet)) continue;
      if (range.active && !updateAllowed(updateSecondsAt(updates, index), range)) continue;
      out.push(pointEntryFromRecord(record, index, 4));
      included.add(index);
      const key = coordKeyFromBuffer(record);
      if (key) includedCoords.add(key);
    }
  } finally {
    await fd.close();
  }
}

function appendVirtualVisitedPoints(out, included, includedCoords, meta, supplemental, visited, typeSet, range) {
  const supplementalNames = new Set((supplemental?.systems ?? []).map((system) => systemNameKey(system.name)));
  const base = virtualVisitedBase(meta, supplemental);
  const systems = visited?.systems ?? [];
  systems.forEach((system, offset) => {
    if (!finiteCoords(system.coords)) return;
    if (supplementalNames.has(systemNameKey(system.name))) return;
    const key = coordKey(system.coords);
    if (key && includedCoords.has(key)) return;
    const index = base + offset;
    if (included.has(index)) return;
    const typeCode = typeCodeForVisitedSystem(meta, system);
    if (!typeAllowed(typeCode, typeSet)) return;
    if (!updateAllowed(parseUpdateSeconds(system.updateTime ?? system.lastVisited ?? system.firstVisited), range)) return;
    out.push(pointEntryFromVisitedSystem(system, index, typeCode));
    included.add(index);
    if (key) includedCoords.add(key);
  });
}

async function readPoints(reqUrl, res) {
  const meta = await getMeta();
  if (!meta) return sendJson(res, { error: 'Systems have not been imported yet.' }, 409);
  const visited = await getVisited();

  const lod = chooseLod(meta, reqUrl.searchParams.get('lod'));
  if (!lod) return sendJson(res, { error: 'No LOD point files are available.' }, 409);

  const typeSet = new Set(
    (reqUrl.searchParams.get('types') ?? '')
      .split(',')
      .filter((x) => x.trim() !== '')
      .map((x) => Number(x))
      .filter((x) => Number.isFinite(x))
  );
  const range = updateRange(reqUrl);
  const richFilters = richPointFilters(reqUrl);
  const updates = range.active ? await getUpdateIndex() : null;
  const limit = Math.max(1000, Math.min(Number(reqUrl.searchParams.get('limit') ?? 250000), 500000));
  const source = path.join(dataDir, lod.file);
  const out = [];
  const included = new Set();
  const includedCoords = new Set();
  const fd = await fs.open(source, 'r');
  const buffer = Buffer.allocUnsafe(lodBytes * 8192);
  const galaxyManifest = richFilters.active ? await getGalaxyManifest() : null;
  const richLod = galaxyManifest?.mapFilters?.lodLevels?.find((entry) => Number(entry.level) === Number(lod.level));
  const richRecordBytes = Number(galaxyManifest?.mapFilters?.recordBytes ?? 0);
  if (richFilters.active && !richLod) {
    await fd.close();
    return sendJson(res, { error: `Rich filters are not available for LOD ${lod.level}. Reimport galaxy.json.gz to build filter indexes.` }, 409);
  }
  if (richFilters.active && richRecordBytes < richFilterMinimumRecordBytes) {
    await fd.close();
    return sendJson(res, { error: 'The rich map filter index format is invalid. Reimport galaxy.json.gz.' }, 409);
  }
  if (richFilters.advanced && richRecordBytes < 40) {
    await fd.close();
    return sendJson(res, { error: 'Detailed body and economy filters require a new full galaxy import.' }, 409);
  }
  const richFd = richLod ? await fs.open(galaxyDataPath(richLod.file), 'r') : null;
  const richBuffer = richFd ? Buffer.allocUnsafe(richRecordBytes * 8192) : null;

  try {
    let position = 0;
    while (out.length < limit) {
      const pointPosition = position / lodBytes;
      const { bytesRead } = await fd.read(buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      position += bytesRead;
      const pointCount = Math.floor(bytesRead / lodBytes);
      let richBytesRead = 0;
      if (richFd && richBuffer) {
        const richRead = await richFd.read(
          richBuffer,
          0,
          pointCount * richRecordBytes,
          pointPosition * richRecordBytes
        );
        richBytesRead = richRead.bytesRead;
      }
      for (let offset = 0; offset + lodBytes <= bytesRead && out.length < limit; offset += lodBytes) {
        const typeCode = buffer.readUInt16LE(offset + 12);
        if (!typeAllowed(typeCode, typeSet)) continue;
        if (richFilters.active) {
          const richOffset = (offset / lodBytes) * richRecordBytes;
          if (!richBuffer || richOffset + richRecordBytes > richBytesRead) continue;
          if (!richPointAllowed(richBuffer, richOffset, richFilters, richRecordBytes)) continue;
        }
        const recordIndex = buffer.readUInt32LE(offset + 16);
        if (range.active && !updateAllowed(updateSecondsAt(updates, recordIndex), range)) continue;
        const flags = buffer.readUInt16LE(offset + 14) | (visitedIndexSet.has(recordIndex) ? 4 : 0);
        const entry = Buffer.allocUnsafe(lodBytes);
        buffer.copy(entry, 0, offset, offset + lodBytes);
        entry.writeUInt16LE(flags, 14);
        out.push(entry);
        included.add(recordIndex);
        const key = coordKeyFromBuffer(buffer, offset);
        if (key) includedCoords.add(key);
      }
    }
  } finally {
    await fd.close();
    if (richFd) await richFd.close();
  }

  if (!richFilters.active) {
    await appendVisitedImportedPoints(out, included, includedCoords, meta, typeSet, range, updates);
  }

  const supplemental = await getSupplemental();
  if (!richFilters.active) {
    for (const system of supplemental.systems ?? []) {
      if (!typeAllowed(system.typeCode, typeSet)) continue;
      if (!updateAllowed(parseUpdateSeconds(system.updateTime), range)) continue;
      if (included.has(Number(system.index))) continue;
      const entry = Buffer.allocUnsafe(lodBytes);
      entry.writeFloatLE(Number(system.coords?.x ?? 0), 0);
      entry.writeFloatLE(Number(system.coords?.y ?? 0), 4);
      entry.writeFloatLE(Number(system.coords?.z ?? 0), 8);
      entry.writeUInt16LE(Number(system.typeCode ?? 0), 12);
      entry.writeUInt16LE(supplementalFlags(system), 14);
      entry.writeUInt32LE(Number(system.index), 16);
      out.push(entry);
      included.add(Number(system.index));
      const key = coordKey(system.coords);
      if (key) includedCoords.add(key);
    }
    appendVirtualVisitedPoints(out, included, includedCoords, meta, supplemental, visited, typeSet, range);
  }

  const body = Buffer.concat(out);
  res.writeHead(200, {
    'content-type': 'application/octet-stream',
    'content-length': body.length,
    'x-lod-level': String(lod.level),
    'x-total-count': String(lod.count),
    'x-rich-filters': richFilters.active ? '1' : '0',
    'cache-control': 'no-store',
  });
  res.end(body);
}

function searchMatch(query, candidate) {
  if (!query) return null;
  if (candidate.startsWith(query)) return { score: 3000 - candidate.length, matchType: 'startsWith' };

  const exactAt = candidate.indexOf(query);
  if (exactAt >= 0) return { score: 2000 - exactAt - candidate.length * 0.01, matchType: 'contains' };

  let qi = 0;
  let gaps = 0;
  let last = -1;
  for (let ci = 0; ci < candidate.length && qi < query.length; ci += 1) {
    if (candidate[ci] === query[qi]) {
      if (last >= 0) gaps += ci - last - 1;
      last = ci;
      qi += 1;
    }
  }
  if (qi < query.length) return null;
  return { score: Math.max(1, 350 - gaps - candidate.length), matchType: 'fuzzy' };
}

async function getSuggestOverlayBucket(key) {
  if (!existsSync(suggestOverlayPath)) {
    suggestOverlayCache = null;
    return [];
  }
  const stat = await fs.stat(suggestOverlayPath);
  if (!suggestOverlayCache || suggestOverlayCache.mtimeMs !== stat.mtimeMs || suggestOverlayCache.size !== stat.size) {
    const buckets = new Map();
    const rl = readline.createInterface({
      input: createReadStream(suggestOverlayPath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      const lowerName = line.slice(0, line.indexOf('\t'));
      const bucketKey = suggestKey(lowerName);
      if (!bucketKey) continue;
      if (!buckets.has(bucketKey)) buckets.set(bucketKey, []);
      buckets.get(bucketKey).push(line);
    }
    suggestOverlayCache = { mtimeMs: stat.mtimeMs, size: stat.size, buckets };
  }
  return suggestOverlayCache.buckets.get(key) ?? [];
}

async function searchSystems(reqUrl, res) {
  const q = (reqUrl.searchParams.get('q') ?? '').trim().toLowerCase();
  if (q.length < 3) return sendJson(res, { query: q, results: [] });
  const max = Math.max(5, Math.min(Number(reqUrl.searchParams.get('limit') ?? 30), 100));
  const results = [];
  const seenIndexes = new Set();
  const seenNames = new Set();
  const key = suggestKey(q);
  const bucketPath = path.join(suggestDir, `${key}.tsv`);

  function addSearchLine(line, scoreBoost = 0, source = null) {
    const [lowerName, name, indexText, typeText, xText, yText, zText] = line.split('\t');
    const match = searchMatch(q, lowerName);
    if (!match) return;
    const index = Number(indexText);
    if (seenIndexes.has(index)) return;
    seenIndexes.add(index);
    seenNames.add(lowerName);
    results.push({
      name,
      index,
      typeCode: Number(typeText),
      coords: { x: Number(xText), y: Number(yText), z: Number(zText) },
      score: match.score + scoreBoost,
      matchType: match.matchType,
      overridesFilters: true,
      source,
    });
    results.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    if (results.length > max * 4) results.length = max * 2;
  }

  for (const line of await getSuggestOverlayBucket(key)) {
    addSearchLine(line, 25, 'delta-overlay');
  }

  if (existsSync(bucketPath)) {
    const rl = readline.createInterface({
      input: createReadStream(bucketPath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      addSearchLine(line);
    }
  } else if (!existsSync(suggestDir) && !existsSync(suggestOverlayPath)) {
    return sendJson(res, {
      query: q,
      results: [],
      missingSuggestionIndex: true,
      message: 'Run npm run import:suggestions to enable typeahead suggestions.',
    });
  }

  const supplemental = await getSupplemental();
  for (const system of supplemental.systems ?? []) {
    const lowerName = systemNameKey(system.name);
    const match = searchMatch(q, lowerName);
    if (!match) continue;
    if (seenIndexes.has(system.index)) continue;
    seenIndexes.add(system.index);
    seenNames.add(lowerName);
    results.push({
      name: system.name,
      index: system.index,
      typeCode: system.typeCode,
      coords: system.coords,
      score: match.score + 50,
      matchType: match.matchType,
      overridesFilters: true,
      source: system.source,
    });
    results.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    if (results.length > max * 4) results.length = max * 2;
  }

  const meta = await getMeta();
  const visited = await getVisited();
  const virtualBase = virtualVisitedBase(meta, supplemental);
  for (const [offset, system] of (visited?.systems ?? []).entries()) {
    if (!finiteCoords(system.coords)) continue;
    const lowerName = systemNameKey(system.name);
    if (seenNames.has(lowerName)) continue;
    const match = searchMatch(q, lowerName);
    if (!match) continue;
    const index = virtualBase + offset;
    if (seenIndexes.has(index)) continue;
    seenIndexes.add(index);
    seenNames.add(lowerName);
    results.push({
      name: system.name,
      index,
      typeCode: typeCodeForVisitedSystem(meta, system),
      coords: system.coords,
      score: match.score + 35,
      matchType: match.matchType,
      overridesFilters: true,
      source: 'Player Journal',
    });
    results.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    if (results.length > max * 4) results.length = max * 2;
  }

  sendJson(res, { query: q, results: results.slice(0, max) });
}

async function readSystemDetail(reqUrl, res) {
  const index = Number(reqUrl.searchParams.get('index'));
  if (!Number.isInteger(index) || index < 0) return badRequest(res, 'A valid system index is required.');
  if (!existsSync(recordsPath)) return sendJson(res, { error: 'Systems have not been imported yet.' }, 409);
  const meta = await getMeta();
  await getVisited();
  const cached = getCachedSystemDetail(index);
  if (cached) return sendSystemDetail(res, index, cached);
  const importedCount = meta?.importedCount ?? meta?.count ?? 0;
  if (index >= importedCount) {
    const supplemental = await getSupplemental();
    const system = (supplemental.systems ?? []).find((entry) => entry.index === index);
    if (!system) {
      const visited = await getVisited();
      const virtualSystem = virtualVisitedSystemAt(index, meta, supplemental, visited);
      if (!virtualSystem) return notFound(res);
      const systemName = virtualSystem.name;
      return sendSystemDetail(res, index, {
        index,
        id64: String(virtualSystem.id64 ?? virtualSystem.systemAddress ?? `journal:${systemName}`),
        name: systemName,
        mainStar: virtualSystem.mainStar ?? 'Unknown',
        typeCode: typeCodeForVisitedSystem(meta, virtualSystem),
        coords: virtualSystem.coords,
        needsPermit: false,
        nonStandard: Boolean(supplementalFlags(virtualSystem) & 2),
        visited: true,
        source: 'Player Journal',
        firstVisited: virtualSystem.firstVisited,
        lastVisited: virtualSystem.lastVisited,
        updateTime: virtualSystem.updateTime ?? virtualSystem.lastVisited,
        lastEvent: virtualSystem.lastEvent,
        visitCount: virtualSystem.count,
      });
    }
    const systemName = system.name;
    return sendSystemDetail(res, index, {
      index,
      id64: String(system.id64 ?? system.systemAddress ?? ''),
      name: systemName,
      mainStar: system.mainStar ?? 'Unknown',
      typeCode: system.typeCode,
      coords: system.coords,
      needsPermit: false,
      nonStandard: Boolean(supplementalFlags(system) & 2),
      visited: true,
      source: system.source ?? 'Player Journal',
      firstVisited: system.firstVisited,
      lastVisited: system.lastVisited,
      updateTime: system.updateTime ?? system.lastVisited,
      lastEvent: system.lastEvent,
      visitCount: system.visitCount,
    });
  }
  const fd = await fs.open(recordsPath, 'r');
  const buffer = Buffer.allocUnsafe(recordBytes);
  try {
    const { bytesRead } = await fd.read(buffer, 0, recordBytes, index * recordBytes);
    if (bytesRead !== recordBytes) return notFound(res);
  } finally {
    await fd.close();
  }

  const nameOffset = buffer.readUInt32LE(16);
  const nameLength = buffer.readUInt16LE(20);
  const namesFd = await fs.open(path.join(dataDir, 'systems-names.txt'), 'r');
  const nameBuffer = Buffer.allocUnsafe(nameLength);
  try {
    await namesFd.read(nameBuffer, 0, nameLength, nameOffset);
  } finally {
    await namesFd.close();
  }

  const typeCode = buffer.readUInt16LE(12);
  const flags = buffer.readUInt16LE(14);
  const updateSeconds = await readUpdateSecondsAt(index);
  const systemName = nameBuffer.toString('utf8');
  return sendSystemDetail(res, index, {
    index,
    id64: buffer.readBigUInt64LE(24).toString(),
    name: systemName,
    mainStar: meta?.typeNames?.[typeCode] ?? 'Unknown',
    typeCode,
    coords: {
      x: buffer.readFloatLE(0),
      y: buffer.readFloatLE(4),
      z: buffer.readFloatLE(8),
    },
    needsPermit: Boolean(flags & 1),
    nonStandard: Boolean(flags & 2),
    visited: visitedIndexSet.has(index),
    updateTime: secondsToIso(updateSeconds),
    source: 'Spansh',
  });
}

async function runJournalRefresh(reqUrl, res) {
  if (journalScanStatus.running) {
    return sendJson(res, { started: false, scan: journalScanStatus });
  }
  const mode = reqUrl.searchParams.get('mode') === 'all' ? 'all' : 'latest';
  const latestCount = Math.max(1, Math.min(Number(reqUrl.searchParams.get('count') ?? 20) || 20, 200));
  const args = [path.join(__dirname, 'scripts', 'import-journals.js')];
  if (mode === 'all') args.push('--all');
  else args.push('--latest', String(latestCount));
  const id = `${Date.now()}-${mode}`;
  const startedAt = new Date().toISOString();

  const child = spawn(process.execPath, args, {
    cwd: __dirname,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let stdoutBuffer = '';

  journalScanStatus = {
    running: true,
    id,
    mode,
    startedAt,
    finishedAt: null,
    message: mode === 'all' ? 'starting all scan' : 'starting latest scan',
    ok: null,
    code: null,
    stdout: '',
    stderr: '',
  };

  function handleStdout(chunk) {
    const text = chunk.toString();
    stdout += text;
    stdoutBuffer += text;
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith('PROGRESS\t')) journalScanStatus.message = line.slice(9);
    }
  }

  child.stdout.on('data', handleStdout);
  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    stderr += text;
    const lastLine = text.trim().split(/\r?\n/).filter(Boolean).at(-1);
    if (lastLine) journalScanStatus.message = lastLine.slice(0, 120);
  });
  child.on('error', (error) => {
    stderr += `${error.message}\n`;
    journalScanStatus = {
      ...journalScanStatus,
      running: false,
      finishedAt: new Date().toISOString(),
      message: error.message,
      ok: false,
      code: -1,
      stdout,
      stderr,
    };
  });
  child.on('close', async (code) => {
    if (stdoutBuffer.startsWith('PROGRESS\t')) journalScanStatus.message = stdoutBuffer.slice(9);
    visitedCache = null;
    supplementalCache = null;
    journalBodiesCache = null;
    metaCache = null;
    clearSystemDetailCache();
    await getVisited().catch(() => null);
    const finalLine = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('PROGRESS\t'))
      .at(-1);
    journalScanStatus = {
      ...journalScanStatus,
      running: false,
      finishedAt: new Date().toISOString(),
      message: finalLine || (code === 0 ? 'complete' : 'failed'),
      ok: code === 0,
      code,
      stdout,
      stderr,
    };
  });
  return sendJson(res, { started: true, scan: journalScanStatus }, 202);
}

function runChildStep(step, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let stdoutBuffer = '';

    systemUpdateStatus = {
      ...systemUpdateStatus,
      step,
      message: `starting ${step}`,
    };

    function handleLine(line) {
      const clean = line.trim();
      if (!clean) return;
      systemUpdateStatus.message = clean.startsWith('PROGRESS\t') ? clean.slice(9) : clean.slice(0, 140);
    }

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      stdoutBuffer += text;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) handleLine(line);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      const lastLine = text.trim().split(/\r?\n/).filter(Boolean).at(-1);
      if (lastLine) systemUpdateStatus.message = lastLine.slice(0, 140);
    });
    child.on('error', (error) => {
      stderr += `${error.message}\n`;
      resolve({ ok: false, code: -1, stdout, stderr, message: error.message });
    });
    child.on('close', (code) => {
      if (stdoutBuffer) handleLine(stdoutBuffer);
      const finalLine = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('PROGRESS\t'))
        .at(-1);
      resolve({
        ok: code === 0,
        code,
        stdout,
        stderr,
        message: finalLine || (code === 0 ? `${step} complete` : `${step} failed`),
      });
    });
  });
}

async function runSystemUpdate(reqUrl, res) {
  if (systemUpdateStatus.running) {
    return sendJson(res, { started: false, update: systemUpdateStatus });
  }
  if (journalScanStatus.running) {
    return sendJson(res, { started: false, update: systemUpdateStatus, error: 'Journal scan is already running.' }, 409);
  }
  const mode = reqUrl.searchParams.get('mode') ?? '1month';
  const placesUpdate = mode === 'places';
  const discoveriesUpdate = mode === 'discoveries';
  const murderBinariesUpdate = mode === 'murder-binaries';
  const galaxyUpdate = mode === 'galaxy';
  const localGalaxyPath = path.join(__dirname, 'galaxy.json.gz');
  const sourceInfo = placesUpdate
    ? { label: 'EDAstro Combined POI', url: combinedPoiUrl, large: false, kind: 'places' }
    : discoveriesUpdate
      ? { label: 'EDAstro + Explorarium Discoveries', url: 'multiple discovery sources', large: false, kind: 'discoveries' }
      : murderBinariesUpdate
        ? { label: 'Murder Binaries local analysis', url: path.join(dataDir, 'galaxy'), large: true, kind: 'murder-binaries' }
      : galaxyUpdate
        ? { label: 'Local Spansh full galaxy data', url: localGalaxyPath, large: true, kind: 'galaxy' }
        : systemDeltaSources[mode];
  if (!sourceInfo) return badRequest(res, `Unknown system update mode: ${mode}`);
  if (galaxyUpdate && !existsSync(localGalaxyPath)) {
    return sendJson(res, { error: `Cannot find ${localGalaxyPath}. Download galaxy.json.gz into the project folder first.` }, 409);
  }
  if (sourceInfo.large && reqUrl.searchParams.get('confirmLarge') !== '1') {
    return sendJson(res, {
      error: `${sourceInfo.label} processes or downloads a large dataset. Confirm it in the app before starting.`,
      requiresConfirmation: true,
      mode,
      source: sourceInfo.label,
    }, 409);
  }
  const source = sourceInfo.url;

  const id = `${Date.now()}-${mode}`;
  const startedAt = new Date().toISOString();
  systemUpdateStatus = {
    running: true,
    id,
    mode,
    startedAt,
    finishedAt: null,
    step: 'queued',
    message: placesUpdate
      ? 'queued places update'
      : discoveriesUpdate
        ? 'queued discoveries update'
        : murderBinariesUpdate
          ? 'queued Murder Binaries analysis'
        : galaxyUpdate
          ? 'queued full galaxy import'
          : `queued ${mode} systems update`,
    ok: null,
    code: null,
    stdout: '',
    stderr: '',
  };

  (async () => {
    const steps = placesUpdate || discoveriesUpdate
      ? [{ step: placesUpdate ? 'refresh places' : 'refresh discoveries', args: [path.join(__dirname, 'scripts', placesUpdate ? 'import-places.js' : 'import-discoveries.js'), ...(placesUpdate ? [source] : [])] }]
      : murderBinariesUpdate
        ? [{ step: 'analyze Murder Binaries', args: [path.join(__dirname, 'scripts', 'run-native-importer.js'), 'murder-binaries'] }]
      : galaxyUpdate
        ? [{ step: 'import full galaxy data', args: [path.join(__dirname, 'scripts', 'run-native-importer.js'), 'galaxy', '--source', source] }]
      : [
          { step: `merge ${mode}`, args: [path.join(__dirname, 'scripts', 'run-native-importer.js'), 'delta', '--source', source] },
          { step: 'rebuild local spatial detail', args: [path.join(__dirname, 'scripts', 'run-native-importer.js'), 'spatial-index'] },
          { step: 'refresh journals', args: [path.join(__dirname, 'scripts', 'import-journals.js')] },
        ];
    let stdout = '';
    let stderr = '';
    let final = { ok: true, code: 0, message: 'complete' };

    for (const step of steps) {
      const result = await runChildStep(step.step, step.args);
      stdout += `\n[${step.step}]\n${result.stdout}`;
      stderr += `\n[${step.step}]\n${result.stderr}`;
      final = result;
      if (!result.ok) break;
    }

    metaCache = null;
    placesCache = null;
    discoveriesCache = null;
    murderBinariesIndexCache = null;
    closeCachedFd(spatialIndexCache);
    spatialIndexCache = null;
    supplementalCache = null;
    visitedCache = null;
    journalBodiesCache = null;
    clearSystemDetailCache();
    updateMetaCache = null;
    closeCachedFd(updateIndexCache);
    updateIndexCache = null;
    suggestOverlayCache = null;
    galaxyManifestCache = null;
    await getVisited().catch(() => null);
    const meta = await getMeta().catch(() => null);
    const finishedAt = new Date().toISOString();
    const ok = Boolean(final.ok);
    const logEntry = {
      id,
      mode,
      source,
      sourceLabel: sourceInfo.label,
      large: sourceInfo.large,
      startedAt,
      finishedAt,
      ok,
      message: final.message,
      lastDataUpdateTime: meta?.updateTimeRange?.maxUpdateTime ?? null,
      lastDeltaImport: meta?.lastDeltaImport ?? null,
    };
    await appendSystemUpdateLog(logEntry).catch(() => null);
    systemUpdateStatus = {
      ...systemUpdateStatus,
      running: false,
      finishedAt,
      step: ok ? 'complete' : systemUpdateStatus.step,
      message: final.message || (ok ? 'System update complete.' : 'System update failed.'),
      ok,
      code: final.code,
      stdout,
      stderr,
      lastDataUpdateTime: logEntry.lastDataUpdateTime,
      lastDeltaImport: logEntry.lastDeltaImport,
    };
  })().catch(async (error) => {
    const finishedAt = new Date().toISOString();
    await appendSystemUpdateLog({
      id,
      mode,
      source,
      sourceLabel: sourceInfo.label,
      large: sourceInfo.large,
      startedAt,
      finishedAt,
      ok: false,
      message: error.message,
    }).catch(() => null);
    systemUpdateStatus = {
      ...systemUpdateStatus,
      running: false,
      finishedAt,
      step: 'failed',
      message: error.message,
      ok: false,
      code: -1,
      stderr: `${systemUpdateStatus.stderr}\n${error.stack ?? error.message}`,
    };
  });

  return sendJson(res, { started: true, update: systemUpdateStatus }, 202);
}

async function serveRegionMap(res) {
  if (!existsSync(regionMapPath)) {
    return sendJson(res, {
      imported: false,
      error: 'Region vector map is not built. Run npm run import:regions after adding regionID_numsort.csv and regionMAP.csv.',
    }, 409);
  }
  const stat = await fs.stat(regionMapPath);
  if (!stat.isFile()) return notFound(res);
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  return createReadStream(regionMapPath).pipe(res);
}

async function serveStatic(reqUrl, res) {
  const decoded = decodeURIComponent(reqUrl.pathname === '/' ? '/index.html' : reqUrl.pathname);
  const requested = path.normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(publicDir, requested);
  if (!filePath.startsWith(publicDir)) return notFound(res);
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return notFound(res);
    const ext = path.extname(filePath);
    res.writeHead(200, {
      'content-type': mimeTypes.get(ext) ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    createReadStream(filePath).pipe(res);
  } catch {
    notFound(res);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url, `http://${req.headers.host}`);
    if (reqUrl.pathname === '/api/status') {
      await refreshCarrierPlacesOnceDaily().catch((error) => console.warn(`Carrier POI refresh failed: ${error.message}`));
      const [meta, visited, places, systemUpdateLog, galaxyManifest, spatialIndex] = await Promise.all([
        getMeta(),
        getVisited(),
        getPlaces(),
        getSystemUpdateLog(),
        getGalaxyManifest(),
        readSpatialMeta(),
      ]);
      return sendJson(res, {
        imported: Boolean(meta),
        meta,
        visited,
        places: placesSummary(places),
        galaxyDetails: galaxyDetailsSummary(galaxyManifest),
        spatialIndex,
        systemUpdates: {
          running: systemUpdateStatus.running,
          current: systemUpdateStatus,
          log: systemUpdateLog,
          lastRun: systemUpdateLog.runs?.[0] ?? null,
          lastDataUpdateTime: meta?.updateTimeRange?.maxUpdateTime ?? null,
          lastDeltaImport: meta?.lastDeltaImport ?? null,
        },
        runtimeConfig: {
          trackedCarrier: localConfig.trackedCarrier,
          llmSearch: localConfig.llmSearch ? {
            provider: localConfig.llmSearch.provider,
            model: localConfig.llmSearch.model,
            baseUrl: localConfig.llmSearch.baseUrl,
            hasApiKey: Boolean(localConfig.llmSearch.apiKey),
          } : null,
        },
        journalPath: journalDir,
      });
    }
    if (reqUrl.pathname === '/api/points') return await readPoints(reqUrl, res);
    if (reqUrl.pathname === '/api/local-points') return await queryLocalPoints(reqUrl, res);
    if (reqUrl.pathname === '/api/search') return await searchSystems(reqUrl, res);
    if (reqUrl.pathname === '/api/llm-search' && req.method === 'POST') return await llmAugmentedSearch(req, res);
    if (reqUrl.pathname === '/api/system') return await readSystemDetail(reqUrl, res);
    if (reqUrl.pathname === '/api/system-rich') return await readRichSystem(reqUrl, res);
    if (reqUrl.pathname === '/api/notes' && req.method === 'GET') return await listSystemNotes(reqUrl, res);
    if (reqUrl.pathname === '/api/notes' && req.method === 'POST') return await saveSystemNote(req, res);
    if (reqUrl.pathname === '/api/places') return sendJson(res, await getPlaces());
    if (reqUrl.pathname === '/api/regions') return await serveRegionMap(res);
    if (reqUrl.pathname === '/api/murder-binaries') return queryMurderBinaries(reqUrl, res);
    if (reqUrl.pathname === '/api/discoveries') return sendJson(res, await getDiscoveries() ?? { imported: false, places: [] });
    if (reqUrl.pathname === '/api/visited') return sendJson(res, await getVisited());
    if (reqUrl.pathname === '/api/journal-scan-status') return sendJson(res, journalScanStatus);
    if (reqUrl.pathname === '/api/refresh-journals' && req.method === 'POST') return await runJournalRefresh(reqUrl, res);
    if (reqUrl.pathname === '/api/system-update-status') return sendJson(res, { ...systemUpdateStatus, log: await getSystemUpdateLog() });
    if (reqUrl.pathname === '/api/system-update' && req.method === 'POST') return await runSystemUpdate(reqUrl, res);
    return await serveStatic(reqUrl, res);
  } catch (error) {
    console.error(error);
    sendJson(res, { error: error.message }, 500);
  }
});

const port = Number(process.env.PORT ?? 5177);
server.listen(port, () => {
  console.log(`Elite Dangerous System Search running at http://localhost:${port}`);
});
