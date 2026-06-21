import { GalaxyRenderer, colorsForType } from './renderer.js?v=false-color-grid-1';

const state = {
  meta: null,
  visited: null,
  renderer: null,
  enabledTypes: new Set(),
  searchResults: [],
  places: [],
  murderBinaryPlaces: [],
  visiblePlaces: [],
  placesMeta: null,
  carrierLocation: null,
  trackedCarrier: null,
  notes: [],
  notesMode: 'all',
  activeNoteSystem: null,
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
  richPointFiltersActive: false,
};

const el = {
  canvas: document.querySelector('#stars'),
  overlay: document.querySelector('#overlay'),
  search: document.querySelector('#search'),
  results: document.querySelector('#searchResults'),
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
  visitedToggle: document.querySelector('#visitedToggle'),
  gridToggle: document.querySelector('#gridToggle'),
  dropLinesToggle: document.querySelector('#dropLinesToggle'),
  landmarksToggle: document.querySelector('#landmarksToggle'),
  carrierRangeToggle: document.querySelector('#carrierRangeToggle'),
  murderBinariesToggle: document.querySelector('#murderBinariesToggle'),
  poiModeInputs: [...document.querySelectorAll('input[name="poiMode"]')],
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
  resetView: document.querySelector('#resetView'),
  tooltip: document.querySelector('#systemTooltip'),
  noteMenu: document.querySelector('#noteMenu'),
  noteMenuSystem: document.querySelector('#noteMenuSystem'),
  noteMenuClose: document.querySelector('#noteMenuClose'),
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
  richDataFilter: document.querySelector('#richDataFilter'),
  stationFilter: document.querySelector('#stationFilter'),
  populatedFilter: document.querySelector('#populatedFilter'),
  landableFilter: document.querySelector('#landableFilter'),
  marketFilter: document.querySelector('#marketFilter'),
  shipyardFilter: document.querySelector('#shipyardFilter'),
  outfittingFilter: document.querySelector('#outfittingFilter'),
  signalsFilter: document.querySelector('#signalsFilter'),
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
let focusCopyStatusTimer = null;
let journalScanPollTimer = null;
let systemUpdatePollTimer = null;
let murderBinariesRefreshTimer = null;
let murderBinariesRequestId = 0;
let localPointsRefreshTimer = null;
let localPointsRequestId = 0;
let starScaleFrame = null;
let tooltipOwner = null;
const tooltipCacheLimit = 180;
const tooltipCacheTtlMs = 5 * 60 * 1000;
const tooltipFetchDelayMs = 120;
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
    ['richData', el.richDataFilter],
    ['hasStations', el.stationFilter],
    ['populated', el.populatedFilter],
    ['landable', el.landableFilter],
    ['markets', el.marketFilter],
    ['shipyards', el.shipyardFilter],
    ['outfitting', el.outfittingFilter],
    ['signals', el.signalsFilter],
  ];
}

