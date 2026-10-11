import { GalaxyRenderer, colorsForType, isGiantStarType, parseBioOverlay } from './renderer.js?v=bio-1';
import { bodyPrediction, normaliseJournalBody, normaliseSpanshBody } from './bio-model.js?v=bio-1';
import { decodeId64, galaxyOrigin, massCodeTypicalStars } from './id64.js?v=mass-layers-1';
import { colorModes, hexToRgb, noDataColor } from './color-modes.js?v=map-ui-1';

const state = {
  meta: null,
  visited: null,
  renderer: null,
  enabledTypes: new Set(),
  searchResults: [],
  places: [],
  placeCategoryData: new Map(),
  murderBinaryPlaces: [],
  visiblePlaces: [],
  placesMeta: null,
  carrierLocation: null,
  trackedCarrier: null,
  llmSearchDefaults: null,
  notes: [],
  notesMode: 'all',
  activeNoteSystem: null,
  contextMenuSystemName: null,
  systemUpdates: null,
  enabledPlaceCategories: new Set(),
  activeSearchIndex: -1,
  searchTimer: null,
  focus: { name: 'Sol', coords: { x: 0, y: 0, z: 0 } },
  latestJournal: null,
  updateFiltersInitialized: false,
  filterInputs: [],
  filterGroups: [],
  selectedSystem: null,
  richSystem: null,
  galaxyDetails: null,
  spatialIndex: null,
  basePointCount: 0,
  baseLod: null,
  localPointCount: 0,
  localRadius: null,
  localAreaCount: null,
  localAreaComplete: true,
  localPointRequestKey: null,
  richPointFiltersActive: false,
  routeOverlay: null,
  bio: { available: false, generatedAt: null, species: [], selected: null, level: 640, band: 0, bandLayer: null, model: null, rates: null, modelPromise: null },
  live: { enabled: true, running: false, follow: false, snapshot: null, source: null, lastSavedId: null },
};

const el = {
  canvas: document.querySelector('#stars'),
  overlay: document.querySelector('#overlay'),
  search: document.querySelector('#search'),
  results: document.querySelector('#searchResults'),
  llmSearchButton: document.querySelector('#llmSearchButton'),
  llmSearchPanel: document.querySelector('#llmSearchPanel'),
  llmSearchClose: document.querySelector('#llmSearchClose'),
  llmSearchPrompt: document.querySelector('#llmSearchPrompt'),
  llmSearchRun: document.querySelector('#llmSearchRun'),
  llmSearchStatus: document.querySelector('#llmSearchStatus'),
  llmSearchAnswer: document.querySelector('#llmSearchAnswer'),
  llmSearchResults: document.querySelector('#llmSearchResults'),
  llmSearchProviderLabel: document.querySelector('#llmSearchProviderLabel'),
  llmSearchPreview: document.querySelector('#llmSearchPreview'),
  llmAiSettings: document.querySelector('#llmAiSettings'),
  llmAiSummary: document.querySelector('#llmAiSummary'),
  llmProvider: document.querySelector('#llmProvider'),
  llmModel: document.querySelector('#llmModel'),
  llmModelOptions: document.querySelector('#llmModelOptions'),
  llmModelHint: document.querySelector('#llmModelHint'),
  llmSaveKey: document.querySelector('#llmSaveKey'),
  llmRemoveKey: document.querySelector('#llmRemoveKey'),
  llmApiKey: document.querySelector('#llmApiKey'),
  llmApiKeyHint: document.querySelector('#llmApiKeyHint'),
  llmBaseUrl: document.querySelector('#llmBaseUrl'),
  llmBaseUrlHint: document.querySelector('#llmBaseUrlHint'),
  clientToast: document.querySelector('#clientToast'),
  filters: document.querySelector('#filters'),
  filterActions: document.querySelector('#filterActions'),
  starScale: document.querySelector('#starScale'),
  starScaleAuto: document.querySelector('#starScaleAuto'),
  starScaleValue: document.querySelector('#starScaleValue'),
  status: document.querySelector('#status'),
  selected: document.querySelector('#selected'),
  datasetSummary: document.querySelector('#datasetSummary'),
  focusName: document.querySelector('#focusName'),
  focusCopyStatus: document.querySelector('#focusCopyStatus'),
  focusCoords: document.querySelector('#focusCoords'),
  journalSummary: document.querySelector('#journalSummary'),
  currentShipSummary: document.querySelector('#currentShipSummary'),
  currentShipStats: document.querySelector('#currentShipStats'),
  shipJumpOverride: document.querySelector('#shipJumpOverride'),
  clearShipJumpOverride: document.querySelector('#clearShipJumpOverride'),
  shipJumpEffective: document.querySelector('#shipJumpEffective'),
  visitedToggle: document.querySelector('#visitedToggle'),
  depthEmphasisToggle: document.querySelector('#depthEmphasisToggle'),
  gridToggle: document.querySelector('#gridToggle'),
  dropLinesToggle: document.querySelector('#dropLinesToggle'),
  localDetailOnlyToggle: document.querySelector('#localDetailOnlyToggle'),
  sectorMapToggle: document.querySelector('#sectorMapToggle'),
  galaxyGlowToggle: document.querySelector('#galaxyGlowToggle'),
  boxelToggle: document.querySelector('#boxelToggle'),
  boxelGlowToggle: document.querySelector('#boxelGlowToggle'),
  parentBoxelInputs: [...document.querySelectorAll('input[name="parentBoxel"]')],
  boxelHint: document.querySelector('#boxelHint'),
  nebulaToggle: document.querySelector('#nebulaToggle'),
  bioOverlayToggle: document.querySelector('#bioOverlayToggle'),
  bioLevelInputs: [...document.querySelectorAll('input[name="bioLevel"]')],
  bioBandInputs: [...document.querySelectorAll('input[name="bioBand"]')],
  bioBandHint: document.querySelector('#bioBandHint'),
  bioSpeciesList: document.querySelector('#bioSpeciesList'),
  bioSpeciesCount: document.querySelector('#bioSpeciesCount'),
  bioSpeciesAll: document.querySelector('#bioSpeciesAll'),
  bioSpeciesTop: document.querySelector('#bioSpeciesTop'),
  bioLegend: document.querySelector('#bioLegend'),
  bioLegendMax: document.querySelector('#bioLegendMax'),
  bioHint: document.querySelector('#bioHint'),
  liveIndicator: document.querySelector('#liveIndicator'),
  liveJournalToggle: document.querySelector('#liveJournalToggle'),
  liveFollowToggle: document.querySelector('#liveFollowToggle'),
  liveAutoTarget: document.querySelector('#liveAutoTarget'),
  liveJournalStatus: document.querySelector('#liveJournalStatus'),
  colorBySelect: document.querySelector('#colorBySelect'),
  colorLegend: document.querySelector('#colorLegend'),
  routeBar: document.querySelector('#routeBar'),
  landmarksToggle: document.querySelector('#landmarksToggle'),
  carrierMarkerToggle: document.querySelector('#carrierMarkerToggle'),
  carrierRangeToggle: document.querySelector('#carrierRangeToggle'),
  carrierNameInput: document.querySelector('#carrierNameInput'),
  saveCarrier: document.querySelector('#saveCarrier'),
  carrierConfigStatus: document.querySelector('#carrierConfigStatus'),
  murderBinariesToggle: document.querySelector('#murderBinariesToggle'),
  routeToggle: document.querySelector('#routeToggle'),
  refreshRoute: document.querySelector('#refreshRoute'),
  poiModeInputs: [...document.querySelectorAll('input[name="poiMode"]')],
  placeIsolateToggle: document.querySelector('#placeIsolateToggle'),
  placesSummary: document.querySelector('#placesSummary'),
  placeFilterActions: document.querySelector('#placeFilterActions'),
  placeFilters: document.querySelector('#placeFilters'),
  systemsSummary: document.querySelector('#systemsSummary'),
  systemUpdateButtons: [...document.querySelectorAll('.system-update')],
  systemUpdateStatus: document.querySelector('#systemUpdateStatus'),
  systemUpdateProgress: document.querySelector('#systemUpdateProgress'),
  systemUpdateLog: document.querySelector('#systemUpdateLog'),
  refreshJournals: document.querySelector('#refreshJournals'),
  scanLatestJournals: document.querySelector('#scanLatestJournals'),
  scanAllJournals: document.querySelector('#scanAllJournals'),
  journalScanStatus: document.querySelector('#journalScanStatus'),
  journalScanProgress: document.querySelector('#journalScanProgress'),
  resetView: document.querySelector('#resetView'),
  tooltip: document.querySelector('#systemTooltip'),
  noteMenu: document.querySelector('#noteMenu'),
  noteMenuSystem: document.querySelector('#noteMenuSystem'),
  noteMenuClose: document.querySelector('#noteMenuClose'),
  noteCopyName: document.querySelector('#noteCopyName'),
  noteText: document.querySelector('#noteText'),
  noteCount: document.querySelector('#noteCount'),
  noteDelete: document.querySelector('#noteDelete'),
  noteSave: document.querySelector('#noteSave'),
  noteModeInputs: [...document.querySelectorAll('input[name="notesMode"]')],
  noteSearch: document.querySelector('#noteSearch'),
  notesSummary: document.querySelector('#notesSummary'),
  notesList: document.querySelector('#notesList'),
  recenterFocus: document.querySelector('#recenterFocus'),
  returnLatestJournal: document.querySelector('#returnLatestJournal'),
  updatedFrom: document.querySelector('#updatedFrom'),
  updatedBefore: document.querySelector('#updatedBefore'),
  updatedRangeSummary: document.querySelector('#updatedRangeSummary'),
  app: document.querySelector('.app'),
  inspector: document.querySelector('#inspector'),
  inspectorTabs: [...document.querySelectorAll('[data-inspector-tab]')],
  inspectorPanels: [...document.querySelectorAll('[data-inspector-panel]')],
  toggleInspector: document.querySelector('#toggleInspector'),
  openLayers: document.querySelector('#openLayers'),
  toolbarRecenter: document.querySelector('#toolbarRecenter'),
  toolbarLatest: document.querySelector('#toolbarLatest'),
  bodiesState: document.querySelector('#bodiesState'),
  bodySystemSummary: document.querySelector('#bodySystemSummary'),
  bodyList: document.querySelector('#bodyList'),
  richFiltersSummary: document.querySelector('#richFiltersSummary'),
  stationFilter: document.querySelector('#stationFilter'),
  populatedFilter: document.querySelector('#populatedFilter'),
  landableFilter: document.querySelector('#landableFilter'),
  marketFilter: document.querySelector('#marketFilter'),
  shipyardFilter: document.querySelector('#shipyardFilter'),
  outfittingFilter: document.querySelector('#outfittingFilter'),
  minBodyCount: document.querySelector('#minBodyCount'),
  bodyTypeFilter: document.querySelector('#bodyTypeFilter'),
  atmosphereFilter: document.querySelector('#atmosphereFilter'),
  ringTypeFilter: document.querySelector('#ringTypeFilter'),
  volcanismFilter: document.querySelector('#volcanismFilter'),
  economyFilter: document.querySelector('#economyFilter'),
  securityFilter: document.querySelector('#securityFilter'),
  governmentFilter: document.querySelector('#governmentFilter'),
  clearRichFilters: document.querySelector('#clearRichFilters'),
};

const systemCache = new Map();
let hoverRequestId = 0;
let searchRequestId = 0;
let hoverFetchTimer = null;
let lastHoverFetchAt = 0;
let pendingTooltipIndex = null;
let pendingTooltipHover = null;
let focusCopyStatusTimer = null;
let journalScanPollTimer = null;
let systemUpdatePollTimer = null;
let murderBinariesRefreshTimer = null;
let murderBinariesRequestId = 0;
let localPointsRefreshTimer = null;
let pointStatusTimer = null;
let localPointsRequestId = 0;
let localPointsController = null;
let pointLoadController = null;
let searchController = null;
let placesLoadController = null;
let placesLoadRequestId = 0;
let pointLoadRequestId = 0;
let richFilterApplyId = 0;
let starScaleFrame = null;
let tooltipOwner = null;
let clientToastTimer = null;
let routePollTimer = null;
let routePollInFlight = false;
let routeOverlaySignature = null;
const tooltipCacheLimit = 500;
const tooltipCacheTtlMs = 10 * 60 * 1000;
const tooltipFetchDelayMs = 40;
const routePollMs = 5000;
const viewSettingsKey = 'ed-system-search:view';
const dayMs = 24 * 60 * 60 * 1000;
const richSystemCache = new Map();
let richSystemRequestId = 0;
const systemUpdateWindows = [
  { mode: '1day', days: 1 },
  { mode: '1week', days: 7 },
  { mode: '2weeks', days: 14 },
  { mode: '1month', days: 31 },
  { mode: '6months', days: 183 },
];
const murderBinariesCategory = 'Murder Binaries';
const coloniaLandmark = {
  name: 'Colonia',
  shortName: 'Colonia',
  coords: { x: -9530.5, y: -910.28125, z: 19808.125 },
  color: '#b8c7ff',
};

function fmt(n) {
  return Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function systemKey(name) {
  return String(name ?? '').trim().toLowerCase();
}

function notePreview(text, max = 140) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}...` : clean;
}

function coordsText(coords) {
  return `${fmt(coords?.x)}, ${fmt(coords?.y)}, ${fmt(coords?.z)}`;
}

function compactStarType(value) {
  const text = String(value ?? '').trim();
  if (!text || text === 'Unknown') return '';
  return text.replace(/\s+Star$/i, '').trim();
}

function dateInputValue(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function localDateTime(value) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Unknown';
}

function localDayStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function systemUpdateAgeDays(value) {
  if (!value) return null;
  const dataDate = new Date(value);
  if (!Number.isFinite(dataDate.getTime())) return null;
  return Math.max(0, Math.ceil((localDayStart(new Date()) - localDayStart(dataDate)) / dayMs));
}

function recommendedSystemUpdateMode(value) {
  const ageDays = systemUpdateAgeDays(value);
  if (ageDays === null) return null;
  return systemUpdateWindows.find((item) => ageDays <= item.days)?.mode ?? '6months';
}

function distanceLy(a, b) {
  if (!a || !b) return null;
  return Math.hypot(
    Number(a.x ?? 0) - Number(b.x ?? 0),
    Number(a.y ?? 0) - Number(b.y ?? 0),
    Number(a.z ?? 0) - Number(b.z ?? 0)
  );
}

function setStatus(message, title = message) {
  el.status.textContent = message;
  el.status.title = title;
}

// While the server is writing data (journal scan or system/galaxy update), the
// status pill switches to a high-visibility warning style so the user knows
// not to close or relaunch the app mid-write.
const busyWriteKinds = new Set();
function setWriteActivity(kind, active) {
  if (active) busyWriteKinds.add(kind);
  else busyWriteKinds.delete(kind);
  el.status.classList.toggle('busy-write', busyWriteKinds.size > 0);
}

function isAbortError(error) {
  return error?.name === 'AbortError';
}

function showClientToast(message, timeoutMs = 9000) {
  if (!el.clientToast) return;
  clearTimeout(clientToastTimer);
  el.clientToast.textContent = message;
  el.clientToast.hidden = false;
  clientToastTimer = setTimeout(() => {
    el.clientToast.hidden = true;
  }, timeoutMs);
}

function readViewSettings() {
  try {
    return JSON.parse(localStorage.getItem(viewSettingsKey) ?? '{}');
  } catch {
    return {};
  }
}

function writeViewSettings(patch) {
  const next = { ...readViewSettings(), ...patch };
  localStorage.setItem(viewSettingsKey, JSON.stringify(next));
}

function currentShipLabel(ship) {
  if (!ship) return 'Unknown ship';
  const type = ship.shipType ? String(ship.shipType).replaceAll('_', ' ') : 'Unknown ship';
  const name = ship.shipName ? `"${ship.shipName}"` : null;
  const ident = ship.shipIdent ? `[${ship.shipIdent}]` : null;
  return [name, ident, type].filter(Boolean).join(' ');
}

function currentShipKey(ship) {
  if (!ship) return null;
  if (ship.shipKey) return ship.shipKey;
  if (ship.shipId !== undefined && ship.shipId !== null) return `id:${ship.shipId}`;
  const parts = [ship.shipType, ship.shipName, ship.shipIdent].filter(Boolean).join(':').toLowerCase();
  return parts ? `ship:${parts}` : null;
}

function readShipJumpOverrides() {
  const overrides = readViewSettings().shipJumpOverrides;
  return overrides && typeof overrides === 'object' && !Array.isArray(overrides) ? overrides : {};
}

function setShipJumpOverride(shipKey, value) {
  if (!shipKey) return;
  const overrides = { ...readShipJumpOverrides() };
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) overrides[shipKey] = Number(numeric.toFixed(2));
  else delete overrides[shipKey];
  writeViewSettings({ shipJumpOverrides: overrides });
}

function shipJumpOverride(ship) {
  const key = currentShipKey(ship);
  if (!key) return null;
  const value = Number(readShipJumpOverrides()[key]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function effectiveShipJumpRange(ship) {
  const override = shipJumpOverride(ship);
  const journal = Number(ship?.maxJumpRangeLy);
  return {
    value: override ?? (Number.isFinite(journal) && journal > 0 ? journal : null),
    source: override ? 'override' : 'journal',
    override,
    journal: Number.isFinite(journal) && journal > 0 ? journal : null,
  };
}

// Offline fallback; the panel lists the provider's live models when it can.
const llmModelPresets = {
  openai: [
    { id: 'gpt-5.5', label: 'GPT-5.5 - highest capability' },
    { id: 'gpt-5.4', label: 'GPT-5.4 - strong general search' },
    { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini - balanced default' },
    { id: 'gpt-5.4-nano', label: 'GPT-5.4 nano - lowest latency/cost' },
  ],
  anthropic: [
    { id: 'claude-fable-5-1', label: 'Claude Fable 5.1 - highest capability' },
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 - default' },
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 - balanced' },
    { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 - fastest' },
  ],
  kobold: [
    { id: 'local-model', label: 'KoboldCPP local model' },
  ],
};
const llmProviders = ['openai', 'anthropic', 'kobold'];

function defaultLlmModel(provider) {
  if (provider === 'anthropic') return 'claude-opus-5-5';
  if (provider === 'kobold') return 'local-model';
  return 'gpt-5.4-mini';
}

function llmBaseUrlPlaceholder(provider) {
  if (provider === 'anthropic') return 'https://api.anthropic.com';
  if (provider === 'kobold') return 'http://localhost:5001/v1';
  return 'https://api.openai.com/v1';
}

function llmProviderLabel(provider) {
  if (provider === 'anthropic') return 'Claude';
  if (provider === 'kobold') return 'KoboldCPP';
  return 'ChatGPT';
}

// Where the server keeps API keys, from /api/llm-keys.
function llmKeyStoreText() {
  const store = state.llmKeys?.store;
  if (!store) return 'the app on this computer';
  return store.secure ? store.label : 'a plain-text file';
}

function llmSavedKey(provider) {
  return state.llmKeys?.providers?.[provider] ?? null;
}

function llmApiKeyHint(provider) {
  if (state.llmKeys?.error) return `Could not read saved keys: ${state.llmKeys.error}`;
  const saved = llmSavedKey(provider);
  const insecure = state.llmKeys?.store && !state.llmKeys.store.secure
    ? ` Not secure: ${state.llmKeys.store.reason ?? 'no credential store is available'}.`
    : '';
  if (saved?.hasKey) {
    const when = saved.savedAt ? ` on ${new Date(saved.savedAt).toLocaleDateString()}` : '';
    return `${provider === 'kobold' ? 'Token' : 'Key'} saved in ${llmKeyStoreText()}${when}. Enter a new one to replace it.${insecure}`;
  }
  if (provider === 'kobold') return 'Usually blank unless your local endpoint requires a token.';
  return `Saved in ${llmKeyStoreText()}, never in the browser.${insecure}`;
}

function llmBaseUrlHint(provider) {
  if (provider === 'kobold') return 'Your local OpenAI-compatible KoboldCPP endpoint. Save to apply.';
  return `Leave blank for ${llmProviderLabel(provider)}'s official API. A key is only sent to the URL it was saved with, so changing this means entering the key again.`;
}

// Live model lists for this page session, keyed by provider and saved key.
const llmModelLists = new Map();
let llmModelRequest = null;
let llmModelTimer = null;

function llmModelListKey(provider) {
  return `${provider}|${llmSavedKey(provider)?.savedAt ?? ''}`;
}

function updateLlmModelOptions(settings) {
  const { provider } = settings;
  el.llmModel.placeholder = defaultLlmModel(provider);
  const live = llmModelLists.get(llmModelListKey(provider));
  const options = live?.models?.length ? live.models : (llmModelPresets[provider] ?? llmModelPresets.openai);
  el.llmModelOptions.replaceChildren(...options.map((item) => {
    const option = document.createElement('option');
    option.value = item.id;
    if (item.label && item.label !== item.id) option.label = item.label;
    return option;
  }));
  const canList = provider === 'kobold' || Boolean(llmSavedKey(provider)?.hasKey);
  if (live?.models?.length) {
    el.llmModelHint.textContent = `${live.models.length} models available from ${llmProviderLabel(provider)}.`;
  } else if (live?.error) {
    el.llmModelHint.textContent = `Could not list models (${live.error}). Showing presets.`;
  } else if (!canList) {
    el.llmModelHint.textContent = 'Save an API key to list the models your account can use.';
  } else {
    el.llmModelHint.textContent = '';
  }
  // Only ask the provider while the panel is open, not on every page load.
  if (!live && canList && state.llmKeys && !el.llmSearchPanel.hidden) {
    clearTimeout(llmModelTimer);
    llmModelTimer = setTimeout(() => refreshLlmModels(provider), 300);
  }
}

