import { existsSync, readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileAtomic } from './scripts/atomic-file.js';

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
    // Following the journal live is on unless switched off.
    liveJournal: value.liveJournal !== false,
  };
}

export function localConfigPath(configFile = process.env.EDSS_CONFIG) {
  return configFile
    ? path.resolve(configFile)
    : path.join(projectRoot, 'config.local.json');
}

export function loadLocalConfig(configFile = process.env.EDSS_CONFIG) {
  const resolved = localConfigPath(configFile);
  if (!existsSync(resolved)) return normalizeLocalConfig();
  try {
    return normalizeLocalConfig(JSON.parse(readFileSync(resolved, 'utf8')));
  } catch (error) {
    throw new Error(`Could not load local configuration: ${error.message}`);
  }
}

// Reads the raw file, lets `mutate` change it in place, and writes it back, so
// keys the app does not manage (anything hand-added) survive a save.
async function updateLocalConfigFile(mutate, configFile) {
  const resolved = localConfigPath(configFile);
  let raw = {};
  try {
    raw = JSON.parse(await fs.readFile(resolved, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Could not read local configuration: ${error.message}`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) raw = {};
  mutate(raw);
  await writeFileAtomic(resolved, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
  return normalizeLocalConfig(raw);
}

export async function saveTrackedCarrier(trackedCarrier, configFile = process.env.EDSS_CONFIG) {
  return updateLocalConfigFile((raw) => {
    raw.trackedCarrier = trackedCarrier
      ? {
        id: trackedCarrier.id ?? null,
        name: trackedCarrier.name ?? '',
        callsign: trackedCarrier.callsign ?? '',
        label: trackedCarrier.label ?? '',
        fallbackCoords: trackedCarrier.fallbackCoords ?? null,
      }
      : null;
  }, configFile);
}

export async function saveLiveJournal(enabled, configFile = process.env.EDSS_CONFIG) {
  return updateLocalConfigFile((raw) => {
    raw.liveJournal = Boolean(enabled);
  }, configFile);
}

// Called once the key has been moved into the credential store, so the
// plain-text copy does not linger in the file.
export async function removeLocalConfigLlmApiKey(configFile = process.env.EDSS_CONFIG) {
  return updateLocalConfigFile((raw) => {
    if (raw.llmSearch && typeof raw.llmSearch === 'object') delete raw.llmSearch.apiKey;
  }, configFile);
}
