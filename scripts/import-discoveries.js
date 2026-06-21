import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.dirname(__dirname);
const dataDir = process.env.EDSS_DATA_DIR ? path.resolve(process.env.EDSS_DATA_DIR) : path.join(rootDir, 'data');
const outputPath = path.join(dataDir, 'discoveries.json');
const importedAt = new Date().toISOString();

const edastroSources = [
  {
    id: 'aa-a-h-sectors',
    label: 'AA-A h Sectors',
    category: 'AA-A h Sectors',
    source: 'EDAstro Sector List of AA-A h systems',
    url: 'https://edastro.com/mapcharts/files/sector-list-H-mass.csv',
  },
  {
    id: 'rare-valuable-planets',
    label: 'Rare Valuable Systems',
    category: 'Rare Valuable Systems',
    source: 'EDAstro Rare Numbers of Valuable Planets',
    url: 'https://edastro.com/mapcharts/files/valuable-planet-systems.csv',
  },
  {
    id: 'close-landables',
    label: 'Close Landables',
    category: 'Close Landables',
    source: 'EDAstro Close Landables',
    url: 'https://edastro.com/mapcharts/files/close-landables.csv',
  },
];

const supabaseUrl = 'https://oduelomkzdlxvenwjeui.supabase.co';
const supabaseAnonKey = 'sb_publishable_wRxCE9xKgOLmkVx5cpR0Tw_w5tuc3yq';
const supabasePageSize = 1000;

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

function numberField(row, headers, names) {
  const raw = value(row, headers, names);
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
}

function hashId(input) {
  return createHash('sha1').update(input).digest('hex').slice(0, 16);
}

function coordsKey(coords) {
  return `${coords.x.toFixed(3)}|${coords.y.toFixed(3)}|${coords.z.toFixed(3)}`;
}

function discoveryId(sourceId, name, coords, category) {
  return hashId([sourceId, name.trim().toLowerCase(), coordsKey(coords), category.trim().toLowerCase()].join('|'));
}

function makeDiscovery({ sourceId, name, category, source, sourceGroup, type, typeLabel, coords, systemName = null, description = '', details = null }) {
  return {
    id: discoveryId(sourceId, name, coords, category),
    name,
    category,
    source,
    sourceGroup,
    type,
    typeLabel,
    coords,
    systemName,
    description,
    details,
    updatedAt: importedAt,
    defaultEnabled: false,
    discovery: true,
  };
}

function normalizeAaAh(rows, source) {
  if (rows.length < 2) return [];
  const headers = headerMap(rows[0]);
  const discoveries = [];
  for (const row of rows.slice(1)) {
    const sector = value(row, headers, ['Sector']);
    const x = numberField(row, headers, ['Avg X']);
    const y = numberField(row, headers, ['Avg Y']);
    const z = numberField(row, headers, ['Avg Z']);
    if (!sector || x === null || y === null || z === null) continue;
    const aaAhCount = numberField(row, headers, ['AA-A_h systems']);
    const highest = numberField(row, headers, ['Highest Number']);
    const total = numberField(row, headers, ['Sector Total Systems']);
    discoveries.push(makeDiscovery({
      sourceId: source.id,
      name: `${sector} AA-A h sector`,
      category: source.category,
      source: source.source,
      sourceGroup: 'EDAstro',
      type: 'AA-A h Sector',
      typeLabel: 'AA-A h Sector',
      coords: { x, y, z },
      description: `${aaAhCount ?? 0} AA-A h systems; highest number ${highest ?? 'unknown'}; ${total ?? 'unknown'} total systems.`,
      details: { sector, aaAhCount, highestNumber: highest, sectorTotalSystems: total },
    }));
  }
  return discoveries;
}

function normalizeRareValuable(rows, source) {
  if (rows.length < 2) return [];
  const headers = headerMap(rows[0]);
  const discoveries = [];
  for (const row of rows.slice(1)) {
    const system = value(row, headers, ['System']);
    const x = numberField(row, headers, ['Coord_x', 'Coord X']);
    const y = numberField(row, headers, ['Coord_y', 'Coord Y']);
    const z = numberField(row, headers, ['Coord_z', 'Coord Z']);
    if (x === null || y === null || z === null) continue;
    const id64 = value(row, headers, ['ID64 SystemAddress']);
    const score = value(row, headers, ['Score']);
    const elw = value(row, headers, ['Earth-like worlds']);
    const ww = value(row, headers, ['Water worlds']);
    const aw = value(row, headers, ['Ammonia worlds']);
    discoveries.push(makeDiscovery({
      sourceId: source.id,
      name: system || `Valuable system ${id64 || coordsKey({ x, y, z })}`,
      category: source.category,
      source: source.source,
      sourceGroup: 'EDAstro',
      type: 'Rare Valuable Planets',
      typeLabel: 'Rare Valuable Planets',
      coords: { x, y, z },
      systemName: system || null,
      description: `Score ${score || 'unknown'}; ELW ${elw || 0}, WW ${ww || 0}, AW ${aw || 0}.`,
      details: { id64, score, earthLikeWorlds: elw, waterWorlds: ww, ammoniaWorlds: aw },
    }));
  }
  return discoveries;
}