async function refreshLlmModels(provider) {
  const key = llmModelListKey(provider);
  llmModelRequest?.abort();
  const controller = new AbortController();
  llmModelRequest = controller;
  el.llmModelHint.textContent = `Loading ${llmProviderLabel(provider)} models...`;
  try {
    const response = await fetch('/api/llm-models', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    llmModelLists.set(key, response.ok
      ? { models: data.models ?? [] }
      : { error: data.error || response.statusText });
  } catch (error) {
    if (isAbortError(error)) return;
    llmModelLists.set(key, { error: error.message });
  } finally {
    if (llmModelRequest === controller) llmModelRequest = null;
  }
  // Render only if the form still shows the provider this list belongs to.
  const current = readLlmSettings();
  if (current.provider === provider && llmModelListKey(provider) === key) updateLlmModelOptions(current);
}

// Browser storage holds only non-secret choices: whether the LLM is on, the
// provider, and the model picked for each provider.
function readLlmSettings() {
  const settings = readViewSettings().llmSearch ?? {};
  const defaults = state.llmSearchDefaults ?? {};
  const provider = llmProviders.includes(settings.provider)
    ? settings.provider
    : llmProviders.includes(defaults.provider)
      ? defaults.provider
      : 'openai';
  const configured = settings.providers?.[provider] ?? {};
  const legacyConfigured = settings.provider === provider ? settings : {};
  const serverModel = defaults.provider === provider ? defaults.model : '';
  return {
    provider,
    providers: settings.providers ?? {},
    model: configured.model || legacyConfigured.model || serverModel || defaultLlmModel(provider),
  };
}

function writeLlmSettings(settings) {
  const providers = {};
  for (const [provider, config] of Object.entries(settings.providers ?? {})) {
    if (config?.model) providers[provider] = { model: config.model };
  }
  writeViewSettings({ llmSearch: { provider: settings.provider, providers } });
}

function applyLlmSettingsToForm(settings = readLlmSettings(), { resetCredentials = false } = {}) {
  el.llmProvider.value = settings.provider;
  updateLlmModelOptions(settings);
  el.llmModel.value = settings.model || defaultLlmModel(settings.provider);
  const saved = llmSavedKey(settings.provider);
  // Keep what the user is typing unless the provider changed or a save ran.
  if (resetCredentials || el.llmApiKey.dataset.provider !== settings.provider) {
    el.llmApiKey.value = '';
    el.llmBaseUrl.value = saved?.baseUrl ?? '';
    el.llmApiKey.dataset.provider = settings.provider;
  }
  el.llmApiKey.placeholder = saved?.hasKey
    ? 'Saved - enter a new one to replace it'
    : settings.provider === 'kobold' ? 'Optional token' : `${llmProviderLabel(settings.provider)} API key`;
  el.llmApiKeyHint.textContent = llmApiKeyHint(settings.provider);
  el.llmBaseUrl.placeholder = llmBaseUrlPlaceholder(settings.provider);
  el.llmBaseUrlHint.textContent = llmBaseUrlHint(settings.provider);
  el.llmSaveKey.textContent = settings.provider === 'kobold' ? 'Save endpoint' : 'Save key';
  el.llmRemoveKey.hidden = !saved?.saved;
  const ready = llmAssistantReady(settings.provider);
  el.llmAiSummary.textContent = ready ? `${llmProviderLabel(settings.provider)} ready` : 'Not set up';
  el.llmSearchProviderLabel.textContent = 'Describe what you are looking for';
}

// An assistant counts as set up once it has a saved key, or for KoboldCPP a
// saved endpoint.
function llmAssistantReady(provider) {
  const saved = llmSavedKey(provider);
  return provider === 'kobold' ? Boolean(saved?.saved) : Boolean(saved?.hasKey);
}

function llmSettingsFromForm() {
  const existing = readViewSettings().llmSearch ?? {};
  const provider = llmProviders.includes(el.llmProvider.value) ? el.llmProvider.value : 'openai';
  return llmSettingsWithProviderFromForm(provider, existing);
}

function llmSettingsWithProviderFromForm(provider, existing = readViewSettings().llmSearch ?? {}) {
  const model = el.llmModel.value.trim() || defaultLlmModel(provider);
  return {
    provider,
    providers: {
      ...(existing.providers ?? {}),
      [provider]: { model },
    },
    model,
  };
}

function persistLlmSettings() {
  const settings = llmSettingsFromForm();
  writeLlmSettings(settings);
  applyLlmSettingsToForm(settings);
  return settings;
}

async function loadLlmKeys() {
  try {
    const response = await api('/api/llm-keys');
    state.llmKeys = await response.json();
    await migrateBrowserLlmKeys();
  } catch (error) {
    state.llmKeys = { error: error.message, providers: {} };
  }
  applyLlmSettingsToForm(readLlmSettings(), { resetCredentials: true });
}

// Earlier versions kept keys in browser storage. Hand any found to the server
// (unless it already holds one for that provider), then drop the local copies.
async function migrateBrowserLlmKeys() {
  const settings = readViewSettings().llmSearch ?? {};
  const found = [];
  for (const provider of llmProviders) {
    const entry = settings.providers?.[provider] ?? (settings.provider === provider ? settings : null);
    if (entry?.apiKey || (provider === 'kobold' && entry?.baseUrl)) {
      found.push({ provider, apiKey: entry.apiKey ?? '', baseUrl: entry.baseUrl ?? '' });
    }
  }
  if (!found.length && !('apiKey' in settings)) return;
  let moved = true;
  for (const item of found) {
    if (llmSavedKey(item.provider)?.saved) continue;
    try {
      const response = await api('/api/llm-keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(item),
      });
      state.llmKeys = await response.json();
    } catch (error) {
      moved = false;
      console.warn(`Could not move the saved ${item.provider} key out of the browser: ${error.message}`);
    }
  }
  if (moved) writeLlmSettings({ ...readLlmSettings(), providers: settings.providers ?? {} });
}

async function saveLlmKey({ remove = false } = {}) {
  const provider = llmProviders.includes(el.llmProvider.value) ? el.llmProvider.value : 'openai';
  el.llmSaveKey.disabled = true;
  el.llmRemoveKey.disabled = true;
  el.llmApiKeyHint.textContent = remove ? 'Removing...' : 'Saving...';
  try {
    const response = await api('/api/llm-keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(remove
        ? { provider, remove: true }
        : { provider, apiKey: el.llmApiKey.value.trim(), baseUrl: el.llmBaseUrl.value.trim() }),
    });
    state.llmKeys = await response.json();
    applyLlmSettingsToForm(readLlmSettings(), { resetCredentials: true });
    scheduleSearchPreview(0);
  } catch (error) {
    el.llmApiKeyHint.textContent = `Could not ${remove ? 'remove' : 'save'} the ${provider === 'kobold' ? 'endpoint' : 'key'}: ${error.message}`;
  } finally {
    el.llmSaveKey.disabled = false;
    el.llmRemoveKey.disabled = false;
  }
}

function applyStarScale(percent, persist = false) {
  const nextPercent = Math.max(10, Math.min(400, Math.round(Number(percent) || 200)));
  el.starScale.value = String(nextPercent);
  el.starScaleValue.value = `${nextPercent}%`;
  cancelAnimationFrame(starScaleFrame);
  starScaleFrame = requestAnimationFrame(() => {
    state.renderer?.setStarScale(nextPercent / 50);
  });
  if (persist) writeViewSettings({ starScalePercent: nextPercent });
}

function displayAutoStarScale(percent) {
  if (!el.starScaleAuto.checked) return;
  const nextPercent = Math.max(10, Math.min(400, Math.round(Number(percent) / 10) * 10));
  el.starScale.value = String(nextPercent);
  el.starScaleValue.value = `${nextPercent}%`;
}

function setStarScaleAuto(enabled, persist = false) {
  const nextEnabled = Boolean(enabled);
  if (!nextEnabled && state.renderer?.autoStarScale) {
    const currentPercent = Number(el.starScale.value) || 200;
    state.renderer.setStarScale(currentPercent / 50);
    if (persist) writeViewSettings({ starScalePercent: currentPercent });
  }
  el.starScaleAuto.checked = nextEnabled;
  state.renderer?.setAutoStarScale(el.starScaleAuto.checked);
  if (persist) writeViewSettings({ starScaleAuto: el.starScaleAuto.checked });
}

function richFilterControls() {
  return [
    ['hasStations', el.stationFilter],
    ['populated', el.populatedFilter],
    ['landable', el.landableFilter],
    ['markets', el.marketFilter],
    ['shipyards', el.shipyardFilter],
    ['outfitting', el.outfittingFilter],
  ];
}

function richFiltersAvailable() {
  const compatibility = state.galaxyDetails?.mapFilters?.compatibility;
  return Boolean(
    state.galaxyDetails?.imported
    && state.galaxyDetails?.mapFilters?.lodLevels?.length
    && compatibility?.compatible !== false
  );
}

function richCategoryControls() {
  return [
    ['bodyType', el.bodyTypeFilter],
    ['atmosphere', el.atmosphereFilter],
    ['ringType', el.ringTypeFilter],
    ['volcanism', el.volcanismFilter],
    ['economy', el.economyFilter],
    ['security', el.securityFilter],
    ['government', el.governmentFilter],
  ];
}

function richCategoryFiltersAvailable() {
  return richFiltersAvailable() && Number(state.galaxyDetails?.mapFilters?.recordBytes ?? 0) >= 40;
}

function configureRichFilters() {
  const available = richFiltersAvailable();
  const categoriesAvailable = richCategoryFiltersAvailable();
  const settings = readViewSettings();
  const unavailableReason = state.galaxyDetails?.mapFilters?.compatibility?.reason
    ?? (state.galaxyDetails?.imported
      ? 'Reimport galaxy.json.gz to build map filter indexes.'
      : 'Import galaxy.json.gz to enable these filters.');
  for (const [name, input] of richFilterControls()) {
    input.disabled = !available;
    input.checked = available ? Boolean(settings.richFilters?.[name]) : false;
    input.closest('label')?.toggleAttribute('aria-disabled', !available);
    input.closest('label')?.setAttribute('title', available ? '' : unavailableReason);
  }
  el.minBodyCount.disabled = !available;
  el.clearRichFilters.disabled = !available;
  el.minBodyCount.value = available ? String(Math.max(0, Number(settings.richFilters?.minBodies ?? 0))) : '0';
  for (const [name, input] of richCategoryControls()) {
    input.disabled = !categoriesAvailable;
    setCategoryFilterValue(input, categoriesAvailable ? String(settings.richFilters?.[name] ?? '') : '');
    input.closest('label')?.toggleAttribute('aria-disabled', !categoriesAvailable);
    input.closest('label')?.setAttribute('title', categoriesAvailable ? '' : unavailableReason);
  }
  el.colorBySelect.disabled = !categoriesAvailable;
  el.colorBySelect.value = categoriesAvailable ? activeColorBy() : '';
  renderColorLegend();
  state.renderer?.setColorMode(colorModeFor(activeColorBy()));
  if (!available) {
    el.richFiltersSummary.textContent = unavailableReason;
    return;
  }
  const count = state.galaxyDetails.baseCount ?? state.galaxyDetails.indexedRecords ?? 0;
  const updated = state.galaxyDetails.updatedAt ? ` Updated ${localDateTime(state.galaxyDetails.updatedAt)}.` : '';
  const categoryText = categoriesAvailable ? ' Detailed body and civilization filters are ready.' : ' Reimport full data to add detailed categories.';
  el.richFiltersSummary.textContent = `${fmt(count)} systems have indexed full-data summaries.${categoryText}${updated}`;
}

function richFilterSettings() {
  const filters = Object.fromEntries(richFilterControls().map(([name, input]) => [name, input.checked]));
  for (const [name, input] of richCategoryControls()) filters[name] = input.value;
  filters.minBodies = Math.max(0, Math.floor(Number(el.minBodyCount.value) || 0));
  return filters;
}

// A category <select> shows one value; several values (set from the colour
// legend) live in an extra "Several" option so the filter keeps one source.
function setCategoryFilterValue(input, value) {
  input.querySelector('option[data-multi]')?.remove();
  const values = String(value ?? '').split(',').filter(Boolean);
  if (values.length > 1 || (values.length === 1 && !input.querySelector(`option[value="${CSS.escape(values[0])}"]`))) {
    const option = document.createElement('option');
    option.value = values.join(',');
    option.dataset.multi = '';
    option.textContent = `Several (${values.length})`;
    input.append(option);
  }
  input.value = values.join(',');
}

function activeColorBy() {
  const key = readViewSettings().colorBy ?? '';
  return richCategoryFiltersAvailable() && Object.hasOwn(colorModes, key) ? key : '';
}

function colorModeFor(key) {
  const mode = colorModes[key];
  if (!mode) return null;
  return {
    key,
    palette: [null, ...mode.values.map((entry) => hexToRgb(entry.color))],
    noData: hexToRgb(noDataColor),
  };
}

function colorLegendSelection(mode) {
  const input = richCategoryControls().find(([name]) => name === mode.filter)?.[1];
  const values = String(input?.value ?? '').split(',').filter(Boolean);
  const all = [...mode.values.map((entry) => entry.value), 'none'];
  return { input, selected: new Set(values.length ? values : all), all };
}

function renderColorLegend() {
  const key = activeColorBy();
  const mode = colorModes[key];
  el.colorLegend.hidden = !mode;
  el.colorLegend.replaceChildren();
  if (!mode) return;
  const { selected } = colorLegendSelection(mode);
  const entries = [...mode.values, { value: 'none', label: 'No data', color: noDataColor }];
  for (const entry of entries) {
    const label = document.createElement('label');
    label.className = 'color-legend-item';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = selected.has(entry.value);
    input.addEventListener('change', () => toggleColorLegendValue(mode, entry.value, input.checked));
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.setProperty('--star-color', entry.color);
    const text = document.createElement('span');
    text.textContent = entry.label;
    label.append(input, swatch, text);
    el.colorLegend.append(label);
  }
  const actions = document.createElement('div');
  actions.className = 'color-legend-actions';
  const showAll = document.createElement('button');
  showAll.type = 'button';
  showAll.className = 'panel-button panel-button-tertiary';
  showAll.textContent = 'Show all';
  showAll.addEventListener('click', () => setColorLegendValues(mode, null));
  actions.append(showAll);
  if (mode.note) {
    const note = document.createElement('small');
    note.className = 'muted';
    note.textContent = mode.note;
    actions.append(note);
  }
  el.colorLegend.append(actions);
}

// Legend toggles edit the matching System features filter, so colouring and
// filtering stay one system: all values checked means "Any".
function toggleColorLegendValue(mode, value, checked) {
  const { selected } = colorLegendSelection(mode);
  if (checked) selected.add(value);
  else selected.delete(value);
  setColorLegendValues(mode, selected);
}

function setColorLegendValues(mode, selected) {
  const { input, all } = colorLegendSelection(mode);
  if (!input) return;
  const values = selected && selected.size < all.length ? all.filter((value) => selected.has(value)) : [];
  if (selected && selected.size === 0) values.push('none');
  setCategoryFilterValue(input, values.join(','));
  renderColorLegend();
  saveAndApplyRichFilters();
}

// Like the in-game colour views, a colour mode starts by hiding systems that
// have no data for it; switching back undoes that automatic filter unless
// the user has changed it since.
async function applyColorBy(key) {
  const settings = readViewSettings();
  const previousAuto = settings.colorAutoFilter;
  writeViewSettings({ colorBy: key, colorAutoFilter: null });
  const mode = colorModes[activeColorBy()];
  state.renderer.setColorMode(colorModeFor(activeColorBy()));
  const controls = new Map(richCategoryControls());
  const previousInput = previousAuto ? controls.get(previousAuto.filter) : null;
  if (previousInput && previousInput.value === previousAuto.value && previousAuto.filter !== mode?.filter) {
    setCategoryFilterValue(previousInput, '');
  }
  const input = mode ? controls.get(mode.filter) : null;
  if (input && !input.value) {
    const value = mode.values.map((entry) => entry.value).join(',');
    writeViewSettings({ colorAutoFilter: { filter: mode.filter, value } });
    setCategoryFilterValue(input, value);
  } else if (input && previousAuto?.filter === mode.filter && input.value === previousAuto.value) {
    writeViewSettings({ colorAutoFilter: previousAuto });
  }
  renderColorLegend();
  await saveAndApplyRichFilters();
}

function appendRichFilterParams(params) {
  if (!richFiltersAvailable()) return false;
  const colorBy = activeColorBy();
  if (colorBy) params.set('colorBy', colorBy);
  const rich = richFilterSettings();
  for (const name of ['hasStations', 'populated', 'landable', 'markets', 'shipyards', 'outfitting']) {
    if (rich[name]) params.set(name, '1');
  }
  if (rich.minBodies > 0) params.set('minBodies', String(rich.minBodies));
  if (richCategoryFiltersAvailable()) {
    for (const name of ['bodyType', 'atmosphere', 'ringType', 'volcanism', 'economy', 'security', 'government']) {
      if (rich[name]) params.set(name, rich[name]);
    }
  }
  return ['hasStations', 'populated', 'landable', 'markets', 'shipyards', 'outfitting', 'minBodies',
    'bodyType', 'atmosphere', 'ringType', 'volcanism', 'economy', 'security', 'government']
    .some((name) => params.has(name));
}

async function saveAndApplyRichFilters() {
  const applyId = ++richFilterApplyId;
  writeViewSettings({ richFilters: richFilterSettings() });
  renderColorLegend();
  cancelLocalPointsRefresh();
  state.localPointCount = 0;
  state.localAreaCount = null;
  state.localPointRequestKey = null;
  el.status.classList.add('loading');
  el.richFiltersSummary.classList.add('filter-applying');
  el.richFiltersSummary.textContent = 'Applying filters to the galaxy and nearby systems...';
  setStatus('Applying System Features filters...');
  try {
    await state.renderer.setLocalPoints(new ArrayBuffer(0), state.meta);
    await loadPoints({ awaitLocal: true });
    if (applyId !== richFilterApplyId) return;
    state.renderer.requestRender();
    configureRichFilters();
    updatePointStatus();
  } catch (error) {
    if (isAbortError(error) || applyId !== richFilterApplyId) return;
    console.error(error);
    setStatus(`Could not apply full-data filters: ${error.message}`);
  } finally {
    if (applyId === richFilterApplyId) {
      el.status.classList.remove('loading');
      el.richFiltersSummary.classList.remove('filter-applying');
    }
  }
}

function clearRichFilters() {
  for (const [, input] of richFilterControls()) input.checked = false;
  for (const [, input] of richCategoryControls()) setCategoryFilterValue(input, '');
  el.minBodyCount.value = '0';
  saveAndApplyRichFilters();
}

function setInspectorTab(tabName, persist = true) {
  const validTab = el.inspectorTabs.some((button) => button.dataset.inspectorTab === tabName)
    ? tabName
    : 'system';
  for (const button of el.inspectorTabs) {
    const active = button.dataset.inspectorTab === validTab;
    button.setAttribute('aria-selected', active ? 'true' : 'false');
    button.tabIndex = active ? 0 : -1;
  }
  for (const panel of el.inspectorPanels) {
    panel.hidden = panel.dataset.inspectorPanel !== validTab;
  }
  el.inspector.dataset.activeTab = validTab;
  if (persist) writeViewSettings({ inspectorTab: validTab });
  if (validTab === 'bodies') {
    loadSelectedBodies().catch((error) => {
      console.warn(error);
      renderBodiesError(error.message);
    });
  }
}

function setInspectorCollapsed(collapsed, persist = true) {
  el.app.classList.toggle('inspector-collapsed', collapsed);
  el.toggleInspector.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  el.toggleInspector.setAttribute('aria-label', collapsed ? 'Show inspector' : 'Hide inspector');
  el.toggleInspector.title = collapsed ? 'Show inspector' : 'Hide inspector';
  if (persist) writeViewSettings({ inspectorCollapsed: collapsed });
  requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
}

function openInspectorTab(tabName) {
  setInspectorCollapsed(false);
  setInspectorTab(tabName);
}