function richFiltersAvailable() {
  return Boolean(state.galaxyDetails?.imported && state.galaxyDetails?.mapFilters?.lodLevels?.length);
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
  for (const [name, input] of richFilterControls()) {
    input.disabled = !available;
    input.checked = available ? Boolean(settings.richFilters?.[name]) : false;
  }
  el.minBodyCount.disabled = !available;
  el.clearRichFilters.disabled = !available;
  el.minBodyCount.value = available ? String(Math.max(0, Number(settings.richFilters?.minBodies ?? 0))) : '0';
  for (const [name, input] of richCategoryControls()) {
    input.disabled = !categoriesAvailable;
    input.value = categoriesAvailable ? String(settings.richFilters?.[name] ?? '') : '';
  }
  if (!available) {
    el.richFiltersSummary.textContent = state.galaxyDetails?.imported
      ? 'Reimport galaxy.json.gz to build map filter indexes.'
      : 'Import galaxy.json.gz to enable these filters.';
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

function saveAndApplyRichFilters() {
  writeViewSettings({ richFilters: richFilterSettings() });
  loadPoints().catch((error) => {
    console.error(error);
    setStatus(`Could not apply full-data filters: ${error.message}`);
  });
}

function clearRichFilters() {
  for (const [, input] of richFilterControls()) input.checked = false;
  for (const [, input] of richCategoryControls()) input.value = '';
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
  const label = scan.mode === 'all' ? 'All scan' : 'Latest scan';
  const elapsed = scan.startedAt ? elapsedText(scan.startedAt) : '0:00';
  setStatus(`${label} ${elapsed} · ${scan.message ?? 'working'}`);
}

function setSystemUpdateStatus(update) {
  const label = update?.mode === 'places'
    ? 'Places update'
    : update?.mode === 'discoveries'
      ? 'Discoveries update'
      : update?.mode === 'murder-binaries'
        ? 'Murder Binaries analysis'
      : update?.mode === 'galaxy'
        ? 'Full galaxy import'
    : update?.mode
      ? `Systems ${update.mode}`
      : 'Data update';
  const elapsed = update?.startedAt ? elapsedText(update.startedAt) : '0:00';
  const message = `${label} ${elapsed} · ${update?.step ?? 'running'} · ${update?.message ?? 'working'}`;
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
  state.latestJournal = data.visited?.latestSystem ?? null;
  state.carrierLocation = data.visited?.carrierLocation ?? null;
  state.trackedCarrier = data.runtimeConfig?.trackedCarrier ?? null;
  state.systemUpdates = data.systemUpdates ?? null;
  state.galaxyDetails = data.galaxyDetails ?? null;
  state.spatialIndex = data.spatialIndex ?? null;

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
    const enabled = predicate(item.group);
    item.input.checked = enabled;
    for (const code of item.group.codes) {
      if (enabled) state.enabledTypes.add(code);
    }
  }
  loadPoints();
}

function renderFilterActions() {
  const actions = [
    ['All', () => true],
    ['None', () => false],
    ['Main', isMainSequenceGroup],
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
      <dt>Coords</dt><dd>${coordsText(system.coords)}</dd>
      <dt>Permit</dt><dd>${system.needsPermit ? 'Required' : 'No'}</dd>
      <dt>Visited</dt><dd>${system.visited ? 'Yes' : 'No'}</dd>
      <dt>Source</dt><dd>${escapeHtml(system.source ?? 'Unknown')}</dd>
      <dt>Last updated</dt><dd>${localDateTime(system.updateTime)}</dd>
      <dt>Icon</dt><dd>${system.nonStandard ? 'Special primary' : 'Standard star'}</dd>
      ${system.lastVisited ? `<dt>Last visit</dt><dd>${new Date(system.lastVisited).toLocaleString()}</dd>` : ''}
      ${note ? `<dt>Note</dt><dd class="note-inline">${note}</dd>` : ''}
    </dl>
  `;
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

function bodyBadges(body) {
  const badges = [];
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

function bodyHtml(body, index) {
  const subtype = body.subType ?? body.type ?? 'Unknown body';
  const badges = bodyBadges(body);
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
        <span class="body-ordinal">${String(body.bodyId ?? index).padStart(2, '0')}</span>
        <span class="body-title">
          <strong>${escapeHtml(body.name ?? `Body ${index + 1}`)}</strong>
          <small>${escapeHtml(subtype)}</small>
        </span>
        <span class="body-badges">${badges.map((badge) => `<i>${escapeHtml(badge)}</i>`).join('')}</span>
      </summary>
      <div class="body-detail">
        <dl>${details || '<dt>Details</dt><dd>No additional fields recorded</dd>'}</dl>
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
  const bodies = Array.isArray(system.bodies) ? system.bodies : [];
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
    ? bodies.map(bodyHtml).join('')
    : '<div class="section muted">No body records are available for this system.</div>';
}

async function loadSelectedBodies() {
  const selected = state.selectedSystem;
  if (!selected?.id64 && !selected?.name) {
    renderBodiesError('Select a system to view its body data.');
    return;
  }
  const key = `${selected.id64 ?? ''}:${selected.name ?? ''}`;
  const cached = richSystemCache.get(key);
  if (cached) {
    state.richSystem = cached;
    renderRichSystem(cached);
    return;
  }
  const requestId = ++richSystemRequestId;
  el.bodiesState.textContent = `Loading full data for ${selected.name}...`;
  el.bodySystemSummary.hidden = true;
  el.bodyList.replaceChildren();
  try {
    const params = new URLSearchParams();
    if (selected.id64) params.set('id64', String(selected.id64));
    if (selected.name) params.set('name', selected.name);
    const response = await api(`/api/system-rich?${params.toString()}`);
    const data = await response.json();
    if (requestId !== richSystemRequestId) return;
    richSystemCache.set(key, data);
    if (richSystemCache.size > 24) richSystemCache.delete(richSystemCache.keys().next().value);
    state.richSystem = data;
    renderRichSystem(data);
  } catch (error) {
    if (requestId !== richSystemRequestId) return;
    renderBodiesError(error.message.includes('Not Found')
      ? 'No full body record was found for this system.'
      : `Could not load body data: ${error.message}`);
  }
}

function selectedPlaceHtml(place) {
  const distance = distanceLy(state.focus?.coords, place.coords);
  return `
    <h2>${place.name}</h2>
    <div class="muted">${place.category ?? 'Place of interest'}</div>
    <dl>
      <dt>Coords</dt><dd>${coordsText(place.coords)}</dd>
      <dt>System</dt><dd>${place.systemName ?? 'Unknown'}</dd>
      ${place.stale ? `<dt>Status</dt><dd>Last known position. Latest journal system is ${place.unresolvedSystemName ?? 'unknown'}.</dd>` : ''}
      <dt>Source</dt><dd>${place.source ?? 'Unknown'}</dd>
      <dt>Group</dt><dd>${place.sourceGroup ?? 'Unknown'}</dd>
      <dt>Type</dt><dd>${place.typeLabel ?? place.type ?? 'Unknown'}</dd>
      <dt>Distance</dt><dd>${distance === null ? 'Unknown' : `${fmt(distance)} ly from focus`}</dd>
      ${place.description ? `<dt>Notes</dt><dd>${place.description}</dd>` : ''}
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
  el.tooltip.textContent = '';
}

async function showTooltip(hover) {
  if (!hover || !Number.isInteger(hover.index) || hover.index < 0) {
    hoverRequestId += 1;
    clearTimeout(hoverFetchTimer);
    if (tooltipOwner === 'system') hideTooltip();
    return;
  }
  const requestId = ++hoverRequestId;
  const cached = getCachedSystem(hover.index);
  if (cached) {
    renderTooltip(cached, hover.x, hover.y);
    return;
  }
  clearTimeout(hoverFetchTimer);
  const wait = Math.max(tooltipFetchDelayMs, tooltipFetchDelayMs - (Date.now() - lastHoverFetchAt));
  hoverFetchTimer = setTimeout(() => fetchTooltipSystem(hover, requestId), wait);
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
  el.tooltip.textContent = distance === null
    ? `${system.name}${typeText}${note}`
    : `${system.name}${typeText} · ${fmt(distance)} ly${note}`;
  el.tooltip.hidden = false;
  const viewport = el.tooltip.parentElement.getBoundingClientRect();
  const tooltip = el.tooltip.getBoundingClientRect();
  const left = Math.min(viewport.width - tooltip.width - 10, x + 14);
  const top = Math.max(10, Math.min(viewport.height - tooltip.height - 10, y - tooltip.height - 10));
  el.tooltip.style.left = `${left}px`;
  el.tooltip.style.top = `${top}px`;
}

function focusSystem(name, coords) {
  state.focus = { name, coords };
  el.focusName.textContent = name;
  el.focusCoords.textContent = coordsText(coords);
  state.renderer.setTarget(coords.x, coords.y, coords.z);
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
  el.noteMenuSystem.textContent = system.name;
  el.noteText.value = system.note?.text ?? '';
  updateNoteCount();
  positionNoteMenu(hit.x, hit.y);
  el.noteText.focus();
}

function closeNoteMenu() {
  state.activeNoteSystem = null;
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
  const response = await api(`/api/notes${params}`);
  const data = await response.json();
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

function updateLandmarks() {
  const carrier = currentCarrierTarget();
  const landmarks = [
    { name: 'Sol', shortName: 'Sol', coords: state.meta?.sol?.coords ?? { x: 0, y: 0, z: 0 }, color: '#42d1c7' },
    { name: 'Sagittarius A*', shortName: 'Sgr A*', coords: { x: 25.21875, y: -20.90625, z: 25899.96875 }, color: '#f2a541' },
    coloniaLandmark,
  ];
  if (carrier) {
    const carrierLabel = carrier.name ?? carrierDisplayName();
    landmarks.push({ name: carrierLabel, shortName: carrierLabel, coords: carrier.coords, color: '#b6ff00', hideWhenPlaceLabelVisible: true });
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
  if (await searchLatestSystem(latest.name, true)) return true;
  if (latest.coords) {
    focusSystem(latest.name, latest.coords);
    state.renderer.setSelectedSystem({
      name: latest.name,
      coords: latest.coords,
      mainStar: 'Unknown',
      visited: true,
    });
    return true;
  }
  return false;
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
  setStatus(all ? 'All scan 0:00 · starting' : 'Latest scan 0:00 · starting');
  try {
    const path = all ? '/api/refresh-journals?mode=all' : '/api/refresh-journals?mode=latest&count=20';
    const response = await api(path, { method: 'POST' });
    const result = await response.json();
    await pollJournalScan(result.scan);
  } catch (error) {
    console.error(error);
    setStatus(`Journal scan failed: ${error.message}`);
    setJournalButtonsDisabled(false);
  }
}

async function pollJournalScan(scan) {
  if (scan) setScanStatus(scan);
  if (scan && !scan.running) {
    if (!scan.ok) {
      const detail = (scan.stderr || scan.stdout || '').trim();
      throw new Error(detail || `Journal scan exited with code ${scan.code}.`);
    }
    await loadStatus();
    await loadPlaces();
    systemCache.clear();
    await loadNotes();
    await loadPoints();
    richSystemCache.clear();
    if (state.selectedSystem) await loadSelectedBodies();
    setStatus(scan.message || 'Journal data refreshed.');
    setJournalButtonsDisabled(false);
    return;
  }
  journalScanPollTimer = setTimeout(async () => {
    try {
      const response = await api('/api/journal-scan-status');
      const nextScan = await response.json();
      await pollJournalScan(nextScan);
    } catch (error) {
      console.error(error);
      setStatus(`Journal scan status failed: ${error.message}`);
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
      setStatus(`System update status failed: ${error.message}`);
      el.systemUpdateStatus.textContent = `Status failed: ${error.message}`;
      setDownloadProgress('', false);
      setSystemButtonsDisabled(false);
    }
  }, 1000);
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

async function loadPoints() {
  if (state.enabledTypes.size === 0) {
    state.renderer.setPoints(new ArrayBuffer(0), state.meta);
    state.renderer.setLocalPoints(new ArrayBuffer(0), state.meta);
    state.basePointCount = 0;
    state.localPointCount = 0;
    setStatus('0 systems · filters hidden · search still works');
    return;
  }
  const params = new URLSearchParams({
    types: [...state.enabledTypes].join(','),
    limit: '300000',
  });
  if (!el.updatedFrom.disabled && el.updatedFrom.value) params.set('updatedFrom', el.updatedFrom.value);
  if (!el.updatedBefore.disabled && el.updatedBefore.value) params.set('updatedBefore', el.updatedBefore.value);
  if (richFiltersAvailable()) {
    const rich = richFilterSettings();
    if (rich.richData) params.set('richData', '1');
    if (rich.hasStations) params.set('hasStations', '1');
    if (rich.populated) params.set('populated', '1');
    if (rich.landable) params.set('landable', '1');
    if (rich.markets) params.set('markets', '1');
    if (rich.shipyards) params.set('shipyards', '1');
    if (rich.outfitting) params.set('outfitting', '1');
    if (rich.signals) params.set('signals', '1');
    if (rich.minBodies > 0) params.set('minBodies', String(rich.minBodies));
    if (richCategoryFiltersAvailable()) {
      if (rich.bodyType) params.set('bodyType', rich.bodyType);
      if (rich.atmosphere) params.set('atmosphere', rich.atmosphere);
      if (rich.ringType) params.set('ringType', rich.ringType);
      if (rich.volcanism) params.set('volcanism', rich.volcanism);
      if (rich.economy) params.set('economy', rich.economy);
      if (rich.security) params.set('security', rich.security);
      if (rich.government) params.set('government', rich.government);
    }
  }
  const response = await api(`/api/points?${params.toString()}`);
  const buffer = await response.arrayBuffer();
  const lod = response.headers.get('x-lod-level');
  const richFiltersActive = response.headers.get('x-rich-filters') === '1';
  state.basePointCount = buffer.byteLength / 20;
  state.baseLod = lod;
  state.richPointFiltersActive = richFiltersActive;
  state.renderer.setPoints(buffer, state.meta);
  if (richFiltersActive || !state.spatialIndex) {
    state.localPointCount = 0;
    state.localRadius = null;
    state.renderer.setLocalPoints(new ArrayBuffer(0), state.meta);
  } else {
    scheduleLocalPointsRefresh(0);
  }
  updatePointStatus();
}

function updatePointStatus() {
  const richSuffix = state.richPointFiltersActive ? ' · full-data filters active' : '';
  const localSuffix = state.localPointCount
    ? ` + ${fmt(state.localPointCount)} local within ${fmt(state.localRadius)} ly`
    : '';
  const displayed = fmt(state.renderer?.allPoints?.length ?? state.basePointCount);
  setStatus(
    `${displayed} systems · LOD ${state.baseLod}${localSuffix}${richSuffix} · search overrides filters`,
    `Displaying ${fmt(state.basePointCount)} global systems from LOD ${state.baseLod}${localSuffix}${state.richPointFiltersActive ? ' with full-data filters applied' : ''}. Nearby spatial detail receives rendering priority.`
  );
}

function scheduleLocalPointsRefresh(delay = 450) {
  clearTimeout(localPointsRefreshTimer);
  const requestId = ++localPointsRequestId;
  if (!state.spatialIndex || state.richPointFiltersActive || state.enabledTypes.size === 0) return;
  const limit = state.renderer.localPointLimit();
  if (limit <= 0) {
    if (state.localPointCount > 0) {
      state.localPointCount = 0;
      state.localRadius = null;
      state.renderer.setLocalPoints(new ArrayBuffer(0), state.meta);
      updatePointStatus();
    }
    return;
  }
  localPointsRefreshTimer = setTimeout(() => refreshLocalPoints(requestId, limit).catch((error) => {
    console.warn(error);
    setStatus(`Local system detail failed: ${error.message}`);
  }), delay);
}

async function refreshLocalPoints(requestId, limit) {
  const coords = state.renderer.targetCoords();
  const params = new URLSearchParams({
    x: String(coords.x),
    y: String(coords.y),
    z: String(coords.z),
    types: [...state.enabledTypes].join(','),
    limit: String(limit),
  });
  if (!el.updatedFrom.disabled && el.updatedFrom.value) params.set('updatedFrom', el.updatedFrom.value);
  if (!el.updatedBefore.disabled && el.updatedBefore.value) params.set('updatedBefore', el.updatedBefore.value);
  const response = await api(`/api/local-points?${params.toString()}`);
  const buffer = await response.arrayBuffer();
  if (requestId !== localPointsRequestId) return;
  state.localPointCount = buffer.byteLength / 20;
  state.localRadius = Number(response.headers.get('x-local-radius') ?? 0);
  state.renderer.setLocalPoints(buffer, state.meta);
  updatePointStatus();
}

async function loadPlaces() {
  try {
    const response = await api('/api/places');
    const data = await response.json();
    state.places = applyCarrierOverride(data.places ?? []);
    state.placesMeta = data.imported ? data : state.placesMeta;
    renderPlaceFilters();
    applyPlaceFilters();
    if (el.murderBinariesToggle.checked && !el.murderBinariesToggle.disabled) {
      scheduleMurderBinariesRefresh(0);
    }
    if (data.imported) {
      updatePlacesSummary();
    }
  } catch (error) {
    console.warn(error);
    state.places = [];
    state.renderer.setPlaces([]);
  }
}

function updatePlacesSummary() {
  const meta = state.placesMeta;
  if (!meta?.imported && !meta?.count) return;
  const discoveryText = meta.discoveries?.count ? ` including ${fmt(meta.discoveries.count)} discoveries;` : '';
  const shown = !state.renderer?.showPlaces
    ? 'overlay hidden'
    : state.renderer?.showAllPlaces
      ? 'showing all'
      : 'showing nearest 50';
  const filtered = state.visiblePlaces.length !== state.places.length
    ? ` ${fmt(state.visiblePlaces.length)} after filters;`
    : '';
  el.placesSummary.textContent = `${fmt(meta.count)} places loaded from ${meta.source};${discoveryText}${filtered} ${shown}.`;
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
  const regularPlaces = state.places.filter((place) => state.enabledPlaceCategories.has(place.category ?? 'Other POIs'));
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
    const match = result.matchType === 'startsWith' ? 'Starts' : result.matchType === 'contains' ? 'Contains' : 'Fuzzy';
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

async function search() {
  const q = el.search.value.trim();
  if (q.length < 3) {
    searchRequestId += 1;
    renderSearchResults([]);
    return;
  }
  const requestId = ++searchRequestId;
  const response = await api(`/api/search?q=${encodeURIComponent(q)}&limit=25`);
  const data = await response.json();
  if (requestId !== searchRequestId) return;
  renderSearchResults(data.results, data.message);
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
    writeViewSettings({ showVisited: el.visitedToggle.checked });
  });
  el.starScale.addEventListener('input', () => {
    if (el.starScaleAuto.checked) setStarScaleAuto(false, true);
    applyStarScale(el.starScale.value);
  });
  el.starScale.addEventListener('change', () => applyStarScale(el.starScale.value, true));
  el.starScaleAuto.addEventListener('change', () => setStarScaleAuto(el.starScaleAuto.checked, true));
  el.gridToggle.addEventListener('change', () => {
    state.renderer.showGrid = el.gridToggle.checked;
    writeViewSettings({ showGrid: el.gridToggle.checked });
  });
  el.dropLinesToggle.addEventListener('change', () => {
    state.renderer.showDropLines = el.dropLinesToggle.checked;
    writeViewSettings({ showDropLines: el.dropLinesToggle.checked });
  });
  el.landmarksToggle.addEventListener('change', () => {
    state.renderer.showLandmarks = el.landmarksToggle.checked;
    writeViewSettings({ showLandmarks: el.landmarksToggle.checked });
  });
  el.carrierRangeToggle.addEventListener('change', () => {
    state.renderer.showCarrierRange = el.carrierRangeToggle.checked;
    writeViewSettings({ showCarrierRange: el.carrierRangeToggle.checked });
  });
  el.murderBinariesToggle.addEventListener('change', () => {
    setMurderBinariesOverlay(el.murderBinariesToggle.checked, true);
  });
  for (const input of el.poiModeInputs) {
    input.addEventListener('change', () => {
      if (input.checked) setPoiMode(input.value, true);
    });
  }
  el.resetView.addEventListener('click', () => state.renderer.resetOrientation());
  el.focusName.addEventListener('click', copyFocusName);
  el.noteText.addEventListener('input', () => {
    if (el.noteText.value.length > 512) el.noteText.value = el.noteText.value.slice(0, 512);
    updateNoteCount();
  });
  el.noteMenuClose.addEventListener('click', closeNoteMenu);
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
  state.renderer.onPlaceSelect = (place) => focusPlace(place);
  state.renderer.onPlaceHover = (hover) => showPlaceTooltip(hover);
  state.renderer.onTargetChange = () => {
    scheduleMurderBinariesRefresh();
    scheduleLocalPointsRefresh();
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
  el.gridToggle.checked = viewSettings.showGrid ?? true;
  el.dropLinesToggle.checked = viewSettings.showDropLines ?? true;
  el.landmarksToggle.checked = viewSettings.showLandmarks ?? true;
  el.carrierRangeToggle.checked = viewSettings.showCarrierRange ?? false;
  const savedMurderCategory = Array.isArray(viewSettings.placeCategories)
    && viewSettings.placeCategories.includes(murderBinariesCategory);
  el.murderBinariesToggle.checked = viewSettings.showMurderBinaries ?? savedMurderCategory ?? false;
  state.renderer.showVisited = el.visitedToggle.checked;
  state.renderer.showGrid = el.gridToggle.checked;
  state.renderer.showDropLines = el.dropLinesToggle.checked;
  state.renderer.showLandmarks = el.landmarksToggle.checked;
  state.renderer.showCarrierRange = el.carrierRangeToggle.checked;
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
  setPoiMode(poiModeFromSettings(viewSettings), false);
  setNotesMode(viewSettings.notesMode, false);
  bindControls();
  const ready = await loadStatus();
  if (!ready) return;
  updateLandmarks();
  resumeJournalScanIfRunning();
  resumeSystemUpdateIfRunning();
  renderFilters();
  await loadNotes();
  await loadPlaces();

  if (!(await focusLatestJournal())) {
    focusSystem('Sol', state.meta.sol.coords);
  }

  await loadPoints();
  state.renderer.start();
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