function normalizeCloseLandables(rows, source) {
  if (rows.length < 2) return [];
  const headers = headerMap(rows[0]);
  const bySystem = new Map();
  for (const row of rows.slice(1)) {
    const system = value(row, headers, ['System']);
    const planet = value(row, headers, ['Planet']);
    const x = numberField(row, headers, ['Coord X']);
    const y = numberField(row, headers, ['Coord Y']);
    const z = numberField(row, headers, ['Coord Z']);
    if (!system || x === null || y === null || z === null) continue;
    const key = system.trim().toLowerCase();
    const entry = bySystem.get(key) ?? {
      system,
      coords: { x, y, z },
      planets: [],
      starTypes: new Set(),
      minAxisLs: null,
    };
    const axis = numberField(row, headers, ['Semi-major Axis (LS)']);
    if (axis !== null) entry.minAxisLs = entry.minAxisLs === null ? axis : Math.min(entry.minAxisLs, axis);
    const starType = value(row, headers, ['Star Type']);
    if (starType) entry.starTypes.add(starType);
    if (planet) entry.planets.push(planet);
    bySystem.set(key, entry);
  }

  return [...bySystem.values()].map((entry) => makeDiscovery({
    sourceId: source.id,
    name: entry.system,
    category: source.category,
    source: source.source,
    sourceGroup: 'EDAstro',
    type: 'Close body to giant star with landable',
    typeLabel: 'Close Landable',
    coords: entry.coords,
    systemName: entry.system,
    description: `${entry.planets.length} close landable ${entry.planets.length === 1 ? 'body' : 'bodies'}${entry.minAxisLs === null ? '' : `; nearest ${entry.minAxisLs.toFixed(3)} ls`}.`,
    details: {
      planets: entry.planets.slice(0, 12),
      planetCount: entry.planets.length,
      starTypes: [...entry.starTypes],
      minSemiMajorAxisLs: entry.minAxisLs,
    },
  }));
}

function normalizeEdastro(source, rows) {
  if (source.id === 'aa-a-h-sectors') return normalizeAaAh(rows, source);
  if (source.id === 'rare-valuable-planets') return normalizeRareValuable(rows, source);
  if (source.id === 'close-landables') return normalizeCloseLandables(rows, source);
  return [];
}

async function fetchExplorariumPage(offset) {
  const url = `${supabaseUrl}/rest/v1/systems?select=system_name,x,y,z,bodies,created_at,category,id64&order=category.asc,system_name.asc&limit=${supabasePageSize}&offset=${offset}`;
  const response = await fetch(url, {
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
    },
  });
  if (!response.ok) throw new Error(`Explorarium systems fetch failed: ${response.status} ${response.statusText}`);
  return response.json();
}

function summarizeExplorariumBodies(bodies) {
  if (!Array.isArray(bodies) || bodies.length === 0) return '';
  const body = bodies[0] ?? {};
  const parts = [];
  for (const key of ['Landables', 'Gas Giants', 'Total Planets', 'Stars']) {
    if (body[key] !== undefined) parts.push(`${key}: ${body[key]}`);
  }
  if (body['First Body Name']) parts.push(`first: ${body['First Body Name']}`);
  if (body['Last Body Name']) parts.push(`last: ${body['Last Body Name']}`);
  return parts.join('; ');
}

async function importExplorarium() {
  const discoveries = [];
  for (let offset = 0; ; offset += supabasePageSize) {
    const rows = await fetchExplorariumPage(offset);
    if (!rows.length) break;
    for (const row of rows) {
      const name = String(row.system_name ?? '').trim();
      const category = String(row.category ?? '').trim();
      const x = Number(row.x);
      const y = Number(row.y);
      const z = Number(row.z);
      if (!name || !category || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      discoveries.push(makeDiscovery({
        sourceId: 'explorarium',
        name,
        category,
        source: 'Explorarium Supabase',
        sourceGroup: 'Explorarium',
        type: category,
        typeLabel: category,
        coords: { x, y, z },
        systemName: name,
        description: summarizeExplorariumBodies(row.bodies),
        details: {
          id64: row.id64 ?? null,
          createdAt: row.created_at ?? null,
          bodies: row.bodies ?? [],
        },
      }));
    }
    console.log(`Fetched ${discoveries.length.toLocaleString()} Explorarium discoveries...`);
    if (rows.length < supabasePageSize) break;
  }
  return discoveries;
}

function countsBy(items, field) {
  const counts = {};
  for (const item of items) {
    const key = item[field] ?? 'Unknown';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

async function main() {
  await fs.mkdir(dataDir, { recursive: true });
  const discoveries = [];
  const sourceSummaries = [];

  for (const source of edastroSources) {
    console.log(`Importing ${source.label} from ${source.url}`);
    const rows = parseCsv(await readSource(source.url));
    const normalized = normalizeEdastro(source, rows);
    discoveries.push(...normalized);
    sourceSummaries.push({ id: source.id, label: source.label, source: source.source, url: source.url, count: normalized.length });
  }

  console.log('Importing Explorarium discoveries from Supabase');
  const explorarium = await importExplorarium();
  discoveries.push(...explorarium);
  sourceSummaries.push({
    id: 'explorarium',
    label: 'Explorarium',
    source: 'Explorarium Supabase',
    url: `${supabaseUrl}/rest/v1/systems?select=*`,
    count: explorarium.length,
  });

  const seen = new Set();
  const unique = [];
  for (const discovery of discoveries) {
    const key = `${discovery.category.toLowerCase()}|${discovery.name.toLowerCase()}|${coordsKey(discovery.coords)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(discovery);
  }
  unique.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

  const payload = {
    importedAt,
    source: 'EDAstro + Explorarium Discoveries',
    count: unique.length,
    categories: countsBy(unique, 'category'),
    sourceGroups: countsBy(unique, 'sourceGroup'),
    types: countsBy(unique, 'type'),
    sources: sourceSummaries,
    places: unique,
  };
  await fs.writeFile(outputPath, JSON.stringify(payload, null, 2));
  console.log(`Imported ${unique.length.toLocaleString()} discovery markers into ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