function elapsedText(startedAt) {
  const started = new Date(startedAt).getTime();
  if (!Number.isFinite(started)) return '0:00';
  const totalSeconds = Math.max(0, Math.floor((Date.now() - started) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function setScanStatus(scan) {
  const label = scan.origin === 'live' ? 'Saving live journal' : scan.mode === 'all' ? 'All scan' : 'Latest scan';
  const elapsed = scan.startedAt ? elapsedText(scan.startedAt) : '0:00';
  setWriteActivity('scan', Boolean(scan.running));
  const message = `${label} ${elapsed} · ${scan.message ?? 'working'}`;
  setStatus(message);
  setJournalScanPanel(scan, { message, processing: Boolean(scan.running) });
}

function setSystemUpdateStatus(update) {
  const label = update?.mode === 'places'
    ? 'Places update'
    : update?.mode === 'discoveries'
      ? 'Discoveries update'
      : update?.mode === 'murder-binaries'
        ? 'Murder Binaries analysis'
      : update?.mode === 'green-gas-giants'
        ? 'Green Gas Giant analysis'
      : update?.mode === 'bio-targets'
        ? 'High-value bio analysis'
      : update?.mode === 'galaxy'
        ? 'Full galaxy import'
    : update?.mode
      ? `Systems ${update.mode}`
      : 'Data update';
  const elapsed = update?.startedAt ? elapsedText(update.startedAt) : '0:00';
  const message = `${label} ${elapsed} · ${update?.step ?? 'running'} · ${update?.message ?? 'working'}`;
  setWriteActivity('update', Boolean(update?.running));
  setStatus(message);
  el.systemUpdateStatus.textContent = message;
  setDownloadProgress(update?.message ?? '', Boolean(update?.running));
}

function setDownloadProgress(message, running) {
  const percentMatch = String(message).match(/\((\d{1,3})%\)/);
  const isDownload = /\bdownload/i.test(String(message));
  el.systemUpdateProgress.hidden = !running || !isDownload;
  if (el.systemUpdateProgress.hidden) return;
  const bar = el.systemUpdateProgress.querySelector('span');
  const percent = percentMatch ? Math.max(0, Math.min(100, Number(percentMatch[1]))) : 0;
  bar.style.width = `${percent}%`;
  el.systemUpdateProgress.title = message;
}

function scanModeLabel(mode) {
  return mode === 'all' ? 'All scan' : 'Latest scan';
}

function journalScanProgressPercent(scan) {
  const message = String(scan?.message ?? '').toLowerCase();
  let match = message.match(/\breading\s+(\d+)\/(\d+)/);
  if (match) return 8 + (Math.min(Number(match[1]), Number(match[2])) / Math.max(1, Number(match[2]))) * 37;
  match = message.match(/\bcarrier scan\s+(\d+)\/(\d+)/);
  if (match) return 45 + (Math.min(Number(match[1]), Number(match[2])) / Math.max(1, Number(match[2]))) * 10;
  match = message.match(/\b(?:exact match|matching)\s+(\d+)\/(\d+)/);
  if (match) return 62 + (Math.min(Number(match[1]), Number(match[2])) / Math.max(1, Number(match[2]))) * 18;
  match = message.match(/\bwriting\b.*\s(\d+)\/(\d+)/);
  if (match) return 82 + (Math.min(Number(match[1]), Number(match[2])) / Math.max(1, Number(match[2]))) * 8;
  if (message.includes('starting')) return 2;
  if (message.includes('listing files')) return 5;
  if (message.includes('merging visits')) return 56;
  if (message.includes('exact overlay')) return 60;
  if (message.includes('exact miss')) return 81;
  if (message.includes('matching')) return 70;
  if (message.includes('writing')) return 84;
  if (message.includes('no new journal lines')) return 90;
  return null;
}

function setDataStateText(node, message) {
  if (!node) return;
  const span = node.querySelector('span');
  if (span) span.textContent = message;
  else node.textContent = message;
}

function setJournalScanPanel(scan = null, options = {}) {
  const processing = Boolean(options.processing);
  const failed = Boolean(options.failed || (scan && scan.running === false && scan.ok === false));
  const mode = scan?.mode ?? options.mode ?? 'latest';
  const label = scan ? scanModeLabel(mode) : '';
  const elapsed = scan?.startedAt ? `${elapsedText(scan.startedAt)} · ` : '';
  const message = options.message
    ?? (scan ? `${label} ${elapsed}${scan.message ?? (scan.running ? 'working' : 'complete')}` : 'Idle');
  setDataStateText(el.journalScanStatus, message);
  el.journalScanStatus?.classList.toggle('running', processing);
  el.journalScanStatus?.classList.toggle('failed', failed);
  if (el.journalScanProgress) {
    el.journalScanProgress.hidden = !processing;
    const inferredPercent = journalScanProgressPercent(scan);
    const requestedPercent = Number(options.percent);
    const percent = Number.isFinite(requestedPercent) ? requestedPercent : inferredPercent;
    const determinate = processing && Number.isFinite(percent);
    const bar = el.journalScanProgress.querySelector('span');
    el.journalScanProgress.classList.toggle('indeterminate', processing && !determinate);
    if (bar) bar.style.width = determinate ? `${Math.max(0, Math.min(100, percent))}%` : '';
    if (determinate) el.journalScanProgress.setAttribute('aria-valuenow', String(Math.round(percent)));
    else el.journalScanProgress.removeAttribute('aria-valuenow');
    el.journalScanProgress.title = processing ? message : '';
  }
}

function setFocusCopyStatus(message, ok = true) {
  clearTimeout(focusCopyStatusTimer);
  el.focusCopyStatus.textContent = message;
  el.focusCopyStatus.classList.toggle('error', !ok);
  focusCopyStatusTimer = setTimeout(() => {
    el.focusCopyStatus.textContent = '';
    el.focusCopyStatus.classList.remove('error');
  }, 1800);
}

function copyWithFallback(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.append(textarea);
  textarea.select();
  try {
    if (!document.execCommand('copy')) throw new Error('Copy command was rejected.');
  } finally {
    textarea.remove();
  }
}

async function copyFocusName() {
  const name = state.focus?.name?.trim();
  if (!name) return;
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(name);
    else copyWithFallback(name);
    setFocusCopyStatus('Copied');
  } catch (error) {
    console.warn(error);
    setFocusCopyStatus('Copy failed', false);
  }
}

async function api(path, options) {
  const response = await fetch(path, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || response.statusText);
  }
  return response;
}

async function loadStatus() {
  const response = await api('/api/status');
  const data = await response.json();
  state.meta = data.meta;
  state.visited = data.visited;
  state.latestJournal = newerLatestSystem(data.visited?.latestSystem ?? null, liveLatestSystem());
  if (el.routeBar && state.routeOverlay) renderRouteBar();
  state.carrierLocation = data.visited?.carrierLocation ?? null;
  state.trackedCarrier = data.runtimeConfig?.trackedCarrier ?? null;
  renderCarrierConfig();
  state.llmSearchDefaults = data.runtimeConfig?.llmSearch ?? null;
  state.systemUpdates = data.systemUpdates ?? null;
  state.galaxyDetails = data.galaxyDetails ?? null;
  state.spatialIndex = data.spatialIndex ?? null;
  updateBioAvailability(data.bioTargets);
  updateLiveStatus(data.liveJournal);

  if (!data.imported) {
    el.datasetSummary.textContent = 'Run npm run import:systems to build map indexes.';
    setStatus('Systems are not imported yet. Import the Spansh dump, then refresh this page.');
    return false;
  }

  const supplementalText = data.meta.supplementalCount
    ? ` + ${fmt(data.meta.supplementalCount)} journal-only`
    : '';
  el.datasetSummary.textContent = `${fmt(data.meta.importedCount ?? data.meta.count)} systems imported${supplementalText} ${new Date(data.meta.importedAt).toLocaleString()}`;
  configureRichFilters();
  updateSystemsSummary();
  if (data.visited) {
    const latest = data.visited.latestSystem?.name ?? 'Unknown';
    const supplemental = data.visited.supplementalCount ? ` ${fmt(data.visited.supplementalCount)} journal-only systems added.` : '';
    const scan = data.visited.scanMode === 'all'
      ? ' Last scan: all journals.'
      : data.visited.scanMode
        ? ` Last scan: latest ${fmt(data.visited.scannedFileCount)} of ${fmt(data.visited.fileCount)} journals; read ${fmt(data.visited.readFileCount ?? data.visited.scannedFileCount)} changed.`
        : '';
    el.journalSummary.textContent = `${fmt(data.visited.visitedCount)} visited systems. Latest: ${latest}.${supplemental} User data last updated ${new Date(data.visited.updatedAt).toLocaleString()}.${scan}`;
  } else {
    el.journalSummary.textContent = `No parsed journals yet. Source: ${data.journalPath}`;
  }
  renderCurrentShip();
  if (data.places?.imported) {
    state.placesMeta = data.places;
    updatePlacesSummary();
  } else {
    el.placesSummary.textContent = 'Run npm run import:places to load places of interest.';
  }
  setupUpdateFilters(data.meta.updateTimeRange);
  return true;
}

function updateSystemsSummary() {
  const updates = state.systemUpdates;
  const lastDataUpdateTime = updates?.lastDataUpdateTime ?? state.meta?.updateTimeRange?.maxUpdateTime ?? null;
  const dataTime = lastDataUpdateTime ? localDateTime(lastDataUpdateTime) : 'Unknown';
  const lastRun = updates?.lastRun;
  const runText = lastRun
    ? `Last ${lastRun.mode} run ${localDateTime(lastRun.finishedAt)} (${lastRun.ok ? 'ok' : 'failed'}).`
    : 'No in-app update runs logged yet.';
  el.systemsSummary.textContent = `Newest system data timestamp: ${dataTime}. ${runText}`;
  updateRecommendedSystemUpdate(lastDataUpdateTime);
  renderSystemUpdateLog(updates?.log?.runs ?? []);
}

function updateRecommendedSystemUpdate(lastDataUpdateTime) {
  const recommendedMode = recommendedSystemUpdateMode(lastDataUpdateTime);
  const ageDays = systemUpdateAgeDays(lastDataUpdateTime);
  for (const button of el.systemUpdateButtons) {
    const active = Boolean(recommendedMode && button.dataset.systemUpdate === recommendedMode);
    button.classList.toggle('system-update-recommended', active);
    if (active) {
      button.title = `Recommended for data about ${ageDays} calendar day${ageDays === 1 ? '' : 's'} old.`;
    } else {
      button.removeAttribute('title');
    }
  }
}

function renderSystemUpdateLog(runs) {
  el.systemUpdateLog.replaceChildren();
  for (const run of runs.slice(0, 6)) {
    const item = document.createElement('div');
    item.className = `update-log-entry${run.ok === false ? ' failed' : ''}`;
    const title = document.createElement('strong');
    title.textContent = `${run.mode} · ${run.ok ? 'Complete' : 'Failed'}`;
    const detail = document.createElement('span');
    const dataTime = run.lastDataUpdateTime ? ` · data ${localDateTime(run.lastDataUpdateTime)}` : '';
    detail.textContent = `${localDateTime(run.finishedAt)}${dataTime}`;
    item.append(title, detail);
    el.systemUpdateLog.append(item);
  }
}

function appendShipStat(label, value) {
  const item = document.createElement('div');
  const title = document.createElement('span');
  const detail = document.createElement('strong');
  title.textContent = label;
  detail.textContent = value;
  item.append(title, detail);
  el.currentShipStats.append(item);
}

function renderCurrentShip() {
  const ship = state.visited?.currentShip ?? null;
  el.currentShipStats.replaceChildren();
  const shipKey = currentShipKey(ship);
  el.shipJumpOverride.disabled = !shipKey;
  el.clearShipJumpOverride.disabled = !shipKey || shipJumpOverride(ship) === null;
  if (!ship) {
    el.currentShipSummary.textContent = 'No ship data found. Scan journals after a Loadout event is present.';
    el.shipJumpOverride.value = '';
    el.shipJumpOverride.placeholder = 'Journal range';
    el.shipJumpEffective.textContent = '';
    return;
  }

  const range = effectiveShipJumpRange(ship);
  const journalText = range.journal ? `${fmt(range.journal)} ly` : 'Unknown';
  const override = range.override;
  el.currentShipSummary.textContent = currentShipLabel(ship);
  appendShipStat('Journal range', journalText);
  appendShipStat('Ship ID', ship.shipId !== undefined && ship.shipId !== null ? String(ship.shipId) : 'Unknown');
  appendShipStat('Last event', `${ship.sourceEvent ?? 'Journal'} · ${localDateTime(ship.timestamp)}`);
  if (ship.cargoCapacity !== undefined) appendShipStat('Cargo', `${fmt(ship.cargoCapacity)} t`);
  if (ship.fuelCapacity?.main !== undefined) appendShipStat('Fuel', `${fmt(ship.fuelCapacity.main)} t`);

  el.shipJumpOverride.value = override ?? '';
  el.shipJumpOverride.placeholder = range.journal ? `${fmt(range.journal)} ly` : 'Journal range';
  el.clearShipJumpOverride.disabled = !shipKey || override === null;
  el.shipJumpEffective.textContent = range.value
    ? `Effective max jump: ${fmt(range.value)} ly (${range.source})`
    : 'Effective max jump: unknown';
}

function setupUpdateFilters(range) {
  const available = Boolean(range?.available && range.minUpdateTime && range.maxUpdateTime);
  el.updatedFrom.disabled = !available;
  el.updatedBefore.disabled = !available;
  if (!available) {
    el.updatedRangeSummary.textContent = 'Run npm run import:updates to enable date filtering.';
    return;
  }
  if (!state.updateFiltersInitialized) {
    el.updatedFrom.value = dateInputValue(range.minUpdateTime) || '2000-01-01';
    el.updatedBefore.value = '';
    state.updateFiltersInitialized = true;
  }
  el.updatedRangeSummary.textContent = `${localDateTime(range.minUpdateTime)} to ${localDateTime(range.maxUpdateTime)}`;
}

function typeLabel(typeName) {
  if (typeName.includes('Black Hole')) return 'Black holes';
  if (typeName.includes('Neutron')) return 'Neutron';
  if (typeName.includes('White Dwarf')) return 'White dwarfs';
  if (typeName.includes('T Tauri')) return 'T Tauri';
  if (typeName.includes('Wolf-Rayet')) return 'Wolf-Rayet';
  if (typeName.startsWith('O ')) return 'Class O';
  if (typeName.startsWith('B ')) return 'Class B';
  if (typeName.startsWith('A ')) return 'Class A';
  if (typeName.startsWith('F ')) return 'Class F';
  if (typeName.startsWith('G ')) return 'Class G';
  if (typeName.startsWith('K ')) return 'Class K';
  if (typeName.startsWith('M ')) return 'Class M';
  if (typeName.startsWith('L ')) return 'Class L';
  if (typeName.startsWith('T ')) return 'Class T';
  if (typeName.startsWith('Y ')) return 'Class Y';
  return typeName.replace(' Star', '');
}

function groupedTypes(meta) {
  const groups = new Map();
  meta.typeNames.forEach((name, code) => {
    const label = typeLabel(name);
    if (!groups.has(label)) groups.set(label, { label, codes: [], count: 0, color: colorsForType(name) });
    groups.get(label).codes.push(code);
    groups.get(label).count += meta.typeCounts[String(code)] ?? 0;
  });
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

function isMainSequenceGroup(group) {
  return /^Class [OBAFGKMLTY]$/.test(group.label);
}

function isRareGroup(group) {
  return ['Black holes', 'Neutron', 'White dwarfs', 'Wolf-Rayet'].includes(group.label);
}

function isSpecialGroup(group) {
  return group.codes.some((code) => /Black Hole|Neutron|White Dwarf|T Tauri|Wolf-Rayet|Herbig|giant|super giant|C Star|CJ Star|CN Star|S-type|MS-type/i.test(state.meta.typeNames[code] ?? ''));
}

function filterCategory(group) {
  if (isMainSequenceGroup(group)) return 'Main Sequence';
  if (['Black holes', 'Neutron', 'White dwarfs'].includes(group.label)) return 'Remnants';
  if (['T Tauri'].includes(group.label) || group.codes.some((code) => /Herbig/i.test(state.meta.typeNames[code] ?? ''))) return 'Young Stars';
  if (isSpecialGroup(group)) return 'Rare / Special';
  return 'Other';
}

function applyFilterPreset(predicate) {
  state.enabledTypes.clear();
  for (const item of state.filterInputs) {
    let enabledCount = 0;
    for (const code of item.group.codes) {
      if (!predicate(item.group, code)) continue;
      state.enabledTypes.add(code);
      enabledCount += 1;
    }
    item.input.checked = enabledCount === item.group.codes.length;
    item.input.indeterminate = enabledCount > 0 && enabledCount < item.group.codes.length;
  }
  loadPoints();
}

function renderFilterActions() {
  const actions = [
    ['All', () => true],
    ['None', () => false],
    ['Main', isMainSequenceGroup],
    ['Giants', (_group, code) => isGiantStarType(state.meta.typeNames[code])],
    ['Rare', isRareGroup],
    ['Special', isSpecialGroup],
  ];
  el.filterActions.replaceChildren();
  for (const [label, predicate] of actions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', () => applyFilterPreset(predicate));
    el.filterActions.append(button);
  }
}

function renderFilters() {
  const groups = groupedTypes(state.meta);
  const viewSettings = readViewSettings();
  const openGroups = viewSettings.openFilterGroups ?? {};
  state.filterGroups = groups;
  state.filterInputs = [];
  state.enabledTypes = new Set(state.meta.typeNames.map((_, code) => code));
  renderFilterActions();
  el.filters.replaceChildren();
  const categories = new Map();
  for (const group of groups) {
    const category = filterCategory(group);
    if (!categories.has(category)) categories.set(category, []);
    categories.get(category).push(group);
  }
  for (const category of ['Main Sequence', 'Remnants', 'Young Stars', 'Rare / Special', 'Other']) {
    const categoryGroups = categories.get(category);
    if (!categoryGroups?.length) continue;
    const details = document.createElement('details');
    details.className = 'filter-group-section';
    details.open = Object.hasOwn(openGroups, category) ? Boolean(openGroups[category]) : category !== 'Other';
    details.addEventListener('toggle', () => {
      writeViewSettings({
        openFilterGroups: {
          ...readViewSettings().openFilterGroups,
          [category]: details.open,
        },
      });
    });
    const summary = document.createElement('summary');
    summary.textContent = category;
    const count = document.createElement('span');
    count.textContent = String(categoryGroups.length);
    summary.append(count);
    const content = document.createElement('div');
    content.className = 'filter-group-content';
    for (const group of categoryGroups) {
      content.append(filterControl(group));
    }
    details.append(summary, content);
    el.filters.append(details);
  }
}

function filterControl(group) {
    const label = document.createElement('label');
    label.className = 'filter';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = true;
    input.addEventListener('change', () => {
      input.indeterminate = false;
      for (const code of group.codes) {
        if (input.checked) state.enabledTypes.add(code);
        else state.enabledTypes.delete(code);
      }
      loadPoints();
    });
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.setProperty('--star-color', `rgb(${group.color.map((c) => Math.round(c * 255)).join(',')})`);
    const text = document.createElement('span');
    text.textContent = group.label;
    label.append(input, swatch, text);
    state.filterInputs.push({ group, input });
    return label;
}

function selectedHtml(system) {
  const note = system.note?.text ? escapeHtml(system.note.text) : '';
  const starColor = `rgb(${colorsForType(system.mainStar).map((component) => Math.round(component * 255)).join(',')})`;
  return `
    <div class="selected-primary">
      <span class="selected-star-mark${system.nonStandard ? ' special' : ''}" style="--star-color: ${starColor}"></span>
      <div>
        <strong>${escapeHtml(system.mainStar)}</strong>
        <span>${system.nonStandard ? 'Special primary object' : 'Standard primary star'}</span>
      </div>
    </div>
    <dl>
      <dt>ID64</dt><dd>${escapeHtml(system.id64)}</dd>
      ${boxelRows(system)}
      ${state.bio.available ? '<dt>High-value bio</dt><dd id="bioCellDetail" class="bio-cell">Loading…</dd>' : ''}
      <dt>Coords</dt><dd>${coordsText(system.coords)}</dd>
      <dt>Permit</dt><dd>${system.needsPermit ? 'Required' : 'No'}</dd>
      <dt>Visited</dt><dd>${system.visited ? 'Yes' : 'No'}</dd>
      <dt>Source</dt><dd>${escapeHtml(system.source ?? 'Unknown')}</dd>
      <dt>Last updated</dt><dd>${localDateTime(system.updateTime)}</dd>
      <dt>Icon</dt><dd>${system.nonStandard ? 'Special primary' : 'Standard star'}</dd>
      ${system.lastVisited ? `<dt>Last visit</dt><dd>${new Date(system.lastVisited).toLocaleString()}</dd>` : ''}
      ${note ? `<dt>Note</dt><dd class="note-inline">${note}</dd>` : ''}
    </dl>
    <div id="bioBodyCallout" class="bio-callout" hidden></div>
  `;
}

// Mass code and boxel come straight from the ID64; for systems with an
// unknown primary, the mass code is the best hint at what the star is.
function boxelRows(system) {
  const boxel = decodeId64(system.id64);
  if (!boxel) return '';
  const unknownPrimary = !system.mainStar || system.mainStar === 'Unknown';
  const massText = unknownPrimary
    ? `${boxel.letter} · likely ${massCodeTypicalStars[boxel.massCode]}`
    : boxel.letter;
  const min = boxel.min;
  return [
    detailRow('Mass code', massText),
    detailRow('Boxel', `${boxel.cellEdge} ly cube from ${min.x.toLocaleString()}, ${min.y.toLocaleString()}, ${min.z.toLocaleString()}`),
  ].join('');
}

function detailRow(label, value) {
  if (value === undefined || value === null || value === '') return '';
  return `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`;
}

function compactNumber(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return number.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function bodyStations(body) {
  return Array.isArray(body?.stations) ? body.stations : [];
}

function bodyBadges(body, prediction = null) {
  const badges = [];
  if (prediction?.some((item) => item.basis === 'confirmed')) badges.push('High-value bio');
  else if (prediction?.some((item) => (item.probability ?? 0) >= 0.25)) badges.push('Likely high-value bio');
  if (body.type) badges.push(body.type);
  if (body.isLandable) badges.push('Landable');
  if (Array.isArray(body.rings) && body.rings.length) badges.push(`${body.rings.length} ring${body.rings.length === 1 ? '' : 's'}`);
  if (body.signals && Object.keys(body.signals).length) badges.push('Signals');
  const stations = bodyStations(body).length;
  if (stations) badges.push(`${stations} station${stations === 1 ? '' : 's'}`);
  return badges;
}

function stationHtml(station) {
  const services = Array.isArray(station.services) ? station.services : [];
  const marketCount = station.market?.commodities?.length ?? 0;
  const ships = station.shipyard?.ships?.length ?? 0;
  const modules = station.outfitting?.modules?.length ?? 0;
  return `
    <div class="station-row">
      <div>
        <strong>${escapeHtml(station.name ?? 'Unnamed station')}</strong>
        <span>${escapeHtml(station.type ?? 'Station')}</span>
      </div>
      <div class="station-facts">
        ${station.distanceToArrival !== undefined ? `<span>${escapeHtml(compactNumber(station.distanceToArrival))} ls</span>` : ''}
        ${marketCount ? `<span>${fmt(marketCount)} commodities</span>` : ''}
        ${ships ? `<span>${fmt(ships)} ships</span>` : ''}
        ${modules ? `<span>${fmt(modules)} modules</span>` : ''}
        ${services.length ? `<span>${fmt(services.length)} services</span>` : ''}
      </div>
    </div>
  `;
}

function bodyHtml(body, index, prediction = null) {
  const subtype = body.subType ?? body.type ?? 'Unknown body';
  const badges = bodyBadges(body, prediction);
  const materials = body.materials && typeof body.materials === 'object' ? Object.keys(body.materials).length : 0;
  const signals = body.signals && typeof body.signals === 'object' ? Object.keys(body.signals).length : 0;
  const stations = bodyStations(body);
  const details = [
    detailRow('Body ID', body.bodyId),
    detailRow('ID64', body.id64),
    detailRow('Distance', body.distanceToArrival !== undefined ? `${compactNumber(body.distanceToArrival)} ls` : null),
    detailRow('Spectral class', body.spectralClass),
    detailRow('Luminosity', body.luminosity),
    detailRow('Solar masses', compactNumber(body.solarMasses, 4)),
    detailRow('Solar radius', compactNumber(body.solarRadius, 4)),
    detailRow('Earth masses', compactNumber(body.earthMasses, 4)),
    detailRow('Gravity', body.gravity !== undefined ? `${compactNumber(body.gravity, 3)} g` : null),
    detailRow('Radius', body.radius !== undefined ? `${compactNumber(body.radius)} km` : null),
    detailRow('Temperature', body.surfaceTemperature !== undefined ? `${compactNumber(body.surfaceTemperature)} K` : null),
    detailRow('Atmosphere', body.atmosphereType),
    detailRow('Volcanism', body.volcanismType),
    detailRow('Terraforming', body.terraformingState),
    detailRow('Reserve', body.reserveLevel),
    detailRow('Orbital period', body.orbitalPeriod !== undefined ? `${compactNumber(body.orbitalPeriod)} days` : null),
    detailRow('Rotation period', body.rotationalPeriod !== undefined ? `${compactNumber(body.rotationalPeriod)} days` : null),
    detailRow('Axial tilt', compactNumber(body.axialTilt, 4)),
    detailRow('Materials', materials ? `${materials} recorded` : null),
    detailRow('Signals', signals ? `${signals} categories` : null),
    detailRow('Updated', body.updateTime ? localDateTime(body.updateTime) : null),
  ].join('');
  return `
    <details class="body-item"${index === 0 ? ' open' : ''}>
      <summary>
        <span class="body-ordinal">${escapeHtml(String(body.bodyId ?? index).padStart(2, '0'))}</span>
        <span class="body-title">
          <strong>${escapeHtml(body.name ?? `Body ${index + 1}`)}</strong>
          <small>${escapeHtml(subtype)}</small>
        </span>
        <span class="body-badges">${badges.map((badge) => `<i>${escapeHtml(badge)}</i>`).join('')}</span>
      </summary>
      <div class="body-detail">
        <dl>${details || '<dt>Details</dt><dd>No additional fields recorded</dd>'}</dl>
        ${prediction?.length ? `
          <div class="body-subsection">
            <span>High-value bio</span>
            <div class="bio-prediction">${prediction.map(bioPredictionRow).join('')}</div>
          </div>
        ` : ''}
        ${Array.isArray(body.rings) && body.rings.length ? `
          <div class="body-subsection">
            <span>Rings</span>
            ${body.rings.map((ring) => `<div class="ring-row"><strong>${escapeHtml(ring.name ?? ring.type ?? 'Ring')}</strong><small>${escapeHtml(ring.type ?? '')}</small></div>`).join('')}
          </div>
        ` : ''}
        ${stations.length ? `
          <div class="body-subsection">
            <span>Stations</span>
            ${stations.map(stationHtml).join('')}
          </div>
        ` : ''}
      </div>
    </details>
  `;
}

function renderBodiesError(message) {
  el.bodiesState.textContent = message;
  el.bodySystemSummary.hidden = true;
  el.bodyList.replaceChildren();
}

function renderRichSystem(data) {
  const system = data.system;
  const bodies = withLiveBodies(data, Array.isArray(system.bodies) ? system.bodies : []);
  const predictions = richBodyPredictions(data, bodies);
  const stations = Array.isArray(system.stations) ? system.stations : [];
  const totalStations = data.summary?.stationCount ?? stations.length + bodies.reduce((sum, body) => sum + bodyStations(body).length, 0);
  el.bodiesState.textContent = `${fmt(bodies.length)} recorded bodies · ${fmt(totalStations)} stations · ${data.segment?.kind ?? 'base'} data`;
  el.bodySystemSummary.hidden = false;
  el.bodySystemSummary.innerHTML = `
    <strong>${escapeHtml(system.name ?? state.selectedSystem?.name ?? 'Selected system')}</strong>
    <dl>
      ${detailRow('Population', system.population !== undefined ? fmt(system.population) : null)}
      ${detailRow('Allegiance', system.allegiance)}
      ${detailRow('Government', system.government)}
      ${detailRow('Security', system.security)}
      ${detailRow('Primary economy', system.primaryEconomy)}
      ${detailRow('Secondary economy', system.secondaryEconomy)}
      ${detailRow('Updated', system.date ? localDateTime(system.date) : null)}
    </dl>
    ${stations.length ? `<div class="system-stations"><span>System stations</span>${stations.map(stationHtml).join('')}</div>` : ''}
  `;
  el.bodyList.innerHTML = bodies.length
    ? bodies.map((body, index) => bodyHtml(body, index, predictions.get(body)?.prediction)).join('')
    : '<div class="section muted">No body records are available for this system.</div>';
}

// ---------- High-value bio ----------

function creditsText(value) {
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M cr`;
  if (value >= 1e3) return `${Math.round(value / 1e3)}k cr`;
  return `${Math.round(value)} cr`;
}

function percentText(value) {
  if (value >= 0.995) return '100%';
  if (value < 0.01) return '<1%';
  return `${Math.round(value * 100)}%`;
}

function updateBioAvailability(info) {
  const generatedAt = info?.generatedAt ?? null;
  if (generatedAt !== state.bio.generatedAt) {
    // A rebuilt map comes with new galaxy-wide rates for the body predictions.
    state.bio.model = null;
    state.bio.rates = null;
    state.bio.modelPromise = null;
  }
  state.bio.available = Boolean(info?.available);
  state.bio.generatedAt = generatedAt;
  state.bio.species = info?.species ?? [];
  el.bioOverlayToggle.disabled = !state.bio.available;
  el.bioHint.textContent = state.bio.available
    ? `Built ${localDateTime(generatedAt)} from ${fmt(info.systems)} systems with scanned bodies.`
    : 'Build the map once from Data > Build high-value bio map.';
  renderBioSpeciesList();
  loadBioOverlay();
}

function bioSpeciesSelected(species) {
  return state.bio.selected === null || state.bio.selected.has(species.key);
}

function renderBioSpeciesList() {
  const selectedCount = state.bio.species.filter(bioSpeciesSelected).length;
  el.bioSpeciesCount.textContent = state.bio.species.length ? `${selectedCount} of ${state.bio.species.length}` : '';
  el.bioSpeciesList.replaceChildren(...[...state.bio.species]
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
    .map((species) => {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = bioSpeciesSelected(species);
      input.addEventListener('change', () => {
        const next = new Set(state.bio.species.filter(bioSpeciesSelected).map((item) => item.key));
        if (input.checked) next.add(species.key);
        else next.delete(species.key);
        setBioSpecies(next.size === state.bio.species.length ? null : next);
      });
      const name = document.createElement('span');
      name.textContent = species.name;
      const value = document.createElement('small');
      value.textContent = `${(species.value / 1e6).toFixed(1)}M`;
      label.append(input, name, value);
      return label;
    }));
}

function setBioSpecies(selected) {
  state.bio.selected = selected;
  writeViewSettings({ bioSpecies: selected ? [...selected] : null });
  renderBioSpeciesList();
  loadBioOverlay();
  if (state.selectedSystem) loadBioCellDetail(state.selectedSystem);
}

// Comma-separated species keys for the API; empty means all of them.
function bioSpeciesQuery() {
  if (state.bio.selected === null) return '';
  return [...state.bio.selected].join(',');
}

let bioOverlayRequestId = 0;
let bioBandTimer = null;
const bioLayerLy = 320;

// The 320 ly layer (the bio map's cell row) holding height y.
function bioLayerOf(y) {
  return Math.floor((y + galaxyOrigin.y) / bioLayerLy);
}

function bioBandRange(layer, layers) {
  const half = (layers - 1) / 2;
  const min = (layer - half) * bioLayerLy - galaxyOrigin.y;
  return { min, max: min + layers * bioLayerLy };
}

// With a height band on, reload the map when the map target moves into
// another 320 ly layer.
function scheduleBioBandRefresh() {
  if (!state.bio.band || !el.bioOverlayToggle.checked || !state.renderer) return;
  if (bioLayerOf(state.renderer.targetCoords().y) === state.bio.bandLayer) return;
  clearTimeout(bioBandTimer);
  bioBandTimer = setTimeout(loadBioOverlay, 250);
}

async function loadBioOverlay() {
  const requestId = ++bioOverlayRequestId;
  const renderer = state.renderer;
  const nothingSelected = state.bio.selected !== null && state.bio.selected.size === 0;
  if (!renderer || !el.bioOverlayToggle.checked || !state.bio.available || nothingSelected) {
    renderer?.setBioOverlay(null);
    el.bioLegend.hidden = true;
    return;
  }
  const params = new URLSearchParams({ level: String(state.bio.level) });
  const species = bioSpeciesQuery();
  if (species) params.set('species', species);
  let bandText = 'Each square averages every height in its column.';
  if (state.bio.band) {
    const y = renderer.targetCoords().y;
    state.bio.bandLayer = bioLayerOf(y);
    const range = bioBandRange(state.bio.bandLayer, state.bio.band);
    params.set('band', String(state.bio.band));
    params.set('y', String(y));
    bandText = `Heights ${fmt(range.min)} to ${fmt(range.max)} ly, around the map target. Moves with the grid plane.`;
  }
  try {
    const response = await fetch(`/api/bio-targets?${params.toString()}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const image = parseBioOverlay(await response.arrayBuffer());
    if (requestId !== bioOverlayRequestId) return;
    renderer.setBioOverlay(image);
    el.bioBandHint.textContent = image ? bandText : `${bandText} No scanned systems at these heights.`;
    el.bioLegend.hidden = !image;
    if (image) el.bioLegendMax.textContent = `Top 10%: ${creditsText(image.topTenthCredits)}+ / system`;
  } catch (error) {
    console.warn(error);
    setStatus(`High-value bio map unavailable: ${error.message}`);
  }
}

let bioCellRequestId = 0;

async function loadBioCellDetail(system) {
  const target = () => el.selected.querySelector('#bioCellDetail');
  if (!state.bio.available || !system?.coords || !target()) return;
  const requestId = ++bioCellRequestId;
  const params = new URLSearchParams({ x: String(system.coords.x), y: String(system.coords.y), z: String(system.coords.z) });
  const species = bioSpeciesQuery();
  if (species) params.set('species', species);
  try {
    const response = await api(`/api/bio-targets/cell?${params.toString()}`);
    const data = await response.json();
    if (requestId !== bioCellRequestId || !target()) return;
    target().innerHTML = bioCellHtml(data);
  } catch (error) {
    if (requestId === bioCellRequestId && target()) target().textContent = `Unavailable: ${error.message}`;
  }
}

// The 320 ly boxel when it has enough fully scanned systems to judge by,
// otherwise its 1,280 ly sector.
function bioCellHtml(data) {
  if (!data.available) return 'Not built yet';
  const boxel = data.levels[320];
  const sector = data.levels[1280];
  const pick = boxel.basis === 'complete' || !sector.systems ? boxel : sector;
  if (!pick.systems) return 'No scanned systems here yet';
  const area = pick === boxel ? '320 ly boxel' : '1,280 ly sector';
  const sample = pick.basis === 'complete'
    ? `${fmt(pick.completeSystems)} fully scanned systems`
    : `${fmt(pick.systems)} partly scanned systems, rough`;
  const summary = `≈${creditsText(pick.creditsPerSystem)} per scanned system · ${percentText(pick.chancePerSystem)} hold one (${area}, ${sample})`;
  const top = pick.species.filter((item) => item.finds >= 0.05).slice(0, 3);
  const rows = top.map((item) => {
    const candidates = Math.round(item.mapped + item.unmapped);
    const title = `${fmt(candidates)} candidate bodies (${fmt(Math.round(item.mapped))} DSS-mapped). The chance is how often a candidate body has it.`;
    return `<div title="${escapeHtml(title)}"><span>${escapeHtml(item.name)}</span><span>${escapeHtml(percentText(item.rate))}</span><span>${escapeHtml(creditsText(item.value))}</span></div>`;
  }).join('');
  return `<span>${escapeHtml(summary)}</span>${rows ? `<div class="bio-prediction">${rows}</div>` : ''}`;
}

async function ensureBioModel() {
  if (state.bio.model) return state.bio.model;
  state.bio.modelPromise ??= fetch('/api/bio-model')
    .then(async (response) => {
      if (!response.ok) return null;
      const payload = await response.json();
      state.bio.model = payload.model;
      state.bio.rates = payload.rates;
      return payload.model;
    })
    .catch(() => null);
  return state.bio.modelPromise;
}

const bioBasisText = {
  confirmed: 'Scanned',
  genus: 'Genus found by DSS',
  signals: 'Bio signals, genus unknown',
  conditions: 'Conditions only',
};

function bioPredictionRow(item) {
  const chance = item.probability === null ? 'possible' : item.basis === 'confirmed' ? 'found' : percentText(item.probability);
  const title = `${bioBasisText[item.basis] ?? item.basis}; ${percentText(item.share)} of this genus's possible species here`;
  return `<div title="${escapeHtml(title)}"><span class="${item.basis === 'confirmed' ? 'confirmed' : ''}">${escapeHtml(item.name)}</span><span>${escapeHtml(chance)}</span><span>${escapeHtml(creditsText(item.value))}</span></div>`;
}

function liveSystemFor(data) {
  const snapshot = state.live.snapshot;
  if (!snapshot?.current) return null;
  const sameAddress = data.id64 !== undefined && String(data.id64) === snapshot.current.systemAddress;
  const sameName = systemKey(data.system?.name) === systemKey(snapshot.current.systemName);
  return sameAddress || sameName ? snapshot : null;
}

// Planets the live journal has scanned that the saved data does not hold yet.
function withLiveBodies(data, bodies) {
  const live = liveSystemFor(data);
  if (!live) return bodies;
  const known = new Set(bodies.map((body) => body.bodyId));
  const extra = live.bodies
    .filter((body) => body.scan && !known.has(body.bodyId))
    .map(({ scan }) => ({
      bodyId: scan.BodyID,
      name: scan.BodyName,
      type: 'Planet',
      subType: scan.PlanetClass,
      isLandable: scan.Landable === true,
      gravity: Number.isFinite(scan.SurfaceGravity) ? scan.SurfaceGravity / 9.80665 : undefined,
      surfaceTemperature: scan.SurfaceTemperature,
      atmosphereType: scan.Atmosphere || scan.AtmosphereType,
      volcanismType: scan.Volcanism,
      distanceToArrival: scan.DistanceFromArrivalLS,
      source: 'Live journal',
    }));
  return extra.length ? [...bodies, ...extra].sort((a, b) => (a.bodyId ?? 0) - (b.bodyId ?? 0)) : bodies;
}

function richBodyPredictions(data, bodies) {
  const out = new Map();
  const model = state.bio.model;
  if (!model) return out;
  const live = liveSystemFor(data);
  const system = { bodies, region: data.region ?? live?.current?.region ?? null };
  for (const body of bodies) {
    if (body.type === 'Star') continue;
    const liveBody = live?.bodies.find((item) => item.bodyId === body.bodyId);
    let normalised;
    if (liveBody?.scan) {
      normalised = normaliseJournalBody(liveBody.scan, {
        stars: live.stars,
        region: system.region,
        genuses: liveBody.genuses,
        bioCount: liveBody.bioCount,
        speciesFound: liveBody.speciesFound,
      });
    } else {
      normalised = normaliseSpanshBody(body, system);
      if (liveBody) {
        normalised.genuses = liveBody.genuses ?? normalised.genuses;
        normalised.bioCount = liveBody.bioCount ?? normalised.bioCount;
        normalised.speciesFound = liveBody.speciesFound ?? [];
      }
    }
    const prediction = bodyPrediction(model, normalised, state.bio.rates);
    if (prediction.length) out.set(body, { prediction, bioCount: normalised.bioCount, genuses: normalised.genuses });
  }
  return out;
}

// Bodies with biological signals that could be one of the tracked species,
// for the system details.
function bioBodyCalloutHtml(data) {
  const bodies = withLiveBodies(data, Array.isArray(data.system?.bodies) ? data.system.bodies : []);
  const predictions = richBodyPredictions(data, bodies);
  const systemName = String(data.system?.name ?? '');
  const rows = [];
  for (const body of bodies) {
    const entry = predictions.get(body);
    if (!entry || !(entry.bioCount > 0 || entry.genuses?.length)) continue;
    const best = Math.max(...entry.prediction.map((item) => (item.probability ?? 0) * item.value));
    rows.push({ body, entry, best });
  }
  if (!rows.length) return '';
  rows.sort((a, b) => b.best - a.best);
  const items = rows.map(({ body, entry }) => {
    const name = String(body.name ?? `Body ${body.bodyId}`);
    const shortName = systemName && name.startsWith(systemName) ? name.slice(systemName.length).trim() || name : name;
    const facts = [
      entry.bioCount > 0 ? `${entry.bioCount} bio signal${entry.bioCount === 1 ? '' : 's'}` : 'genus mapped',
      Number.isFinite(body.distanceToArrival) ? `${Math.round(body.distanceToArrival).toLocaleString()} ls` : null,
    ].filter(Boolean).join(' · ');
    return `
      <div class="bio-callout-body">
        <div class="bio-callout-name"><strong title="${escapeHtml(name)}">${escapeHtml(shortName)}</strong><small>${escapeHtml(facts)}</small></div>
        <div class="bio-prediction">${entry.prediction.map(bioPredictionRow).join('')}</div>
      </div>`;
  }).join('');
  return `<div class="bio-callout-title">High-value bio signals</div>${items}`;
}

function renderBioBodyCallout(data) {
  const target = el.selected.querySelector('#bioBodyCallout');
  if (!target) return;
  const html = data && state.bio.model ? bioBodyCalloutHtml(data) : '';
  target.innerHTML = html;
  target.hidden = !html;
}

let bioCalloutRequestId = 0;

async function loadBioBodyCallout(system) {
  const requestId = ++bioCalloutRequestId;
  try {
    const [data] = await Promise.all([fetchRichSystem(system), ensureBioModel()]);
    if (requestId !== bioCalloutRequestId || state.selectedSystem !== system) return;
    state.richSystem ??= data;
    renderBioBodyCallout(data);
  } catch {
    // No body records for this system: nothing to call out.
  }
}

// ---------- Live journal ----------

function connectLive() {
  if (!('EventSource' in window) || state.live.source) return;
  const source = new EventSource('/api/live');
  state.live.source = source;
  source.addEventListener('status', (event) => updateLiveStatus(JSON.parse(event.data)));
  source.addEventListener('snapshot', (event) => {
    state.live.snapshot = JSON.parse(event.data);
    onLiveUpdate({ type: 'snapshot' });
  });
  source.addEventListener('change', (event) => applyLiveChange(JSON.parse(event.data)));
  source.addEventListener('saved', (event) => finishLiveJournalScan(JSON.parse(event.data)));
  // EventSource reconnects on its own; show the indicator as idle meanwhile.
  source.addEventListener('error', () => el.liveIndicator.classList.add('idle'));
}

function updateLiveStatus(status) {
  if (!status) return;
  state.live.enabled = Boolean(status.enabled);
  state.live.running = Boolean(status.running);
  el.liveJournalToggle.checked = state.live.enabled;
  el.liveIndicator.hidden = !state.live.enabled;
  el.liveAutoTarget.hidden = !state.live.enabled;
  el.liveIndicator.classList.toggle('idle', !state.live.running);
  el.liveJournalStatus.textContent = !state.live.enabled
    ? 'Off: use Scan latest journals to refresh by hand.'
    : state.live.running
      ? `Following ${status.file ?? 'the newest journal'}.`
      : 'Waiting for a journal file.';
}

function upsertBy(list, item, matches) {
  const index = list.findIndex(matches);
  if (index >= 0) list[index] = item;
  else list.push(item);
}

function applyLiveChange(change) {
  state.live.snapshot ??= { current: null, fss: null, stars: [], bodies: [] };
  const snapshot = state.live.snapshot;
  if (change.type === 'location') {
    change.systemChanged = snapshot.current?.systemAddress !== change.current.systemAddress;
    if (change.systemChanged) {
      snapshot.stars = [];
      snapshot.bodies = [];
      snapshot.fss = null;
    }
    snapshot.current = change.current;
  } else if (change.type === 'star') {
    upsertBy(snapshot.stars, change.star, (star) => star.BodyID === change.star.BodyID);
  } else if (change.type === 'body') {
    upsertBy(snapshot.bodies, change.body, (body) => body.bodyId === change.body.bodyId);
  } else if (change.type === 'status') {
    snapshot.fss = change.fss;
  }
  onLiveUpdate(change);
}

// Auto targeting: move the target and selection to the system the journal
// says you are in.
function targetLiveSystem() {
  const current = state.live.snapshot?.current;
  if (!current?.systemName || !current.starPos) return;
  const coords = { x: current.starPos[0], y: current.starPos[1], z: current.starPos[2] };
  searchLatestSystem(current.systemName, true).then((found) => {
    if (found) return;
    focusSystem(current.systemName, coords);
    state.renderer.setSelectedSystem({ name: current.systemName, coords, mainStar: 'Unknown', visited: true });
  });
}

function setAutoTarget(enabled) {
  state.live.follow = enabled;
  el.liveFollowToggle.checked = enabled;
  el.liveAutoTarget.setAttribute('aria-pressed', String(enabled));
  el.liveAutoTarget.title = enabled
    ? 'Auto targeting on: the target moves to each new journal system'
    : 'Auto targeting off: the target stays where you put it';
}

function isSelectedLiveSystem() {
  const current = state.live.snapshot?.current;
  const selected = state.selectedSystem;
  if (!current || !selected) return false;
  return String(selected.id64) === current.systemAddress || systemKey(selected.name) === systemKey(current.systemName);
}

let liveBodiesTimer = null;

// The live journal's current system in the shape of the saved latest system.
function liveLatestSystem() {
  const current = state.live.snapshot?.current;
  if (!current?.systemName || !current.starPos) return null;
  return {
    name: current.systemName,
    key: systemKey(current.systemName),
    timestamp: current.arrivedAt,
    systemAddress: current.systemAddress,
    coords: { x: current.starPos[0], y: current.starPos[1], z: current.starPos[2] },
  };
}

// Whichever of two latest-system records is more recent.
function newerLatestSystem(saved, live) {
  if (!live) return saved;
  if (!saved) return live;
  if (systemKey(saved.name) === systemKey(live.name)) return { ...live, ...saved, coords: saved.coords ?? live.coords };
  return String(live.timestamp ?? '') >= String(saved.timestamp ?? '') ? live : saved;
}

function onLiveUpdate(change) {
  const current = state.live.snapshot?.current;
  if (change.type === 'location' || change.type === 'snapshot') {
    state.latestJournal = newerLatestSystem(state.latestJournal, liveLatestSystem());
    if (el.routeBar && state.routeOverlay) renderRouteBar();
  }
  if (current?.starPos) {
    const coords = { x: current.starPos[0], y: current.starPos[1], z: current.starPos[2] };
    state.renderer?.setCommanderLocation({ name: current.systemName, coords });
    el.liveIndicator.title = `Following your journal live · ${current.systemName}`;
    if (change.type === 'location' && change.systemChanged && state.live.follow) targetLiveSystem();
  }
  if (change.type === 'body' && change.organic?.species) {
    setStatus(`Logged ${change.organic.species} on ${change.body.name ?? 'a body'}.`);
  }
  if (isSelectedLiveSystem() && state.richSystem) {
    clearTimeout(liveBodiesTimer);
    liveBodiesTimer = setTimeout(() => {
      if (!isSelectedLiveSystem() || !state.richSystem) return;
      renderRichSystem(state.richSystem);
      renderBioBodyCallout(state.richSystem);
    }, 300);
  }
}

// A save triggered by the live follower: refresh what changed without moving
// the map or the selection.
async function finishLiveJournalScan(scan) {
  if (scan.id && scan.id === state.live.lastSavedId) return;
  state.live.lastSavedId = scan.id;
  setWriteActivity('scan', false);
  setJournalButtonsDisabled(false);
  if (!scan.ok) {
    setJournalScanPanel(scan, { message: `Live save failed: ${scan.message ?? 'see the server log'}`, failed: true });
    return;
  }
  const priorSupplementalCount = state.visited?.supplementalCount ?? 0;
  await loadStatus();
  systemCache.clear();
  richSystemCache.clear();
  const supplementalChanged = (state.visited?.supplementalCount ?? 0) !== priorSupplementalCount;
  await (supplementalChanged ? loadPoints({ background: true }) : applyVisitedIndexUpdate()).catch((error) => {
    if (!isAbortError(error)) console.warn(error);
  });
  setJournalScanPanel(scan, { message: scan.message || 'Live journal saved.', processing: false });
}

// Full body data for a system, from the cache or /api/system-rich. The system
// you are in now may not be saved anywhere yet; then it is an empty record that
// the live journal's bodies fill in.
async function fetchRichSystem(selected) {
  const key = `${selected.id64 ?? ''}:${selected.name ?? ''}`;
  const cached = richSystemCache.get(key);
  if (cached) return cached;
  try {
    const params = new URLSearchParams();
    if (selected.id64) params.set('id64', String(selected.id64));
    if (selected.name) params.set('name', selected.name);
    if (selected.coords) {
      params.set('x', String(selected.coords.x));
      params.set('z', String(selected.coords.z));
    }
    const response = await api(`/api/system-rich?${params.toString()}`);
    const data = await response.json();
    richSystemCache.set(key, data);
    if (richSystemCache.size > 24) richSystemCache.delete(richSystemCache.keys().next().value);
    return data;
  } catch (error) {
    const current = state.live.snapshot?.current;
    if (current && systemKey(current.systemName) === systemKey(selected.name)) {
      return { id64: current.systemAddress, region: current.region, segment: { kind: 'live journal' }, system: { name: current.systemName, bodies: [] } };
    }
    throw error;
  }
}

async function loadSelectedBodies() {
  const selected = state.selectedSystem;
  if (!selected?.id64 && !selected?.name) {
    renderBodiesError('Select a system to view its body data.');
    return;
  }
  const requestId = ++richSystemRequestId;
  el.bodiesState.textContent = `Loading full data for ${selected.name}...`;
  el.bodySystemSummary.hidden = true;
  el.bodyList.replaceChildren();
  try {
    const [data] = await Promise.all([fetchRichSystem(selected), ensureBioModel()]);
    if (requestId !== richSystemRequestId) return;
    state.richSystem = data;
    renderRichSystem(data);
  } catch (error) {
    if (requestId !== richSystemRequestId) return;
    renderBodiesError(error.message.includes('Not Found')
      ? 'No full body record was found for this system.'
      : `Could not load body data: ${error.message}`);
  }
}

// Place descriptions come from third-party lists and some carry HTML links.
// Parse them inertly (a <template> runs no scripts and loads nothing), then
// keep only the text and plain http(s) links.
function safeDescriptionHtml(value) {
  const template = document.createElement('template');
  template.innerHTML = String(value ?? '');
  const parts = [];
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(escapeHtml(node.textContent));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.tagName === 'A') {
      let href = null;
      try {
        const url = new URL(node.getAttribute('href') ?? '');
        if (url.protocol === 'https:' || url.protocol === 'http:') href = url.href;
      } catch {
        href = null;
      }
      const text = escapeHtml(node.textContent || href || '');
      parts.push(href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${text}</a>` : text);
      return;
    }
    if (node.tagName === 'BR') {
      parts.push('<br>');
      return;
    }
    for (const child of node.childNodes) walk(child);
  };
  for (const child of template.content.childNodes) walk(child);
  return parts.join('');
}

function selectedPlaceHtml(place) {
  const distance = distanceLy(state.focus?.coords, place.coords);
  return `
    <h2>${escapeHtml(place.name)}</h2>
    <div class="muted">${escapeHtml(place.category ?? 'Place of interest')}</div>
    <dl>
      <dt>Coords</dt><dd>${coordsText(place.coords)}</dd>
      <dt>System</dt><dd>${escapeHtml(place.systemName ?? 'Unknown')}</dd>
      ${place.stale ? `<dt>Status</dt><dd>Last known position. Latest journal system is ${escapeHtml(place.unresolvedSystemName ?? 'unknown')}.</dd>` : ''}
      <dt>Source</dt><dd>${escapeHtml(place.source ?? 'Unknown')}</dd>
      <dt>Group</dt><dd>${escapeHtml(place.sourceGroup ?? 'Unknown')}</dd>
      <dt>Type</dt><dd>${escapeHtml(place.typeLabel ?? place.type ?? 'Unknown')}</dd>
      <dt>Distance</dt><dd>${distance === null ? 'Unknown' : `${fmt(distance)} ly from focus`}</dd>
      ${place.description ? `<dt>Notes</dt><dd>${safeDescriptionHtml(place.description)}</dd>` : ''}
    </dl>
  `;
}

async function selectSystem(index, focus = true) {
  const response = await api(`/api/system?index=${index}`);
  const system = await response.json();
  setCachedSystem(index, system);
  state.selectedSystem = system;
  state.richSystem = null;
  richSystemRequestId += 1;
  renderBodiesError('Open the Bodies tab to load full system data.');
  el.selected.classList.remove('empty');
  el.selected.innerHTML = selectedHtml(system);
  loadBioCellDetail(system);
  loadBioBodyCallout(system);
  state.renderer.setSelectedSystem(system);
  if (focus) focusSystem(system.name, system.coords);
  setInspectorTab('system');
}

function setCachedSystem(index, system) {
  systemCache.set(index, { system, cachedAt: Date.now() });
  pruneSystemCache();
}

function refreshCachedSystemNote(note) {
  if (!state.activeNoteSystem) return;
  const key = systemKey(state.activeNoteSystem.name);
  for (const [index, entry] of systemCache) {
    if (systemKey(entry.system?.name) === key) {
      systemCache.set(index, {
        ...entry,
        system: {
          ...entry.system,
          note,
        },
        cachedAt: Date.now(),
      });
    }
  }
}

function getCachedSystem(index) {
  const entry = systemCache.get(index);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > tooltipCacheTtlMs) {
    systemCache.delete(index);
    return null;
  }
  systemCache.delete(index);
  systemCache.set(index, entry);
  return entry.system;
}

function pruneSystemCache() {
  const now = Date.now();
  for (const [index, entry] of systemCache) {
    if (now - entry.cachedAt > tooltipCacheTtlMs) systemCache.delete(index);
  }
  while (systemCache.size > tooltipCacheLimit) {
    const oldest = systemCache.keys().next().value;
    systemCache.delete(oldest);
  }
}

function hideTooltip() {
  tooltipOwner = null;
  el.tooltip.hidden = true;
  el.tooltip.classList.remove('loading');
  el.tooltip.textContent = '';
}

function positionTooltip(x, y) {
  const viewport = el.tooltip.parentElement.getBoundingClientRect();
  const tooltip = el.tooltip.getBoundingClientRect();
  const left = Math.min(viewport.width - tooltip.width - 10, x + 14);
  const top = Math.max(10, Math.min(viewport.height - tooltip.height - 10, y - tooltip.height - 10));
  el.tooltip.style.left = `${left}px`;
  el.tooltip.style.top = `${top}px`;
}

function showTooltipLoading(hover) {
  tooltipOwner = 'system';
  el.tooltip.classList.add('loading');
  el.tooltip.textContent = 'Loading system...';
  el.tooltip.hidden = false;
  positionTooltip(hover.x, hover.y);
}

async function showTooltip(hover) {
  if (hover?.kind === 'route') {
    hoverRequestId += 1;
    clearTimeout(hoverFetchTimer);
    pendingTooltipIndex = null;
    pendingTooltipHover = null;
    renderRouteTooltip(hover.hop, hover.x, hover.y);
    return;
  }
  if (!hover || !Number.isInteger(hover.index) || hover.index < 0) {
    hoverRequestId += 1;
    clearTimeout(hoverFetchTimer);
    pendingTooltipIndex = null;
    pendingTooltipHover = null;
    if (tooltipOwner === 'system' || tooltipOwner === 'route') hideTooltip();
    return;
  }
  const cached = getCachedSystem(hover.index);
  if (cached) {
    hoverRequestId += 1;
    clearTimeout(hoverFetchTimer);
    pendingTooltipIndex = null;
    pendingTooltipHover = null;
    renderTooltip(cached, hover.x, hover.y);
    return;
  }
  pendingTooltipHover = hover;
  if (pendingTooltipIndex === hover.index && hoverFetchTimer) return;
  const requestId = ++hoverRequestId;
  pendingTooltipIndex = hover.index;
  clearTimeout(hoverFetchTimer);
  showTooltipLoading(hover);
  const wait = Math.max(0, tooltipFetchDelayMs - (Date.now() - lastHoverFetchAt));
  hoverFetchTimer = setTimeout(() => {
    const nextHover = pendingTooltipHover ?? hover;
    hoverFetchTimer = null;
    pendingTooltipIndex = null;
    pendingTooltipHover = null;
    fetchTooltipSystem(nextHover, requestId);
  }, wait);
}

async function fetchTooltipSystem(hover, requestId) {
  lastHoverFetchAt = Date.now();
  try {
    const response = await api(`/api/system?index=${hover.index}`);
    const system = await response.json();
    setCachedSystem(hover.index, system);
    if (requestId === hoverRequestId) renderTooltip(system, hover.x, hover.y);
  } catch {
    if (requestId === hoverRequestId) hideTooltip();
  }
}

function renderTooltip(system, x, y) {
  tooltipOwner = 'system';
  const distance = distanceLy(state.focus?.coords, system.coords);
  const starType = compactStarType(system.mainStar);
  const typeText = starType ? ` · ${starType}` : '';
  const note = system.note?.text ? `\n${notePreview(system.note.text, 180)}` : '';
  el.tooltip.classList.remove('loading');
  el.tooltip.textContent = distance === null
    ? `${system.name}${typeText}${note}`
    : `${system.name}${typeText} · ${fmt(distance)} ly${note}`;
  el.tooltip.hidden = false;
  positionTooltip(x, y);
}

function renderRouteTooltip(hop, x, y) {
  tooltipOwner = 'route';
  const starClass = compactStarType(hop?.starClass);
  const starText = starClass ? ` · ${starClass}` : '';
  const hopText = `Hop ${Number(hop?.routeIndex ?? 0) + 1}`;
  const distanceText = hop?.hopDistanceLy
    ? ` · ${fmt(hop.hopDistanceLy)} ly hop`
    : ' · route start';
  const cumulativeText = hop?.cumulativeDistanceLy
    ? ` · ${fmt(hop.cumulativeDistanceLy)} ly total`
    : '';
  el.tooltip.classList.remove('loading');
  el.tooltip.textContent = `${hop?.name ?? 'Route point'}${starText}\n${hopText}${distanceText}${cumulativeText}\nTemporary route point`;
  el.tooltip.hidden = false;
  positionTooltip(x, y);
}

function focusSystem(name, coords) {
  state.focus = { name, coords };
  el.focusName.textContent = name;
  el.focusCoords.textContent = coordsText(coords);
  state.renderer.setTarget(coords.x, coords.y, coords.z);
}

// The in-game style route strip: where you are, the next jump, how many
// jumps remain, and the destination. Progress follows the latest journal
// system along NavRoute.json.
function routeProgress(route, latestName) {
  const name = String(latestName ?? '').toLowerCase();
  const found = name ? route.findIndex((hop) => String(hop.name).toLowerCase() === name) : -1;
  const current = Math.max(0, found);
  const remainingLy = Number(route.at(-1)?.cumulativeDistanceLy ?? 0) - Number(route[current]?.cumulativeDistanceLy ?? 0);
  return {
    current,
    next: route[current + 1] ?? null,
    destination: route.at(-1) ?? null,
    jumps: Math.max(0, route.length - 1 - current),
    remainingLy: Math.max(0, remainingLy),
  };
}

function renderRouteBar() {
  const route = state.routeOverlay?.route ?? [];
  const visible = el.routeToggle.checked && route.length >= 2;
  el.routeBar.hidden = !visible;
  el.routeBar.replaceChildren();
  if (!visible) return;
  const progress = routeProgress(route, state.latestJournal?.name);
  const cell = (kicker, hop, detail, tone = '') => {
    const element = document.createElement(hop ? 'button' : 'div');
    element.className = `route-bar-cell ${tone}`.trim();
    if (hop) {
      element.type = 'button';
      element.title = `Focus ${hop.name}`;
      element.addEventListener('click', () => focusRouteHop(hop));
    }
    const label = document.createElement('small');
    label.textContent = kicker;
    const value = document.createElement('strong');
    value.textContent = hop?.name ?? detail;
    element.append(label, value);
    if (hop && detail) {
      const extra = document.createElement('span');
      extra.textContent = detail;
      element.append(extra);
    }
    return element;
  };
  const arrow = (extra = '') => {
    const element = document.createElement('span');
    element.className = `route-bar-arrow ${extra}`.trim();
    element.textContent = '›';
    element.setAttribute('aria-hidden', 'true');
    return element;
  };
  const next = progress.next;
  const nextDetail = next
    ? `${Number(next.hopDistanceLy ?? 0).toFixed(2)} ly${next.starClass ? ` · ${next.starClass}${next.scoopable ? ' · scoopable' : ''}` : ''}`
    : '';
  el.routeBar.append(
    cell('Current system', route[progress.current], ''),
    arrow(),
    next ? cell('Next jump', next, nextDetail, 'next') : cell('Next jump', null, 'Arrived'),
    arrow('jumps'),
    cell('Jumps left', null, `${progress.jumps} · ${progress.remainingLy.toLocaleString(undefined, { maximumFractionDigits: 1 })} ly`, 'jumps'),
    arrow(),
    cell('Destination', progress.destination, '', 'destination'),
  );
}

function focusRouteHop(hop) {
  if (!hop?.coords) return;
  focusSystem(hop.name, hop.coords);
  setStatus(`Focused temporary route point: ${hop.name}`);
}

function routeSignature(payload) {
  if (!payload?.available || !Array.isArray(payload.route)) {
    return `unavailable:${payload?.event ?? ''}:${payload?.timestamp ?? ''}:${payload?.warnings?.[0] ?? ''}`;
  }
  return payload.route
    .map((hop) => [
      hop.id64 ?? '',
      hop.name ?? '',
      hop.starClass ?? '',
      hop.coords?.x ?? '',
      hop.coords?.y ?? '',
      hop.coords?.z ?? '',
    ].join(':'))
    .join('|');
}

function isTransientRouteUnavailable(payload) {
  const warning = String(payload?.warnings?.[0] ?? '').toLowerCase();
  return warning.includes('could not read navroute.json')
    || warning.includes('unexpected end of json')
    || warning.includes('unterminated')
    || warning.includes('is empty');
}

function routeStatusMessage(data) {
  const warningText = data.warnings?.length ? ` · ${data.warnings.length} warning${data.warnings.length === 1 ? '' : 's'}` : '';
  return `Route displayed: ${fmt(data.route.length)} hops · ${fmt(data.totalDistanceLy)} ly${warningText}`;
}

async function refreshRouteOverlay(options = {}) {
  const manual = options.manual !== false;
  const auto = options.auto === true;
  if (manual) {
    el.refreshRoute.disabled = true;
    setStatus('Reading current nav route...');
  }
  try {
    const response = await api('/api/nav-route');
    const data = await response.json();
    const signature = routeSignature(data);
    const changed = signature !== routeOverlaySignature;
    if (!data.available || !Array.isArray(data.route) || data.route.length === 0) {
      if (auto && state.routeOverlay && isTransientRouteUnavailable(data)) return false;
      if (auto && !changed) return false;
      state.routeOverlay = null;
      routeOverlaySignature = signature;
      state.renderer.setRouteOverlay(null);
      renderRouteBar();
      if (manual || auto) setStatus(data.warnings?.[0] ?? 'No active route is available.');
      return changed;
    }
    if (auto && !changed) return false;
    state.routeOverlay = data;
    routeOverlaySignature = signature;
    el.routeToggle.checked = true;
    state.renderer.showRouteOverlay = true;
    state.renderer.setRouteOverlay(data);
    renderRouteBar();
    writeViewSettings({ showRouteOverlay: true });
    setStatus(
      routeStatusMessage(data),
      data.warnings?.join('\n') || 'Temporary route points are drawn from NavRoute.json.'
    );
    startRouteAutoRefresh();
    return changed;
  } catch (error) {
    if (auto && state.routeOverlay) return false;
    state.routeOverlay = null;
    routeOverlaySignature = null;
    state.renderer.setRouteOverlay(null);
    setStatus(`Route overlay failed: ${error.message}`);
    return false;
  } finally {
    if (manual) el.refreshRoute.disabled = false;
  }
}

function shouldAutoRefreshRoute() {
  return Boolean(el.routeToggle?.checked) && document.visibilityState !== 'hidden';
}

function stopRouteAutoRefresh() {
  clearTimeout(routePollTimer);
  routePollTimer = null;
}

function scheduleRouteAutoRefresh(delayMs = routePollMs) {
  stopRouteAutoRefresh();
  if (!shouldAutoRefreshRoute()) return;
  routePollTimer = setTimeout(() => {
    pollRouteOverlay().catch((error) => console.warn(error));
  }, delayMs);
}

async function pollRouteOverlay() {
  if (!shouldAutoRefreshRoute()) {
    stopRouteAutoRefresh();
    return;
  }
  if (routePollInFlight) {
    scheduleRouteAutoRefresh(routePollMs);
    return;
  }
  routePollInFlight = true;
  try {
    await refreshRouteOverlay({ manual: false, auto: true });
  } finally {
    routePollInFlight = false;
    scheduleRouteAutoRefresh(routePollMs);
  }
}

function startRouteAutoRefresh({ immediate = false } = {}) {
  if (!shouldAutoRefreshRoute()) {
    stopRouteAutoRefresh();
    return;
  }
  scheduleRouteAutoRefresh(immediate ? 0 : routePollMs);
}

function carrierDisplayName(carrierLocation = state.carrierLocation) {
  const label = state.trackedCarrier?.label
    ?? carrierLocation?.name
    ?? carrierLocation?.callsign
    ?? 'Tracked carrier';
  return carrierLocation?.stale ? `${label} [last known]` : label;
}

function trackedCarrierNames() {
  return [
    state.trackedCarrier?.label,
    state.trackedCarrier?.name,
    state.trackedCarrier?.callsign,
    state.carrierLocation?.name,
    state.carrierLocation?.callsign,
  ].filter(Boolean).map((value) => systemKey(value));
}

function isTrackedCarrierPlace(place) {
  const names = trackedCarrierNames();
  return names.length > 0 && [place?.name, place?.baseName, place?.callsign]
    .filter(Boolean)
    .some((value) => names.includes(systemKey(value)));
}

function trackedCarrierFallbackPlace() {
  const coords = state.trackedCarrier?.fallbackCoords;
  if (!coords) return null;
  const name = carrierDisplayName(null);
  return {
    name,
    shortName: name,
    coords,
    color: '#b6ff00',
    hideWhenPlaceLabelVisible: true,
  };
}

function carrierPlaceFromJournal(fallbackPlace = null) {
  const carrier = state.carrierLocation;
  const coords = carrier?.coords ?? (carrier?.stale ? fallbackPlace?.coords : null);
  if (!carrier || !coords) return null;
  const staleNote = carrier.stale
    ? `Latest journal carrier system is ${carrier.unresolvedSystemName ?? carrier.systemName ?? 'unknown'}, which is not in the local system data. Showing last known position from ${carrier.lastKnownSystemName ?? fallbackPlace?.systemName ?? 'unknown'}.`
    : `Resolved from player journal ${localDateTime(carrier.timestamp)}.`;
  return {
    id: 'tracked-carrier-journal',
    name: carrierDisplayName(carrier),
    baseName: state.trackedCarrier?.label ?? carrier.name ?? carrier.callsign,
    category: 'Fleet Carriers',
    source: 'Player Journal',
    sourceGroup: 'Player Journal',
    type: 'carrier',
    typeLabel: carrier.stale ? 'Fleet Carrier [last known]' : 'Fleet Carrier',
    coords,
    systemName: carrier.stale ? carrier.lastKnownSystemName ?? fallbackPlace?.systemName : carrier.systemName,
    unresolvedSystemName: carrier.unresolvedSystemName,
    stale: Boolean(carrier.stale),
    description: staleNote,
    updatedAt: carrier.timestamp,
  };
}

function applyCarrierOverride(places) {
  const fallbackPlace = places.find(isTrackedCarrierPlace);
  const carrier = carrierPlaceFromJournal(fallbackPlace);
  if (!carrier) return places;
  return [
    ...places.filter((place) => !isTrackedCarrierPlace(place)),
    carrier,
  ];
}

function currentCarrierTarget() {
  return state.places.find(isTrackedCarrierPlace)
    ?? carrierPlaceFromJournal()
    ?? trackedCarrierFallbackPlace();
}

function focusPlace(place) {
  state.selectedSystem = null;
  state.richSystem = null;
  richSystemRequestId += 1;
  renderBodiesError('Places do not have system body records. Select a star system to view bodies.');
  state.focus = { name: place.name, coords: place.coords };
  el.focusName.textContent = place.name;
  el.focusCoords.textContent = coordsText(place.coords);
  state.renderer.setTarget(place.coords.x, place.coords.y, place.coords.z);
  state.renderer.setSelectedPlace(place);
  el.selected.classList.remove('empty');
  el.selected.innerHTML = selectedPlaceHtml(place);
  setInspectorTab('system');
}

function updateNoteCount() {
  const length = el.noteText.value.length;
  el.noteCount.textContent = `${length} / 512`;
}

function positionNoteMenu(x, y) {
  const viewport = el.noteMenu.parentElement.getBoundingClientRect();
  el.noteMenu.hidden = false;
  const menu = el.noteMenu.getBoundingClientRect();
  const left = Math.max(10, Math.min(viewport.width - menu.width - 10, x + 10));
  const top = Math.max(10, Math.min(viewport.height - menu.height - 10, y + 10));
  el.noteMenu.style.left = `${left}px`;
  el.noteMenu.style.top = `${top}px`;
}

async function openNoteMenu(hit) {
  const response = await api(`/api/system?index=${hit.index}`);
  const system = await response.json();
  setCachedSystem(hit.index, system);
  state.activeNoteSystem = system;
  state.contextMenuSystemName = system.name;
  setNoteMenuEditorVisible(true);
  el.noteMenuSystem.textContent = system.name;
  el.noteText.value = system.note?.text ?? '';
  updateNoteCount();
  positionNoteMenu(hit.x, hit.y);
  el.noteText.focus();
}

function openPlaceContextMenu(hit) {
  const place = hit?.place;
  const systemName = String(place?.systemName ?? place?.name ?? '').trim();
  if (!systemName) return;
  state.activeNoteSystem = null;
  state.contextMenuSystemName = systemName;
  setNoteMenuEditorVisible(false);
  el.noteMenuSystem.textContent = systemName;
  positionNoteMenu(hit.x, hit.y);
}

function setNoteMenuEditorVisible(visible) {
  el.noteText.hidden = !visible;
  el.noteCount.hidden = !visible;
  el.noteDelete.hidden = !visible;
  el.noteSave.hidden = !visible;
}

async function copyContextMenuSystemName() {
  const name = state.contextMenuSystemName?.trim();
  if (!name) return;
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(name);
    else copyWithFallback(name);
    showClientToast(`Copied system name: ${name}`, 3000);
  } catch (error) {
    console.warn(error);
    showClientToast('Could not copy the system name.', 4000);
  }
}

function closeNoteMenu() {
  state.activeNoteSystem = null;
  state.contextMenuSystemName = null;
  el.noteMenu.hidden = true;
}

async function saveActiveNote(text = el.noteText.value) {
  const system = state.activeNoteSystem;
  if (!system?.name) return;
  const response = await api('/api/notes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemName: system.name,
      systemId64: system.id64,
      systemIndex: system.index,
      coords: system.coords,
      text: String(text ?? '').slice(0, 512),
    }),
  });
  const result = await response.json();
  refreshCachedSystemNote(result.note);
  if (systemKey(state.focus?.name) === systemKey(system.name)) {
    state.focus = { ...state.focus };
  }
  await loadNotes();
  if (!el.selected.classList.contains('empty') && systemKey(system.name) === systemKey(el.selected.querySelector('h2')?.textContent)) {
    selectSystem(system.index, false).catch(() => null);
  }
  closeNoteMenu();
  setStatus(result.note ? `Saved note for ${system.name}.` : `Deleted note for ${system.name}.`);
}

async function loadNotes(query = '') {
  const params = query ? `?q=${encodeURIComponent(query)}` : '';
  const response = await fetch(`/api/notes${params}`, {
    headers: state.notesEtag ? { 'If-None-Match': state.notesEtag } : {},
  });
  if (response.status === 304) return;
  if (!response.ok) throw new Error(response.statusText);
  const etag = response.headers.get('etag');
  if (etag && etag === state.notesEtag) return;
  const data = await response.json();
  state.notesEtag = etag;
  state.notes = data.notes ?? [];
  renderNotes(data);
}

function renderNotes(data = { notes: state.notes, count: state.notes.length }) {
  const notes = data.notes ?? state.notes;
  const query = el.noteSearch.value.trim();
  el.notesSummary.textContent = notes.length
    ? `${fmt(notes.length)} note${notes.length === 1 ? '' : 's'}${query ? ` matching "${query}"` : ''}`
    : query ? 'No matching notes' : 'No notes yet';
  el.notesList.replaceChildren();
  for (const note of notes) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'note-item';
    const name = document.createElement('strong');
    name.textContent = note.systemName;
    const text = document.createElement('span');
    text.textContent = notePreview(note.text, 180);
    button.append(name, text);
    button.addEventListener('click', () => {
      focusNoteSystem(note).catch((error) => {
        console.warn(error);
        setStatus(`Could not find ${note.systemName}: ${error.message}`);
      });
    });
    el.notesList.append(button);
  }
}

function setNotesMode(mode, persist = false) {
  state.notesMode = mode === 'search' ? 'search' : 'all';
  for (const input of el.noteModeInputs) input.checked = input.value === state.notesMode;
  el.noteSearch.hidden = state.notesMode !== 'search';
  if (state.notesMode !== 'search') el.noteSearch.value = '';
  if (persist) writeViewSettings({ notesMode: state.notesMode });
  loadNotes(state.notesMode === 'search' ? el.noteSearch.value.trim() : '').catch((error) => console.warn(error));
}

// Parent boxels are the coarser cells holding the target's own boxel, so the
// chips at or below the target's mass code have nothing to show.
function updateBoxelControls(boxel) {
  for (const input of el.parentBoxelInputs) {
    input.disabled = Boolean(boxel) && Number(input.value) <= boxel.massCode;
  }
  el.boxelHint.textContent = boxel
    ? `Target is filed in a ${boxel.cellEdge.toLocaleString()} ly ${boxel.letter} boxel. Larger boxels contain it.`
    : 'Select a system to show its boxels.';
}

function renderCarrierConfig() {
  const carrier = state.trackedCarrier;
  if (document.activeElement !== el.carrierNameInput) el.carrierNameInput.value = carrier?.label ?? '';
  if (!carrier) {
    el.carrierConfigStatus.textContent = 'No carrier configured';
  } else if (carrier.id === null) {
    el.carrierConfigStatus.textContent = 'Carrier ID not found in journals yet. Open carrier management in game, then save again so the map can follow jumps.';
  } else {
    el.carrierConfigStatus.textContent = `Tracking carrier ID ${carrier.id}`;
  }
}

async function saveCarrierConfig() {
  const carrier = el.carrierNameInput.value.trim();
  el.saveCarrier.disabled = true;
  el.carrierConfigStatus.textContent = carrier ? 'Looking up carrier in journals…' : 'Clearing carrier…';
  try {
    const response = await api('/api/tracked-carrier', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ carrier }),
    });
    const result = await response.json();
    state.trackedCarrier = result.trackedCarrier ?? null;
    el.carrierNameInput.blur();
    renderCarrierConfig();
    // Rescan so the saved location follows the new carrier (or is cleared).
    if (el.scanLatestJournals.disabled) {
      setStatus('Carrier saved. It will be picked up by the next journal scan.');
    } else {
      await refreshJournals('latest');
    }
  } catch (error) {
    console.error(error);
    el.carrierConfigStatus.textContent = `Could not save carrier: ${error.message}`;
  } finally {
    el.saveCarrier.disabled = false;
  }
}

function updateLandmarks() {
  const carrier = currentCarrierTarget();
  const landmarks = [
    { name: 'Sol', shortName: 'Sol', coords: state.meta?.sol?.coords ?? { x: 0, y: 0, z: 0 }, color: '#42d1c7' },
    { name: 'Sagittarius A*', shortName: 'Sgr A*', coords: { x: 25.21875, y: -20.90625, z: 25899.96875 }, color: '#f2a541' },
    coloniaLandmark,
  ];
  if (carrier) {
    const carrierLabel = carrier.name ?? carrierDisplayName();
    if (el.carrierMarkerToggle.checked) {
      landmarks.push({ name: carrierLabel, shortName: carrierLabel, coords: carrier.coords, color: '#b6ff00', hideWhenPlaceLabelVisible: true });
    }
    state.renderer.setCarrierRange({
      name: carrierLabel,
      coords: carrier.coords,
      radius: 500,
      color: '#b6ff00',
    });
  } else {
    state.renderer.setCarrierRange(null);
  }
  state.renderer.setLandmarks(landmarks);
  el.carrierMarkerToggle.disabled = !carrier;
  el.carrierRangeToggle.disabled = !carrier;
  if (!carrier) {
    el.carrierRangeToggle.checked = false;
    state.renderer.showCarrierRange = false;
  }
}

function recenterFocus() {
  if (!state.focus?.coords) return;
  state.renderer.setTarget(state.focus.coords.x, state.focus.coords.y, state.focus.coords.z);
}

async function focusLatestJournal() {
  const latest = state.latestJournal;
  if (!latest?.name) return false;
  const focusedFromJournal = focusLatestJournalCoordinates();
  if (await searchLatestSystem(latest.name, true)) return true;
  if (focusedFromJournal) {
    showLatestJournalFallbackSelection();
    return true;
  }
  return false;
}

function focusLatestJournalCoordinates() {
  const latest = state.latestJournal;
  if (!latest?.name || !latest.coords) return false;
  focusSystem(latest.name, latest.coords);
  return true;
}

function showLatestJournalFallbackSelection() {
  const latest = state.latestJournal;
  if (!latest?.name || !latest.coords) return;
  state.renderer.setSelectedSystem({
    name: latest.name,
    coords: latest.coords,
    mainStar: 'Unknown',
    visited: true,
  });
}

function returnToLatestJournal() {
  focusLatestJournal().catch((error) => {
    console.warn(error);
    setStatus(`Could not focus latest journal system: ${error.message}`);
  });
}

function setJournalButtonsDisabled(disabled) {
  el.refreshJournals.disabled = disabled;
  el.scanLatestJournals.disabled = disabled;
  el.scanAllJournals.disabled = disabled;
}

async function refreshJournals(mode = 'latest') {
  const all = mode === 'all';
  setJournalButtonsDisabled(true);
  clearTimeout(journalScanPollTimer);
  const startingMessage = all ? 'All scan 0:00 · starting' : 'Latest scan 0:00 · starting';
  setStatus(startingMessage);
  setJournalScanPanel(null, { mode, message: startingMessage, processing: true });
  try {
    const path = all ? '/api/refresh-journals?mode=all' : '/api/refresh-journals?mode=latest&count=20';
    const response = await api(path, { method: 'POST' });
    const result = await response.json();
    await pollJournalScan(result.scan);
  } catch (error) {
    console.error(error);
    setWriteActivity('scan', false);
    setStatus(`Journal scan failed: ${error.message}`);
    setJournalScanPanel(null, { mode, message: `Failed: ${error.message}`, failed: true });
    setJournalButtonsDisabled(false);
  }
}

async function pollJournalScan(scan) {
  if (scan) setScanStatus(scan);
  if (scan && !scan.running && scan.origin === 'live') {
    await finishLiveJournalScan(scan);
    return;
  }
  if (scan && !scan.running) {
    if (!scan.ok) {
      const detail = (scan.stderr || scan.stdout || '').trim();
      throw new Error(detail || `Journal scan exited with code ${scan.code}.`);
    }
    const priorSupplementalCount = state.visited?.supplementalCount ?? 0;
    setWriteActivity('scan', false);
    setJournalScanPanel(scan, { message: 'Scan complete · updating journal summary', processing: true, percent: 91 });
    await loadStatus();
    rebuildLoadedPlaces();
    applyPlaceFilters();
    setJournalScanPanel(scan, { message: 'Scan complete · moving to latest journal system', processing: true, percent: 93 });
    const focusedFromJournal = focusLatestJournalCoordinates();
    systemCache.clear();
    richSystemCache.clear();
    setJournalScanPanel(scan, { message: 'Scan complete · loading nearby systems at the new location', processing: true, percent: 95 });
    await refreshLocalPointsNow({ radius: Math.max(250, localPointRadius()), limit: 25000 }).catch((error) => {
      if (isAbortError(error)) return;
      console.warn(error);
    });
    setJournalScanPanel(scan, { message: 'Scan complete · loading latest system details', processing: true, percent: 97 });
    if (state.latestJournal?.name) {
      const resolvedLatest = await searchLatestSystem(state.latestJournal.name, true).catch((error) => {
        console.warn(error);
        return false;
      });
      if (!resolvedLatest && focusedFromJournal) showLatestJournalFallbackSelection();
    }
    const completeMessage = scan.message || 'Journal data refreshed.';
    setStatus(completeMessage);
    setJournalButtonsDisabled(false);
    // When no new journal-only systems appeared, the global point set is
    // unchanged except for visited flags — patch those in place instead of
    // re-downloading the whole map layer.
    const supplementalChanged = (state.visited?.supplementalCount ?? 0) !== priorSupplementalCount;
    const refreshTask = supplementalChanged ? loadPoints({ background: true }) : applyVisitedIndexUpdate();
    setJournalScanPanel(scan, {
      message: supplementalChanged ? 'Latest location ready · refreshing galaxy map layer in background' : 'Latest location ready · updating visited markers',
      processing: true,
      percent: 99,
    });
    refreshTask
      .then(() => {
        setJournalScanPanel(scan, { message: completeMessage, processing: false });
      })
      .catch((error) => {
        if (isAbortError(error)) {
          setJournalScanPanel(scan, { message: completeMessage, processing: false });
          return;
        }
        console.error(error);
        setStatus(`Could not refresh galaxy map: ${error.message}`);
        setJournalScanPanel(scan, { message: `Map refresh failed: ${error.message}`, failed: true });
      });
    return;
  }
  journalScanPollTimer = setTimeout(async () => {
    try {
      const response = await api('/api/journal-scan-status');
      const nextScan = await response.json();
      await pollJournalScan(nextScan);
    } catch (error) {
      console.error(error);
      setWriteActivity('scan', false);
      setStatus(`Journal scan status failed: ${error.message}`);
      setJournalScanPanel(scan, { message: `Status failed: ${error.message}`, failed: true });
      setJournalButtonsDisabled(false);
    }
  }, 1000);
}

async function resumeJournalScanIfRunning() {
  try {
    const response = await api('/api/journal-scan-status');
    const scan = await response.json();
    if (scan.running) {
      setJournalButtonsDisabled(true);
      await pollJournalScan(scan);
    }
  } catch (error) {
    console.warn(error);
  } finally {
  }
}

function setSystemButtonsDisabled(disabled) {
  for (const button of el.systemUpdateButtons) button.disabled = disabled;
}

function confirmLargeSystemUpdate(button) {
  if (button.dataset.largeUpdate !== 'true') return true;
  const label = button.dataset.largeUpdateLabel || button.textContent.trim();
  return window.confirm(`Start ${label}?\n\nThis can process or download a large dataset and use heavy disk I/O for a while.`);
}

async function runSystemUpdate(mode, confirmedLarge = false) {
  setSystemButtonsDisabled(true);
  clearTimeout(systemUpdatePollTimer);
  const label = mode === 'places'
    ? 'Places update'
    : mode === 'discoveries'
      ? 'Discoveries update'
      : mode === 'murder-binaries'
        ? 'Murder Binaries analysis'
      : mode === 'green-gas-giants'
        ? 'Green Gas Giant analysis'
      : mode === 'bio-targets'
        ? 'High-value bio analysis'
      : mode === 'galaxy'
        ? 'Full galaxy import'
        : `Systems ${mode}`;
  setStatus(`${label} 0:00 · starting`);
  el.systemUpdateStatus.textContent = `${label} 0:00 · starting`;
  try {
    const params = new URLSearchParams({ mode });
    if (confirmedLarge) params.set('confirmLarge', '1');
    const response = await api(`/api/system-update?${params.toString()}`, { method: 'POST' });
    const result = await response.json();
    await pollSystemUpdate(result.update);
  } catch (error) {
    console.error(error);
    setWriteActivity('update', false);
    setStatus(`System update failed: ${error.message}`);
    el.systemUpdateStatus.textContent = `Failed: ${error.message}`;
    setDownloadProgress('', false);
    setSystemButtonsDisabled(false);
  }
}

async function pollSystemUpdate(update) {
  if (update) setSystemUpdateStatus(update);
  if (update && !update.running) {
    if (!update.ok) {
      const detail = (update.stderr || update.stdout || '').trim();
      setSystemButtonsDisabled(false);
      throw new Error(detail || `System update exited with code ${update.code}.`);
    }
    await loadStatus();
    systemCache.clear();
    renderFilters();
    await loadPlaces();
    await loadNotes();
    await loadPoints();
    setStatus(update.message || 'System update complete.');
    el.systemUpdateStatus.textContent = update.message || 'System update complete.';
    setDownloadProgress('', false);
    setSystemButtonsDisabled(false);
    return;
  }
  systemUpdatePollTimer = setTimeout(async () => {
    try {
      const response = await api('/api/system-update-status');
      const nextUpdate = await response.json();
      await pollSystemUpdate(nextUpdate);
    } catch (error) {
      console.error(error);
      setWriteActivity('update', false);
      setStatus(`System update status failed: ${error.message}`);
      el.systemUpdateStatus.textContent = `Status failed: ${error.message}`;
      setDownloadProgress('', false);
      setSystemButtonsDisabled(false);
    }
  }, 1000);
}

// Notice server write activity this page didn't start (another tab, or a scan
// begun before load): a cheap ping every 5s hands off to the per-second
// trackers above, which drive the busy banner and the post-completion refresh.
// The buttons are disabled exactly while a tracker is active, so they double
// as the "already tracking" guard against duplicate poll loops.
function startServerBusyWatch() {
  setInterval(async () => {
    if (busyWriteKinds.size > 0) return;
    const scanTracking = el.refreshJournals?.disabled;
    const updateTracking = [...(el.systemUpdateButtons ?? [])].some((button) => button.disabled);
    if (scanTracking && updateTracking) return;
    try {
      const response = await fetch('/api/ping', { cache: 'no-store' });
      if (!response.ok) return;
      const ping = await response.json();
      if (!ping?.busy) return;
      if (!scanTracking) resumeJournalScanIfRunning();
      if (!updateTracking) resumeSystemUpdateIfRunning();
    } catch {
      // Server unreachable or mid-restart; the next tick will retry.
    }
  }, 5000);
}

async function resumeSystemUpdateIfRunning() {
  try {
    const response = await api('/api/system-update-status');
    const update = await response.json();
    if (update.running) {
      setSystemButtonsDisabled(true);
      await pollSystemUpdate(update);
    } else {
      el.systemUpdateStatus.textContent = update.ok === false
        ? `Last update failed: ${update.message}`
        : 'Idle';
      setDownloadProgress('', false);
    }
  } catch (error) {
    console.warn(error);
  }
}

async function loadPoints(options = {}) {
  pointLoadController?.abort();
  const requestId = ++pointLoadRequestId;
  const controller = new AbortController();
  pointLoadController = controller;
  if (state.enabledTypes.size === 0) {
    state.renderer.setPoints(new ArrayBuffer(0), state.meta);
    state.renderer.setLocalPoints(new ArrayBuffer(0), state.meta);
    state.basePointCount = 0;
    state.localPointCount = 0;
    state.localAreaCount = null;
    if (pointLoadController === controller) pointLoadController = null;
    setStatus('0 systems · filters hidden · search still works');
    return;
  }
  if (options.background) {
    setStatus('Refreshing galaxy map in the background...', 'Nearby/local detail remains available while the global map layer refreshes.');
  }
  const params = new URLSearchParams({
    types: [...state.enabledTypes].join(','),
    limit: '300000',
  });
  if (!el.updatedFrom.disabled && el.updatedFrom.value) params.set('updatedFrom', el.updatedFrom.value);
  if (!el.updatedBefore.disabled && el.updatedBefore.value) params.set('updatedBefore', el.updatedBefore.value);
  appendRichFilterParams(params);
  const fetchStage = async (limit, { reportProgress = false } = {}) => {
    const stageParams = new URLSearchParams(params);
    stageParams.set('limit', String(limit));
    const response = await api(`/api/points?${stageParams.toString()}`, { signal: controller.signal });
    const buffer = reportProgress
      ? await readBodyWithProgress(response, (loaded, total) => {
        if (requestId !== pointLoadRequestId) return;
        const totalText = total ? ` of ${(total / 1048576).toFixed(1)} MB` : '';
        setStatus(`Loading detailed star field... ${(loaded / 1048576).toFixed(1)} MB${totalText}`);
      })
      : await response.arrayBuffer();
    return { response, buffer };
  };
  const applyStage = async ({ response, buffer }) => {
    if (requestId !== pointLoadRequestId) return false;
    state.basePointCount = buffer.byteLength / 20;
    state.baseLod = response.headers.get('x-lod-level');
    state.richPointFiltersActive = response.headers.get('x-rich-filters') === '1';
    await state.renderer.setPoints(buffer, state.meta);
    return requestId === pointLoadRequestId;
  };
  try {
    // Nearby full-resolution points are already rendered first during startup,
    // so decoding an intermediate 40k global LOD only adds another merge,
    // spatial-index build, and GPU upload before the final layer replaces it.
    if (!(await applyStage(await fetchStage(300000, { reportProgress: options.progressive })))) return;
  } catch (error) {
    if (isAbortError(error)) return;
    throw error;
  } finally {
    if (pointLoadController === controller) pointLoadController = null;
  }
  if (!state.spatialIndex) {
    cancelLocalPointsRefresh();
    state.localPointCount = 0;
    state.localRadius = null;
    state.localAreaCount = null;
    state.localAreaComplete = true;
    state.localPointRequestKey = null;
    state.renderer.setLocalPoints(new ArrayBuffer(0), state.meta);
  } else {
    if (options.awaitLocal) {
      await refreshLocalPointsNow();
    } else {
      scheduleLocalPointsRefresh(0);
    }
  }
  updatePointStatus();
}

async function applyVisitedIndexUpdate() {
  const response = await api('/api/visited-indexes');
  const data = await response.json();
  const changed = state.renderer.applyVisitedFlags(new Set(data.indexes ?? []));
  if (changed) updatePointStatus();
}

async function readBodyWithProgress(response, onProgress) {
  if (!response.body?.getReader) return response.arrayBuffer();
  const total = Number(response.headers.get('content-length')) || 0;
  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress?.(loaded, total);
  }
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}

function updatePointStatus() {
  const localOnly = Boolean(el.localDetailOnlyToggle?.checked);
  const richSuffix = state.richPointFiltersActive ? ' · full-data filters active' : '';
  const localSuffix = state.localPointCount
    ? ` + ${fmt(state.localPointCount)} local within ${fmt(state.localRadius)} ly`
    : '';
  const displayed = fmt(state.renderer?.allPoints?.length ?? state.basePointCount);
  const drawn = fmt(state.renderer?.count ?? 0);
  const hasAreaCount = Number.isFinite(state.localAreaCount);
  const areaCount = hasAreaCount
    ? `${state.localAreaComplete ? '' : 'at least '}${fmt(state.localAreaCount)} systems in viewed area · ${drawn} drawn`
    : null;
  setStatus(
    areaCount
      ? `${areaCount} · ${localOnly ? 'global LOD hidden' : `LOD ${state.baseLod}${richSuffix}`} · search overrides filters`
      : localOnly
        ? `${displayed} local systems within ${fmt(state.localRadius)} ly · global LOD hidden · search overrides filters`
        : `${displayed} systems · LOD ${state.baseLod}${localSuffix}${richSuffix} · search overrides filters`,
    localOnly
      ? `${areaCount ? `${state.localAreaComplete ? 'Exact' : 'Lower-bound'} database count within ${fmt(state.localRadius)} ly. ` : ''}Displaying detailed systems near the current view only. The ${fmt(state.basePointCount)}-system global LOD layer remains loaded and can be restored instantly.`
      : `${areaCount ? `${state.localAreaComplete ? 'Exact' : 'Lower-bound'} database count within ${fmt(state.localRadius)} ly; ${fmt(state.localPointCount)} local systems remain after query filters and limits. ` : ''}Displaying ${fmt(state.basePointCount)} global systems from LOD ${state.baseLod}${state.richPointFiltersActive ? ' with full-data filters applied' : ''}.`
  );
}

function schedulePointStatusUpdate() {
  if (pointStatusTimer !== null) return;
  pointStatusTimer = setTimeout(() => {
    pointStatusTimer = null;
    updatePointStatus();
  }, 0);
}

function localPointRadius() {
  const step = state.renderer?.gridStep?.() ?? 250;
  if (step <= 10) return 180;
  if (step <= 25) return 250;
  if (step <= 50) return 350;
  if (step <= 100) return 500;
  return 750;
}

function localPointLimit() {
  const limit = state.renderer?.localPointLimit?.() ?? 0;
  if (limit <= 0) return 0;
  return Math.max(1000, Math.min(50000, limit));
}

function abortLocalPointsRequest() {
  localPointsController?.abort();
  localPointsController = null;
}

// Drop any scheduled or in-flight local point refresh and invalidate responses.
function cancelLocalPointsRefresh() {
  clearTimeout(localPointsRefreshTimer);
  localPointsRefreshTimer = null;
  localPointsRequestId += 1;
  abortLocalPointsRequest();
}

function scheduleLocalPointsRefresh(delay = 160, options = {}) {
  clearTimeout(localPointsRefreshTimer);
  abortLocalPointsRequest();
  const requestId = ++localPointsRequestId;
  if (!state.spatialIndex || state.enabledTypes.size === 0) return;
  const limit = Math.max(0, Math.min(Number(options.limit ?? localPointLimit()) || 0, 50000));
  if (limit <= 0) {
    if (state.localPointCount > 0) {
      state.localPointCount = 0;
      state.localRadius = null;
      state.localAreaCount = null;
      state.localAreaComplete = true;
      state.localPointRequestKey = null;
      state.renderer.setLocalPoints(new ArrayBuffer(0), state.meta);
      updatePointStatus();
    }
    return;
  }
  const radius = Math.max(25, Math.min(1000, Number(options.radius ?? localPointRadius()) || localPointRadius()));
  localPointsRefreshTimer = setTimeout(() => refreshLocalPoints(requestId, limit, { radius, force: Boolean(options.force) }).catch((error) => {
    if (isAbortError(error)) return;
    console.warn(error);
    setStatus(`Local system detail failed: ${error.message}`);
  }), delay);
}

async function refreshLocalPoints(requestId, limit, options = {}) {
  const coords = state.renderer.targetCoords();
  const radius = Math.max(25, Math.min(1000, Number(options.radius ?? localPointRadius()) || localPointRadius()));
  const tileSize = Math.max(200, Math.min(1000, state.renderer.gridStep?.() ?? 250));
  const richParams = new URLSearchParams();
  appendRichFilterParams(richParams);
  const tileKey = [
    Math.floor(coords.x / tileSize),
    Math.floor(coords.y / tileSize),
    Math.floor(coords.z / tileSize),
    tileSize,
    limit,
    radius,
    [...state.enabledTypes].join(','),
    el.updatedFrom.disabled ? '' : el.updatedFrom.value,
    el.updatedBefore.disabled ? '' : el.updatedBefore.value,
    richParams.toString(),
  ].join(':');
  if (!options.force && state.localPointRequestKey === tileKey && state.localPointCount > 0) return;
  const params = new URLSearchParams({
    x: String(coords.x),
    y: String(coords.y),
    z: String(coords.z),
    types: [...state.enabledTypes].join(','),
    limit: String(limit),
    radius: String(radius),
  });
  if (!el.updatedFrom.disabled && el.updatedFrom.value) params.set('updatedFrom', el.updatedFrom.value);
  if (!el.updatedBefore.disabled && el.updatedBefore.value) params.set('updatedBefore', el.updatedBefore.value);
  for (const [name, value] of richParams) params.set(name, value);
  const controller = new AbortController();
  localPointsController = controller;
  let response;
  let buffer;
  try {
    response = await api(`/api/local-points?${params.toString()}`, { signal: controller.signal });
    buffer = await response.arrayBuffer();
  } catch (error) {
    if (isAbortError(error)) return;
    throw error;
  } finally {
    if (localPointsController === controller) localPointsController = null;
  }
  if (requestId !== localPointsRequestId) return;
  state.localPointCount = buffer.byteLength / 20;
  state.localRadius = Number(response.headers.get('x-local-radius') ?? 0);
  const areaCountHeader = response.headers.get('x-local-area-count');
  const areaCount = areaCountHeader === null ? Number.NaN : Number(areaCountHeader);
  state.localAreaCount = Number.isFinite(areaCount) ? areaCount : null;
  state.localAreaComplete = response.headers.get('x-local-area-complete') !== '0';
  state.localPointRequestKey = tileKey;
  await state.renderer.setLocalPoints(buffer, state.meta);
  updatePointStatus();
}

async function refreshLocalPointsNow(options = {}) {
  if (!state.spatialIndex || state.enabledTypes.size === 0) return false;
  const limit = Math.max(1000, Math.min(Number(options.limit ?? localPointLimit()) || 25000, 50000));
  const radius = Math.max(25, Math.min(1000, Number(options.radius ?? localPointRadius()) || localPointRadius()));
  const requestId = ++localPointsRequestId;
  abortLocalPointsRequest();
  await refreshLocalPoints(requestId, limit, { radius, force: true });
  return state.localPointCount > 0;
}

// Backdrop clouds come from the Nebulae places whether or not that marker
// category is shown, so they load once on their own.
let nebulaBackdropLoaded = false;
async function loadNebulaBackdrop() {
  if (nebulaBackdropLoaded || !el.nebulaToggle.checked) return;
  nebulaBackdropLoaded = true;
  try {
    const response = await fetch('/api/places?category=Nebulae');
    if (!response.ok) throw new Error(response.statusText);
    const data = await response.json();
    state.renderer.setNebulae(data.places ?? []);
  } catch (error) {
    nebulaBackdropLoaded = false;
    console.warn('Nebula backdrop unavailable:', error);
  }
}

async function loadPlaces() {
  placesLoadController?.abort();
  const requestId = ++placesLoadRequestId;
  const controller = new AbortController();
  placesLoadController = controller;
  try {
    const response = await fetch('/api/places-summary', { signal: controller.signal });
    if (!response.ok) throw new Error(response.statusText);
    const data = await response.json();
    if (requestId !== placesLoadRequestId) return;
    state.placesMeta = data.imported ? data : state.placesMeta;
    if (data.imported) loadNebulaBackdrop();
    state.placeCategoryData.clear();
    state.places = [];
    renderPlaceFilters();
    await loadEnabledPlaceCategories({ force: true });
    if (el.murderBinariesToggle.checked && !el.murderBinariesToggle.disabled) {
      scheduleMurderBinariesRefresh(0);
    }
    if (data.imported) {
      updatePlacesSummary();
    }
  } catch (error) {
    if (isAbortError(error)) return;
    console.warn(error);
    state.places = [];
    state.renderer.setPlaces([]);
  } finally {
    if (placesLoadController === controller) placesLoadController = null;
  }
}

// The journal carrier override is applied here rather than when a category is
// fetched, so a carrier change or a fresh journal scan only needs a rebuild.
function rebuildLoadedPlaces() {
  state.places = applyCarrierOverride([...state.placeCategoryData.values()].flat());
}

async function loadEnabledPlaceCategories(options = {}) {
  const categories = [...state.enabledPlaceCategories].filter((category) => category !== murderBinariesCategory);
  if (options.force) state.placeCategoryData.clear();
  const missing = categories.filter((category) => !state.placeCategoryData.has(category));
  if (!missing.length) {
    rebuildLoadedPlaces();
    applyPlaceFilters();
    return;
  }

  placesLoadController?.abort();
  const requestId = ++placesLoadRequestId;
  const controller = new AbortController();
  placesLoadController = controller;
  const params = new URLSearchParams();
  for (const category of missing) params.append('category', category);
  try {
    const response = await fetch(`/api/places?${params.toString()}`, { signal: controller.signal });
    if (!response.ok) throw new Error(response.statusText);
    const data = await response.json();
    if (requestId !== placesLoadRequestId) return;
    const groups = new Map(missing.map((category) => [category, []]));
    for (const place of data.places ?? []) {
      const category = place.category ?? 'Other POIs';
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(place);
    }
    for (const [category, places] of groups) state.placeCategoryData.set(category, places);
    rebuildLoadedPlaces();
    applyPlaceFilters();
  } catch (error) {
    if (!isAbortError(error)) throw error;
  } finally {
    if (placesLoadController === controller) placesLoadController = null;
  }
}

function updatePlacesSummary() {
  const meta = state.placesMeta;
  if (!meta?.imported && !meta?.count) return;
  const discoveryText = meta.discoveries?.count ? ` including ${fmt(meta.discoveries.count)} discoveries;` : '';
  const shown = state.renderer?.isolatePlaces
    ? `isolating all ${fmt(state.visiblePlaces.length)} selected places`
    : !state.renderer?.showPlaces
      ? 'overlay hidden'
      : state.renderer?.showAllPlaces
        ? 'showing all'
        : 'showing nearest 50';
  const filtered = state.visiblePlaces.length !== state.places.length
    ? ` ${fmt(state.visiblePlaces.length)} after filters;`
    : '';
  el.placesSummary.textContent = `${fmt(meta.count)} places indexed from ${meta.source};${discoveryText}${filtered} ${shown}.`;
}

function setPlaceIsolation(enabled, persist = false) {
  const next = Boolean(enabled);
  el.placeIsolateToggle.checked = next;
  state.renderer.setIsolatePlaces(next);
  if (persist) writeViewSettings({ isolatePlaceFilters: next });
  updatePlacesSummary();
}

function poiModeFromSettings(settings) {
  if (['off', 'nearby', 'all'].includes(settings.poiMode)) return settings.poiMode;
  if (['off', 'nearby', 'all'].includes(settings.nebulaMode)) return settings.nebulaMode;
  if (settings.showPlaces === false) return 'off';
  if (settings.showAllPlaces === true) return 'all';
  return 'nearby';
}

function setPoiMode(mode, persist = false) {
  const next = ['off', 'nearby', 'all'].includes(mode) ? mode : 'nearby';
  state.renderer.showPlaces = next !== 'off';
  state.renderer.showAllPlaces = next === 'all';
  state.renderer.placeDrawKey = '';
  for (const input of el.poiModeInputs) input.checked = input.value === next;
  if (next === 'off') hideTooltip();
  if (persist) writeViewSettings({ poiMode: next, showPlaces: next !== 'off', showAllPlaces: next === 'all' });
  updatePlacesSummary();
}

function placeCategories() {
  if (Array.isArray(state.placesMeta?.categoryDetails)) {
    return state.placesMeta.categoryDetails
      .map((item) => ({
        category: item.category,
        count: Number(item.count ?? 0),
        defaultEnabled: item.defaultEnabled !== false,
      }))
      .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
  }
  const counts = new Map();
  const defaultEnabled = new Map();
  for (const place of state.places) {
    const category = place.category ?? 'Other POIs';
    counts.set(category, (counts.get(category) ?? 0) + 1);
    defaultEnabled.set(category, (defaultEnabled.get(category) ?? false) || place.defaultEnabled !== false);
  }
  return [...counts.entries()]
    .map(([category, count]) => ({ category, count, defaultEnabled: defaultEnabled.get(category) ?? true }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
}

function renderPlaceFilters() {
  const categories = placeCategories();
  const generalCategories = categories.filter((item) => item.category !== murderBinariesCategory);
  const murderBinariesAvailable = Number(state.placesMeta?.murderBinaries?.count ?? 0) > 0;
  const viewSettings = readViewSettings();
  const saved = Array.isArray(viewSettings.placeCategories) ? new Set(viewSettings.placeCategories) : null;
  state.enabledPlaceCategories = new Set(saved ? categories.filter((item) => saved.has(item.category)).map((item) => item.category) : categories.filter((item) => item.defaultEnabled).map((item) => item.category));
  el.murderBinariesToggle.disabled = !murderBinariesAvailable;
  if (el.murderBinariesToggle.checked && murderBinariesAvailable) state.enabledPlaceCategories.add(murderBinariesCategory);
  else state.enabledPlaceCategories.delete(murderBinariesCategory);

  el.placeFilterActions.replaceChildren();
  for (const [label, categoriesToEnable] of [
    ['All', generalCategories.map((item) => item.category)],
    ['None', []],
    ['Nebulae', generalCategories.filter((item) => item.category === 'Nebulae').map((item) => item.category)],
    ['Discoveries', generalCategories.filter((item) => !item.defaultEnabled).map((item) => item.category)],
  ]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', () => {
      state.enabledPlaceCategories = new Set(categoriesToEnable);
      if (el.murderBinariesToggle.checked && murderBinariesAvailable) {
        state.enabledPlaceCategories.add(murderBinariesCategory);
      }
      for (const input of el.placeFilters.querySelectorAll('input[type="checkbox"]')) {
        input.checked = state.enabledPlaceCategories.has(input.value);
      }
      persistPlaceCategories();
      applyPlaceFilters();
      loadEnabledPlaceCategories().catch((error) => {
        if (!isAbortError(error)) console.warn(error);
      });
    });
    el.placeFilterActions.append(button);
  }

  el.placeFilters.replaceChildren();
  for (const item of generalCategories) {
    const label = document.createElement('label');
    label.className = 'place-filter';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = item.category;
    input.checked = state.enabledPlaceCategories.has(item.category);
    input.addEventListener('change', () => {
      if (input.checked) state.enabledPlaceCategories.add(item.category);
      else state.enabledPlaceCategories.delete(item.category);
      persistPlaceCategories();
      applyPlaceFilters();
      loadEnabledPlaceCategories().catch((error) => {
        if (!isAbortError(error)) console.warn(error);
      });
    });
    const text = document.createElement('span');
    text.textContent = item.category;
    const count = document.createElement('small');
    count.textContent = fmt(item.count);
    label.append(input, text, count);
    el.placeFilters.append(label);
  }
}

function persistPlaceCategories() {
  writeViewSettings({ placeCategories: [...state.enabledPlaceCategories] });
}

function setMurderBinariesOverlay(enabled, persist = false) {
  const next = Boolean(enabled);
  el.murderBinariesToggle.checked = next;
  state.renderer.showMurderBinaries = next;
  state.renderer.placeDrawKey = '';
  if (next && !el.murderBinariesToggle.disabled) state.enabledPlaceCategories.add(murderBinariesCategory);
  else {
    state.enabledPlaceCategories.delete(murderBinariesCategory);
    state.murderBinaryPlaces = [];
    clearTimeout(murderBinariesRefreshTimer);
  }
  if (persist) {
    writeViewSettings({
      showMurderBinaries: next,
      placeCategories: [...state.enabledPlaceCategories],
    });
  }
  applyPlaceFilters();
  if (next && !el.murderBinariesToggle.disabled) scheduleMurderBinariesRefresh(0);
}

function scheduleMurderBinariesRefresh(delay = 400) {
  if (!el.murderBinariesToggle.checked || el.murderBinariesToggle.disabled) return;
  clearTimeout(murderBinariesRefreshTimer);
  murderBinariesRefreshTimer = setTimeout(() => refreshMurderBinaries().catch((error) => {
    console.warn(error);
    setStatus(`Murder Binaries overlay failed: ${error.message}`);
  }), delay);
}

async function refreshMurderBinaries() {
  const requestId = ++murderBinariesRequestId;
  const coords = state.renderer.targetCoords();
  const params = new URLSearchParams({
    x: String(coords.x),
    y: String(coords.y),
    z: String(coords.z),
    limit: '50',
  });
  const response = await api(`/api/murder-binaries?${params.toString()}`);
  const data = await response.json();
  if (requestId !== murderBinariesRequestId || !el.murderBinariesToggle.checked) return;
  state.murderBinaryPlaces = data.places ?? [];
  applyPlaceFilters();
}

function applyPlaceFilters() {
  const hideCarrier = !el.carrierMarkerToggle.checked;
  const regularPlaces = state.places.filter((place) => state.enabledPlaceCategories.has(place.category ?? 'Other POIs')
    && !(hideCarrier && isTrackedCarrierPlace(place)));
  state.visiblePlaces = el.murderBinariesToggle.checked
    ? [...regularPlaces, ...state.murderBinaryPlaces]
    : regularPlaces;
  state.renderer.setPlaces(state.visiblePlaces);
  updateLandmarks();
  updatePlacesSummary();
}

function resultBadge(text, tone = '') {
  const badge = document.createElement('span');
  badge.className = `result-badge${tone ? ` ${tone}` : ''}`;
  badge.textContent = text;
  return badge;
}

function setSearchResultsHidden(hidden) {
  el.results.hidden = hidden;
  el.search.setAttribute('aria-expanded', hidden ? 'false' : 'true');
  if (hidden) {
    state.activeSearchIndex = -1;
    el.search.removeAttribute('aria-activedescendant');
  }
}

function updateActiveSearchResult(index) {
  const buttons = [...el.results.querySelectorAll('.search-result')];
  state.activeSearchIndex = buttons.length ? Math.max(0, Math.min(index, buttons.length - 1)) : -1;
  buttons.forEach((button, buttonIndex) => {
    const active = buttonIndex === state.activeSearchIndex;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
    if (active) {
      el.search.setAttribute('aria-activedescendant', button.id);
      button.scrollIntoView({ block: 'nearest' });
    }
  });
}

function chooseSearchResult(result) {
  setSearchResultsHidden(true);
  el.search.value = result.name;
  state.renderer.setSearchResults([result], state.meta);
  selectSystem(result.index);
}

function chooseLlmResult(result) {
  el.llmSearchPanel.hidden = true;
  el.llmSearchButton.setAttribute('aria-expanded', 'false');
  chooseSearchResult(result);
}

function renderSearchResults(results, message = '') {
  state.searchResults = results;
  state.activeSearchIndex = -1;
  el.results.replaceChildren();
  if (!results.length) {
    if (message) {
      const note = document.createElement('div');
      note.className = 'search-result search-note';
      note.textContent = message;
      el.results.append(note);
      setSearchResultsHidden(false);
    } else {
      setSearchResultsHidden(true);
    }
    state.renderer.setSearchResults([]);
    return;
  }
  for (const [index, result] of results.entries()) {
    const button = document.createElement('button');
    button.className = 'search-result';
    button.id = `search-result-${index}`;
    button.type = 'button';
    button.setAttribute('role', 'option');
    button.tabIndex = -1;
    button.setAttribute('aria-selected', 'false');
    const top = document.createElement('span');
    top.className = 'search-result-top';
    const name = document.createElement('strong');
    name.textContent = result.name;
    const badges = document.createElement('span');
    badges.className = 'result-badges';
    const match = result.matchType === 'llm' ? 'LLM' : result.matchType === 'startsWith' ? 'Starts' : result.matchType === 'contains' ? 'Contains' : 'Fuzzy';
    badges.append(resultBadge(match, 'match'));
    if (result.overridesFilters) badges.append(resultBadge('Filtered', 'filtered'));
    if (result.source) badges.append(resultBadge(result.source, 'source'));
    top.append(name, badges);
    const detail = document.createElement('small');
    const distance = distanceLy(state.focus?.coords, result.coords);
    const distanceText = distance === null ? '' : ` · ${fmt(distance)} ly from focus`;
    detail.textContent = `${state.meta.typeNames[result.typeCode] ?? 'Unknown'} · ${coordsText(result.coords)}${distanceText}`;
    button.append(top, detail);
    button.addEventListener('mouseenter', () => updateActiveSearchResult(index));
    button.addEventListener('click', () => chooseSearchResult(result));
    el.results.append(button);
  }
  setSearchResultsHidden(false);
  state.renderer.setSearchResults(results, state.meta);
}

let searchPreviewTimer = null;
let searchPreviewRequest = null;

function scheduleSearchPreview(delay = 300) {
  clearTimeout(searchPreviewTimer);
  searchPreviewTimer = setTimeout(updateSearchPreview, delay);
}

async function updateSearchPreview() {
  const query = el.llmSearchPrompt.value.trim();
  if (!query) {
    el.llmSearchPreview.replaceChildren();
    return;
  }
  searchPreviewRequest?.abort();
  const controller = new AbortController();
  searchPreviewRequest = controller;
  try {
    const response = await fetch('/api/search-plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, provider: readLlmSettings().provider }),
      signal: controller.signal,
    });
    if (!response.ok) return;
    renderSearchPreview(await response.json());
  } catch (error) {
    if (!isAbortError(error)) console.warn(error);
  }
}

function renderSearchPreview(preview) {
  const line = document.createElement('div');
  const label = document.createElement('strong');
  label.textContent = 'Will search for: ';
  line.append(label, preview.understood.join(' · '));
  const parts = [line];
  if (preview.unknown.length) {
    const unknown = document.createElement('span');
    unknown.className = 'llm-unknown';
    const words = preview.unknown.map((word) => `"${word}"`).join(', ');
    unknown.textContent = preview.aiProvider
      ? `Not recognised: ${words}. The AI assistant (${llmProviderLabel(preview.aiProvider)}) will read the whole request.`
      : `Not recognised: ${words}. These words will be ignored. Try other wording, or set up the AI assistant below to handle requests like this.`;
    parts.push(unknown);
  }
  el.llmSearchPreview.replaceChildren(...parts);
}

function setLlmSearchOpen(open) {
  el.llmSearchPanel.hidden = !open;
  el.llmSearchButton.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) {
    applyLlmSettingsToForm();
    if (el.search.value.trim().length > 8 && !el.llmSearchPrompt.value.trim()) {
      el.llmSearchPrompt.value = el.search.value.trim();
    }
    el.llmSearchPrompt.focus();
    scheduleSearchPreview(0);
  }
}

function renderLlmResults(data) {
  el.llmSearchResults.replaceChildren();
  el.llmSearchAnswer.hidden = !data.answer;
  el.llmSearchAnswer.textContent = data.answer || '';
  if (!data.results?.length) {
    const empty = document.createElement('div');
    empty.className = 'llm-result';
    empty.innerHTML = '<strong>No matching systems found</strong><small>Try a larger distance, like "within 2,000 ly", or fewer requirements.</small>';
    el.llmSearchResults.append(empty);
    state.renderer.setSearchResults([]);
    return;
  }
  state.renderer.setSearchResults(data.results, state.meta);
  for (const result of data.results) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'llm-result';
    const evidence = Array.isArray(result.evidence) && result.evidence.length
      ? `<ul>${result.evidence.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
      : '';
    button.innerHTML = `
      <strong>${escapeHtml(result.name)}</strong>
      <small>${escapeHtml(state.meta.typeNames[result.typeCode] ?? result.mainStar ?? 'Unknown')} · ${fmt(result.distanceLy)} ly from ${escapeHtml(state.focus?.name ?? 'focus')} · ${escapeHtml(result.confidence ?? 'medium')} confidence</small>
      ${evidence}
    `;
    button.addEventListener('click', () => chooseLlmResult(result));
    el.llmSearchResults.append(button);
  }
}

async function runLlmSearch() {
  const query = el.llmSearchPrompt.value.trim();
  if (query.length < 8) {
    el.llmSearchStatus.textContent = 'Describe what you are looking for in a few more words.';
    return;
  }
  const settings = persistLlmSettings();
  el.llmSearchRun.disabled = true;
  el.llmSearchStatus.textContent = 'Searching...';
  el.llmSearchAnswer.hidden = true;
  el.llmSearchResults.replaceChildren();
  try {
    const response = await api('/api/llm-search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query,
        target: state.focus,
        ai: { provider: settings.provider, model: settings.model },
      }),
    });
    const data = await response.json();
    const parts = [
      data.count
        ? `Found ${fmt(data.count)} system${data.count === 1 ? '' : 's'} among the ${fmt(data.scanned)} nearest.`
        : `No matches among the ${fmt(data.scanned)} nearest systems.`,
    ];
    if (data.planner !== 'local') {
      parts.push(`Read by the AI assistant (${llmProviderLabel(data.planner)}).`);
    } else if (data.unknown?.length) {
      parts.push(`Ignored: ${data.unknown.map((word) => `"${word}"`).join(', ')}.`);
    }
    if (data.warning) parts.push(data.warning);
    el.llmSearchStatus.textContent = parts.join(' ');
    renderLlmResults(data);
  } catch (error) {
    console.error(error);
    const message = `Search failed: ${error.message}`;
    el.llmSearchStatus.textContent = message;
    showClientToast(message);
    state.renderer.setSearchResults([]);
  } finally {
    el.llmSearchRun.disabled = false;
  }
}

