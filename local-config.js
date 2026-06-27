import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

function cleanString(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function cleanCoords(value) {
  if (!value || typeof value !== 'object') return null;
  const coords = {
    x: Number(value.x),
    y: Number(value.y),
    z: Number(value.z),
  };
  return Object.values(coords).every(Number.isFinite) ? coords : null;
}

function cleanLlmSearch(value) {
  if (!value || typeof value !== 'object') return null;
  const provider = ['openai', 'anthropic', 'kobold'].includes(value.provider) ? value.provider : null;
  const model = cleanString(value.model);
  const baseUrl = cleanString(value.baseUrl);
  const apiKey = cleanString(value.apiKey);
  if (!provider && !model && !baseUrl && !apiKey) return null;
  return {
    provider: provider ?? 'openai',
    model,
    baseUrl,
    apiKey,
  };
}

export function normalizeLocalConfig(value = {}) {
  const carrierValue = value.trackedCarrier && typeof value.trackedCarrier === 'object'
    ? value.trackedCarrier
    : {};
  const rawId = carrierValue.id;
  const numericId = rawId === null || rawId === undefined || rawId === '' ? null : Number(rawId);
  const id = Number.isSafeInteger(numericId) && numericId >= 0 ? numericId : null;
  const name = cleanString(carrierValue.name);
  const callsign = cleanString(carrierValue.callsign);
  const configuredLabel = cleanString(carrierValue.label);
  const label = configuredLabel ?? (name && callsign ? `${name} [${callsign}]` : name ?? callsign);
  const fallbackCoords = cleanCoords(carrierValue.fallbackCoords);
  const trackedCarrier = id !== null || name || callsign || configuredLabel || fallbackCoords
    ? { id, name, callsign, label: label ?? 'Tracked carrier', fallbackCoords }
    : null;

  return {
    trackedCarrier,
    llmSearch: cleanLlmSearch(value.llmSearch),
  };
}

export function loadLocalConfig(configFile = process.env.EDSS_CONFIG) {
  const resolved = configFile
    ? path.resolve(configFile)
    : path.join(projectRoot, 'config.local.json');
  if (!existsSync(resolved)) return normalizeLocalConfig();
  try {
    return normalizeLocalConfig(JSON.parse(readFileSync(resolved, 'utf8')));
  } catch (error) {
    throw new Error(`Could not load local configuration: ${error.message}`);
  }
}
