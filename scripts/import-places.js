import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.dirname(__dirname);
const dataDir = process.env.EDSS_DATA_DIR ? path.resolve(process.env.EDSS_DATA_DIR) : path.join(rootDir, 'data');
const defaultSource = 'https://edastro.com/mapcharts/files/edsmPOI.csv';
const sourceArg = process.argv[2] ?? defaultSource;
const importedAt = new Date().toISOString();

function isUrl(value) {
  return /^https?:\/\//i.test(value);
}

async function readSource(source) {
  if (isUrl(source)) {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`Failed to download ${source}: ${response.status} ${response.statusText}`);
    return response.text();
  }
  const file = path.resolve(rootDir, source);
  if (!existsSync(file)) throw new Error(`Cannot find ${file}`);
  return fs.readFile(file, 'utf8');
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
    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
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

function value(row, headers, names) {
  for (const name of names) {
    const index = headers.get(name.toLowerCase());
    if (index !== undefined) return row[index]?.trim() ?? '';
  }
  return '';
}

function requireHeaders(headers, names) {
  const missing = names.filter((name) => !headers.has(name.toLowerCase()));
  if (missing.length) {
    throw new Error(`Missing required CSV headers: ${missing.join(', ')}. Found: ${[...headers.keys()].join(', ')}`);
  }
}

function numberField(row, headers, names) {
  const raw = value(row, headers, names);
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

function dedupeKey(name, coords, type) {
  return [
    name.trim().toLowerCase(),
    coords.x.toFixed(3),
    coords.y.toFixed(3),
    coords.z.toFixed(3),
    type.trim().toLowerCase(),
  ].join('|');
}

function sourceGroup(rawType) {
  const type = String(rawType ?? '').toLowerCase();
  if (type.includes('dssa')) return 'DSSA';
  if (type.includes('canonn') || type.startsWith('ccl')) return 'Canonn';
  if (type.includes('carrier')) return 'Fleet Carrier Network';
  if (type.startsWith('star')) return 'STAR Initiative';
  if (type.startsWith('trit_hwy')) return 'Tritium Highway';
  return 'EDAstro / EDSM / GMP';
}

function categoryForPoiType(rawType) {
  const type = String(rawType ?? '').trim();
  const key = type.toLowerCase();
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

function normalizeCombinedPoi(rows) {
  if (rows.length < 2) return [];
  const headers = headerMap(rows[0]);
  requireHeaders(headers, ['POI Type', 'ID', 'Name', 'X', 'Y', 'Z', 'Reference System']);
  const places = [];
  const seen = new Set();

  for (const row of rows.slice(1)) {
    const rawType = value(row, headers, ['POI Type']);
    const sourceId = value(row, headers, ['ID']);
    const name = value(row, headers, ['Name']);
    const x = numberField(row, headers, ['X']);
    const y = numberField(row, headers, ['Y']);
    const z = numberField(row, headers, ['Z']);
    if (!name || x === null || y === null || z === null) continue;

    const category = categoryForPoiType(rawType);
    const coords = { x, y, z };
    const key = dedupeKey(name, coords, rawType || category);
    if (seen.has(key)) continue;
    seen.add(key);

    const systemName = value(row, headers, ['Reference System']);
    const notes = value(row, headers, ['Notes']);
    places.push({
      id: hashId(key),
      name,
      category,
      source: 'EDAstro Combined POI',
      sourceGroup: sourceGroup(rawType),
      sourceId: sourceId || null,
      type: rawType || category,
      typeLabel: rawType ? compactTitle(rawType) : category,
      coords,
      systemName: systemName || null,
      description: notes,
      updatedAt: importedAt,
    });
  }

  return places.sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeNebulaCoordinates(rows) {
  if (rows.length < 2) return [];
  const headers = headerMap(rows[0]);
  requireHeaders(headers, ['Name', 'X', 'Y', 'Z']);
  const places = [];
  const seen = new Set();

  for (const row of rows.slice(1)) {
    const name = value(row, headers, ['Name']);
    const x = numberField(row, headers, ['X']);
    const y = numberField(row, headers, ['Y']);
    const z = numberField(row, headers, ['Z']);
    if (!name || x === null || y === null || z === null) continue;

    const type = value(row, headers, ['Type']);
    const category = 'Nebulae';
    const coords = { x, y, z };
    const key = dedupeKey(name, coords, type || category);
    if (seen.has(key)) continue;
    seen.add(key);

    const systemName = value(row, headers, ['System', 'SystemName', 'System Name']);
    const regionId = value(row, headers, ['RegionID', 'Region ID']);
    places.push({
      id: hashId(key),
      name,
      category,
      source: 'EDAstro Nebulae Coordinates',
      sourceGroup: 'EDAstro',
      sourceId: null,
      type: type || 'nebula',
      typeLabel: type ? `${compactTitle(type)} Nebula` : 'Nebula',
      coords,
      systemName: systemName || null,
      description: regionId ? `Region ${regionId}` : '',
      updatedAt: importedAt,
    });
  }

  return places.sort((a, b) => a.name.localeCompare(b.name));
}

function normalizePlaces(rows) {
  if (rows.length < 2) return [];
  const headers = headerMap(rows[0]);
  if (headers.has('poi type')) return normalizeCombinedPoi(rows);
  return normalizeNebulaCoordinates(rows);
}

function countsBy(places, field) {
  const counts = {};
  for (const place of places) {
    const key = place[field] ?? 'Unknown';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

async function main() {
  await fs.mkdir(dataDir, { recursive: true });
  console.log(`Importing places from ${sourceArg}`);
  const text = await readSource(sourceArg);
  const rows = parseCsv(text);
  const places = normalizePlaces(rows);
  const combined = rows[0]?.some((header) => header.trim().toLowerCase() === 'poi type');
  const payload = {
    importedAt,
    source: combined ? 'EDAstro Combined POI' : 'EDAstro Nebulae Coordinates',
    sourceUrl: isUrl(sourceArg) ? sourceArg : null,
    sourcePath: isUrl(sourceArg) ? null : path.resolve(rootDir, sourceArg),
    count: places.length,
    categories: countsBy(places, 'category'),
    sourceGroups: countsBy(places, 'sourceGroup'),
    types: countsBy(places, 'type'),
    places,
  };
  await fs.writeFile(path.join(dataDir, 'places.json'), JSON.stringify(payload, null, 2));
  console.log(`Imported ${places.length.toLocaleString()} places.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