async function search() {
  const q = el.search.value.trim();
  searchController?.abort();
  searchController = null;
  if (q.length < 3) {
    searchRequestId += 1;
    renderSearchResults([]);
    return;
  }
  const requestId = ++searchRequestId;
  const controller = new AbortController();
  searchController = controller;
  try {
    const response = await api(`/api/search?q=${encodeURIComponent(q)}&limit=25`, { signal: controller.signal });
    const data = await response.json();
    if (requestId !== searchRequestId) return;
    renderSearchResults(data.results, data.message);
  } catch (error) {
    if (!isAbortError(error)) console.warn(error);
  } finally {
    if (searchController === controller) searchController = null;
  }
}

function bindControls() {
  for (const [index, button] of el.inspectorTabs.entries()) {
    button.addEventListener('click', () => setInspectorTab(button.dataset.inspectorTab));
    button.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      let nextIndex = index;
      if (event.key === 'ArrowLeft') nextIndex = (index - 1 + el.inspectorTabs.length) % el.inspectorTabs.length;
      if (event.key === 'ArrowRight') nextIndex = (index + 1) % el.inspectorTabs.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = el.inspectorTabs.length - 1;
      el.inspectorTabs[nextIndex].focus();
      setInspectorTab(el.inspectorTabs[nextIndex].dataset.inspectorTab);
    });
  }
  el.toggleInspector.addEventListener('click', () => {
    setInspectorCollapsed(!el.app.classList.contains('inspector-collapsed'));
  });
  el.openLayers.addEventListener('click', () => openInspectorTab('layers'));
  el.toolbarRecenter.addEventListener('click', recenterFocus);
  el.toolbarLatest.addEventListener('click', returnToLatestJournal);
  el.search.addEventListener('input', () => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(search, 180);
  });
  el.llmSearchButton.addEventListener('click', () => setLlmSearchOpen(el.llmSearchPanel.hidden));
  el.llmSearchClose.addEventListener('click', () => setLlmSearchOpen(false));
  el.llmSearchRun.addEventListener('click', () => runLlmSearch());
  el.llmProvider.addEventListener('focus', () => {
    el.llmProvider.dataset.previousProvider = el.llmProvider.value;
  });
  el.llmProvider.addEventListener('change', () => {
    const previousProvider = llmProviders.includes(el.llmProvider.dataset.previousProvider)
      ? el.llmProvider.dataset.previousProvider
      : readLlmSettings().provider;
    const provider = llmProviders.includes(el.llmProvider.value) ? el.llmProvider.value : 'openai';
    const currentSettings = llmSettingsWithProviderFromForm(previousProvider);
    currentSettings.provider = provider;
    writeLlmSettings(currentSettings);
    applyLlmSettingsToForm(readLlmSettings());
    el.llmProvider.dataset.previousProvider = provider;
    scheduleSearchPreview(0);
  });
  el.llmModel.addEventListener('change', persistLlmSettings);
  el.llmSearchPrompt.addEventListener('input', () => scheduleSearchPreview());
  el.llmSaveKey.addEventListener('click', () => saveLlmKey());
  el.llmRemoveKey.addEventListener('click', () => saveLlmKey({ remove: true }));
  for (const input of [el.llmApiKey, el.llmBaseUrl]) {
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') saveLlmKey();
    });
  }
  el.llmSearchPrompt.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      runLlmSearch();
    }
  });
  el.search.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      setSearchResultsHidden(true);
      return;
    }
    if (el.results.hidden || !state.searchResults.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      updateActiveSearchResult(state.activeSearchIndex + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      updateActiveSearchResult(state.activeSearchIndex <= 0 ? state.searchResults.length - 1 : state.activeSearchIndex - 1);
    } else if (event.key === 'Enter' && state.activeSearchIndex >= 0) {
      event.preventDefault();
      chooseSearchResult(state.searchResults[state.activeSearchIndex]);
    }
  });
  el.visitedToggle.addEventListener('change', () => {
    state.renderer.showVisited = el.visitedToggle.checked;
    state.renderer.rebuildDrawBuffers(true);
    state.renderer.requestRender();
    writeViewSettings({ showVisited: el.visitedToggle.checked });
  });
  el.depthEmphasisToggle.addEventListener('change', () => {
    state.renderer.setDepthEmphasis(el.depthEmphasisToggle.checked);
    writeViewSettings({ showDepthEmphasis: el.depthEmphasisToggle.checked });
  });
  el.starScale.addEventListener('input', () => {
    if (el.starScaleAuto.checked) setStarScaleAuto(false, true);
    applyStarScale(el.starScale.value);
  });
  el.starScale.addEventListener('change', () => applyStarScale(el.starScale.value, true));
  el.starScaleAuto.addEventListener('change', () => setStarScaleAuto(el.starScaleAuto.checked, true));
  el.gridToggle.addEventListener('change', () => {
    state.renderer.showGrid = el.gridToggle.checked;
    state.renderer.requestRender();
    writeViewSettings({ showGrid: el.gridToggle.checked });
  });
  el.dropLinesToggle.addEventListener('change', () => {
    state.renderer.showDropLines = el.dropLinesToggle.checked;
    state.renderer.requestRender();
    writeViewSettings({ showDropLines: el.dropLinesToggle.checked });
  });
  el.sectorMapToggle.addEventListener('change', () => {
    state.renderer.showSectorMap = el.sectorMapToggle.checked;
    state.renderer.requestRender();
    writeViewSettings({ showSectorMap: el.sectorMapToggle.checked });
  });
  el.galaxyGlowToggle.addEventListener('change', () => {
    state.renderer.showGalaxyGlow = el.galaxyGlowToggle.checked;
    state.renderer.requestRender();
    writeViewSettings({ showGalaxyGlow: el.galaxyGlowToggle.checked });
  });
  el.boxelToggle.addEventListener('change', () => {
    state.renderer.showBoxel = el.boxelToggle.checked;
    state.renderer.requestRender();
    writeViewSettings({ showBoxel: el.boxelToggle.checked });
  });
  el.boxelGlowToggle.addEventListener('change', () => {
    state.renderer.boxelGlow = el.boxelGlowToggle.checked;
    state.renderer.requestRender();
    writeViewSettings({ boxelGlow: el.boxelGlowToggle.checked });
  });
  for (const input of el.parentBoxelInputs) {
    input.addEventListener('change', () => {
      const codes = el.parentBoxelInputs.filter((item) => item.checked).map((item) => Number(item.value));
      state.renderer.parentBoxelCodes = new Set(codes);
      state.renderer.requestRender();
      writeViewSettings({ parentBoxels: codes });
    });
  }
  el.bioOverlayToggle.addEventListener('change', () => {
    writeViewSettings({ bioOverlay: el.bioOverlayToggle.checked });
    loadBioOverlay();
  });
  for (const input of el.bioLevelInputs) {
    input.addEventListener('change', () => {
      if (!input.checked) return;
      state.bio.level = Number(input.value);
      writeViewSettings({ bioLevel: state.bio.level });
      loadBioOverlay();
    });
  }
  for (const input of el.bioBandInputs) {
    input.addEventListener('change', () => {
      if (!input.checked) return;
      state.bio.band = Number(input.value);
      writeViewSettings({ bioBand: state.bio.band });
      loadBioOverlay();
    });
  }
  el.bioSpeciesAll.addEventListener('click', () => setBioSpecies(null));
  el.bioSpeciesTop.addEventListener('click', () => {
    setBioSpecies(new Set(state.bio.species.filter((species) => species.value >= 10_000_000).map((species) => species.key)));
  });
  el.liveJournalToggle.addEventListener('change', async () => {
    try {
      const response = await api(`/api/live?enabled=${el.liveJournalToggle.checked ? 1 : 0}`, { method: 'POST' });
      updateLiveStatus(await response.json());
    } catch (error) {
      setStatus(`Could not change live journal following: ${error.message}`);
    }
  });
  const changeAutoTarget = (enabled) => {
    setAutoTarget(enabled);
    writeViewSettings({ liveFollow: enabled });
    if (enabled) targetLiveSystem();
  };
  el.liveFollowToggle.addEventListener('change', () => changeAutoTarget(el.liveFollowToggle.checked));
  el.liveAutoTarget.addEventListener('click', () => changeAutoTarget(!state.live.follow));
  el.nebulaToggle.addEventListener('change', () => {
    state.renderer.showNebulae = el.nebulaToggle.checked;
    state.renderer.requestRender();
    writeViewSettings({ showNebulae: el.nebulaToggle.checked });
    if (el.nebulaToggle.checked) loadNebulaBackdrop();
  });
  el.colorBySelect.addEventListener('change', () => applyColorBy(el.colorBySelect.value));
  el.landmarksToggle.addEventListener('change', () => {
    state.renderer.showLandmarks = el.landmarksToggle.checked;
    state.renderer.requestRender();
    writeViewSettings({ showLandmarks: el.landmarksToggle.checked });
  });
  el.carrierMarkerToggle.addEventListener('change', () => {
    applyPlaceFilters();
    state.renderer.requestRender();
    writeViewSettings({ showCarrierMarker: el.carrierMarkerToggle.checked });
  });
  el.saveCarrier.addEventListener('click', saveCarrierConfig);
  el.carrierNameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') saveCarrierConfig();
  });
  el.carrierRangeToggle.addEventListener('change', () => {
    state.renderer.showCarrierRange = el.carrierRangeToggle.checked;
    state.renderer.requestRender();
    writeViewSettings({ showCarrierRange: el.carrierRangeToggle.checked });
  });
  el.localDetailOnlyToggle.addEventListener('change', async () => {
    const localOnly = el.localDetailOnlyToggle.checked;
    await state.renderer.setShowBasePoints(!localOnly);
    writeViewSettings({ localDetailOnly: localOnly });
    updatePointStatus();
  });
  el.murderBinariesToggle.addEventListener('change', () => {
    setMurderBinariesOverlay(el.murderBinariesToggle.checked, true);
  });
  el.routeToggle.addEventListener('change', () => {
    state.renderer.showRouteOverlay = el.routeToggle.checked;
    renderRouteBar();
    state.renderer.requestRender();
    writeViewSettings({ showRouteOverlay: el.routeToggle.checked });
    if (el.routeToggle.checked) {
      if (!state.routeOverlay) {
        setStatus('Route overlay enabled. Reading NavRoute.json...');
        startRouteAutoRefresh({ immediate: true });
      } else {
        startRouteAutoRefresh();
      }
    } else {
      stopRouteAutoRefresh();
      setStatus('Route overlay hidden.');
    }
  });
  el.refreshRoute.addEventListener('click', () => {
    refreshRouteOverlay().catch((error) => setStatus(`Route overlay failed: ${error.message}`));
  });
  for (const input of el.poiModeInputs) {
    input.addEventListener('change', () => {
      if (input.checked) setPoiMode(input.value, true);
    });
  }
  el.placeIsolateToggle.addEventListener('change', () => {
    setPlaceIsolation(el.placeIsolateToggle.checked, true);
  });
  el.resetView.addEventListener('click', () => state.renderer.resetOrientation());
  el.focusName.addEventListener('click', copyFocusName);
  el.noteText.addEventListener('input', () => {
    if (el.noteText.value.length > 512) el.noteText.value = el.noteText.value.slice(0, 512);
    updateNoteCount();
  });
  el.noteMenuClose.addEventListener('click', closeNoteMenu);
  el.noteCopyName.addEventListener('click', copyContextMenuSystemName);
  el.noteSave.addEventListener('click', () => saveActiveNote());
  el.noteDelete.addEventListener('click', () => saveActiveNote(''));
  el.noteSearch.addEventListener('input', () => {
    if (state.notesMode === 'search') loadNotes(el.noteSearch.value.trim()).catch((error) => console.warn(error));
  });
  for (const input of el.noteModeInputs) {
    input.addEventListener('change', () => {
      if (input.checked) setNotesMode(input.value, true);
    });
  }
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !el.noteMenu.hidden) closeNoteMenu();
    else if (event.key === 'Escape' && !el.llmSearchPanel.hidden) setLlmSearchOpen(false);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') stopRouteAutoRefresh();
    else startRouteAutoRefresh({ immediate: true });
  });
  el.recenterFocus.addEventListener('click', recenterFocus);
  el.returnLatestJournal.addEventListener('click', returnToLatestJournal);
  el.updatedFrom.addEventListener('change', loadPoints);
  el.updatedBefore.addEventListener('change', loadPoints);
  for (const [, input] of richFilterControls()) {
    input.addEventListener('change', saveAndApplyRichFilters);
  }
  for (const [, input] of richCategoryControls()) {
    input.addEventListener('change', saveAndApplyRichFilters);
  }
  el.minBodyCount.addEventListener('change', saveAndApplyRichFilters);
  el.clearRichFilters.addEventListener('click', clearRichFilters);
  el.refreshJournals.addEventListener('click', () => refreshJournals('latest'));
  el.scanLatestJournals.addEventListener('click', () => refreshJournals('latest'));
  el.scanAllJournals.addEventListener('click', () => refreshJournals('all'));
  el.shipJumpOverride.addEventListener('change', () => {
    const ship = state.visited?.currentShip;
    const key = currentShipKey(ship);
    if (!key) return;
    setShipJumpOverride(key, el.shipJumpOverride.value);
    renderCurrentShip();
  });
  el.clearShipJumpOverride.addEventListener('click', () => {
    const key = currentShipKey(state.visited?.currentShip);
    if (!key) return;
    setShipJumpOverride(key, null);
    renderCurrentShip();
  });
  for (const button of el.systemUpdateButtons) {
    button.addEventListener('click', () => {
      const confirmedLarge = button.dataset.largeUpdate === 'true';
      if (!confirmLargeSystemUpdate(button)) return;
      runSystemUpdate(button.dataset.systemUpdate, confirmedLarge);
    });
  }
  document.querySelectorAll('.nav-pad button').forEach((button) => {
    button.addEventListener('click', () => state.renderer.move(button.dataset.move));
  });
  state.renderer.onSelect = (index) => selectSystem(index, true);
  state.renderer.onHover = (hover) => showTooltip(hover);
  state.renderer.onSystemContext = (hit) => openNoteMenu(hit).catch((error) => {
    console.error(error);
    setStatus(`Could not open note editor: ${error.message}`);
  });
  state.renderer.onPlaceContext = openPlaceContextMenu;
  state.renderer.onRouteSelect = (hop) => focusRouteHop(hop);
  state.renderer.onPlaceSelect = (place) => focusPlace(place);
  state.renderer.onPlaceHover = (hover) => showPlaceTooltip(hover);
  state.renderer.onDrawCountChange = () => schedulePointStatusUpdate();
  state.renderer.onTargetChange = () => {
    scheduleMurderBinariesRefresh();
    scheduleLocalPointsRefresh();
    scheduleBioBandRefresh();
  };
}

