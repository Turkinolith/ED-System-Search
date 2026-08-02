import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';

const formatVersion = 1;
const murderBinariesCategory = 'Murder Binaries';

function sourcePaths(dataDir) {
  return {
    places: path.join(dataDir, 'places.json'),
    discoveries: path.join(dataDir, 'discoveries.json'),
    murderBinaries: path.join(dataDir, 'murder-binaries-meta.json'),
    greenGasGiants: path.join(dataDir, 'green-gas-giants.json'),
  };
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function sourceSignature(dataDir) {
  const entries = await Promise.all(Object.entries(sourcePaths(dataDir)).map(async ([name, filePath]) => {
    const stat = existsSync(filePath) ? await fs.stat(filePath) : null;
    return [name, stat ? { size: stat.size, mtimeMs: stat.mtimeMs } : null];
  }));
  return Object.fromEntries(entries);
}

function signaturesMatch(expected, actual) {
  return Object.keys(actual).every((name) => {
    const left = expected?.[name] ?? null;
    const right = actual[name];
    if (!left || !right) return left === right;
    return Number(left.size) === Number(right.size)
      && Math.abs(Number(left.mtimeMs) - Number(right.mtimeMs)) < 1;
  });
}

function greenGasGiantPlaces(data) {
  return (data?.systems ?? []).map((system) => ({
    id: `ggg-${system.id64 ?? system.name.toLowerCase()}`,
    name: system.name,
    category: system.known ? 'Green Gas Giants' : 'Green Gas Giant candidates',
    source: 'Local Green Gas Giant analysis',
    sourceGroup: 'Local full galaxy analysis',
    type: system.known ? 'Confirmed Green Gas Giant' : 'Very-high Green Gas Giant candidate',
    typeLabel: system.known ? 'Confirmed Green Gas Giant' : 'Very-high candidate',
    coords: system.coords,
    systemName: system.name,
    description: system.known
      ? `Known GGG from EDAstro; ${system.bodies?.length ? 'also matches the strict 158 K candidate rule.' : 'not required to match the strict candidate rule.'}`
      : `Water giant or gas giant with water-based life at 158 K (${system.bodies?.map((body) => body.name).join(', ') ?? 'matching body'}).`,
    updatedAt: data.importedAt,
    defaultEnabled: false,
    discovery: true,
  }));
}

function summarizeSources(data, discoveries, murderBinaries, greenGasGiants, places) {
  const discoveryPlaces = discoveries?.places ?? [];
  const categories = {};
  const categoryDefaults = new Map();
  for (const place of places) {
    const category = place.category ?? 'Other POIs';
    categories[category] = (categories[category] ?? 0) + 1;
    categoryDefaults.set(category, (categoryDefaults.get(category) ?? false) || place.defaultEnabled !== false);
  }
  if (murderBinaries?.count) categories[murderBinariesCategory] = Number(murderBinaries.count);
  const importedAt = data?.importedAt
    ?? discoveries?.importedAt
    ?? murderBinaries?.importedAt
    ?? greenGasGiants?.importedAt
    ?? new Date().toISOString();
  return {
    imported: places.length > 0 || Number(murderBinaries?.count ?? 0) > 0,
    importedAt,
    source: [data?.source, discoveries?.source, murderBinaries?.source, greenGasGiants ? 'Green Gas Giant analysis' : null].filter(Boolean).join(' + ') || 'Places',
    sourceUrl: data?.sourceUrl ?? null,
    count: places.length + Number(murderBinaries?.count ?? 0),
    categories,
    sourceGroups: data?.sourceGroups ?? {},
    types: data?.types ?? {},
    carrierRefresh: data?.carrierRefresh ?? null,
    rawSource: data?.source ?? null,
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
    greenGasGiants: greenGasGiants ? {
      importedAt: greenGasGiants.importedAt,
      knownSystemCount: greenGasGiants.knownSystemCount,
      highCandidateCount: greenGasGiants.highCandidateCount,
    } : null,
    categoryDefaults,
  };
}

export async function buildPlaceIndex(dataDir) {
  const paths = sourcePaths(dataDir);
  const signatureBefore = await sourceSignature(dataDir);
  const [data, discoveries, murderBinaries, greenGasGiants] = await Promise.all([
    readJson(paths.places),
    readJson(paths.discoveries),
    readJson(paths.murderBinaries),
    readJson(paths.greenGasGiants),
  ]);
  const basePlaces = Array.isArray(data) ? data : data?.places ?? [];
  const discoveryPlaces = discoveries?.places ?? [];
  const places = [...basePlaces, ...discoveryPlaces, ...greenGasGiantPlaces(greenGasGiants)];
  const summary = summarizeSources(data, discoveries, murderBinaries, greenGasGiants, places);
  const groups = new Map();
  for (const place of places) {
    const category = place.category ?? 'Other POIs';
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(place);
  }

  const outputDir = path.join(dataDir, 'places-index');
  const tempDir = path.join(dataDir, `.places-index-${process.pid}-${Date.now()}.tmp`);
  await fs.mkdir(tempDir, { recursive: true });
  try {
    const categoryDetails = [];
    let fileIndex = 0;
    for (const [category, categoryPlaces] of groups) {
      const file = `${String(fileIndex).padStart(4, '0')}.json`;
      fileIndex += 1;
      await fs.writeFile(path.join(tempDir, file), JSON.stringify(categoryPlaces));
      categoryDetails.push({
        category,
        count: categoryPlaces.length,
        defaultEnabled: summary.categoryDefaults.get(category) ?? true,
        file,
      });
    }
    if (summary.murderBinaries?.count) {
      categoryDetails.push({
        category: murderBinariesCategory,
        count: summary.murderBinaries.count,
        defaultEnabled: false,
        file: null,
      });
    }
    categoryDetails.sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
    const signatureAfter = await sourceSignature(dataDir);
    if (!signaturesMatch(signatureBefore, signatureAfter)) {
      throw new Error('Place data changed while its category index was being built.');
    }
    const { categoryDefaults, ...publicSummary } = summary;
    const meta = {
      formatVersion,
      builtAt: new Date().toISOString(),
      sourceSignature: signatureAfter,
      summary: { ...publicSummary, categoryDetails },
    };
    await fs.writeFile(path.join(tempDir, 'meta.json'), JSON.stringify(meta, null, 2));
    await fs.rm(outputDir, { recursive: true, force: true });
    await fs.rename(tempDir, outputDir);
    return meta;
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => null);
    throw error;
  }
}

export async function readPlaceIndexMeta(dataDir) {
  const metaPath = path.join(dataDir, 'places-index', 'meta.json');
  if (!existsSync(metaPath)) return null;
  const meta = await readJson(metaPath);
  if (Number(meta?.formatVersion) !== formatVersion || !meta?.summary) return null;
  const signature = await sourceSignature(dataDir);
  return signaturesMatch(meta.sourceSignature, signature) ? meta : null;
}

export async function readPlaceIndexCategories(dataDir, meta, categories) {
  if (!meta?.summary?.categoryDetails) return null;
  const requested = new Set(categories);
  const details = meta.summary.categoryDetails.filter((entry) => requested.has(entry.category) && entry.file);
  const payloads = await Promise.all(details.map((entry) => readJson(path.join(dataDir, 'places-index', entry.file), [])));
  return payloads.flat();
}