function showPlaceTooltip(hover) {
  if (!hover?.place) {
    if (tooltipOwner === 'place') hideTooltip();
    return;
  }
  hoverRequestId += 1;
  clearTimeout(hoverFetchTimer);
  tooltipOwner = 'place';
  const distance = distanceLy(state.focus?.coords, hover.place.coords);
  const distanceText = distance === null ? '' : ` · ${fmt(distance)} ly`;
  el.tooltip.classList.remove('loading');
  el.tooltip.textContent = `${hover.place.name} · ${hover.place.category ?? 'Place'}${distanceText}`;
  el.tooltip.hidden = false;
  const viewport = el.tooltip.parentElement.getBoundingClientRect();
  const tooltip = el.tooltip.getBoundingClientRect();
  const left = Math.min(viewport.width - tooltip.width - 10, hover.x + 14);
  const top = Math.max(10, Math.min(viewport.height - tooltip.height - 10, hover.y - tooltip.height - 10));
  el.tooltip.style.left = `${left}px`;
  el.tooltip.style.top = `${top}px`;
}

async function init() {
  state.renderer = new GalaxyRenderer(el.canvas, el.overlay);
  const viewSettings = readViewSettings();
  setInspectorTab(viewSettings.inspectorTab ?? 'system', false);
  setInspectorCollapsed(viewSettings.inspectorCollapsed ?? false, false);
  updateLandmarks();
  el.visitedToggle.checked = viewSettings.showVisited ?? true;
  el.depthEmphasisToggle.checked = viewSettings.showDepthEmphasis ?? true;
  el.gridToggle.checked = viewSettings.showGrid ?? true;
  el.dropLinesToggle.checked = viewSettings.showDropLines ?? true;
  el.localDetailOnlyToggle.checked = viewSettings.localDetailOnly ?? false;
  el.sectorMapToggle.checked = viewSettings.showSectorMap ?? false;
  el.galaxyGlowToggle.checked = viewSettings.showGalaxyGlow ?? true;
  el.boxelToggle.checked = viewSettings.showBoxel ?? true;
  el.boxelGlowToggle.checked = viewSettings.boxelGlow ?? false;
  const savedParentBoxels = new Set(Array.isArray(viewSettings.parentBoxels) ? viewSettings.parentBoxels : []);
  for (const input of el.parentBoxelInputs) input.checked = savedParentBoxels.has(Number(input.value));
  el.nebulaToggle.checked = viewSettings.showNebulae ?? true;
  el.bioOverlayToggle.checked = viewSettings.bioOverlay ?? false;
  state.bio.level = [320, 640, 1280].includes(viewSettings.bioLevel) ? viewSettings.bioLevel : 640;
  for (const input of el.bioLevelInputs) input.checked = Number(input.value) === state.bio.level;
  state.bio.band = [0, 1, 3].includes(viewSettings.bioBand) ? viewSettings.bioBand : 0;
  for (const input of el.bioBandInputs) input.checked = Number(input.value) === state.bio.band;
  state.bio.selected = Array.isArray(viewSettings.bioSpecies) ? new Set(viewSettings.bioSpecies) : null;
  setAutoTarget(viewSettings.liveFollow ?? false);
  el.landmarksToggle.checked = viewSettings.showLandmarks ?? true;
  el.carrierMarkerToggle.checked = viewSettings.showCarrierMarker ?? true;
  el.carrierRangeToggle.checked = viewSettings.showCarrierRange ?? false;
  el.routeToggle.checked = viewSettings.showRouteOverlay ?? false;
  const savedMurderCategory = Array.isArray(viewSettings.placeCategories)
    && viewSettings.placeCategories.includes(murderBinariesCategory);
  el.murderBinariesToggle.checked = viewSettings.showMurderBinaries ?? savedMurderCategory ?? false;
  state.renderer.showVisited = el.visitedToggle.checked;
  state.renderer.setDepthEmphasis(el.depthEmphasisToggle.checked);
  state.renderer.showGrid = el.gridToggle.checked;
  state.renderer.showDropLines = el.dropLinesToggle.checked;
  await state.renderer.setShowBasePoints(!el.localDetailOnlyToggle.checked);
  state.renderer.showSectorMap = el.sectorMapToggle.checked;
  state.renderer.showGalaxyGlow = el.galaxyGlowToggle.checked;
  state.renderer.showBoxel = el.boxelToggle.checked;
  state.renderer.boxelGlow = el.boxelGlowToggle.checked;
  state.renderer.parentBoxelCodes = savedParentBoxels;
  state.renderer.onSelectedBoxelChange = updateBoxelControls;
  state.renderer.showNebulae = el.nebulaToggle.checked;
  state.renderer.showLandmarks = el.landmarksToggle.checked;
  state.renderer.showCarrierRange = el.carrierRangeToggle.checked;
  state.renderer.showRouteOverlay = el.routeToggle.checked;
  state.renderer.showMurderBinaries = el.murderBinariesToggle.checked;
  const savedStarScale = Number(viewSettings.starScalePercent);
  const migratedStarScale = Number(viewSettings.starScale) * 50;
  state.renderer.onStarScaleChange = displayAutoStarScale;
  applyStarScale(Number.isFinite(savedStarScale) && savedStarScale > 0
    ? savedStarScale
    : Number.isFinite(migratedStarScale) && migratedStarScale > 0
      ? migratedStarScale
      : 200, false);
  setStarScaleAuto(viewSettings.starScaleAuto ?? true, false);
  applyLlmSettingsToForm(readLlmSettings());
  setPoiMode(poiModeFromSettings(viewSettings), false);
  setPlaceIsolation(viewSettings.isolatePlaceFilters ?? false, false);
  setNotesMode(viewSettings.notesMode, false);
  bindControls();
  const ready = await loadStatus();
  loadLlmKeys();
  if (!ready) return;
  applyLlmSettingsToForm(readLlmSettings());
  updateLandmarks();
  resumeJournalScanIfRunning();
  resumeSystemUpdateIfRunning();
  startServerBusyWatch();
  connectLive();
  renderFilters();

  // Aim the camera straight from status data and start rendering now: the
  // grid and region map appear immediately while star points stream in.
  const latest = state.latestJournal;
  if (latest?.coords) focusSystem(latest.name, latest.coords);
  else focusSystem('Sol', state.meta.sol.coords);
  state.renderer.start();
  setStatus('Loading star map...');
  el.status.classList.add('loading');

  // Nearest stars first: the density-adaptive local sphere around the focus
  // renders (with working tooltips) while the global layers download.
  const localFirst = refreshLocalPointsNow({ radius: Math.max(250, localPointRadius()), limit: 25000 })
    .catch((error) => {
      if (!isAbortError(error)) console.warn(error);
    });
  await Promise.allSettled([
    localFirst,
    loadPoints({ progressive: true }),
    loadNotes(),
    loadPlaces(),
  ]);
  el.status.classList.remove('loading');
  // Selecting the latest journal system runs a server-side name search that
  // can starve the point streams, so it waits until the map is loaded.
  focusLatestJournal().catch((error) => console.warn(error));
  if (el.routeToggle.checked) startRouteAutoRefresh({ immediate: true });
}

async function searchLatestSystem(name, shouldFocus = false) {
  try {
    const response = await api(`/api/search?q=${encodeURIComponent(name)}&limit=12`);
    const data = await response.json();
    const exact = data.results.find((result) => systemKey(result.name) === systemKey(name));
    const match = exact ?? data.results[0];
    if (match) {
      await selectSystem(match.index, shouldFocus);
      return true;
    }
  } catch (error) {
    console.warn(error);
  }
  return false;
}

async function focusNoteSystem(note) {
  const response = await api(`/api/search?q=${encodeURIComponent(note.systemName)}&limit=12`);
  const data = await response.json();
  const exact = data.results.find((result) => systemKey(result.name) === systemKey(note.systemName));
  if (exact) {
    await selectSystem(exact.index, true);
    return;
  }
  if (note.coords && Number.isFinite(Number(note.coords.x)) && Number.isFinite(Number(note.coords.y)) && Number.isFinite(Number(note.coords.z))) {
    focusSystem(note.systemName, note.coords);
    state.renderer.setSelectedSystem({ name: note.systemName, coords: note.coords, mainStar: 'Unknown', visited: true });
    setStatus(`${note.systemName} is no longer indexed; focused its saved note coordinates.`);
    return;
  }
  throw new Error('No current system record or saved coordinates are available.');
}

init().catch((error) => {
  console.error(error);
  setStatus(error.message);
});
