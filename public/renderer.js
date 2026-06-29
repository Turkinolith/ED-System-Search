const vertexShader = `
attribute vec3 a_position;
attribute vec3 a_color;
attribute float a_size;
attribute float a_style;
attribute float a_phase;
attribute float a_alpha;
uniform mat4 u_matrix;
uniform float u_pixel_ratio;
varying vec3 v_color;
varying float v_style;
varying float v_phase;
varying float v_alpha;
void main() {
  gl_Position = u_matrix * vec4(a_position, 1.0);
  gl_PointSize = a_size * u_pixel_ratio;
  v_color = a_color;
  v_style = a_style;
  v_phase = a_phase;
  v_alpha = a_alpha;
}
`;

const fragmentShader = `
precision mediump float;
varying vec3 v_color;
varying float v_style;
varying float v_phase;
varying float v_alpha;
void main() {
  vec2 p = (gl_PointCoord - vec2(0.5)) * 2.0;
  float radius = length(p);
  if (radius > 1.0) discard;

  float angle = v_phase * 6.2831853;
  float cs = cos(angle);
  float sn = sin(angle);
  vec2 q = vec2(p.x * cs - p.y * sn, p.x * sn + p.y * cs);

  float halo = exp(-radius * radius * 3.2) * (1.0 - smoothstep(0.58, 1.0, radius));
  float coreRadius = v_style > 4.5 && v_style < 6.5 ? 0.29 : 0.23;
  float core = 1.0 - smoothstep(0.0, coreRadius, radius);
  float horizontal = exp(-abs(q.y) * 34.0) * (1.0 - smoothstep(0.12, 0.95, abs(q.x)));
  float vertical = exp(-abs(q.x) * 38.0) * (1.0 - smoothstep(0.1, 0.82, abs(q.y)));
  float diagonalA = exp(-abs(q.x - q.y) * 23.0) * (1.0 - smoothstep(0.12, 0.72, radius));
  float diagonalB = exp(-abs(q.x + q.y) * 23.0) * (1.0 - smoothstep(0.12, 0.72, radius));

  float spikeStrength = 0.34;
  if (v_style > 0.5 && v_style < 2.5) spikeStrength = 0.46;
  if (v_style > 2.5 && v_style < 4.5) spikeStrength = 0.55;
  if (v_style > 4.5 && v_style < 5.5) spikeStrength = 0.22;
  if (v_style > 5.5 && v_style < 6.5) spikeStrength = 0.78;
  if (v_style > 6.5 && v_style < 7.5) spikeStrength = 0.5;
  if (v_style > 7.5) spikeStrength = 0.18;

  float spikes = (horizontal + vertical * 0.82) * spikeStrength;
  if (v_style > 1.5 && v_style < 4.5) spikes += (diagonalA + diagonalB) * 0.12;
  if (v_style > 5.5 && v_style < 6.5) spikes += (diagonalA + diagonalB) * 0.3;

  float intensity = halo * 0.72 + core * 1.55 + spikes;
  vec3 hotCore = mix(v_color, vec3(1.0), clamp(core * 0.88 + spikes * 0.12, 0.0, 0.92));
  float alpha = clamp(halo * 0.48 + core + spikes * 0.42, 0.0, 1.0);
  gl_FragColor = vec4(hotCore * intensity, alpha * v_alpha);
}
`;

function shader(gl, type, source) {
  const s = gl.createShader(type);
  gl.shaderSource(s, source);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

function program(gl) {
  const p = gl.createProgram();
  gl.attachShader(p, shader(gl, gl.VERTEX_SHADER, vertexShader));
  gl.attachShader(p, shader(gl, gl.FRAGMENT_SHADER, fragmentShader));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

function identity() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let r = 0; r < 4; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      out[c * 4 + r] = a[0 * 4 + r] * b[c * 4 + 0]
        + a[1 * 4 + r] * b[c * 4 + 1]
        + a[2 * 4 + r] * b[c * 4 + 2]
        + a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

function perspective(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2);
  const rangeInv = 1 / (near - far);
  return [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (near + far) * rangeInv, -1,
    0, 0, near * far * rangeInv * 2, 0,
  ];
}

function lookAt(eye, target, up) {
  const z = normalize([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
  const x = normalize(cross(up, z));
  const y = cross(z, x);
  return [
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
  ];
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function transform(matrix, point) {
  const x = point[0];
  const y = point[1];
  const z = point[2];
  const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  return [
    (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / w,
    (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / w,
    (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) / w,
    w,
  ];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function roundedRect(ctx, x, y, width, height, radius = 5) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function stableBucket(value) {
  let x = (value ^ 0x9e3779b9) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}

function toRenderCoords(coords) {
  return {
    x: -Number(coords.x ?? 0),
    y: Number(coords.y ?? 0),
    z: Number(coords.z ?? 0),
  };
}

function fromRenderCoords(coords) {
  return {
    x: -Number(coords.x ?? 0),
    y: Number(coords.y ?? 0),
    z: Number(coords.z ?? 0),
  };
}

function isTextInputActive() {
  const active = document.activeElement;
  if (!active) return false;
  const tag = active.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || active.isContentEditable;
}

export function colorsForType(typeName = '') {
  return starVisual(typeName).color;
}

export function isGiantStarType(typeName = '') {
  return /\b(?:super giant|giant)\b.*\bStar$/i.test(String(typeName));
}

export function zoomStarScalePercent(distance) {
  const nearDistance = 850;
  const farDistance = 30000;
  const logarithmic = Math.log(Math.max(nearDistance, Number(distance) || nearDistance) / nearDistance)
    / Math.log(farDistance / nearDistance);
  const progress = clamp(logarithmic, 0, 1);
  const eased = progress * progress * (3 - 2 * progress);
  return 300 + (60 - 300) * eased;
}

export function zoomDrawBudget(distance) {
  if (distance < 2500) {
    return Math.round(clamp(48000 * Math.pow(60 / Math.max(60, distance), 0.28), 14000, 48000));
  }
  if (distance < 7500) return 70000;
  return 110000;
}

export function zoomLocalPointLimit(distance) {
  if (distance < 2500) {
    return Math.round(clamp(70000 * Math.pow(60 / Math.max(60, distance), 0.25), 20000, 70000));
  }
  return 0;
}

function quickselectPrefix(items, count, score) {
  if (count <= 0 || count >= items.length) return;
  const swap = (a, b) => {
    [items[a], items[b]] = [items[b], items[a]];
  };
  const partition = (left, right, pivotIndex) => {
    const pivotScore = score(items[pivotIndex]);
    swap(pivotIndex, right);
    let storeIndex = left;
    for (let index = left; index < right; index += 1) {
      if (score(items[index]) < pivotScore) {
        swap(storeIndex, index);
        storeIndex += 1;
      }
    }
    swap(right, storeIndex);
    return storeIndex;
  };

  const target = count - 1;
  let left = 0;
  let right = items.length - 1;
  while (left < right) {
    const pivot = partition(left, right, Math.floor((left + right) / 2));
    if (pivot === target) return;
    if (pivot < target) left = pivot + 1;
    else right = pivot - 1;
  }
}

export function prioritizeDrawCandidates(candidates, limit, nearFraction = 0.8) {
  if (limit <= 0 || candidates.length === 0) return [];
  if (candidates.length <= limit) return candidates;
  const nearestCount = Math.max(1, Math.min(limit, Math.floor(limit * nearFraction)));
  quickselectPrefix(candidates, nearestCount, (item) => item.distanceSq);
  const nearest = candidates.slice(0, nearestCount);
  const context = candidates.slice(nearestCount);
  const contextCount = limit - nearestCount;
  quickselectPrefix(context, contextCount, (item) => item.point.bucket);
  return [...nearest, ...context.slice(0, contextCount)];
}

export function densityPriorityFraction(candidateCount, nearbyCount, limit) {
  if (limit <= 0 || candidateCount <= limit) return 1;
  const totalPressure = candidateCount / limit;
  const localPressure = nearbyCount / limit;
  const pressure = Math.max(1, totalPressure, 1 + localPressure * 4);
  return Math.min(0.97, Math.max(0.75, 0.75 + Math.log2(pressure) * 0.1));
}

export function gridDepthEmphasis(height, step) {
  const gridStep = Math.max(1, Number(step) || 1);
  const distance = Math.abs(Number(height) || 0);
  const fullBand = gridStep * 2;
  const fadeEnd = gridStep * 8;
  const progress = clamp((distance - fullBand) / Math.max(1, fadeEnd - fullBand), 0, 1);
  const eased = progress * progress * (3 - 2 * progress);
  const nearBoost = 1 - clamp(distance / fullBand, 0, 1);
  return {
    alpha: 1 - eased * 0.78,
    size: 1 + nearBoost * 0.15 - eased * 0.26,
  };
}

export function dropLineAnchorRange(points, target) {
  if (!Array.isArray(points) || points.length === 0 || !Array.isArray(target)) return 0;
  return points.reduce((max, point) => Math.max(
    max,
    Math.hypot(point.x - target[0], point.y - target[1], point.z - target[2]),
  ), 0);
}

export function formatDistanceBadge(value) {
  const distance = Number(value);
  if (!Number.isFinite(distance) || distance <= 0) return '0';
  if (distance < 100) return distance.toFixed(1);
  return Math.round(distance).toLocaleString();
}

const regionMapUrl = '/api/regions';

export function visitedBraceGeometry(radius = 9) {
  const height = radius;
  const inner = radius * 0.72;
  const outer = radius * 1.2;
  return [-1, 1].map((side) => ({
    start: [side * inner, -height],
    curves: [
      [side * outer, -height, side * outer, -height * 0.7, side * outer, -height * 0.45],
      [side * outer, -height * 0.15, side * inner, -height * 0.15, side * inner, 0],
      [side * inner, height * 0.15, side * outer, height * 0.15, side * outer, height * 0.45],
      [side * outer, height * 0.7, side * outer, height, side * inner, height],
    ],
  }));
}

export function starVisual(typeName = '') {
  let color = [0.72, 0.78, 0.82];
  let size = 5.2;
  let style = 0;

  if (typeName.includes('Black Hole')) return { color: [0.48, 0.38, 0.92], size: 6.4, style: 8 };
  if (typeName.includes('Neutron')) return { color: [0.62, 0.9, 1.0], size: 7.2, style: 7 };
  if (typeName.includes('White Dwarf')) return { color: [0.82, 0.9, 1.0], size: 7.0, style: 7 };
  if (typeName.includes('Herbig') || typeName.includes('T Tauri')) return { color: [1.0, 0.12, 0.18], size: 9.5, style: 6 };
  if (typeName.includes('Wolf-Rayet')) return { color: [0.48, 0.9, 1.0], size: 9.2, style: 1 };

  const spectral = typeName.match(/^([OBAFGKMLTY])\b/i)?.[1]?.toUpperCase();
  if (spectral === 'O') ({ color, size, style } = { color: [0.24, 0.34, 1.0], size: 7.8, style: 1 });
  else if (spectral === 'B') ({ color, size, style } = { color: [0.4, 0.42, 1.0], size: 7.4, style: 1 });
  else if (spectral === 'A') ({ color, size, style } = { color: [0.74, 0.68, 1.0], size: 7.0, style: 2 });
  else if (spectral === 'F') ({ color, size, style } = { color: [0.9, 0.94, 1.0], size: 6.5, style: 2 });
  else if (spectral === 'G') ({ color, size, style } = { color: [1.0, 0.92, 0.7], size: 6.4, style: 3 });
  else if (spectral === 'K') ({ color, size, style } = { color: [1.0, 0.58, 0.2], size: 6.1, style: 3 });
  else if (spectral === 'M') ({ color, size, style } = { color: [1.0, 0.3, 0.08], size: 6.2, style: 4 });
  else if (spectral === 'L') ({ color, size, style } = { color: [0.95, 0.18, 0.08], size: 5.3, style: 5 });
  else if (spectral === 'T') ({ color, size, style } = { color: [1.0, 0.06, 0.16], size: 4.9, style: 5 });
  else if (spectral === 'Y') ({ color, size, style } = { color: [1.0, 0.05, 0.1], size: 4.6, style: 5 });
  else if (/C Star|CJ Star|CN Star|S-type|MS-type/i.test(typeName)) ({ color, size, style } = { color: [1.0, 0.22, 0.1], size: 7.4, style: 4 });

  if (/super giant/i.test(typeName)) size *= 2.05;
  else if (/giant/i.test(typeName)) size *= 1.55;
  return { color, size, style };
}

function specialKind(typeName = '') {
  if (typeName.includes('Black Hole')) return 'blackHole';
  if (typeName.includes('Neutron')) return 'neutron';
  if (typeName.includes('White Dwarf')) return 'whiteDwarf';
  if (typeName.includes('T Tauri') || typeName.includes('Herbig')) return 'triangle';
  if (/Wolf-Rayet|C Star|CJ Star|CN Star|S-type|MS-type/i.test(typeName)) return 'other';
  return '';
}

function placeStyle(place) {
  const category = place?.category ?? 'Other POIs';
  if (category === 'Murder Binaries') return { color: '#ff334f', shape: 'hazard' };
  if (category === 'AA-A h Sectors') return { color: '#ff4d6d', shape: 'hex' };
  if (category === 'Rare Valuable Systems') return { color: '#f9d65c', shape: 'star' };
  if (category === 'Close Landables') return { color: '#65f4b6', shape: 'triangle' };
  if (place?.sourceGroup === 'Explorarium') {
    const key = String(category).toLowerCase();
    if (/collid|collision/.test(key)) return { color: '#ff6b6b', shape: 'diamond' };
    if (/ring/.test(key)) return { color: '#58a6ff', shape: 'circle' };
    if (/giant|gas/.test(key)) return { color: '#ffa657', shape: 'hex' };
    if (/landable|atmospheric|bio/.test(key)) return { color: '#7ee787', shape: 'triangle' };
    return { color: '#c084fc', shape: 'plus' };
  }
  const styles = {
    Nebulae: { color: '#d9a8ff', shape: 'diamond' },
    'Fleet Carriers': { color: '#59d3ff', shape: 'square' },
    'Stellar Features': { color: '#fff176', shape: 'star' },
    'Planetary / Biological': { color: '#7ee787', shape: 'circle' },
    'Stations / Megaships': { color: '#ffb15c', shape: 'hex' },
    'Mystery / Xenology': { color: '#ff6fb1', shape: 'triangle' },
    'Routes / Resources': { color: '#66e0c2', shape: 'chevron' },
    'Sightseeing / Historical': { color: '#b8c7ff', shape: 'flag' },
    'Other POIs': { color: '#c9d1d9', shape: 'plus' },
  };
  return styles[category] ?? styles['Other POIs'];
}

export class GalaxyRenderer {
  constructor(canvas, overlay) {
    this.canvas = canvas;
    this.overlay = overlay;
    this.gl = canvas.getContext('webgl', { antialias: true, alpha: true });
    this.ctx = overlay.getContext('2d');
    this.program = program(this.gl);
    this.positionBuffer = this.gl.createBuffer();
    this.colorBuffer = this.gl.createBuffer();
    this.sizeBuffer = this.gl.createBuffer();
    this.styleBuffer = this.gl.createBuffer();
    this.phaseBuffer = this.gl.createBuffer();
    this.alphaBuffer = this.gl.createBuffer();
    this.basePoints = [];
    this.localPoints = [];
    this.allPoints = [];
    this.points = [];
    this.searchResults = [];
    this.selectedSystem = null;
    this.places = [];
    this.placeDrawList = [];
    this.placeDrawKey = '';
    this.labeledPlaceNames = new Set();
    this.gridAnchorPoints = [];
    this.carrierRange = null;
    this.selectedPlace = null;
    this.landmarks = [];
    this.count = 0;
    this.target = [0, 0, 0];
    this.orbitLocked = false;
    this.yaw = 0.55;
    this.pitch = -0.48;
    this.distance = 2500;
    this.showVisited = true;
    this.showGrid = true;
    this.showDepthEmphasis = true;
    this.showDropLines = true;
    this.showLandmarks = true;
    this.showSectorMap = false;
    this.showPlaces = true;
    this.showAllPlaces = false;
    this.showMurderBinaries = false;
    this.showCarrierRange = false;
    this.starScale = 4;
    this.autoStarScale = true;
    this.onStarScaleChange = null;
    this.onTargetChange = null;
    this.lastReportedStarScale = null;
    this.drag = null;
    this.hoverIndex = null;
    this.hoverPlaceId = null;
    this.hoverScreen = null;
    this.hoverPoint = null;
    this.lastHoverAt = 0;
    this.keys = new Set();
    this.onSelect = null;
    this.onHover = null;
    this.onSystemContext = null;
    this.onPlaceSelect = null;
    this.onPlaceHover = null;
    this.matrix = identity();
    this.lastBufferKey = '';
    this.lastBufferBuild = 0;
    this.regionMap = null;
    this.regionBoundaryLods = null;
    this.regionMapLoading = false;
    this.regionMapError = null;
    this.bind();
    this.loadRegionMap();
  }

  bind() {
    window.addEventListener('resize', () => this.resize());
    this.canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.distance = Math.max(8, this.distance * (event.deltaY > 0 ? 1.12 : 0.88));
      this.notifyTargetChange();
    }, { passive: false });
    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    this.canvas.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.canvas.setPointerCapture(event.pointerId);
      this.drag = {
        x: event.clientX,
        y: event.clientY,
        button: event.button,
        moved: false,
      };
    });
    this.canvas.addEventListener('pointermove', (event) => {
      if (!this.drag) {
        this.updateHover(event);
        return;
      }
      const dx = event.clientX - this.drag.x;
      const dy = event.clientY - this.drag.y;
      this.drag.moved = this.drag.moved || Math.hypot(dx, dy) > 3;
      this.drag.x = event.clientX;
      this.drag.y = event.clientY;
      if (this.drag.button === 2) {
        if (event.ctrlKey) this.moveOrbitVertical(dy);
        else this.panOrbitPoint(dx, dy);
      } else {
        this.yaw += dx * 0.005;
        this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + dy * 0.004));
      }
    });
    this.canvas.addEventListener('pointerup', (event) => {
      if (this.drag && !this.drag.moved) {
        if (this.drag.button === 2) this.contextPick(event);
        else this.pick(event);
      }
      this.drag = null;
      this.updateHover(event);
    });
    this.canvas.addEventListener('pointerleave', () => {
      this.hoverIndex = null;
      this.hoverPlaceId = null;
      this.hoverScreen = null;
      this.hoverPoint = null;
      this.onHover?.(null);
      this.onPlaceHover?.(null);
    });
    window.addEventListener('keydown', (event) => {
      if (isTextInputActive()) return;
      this.keys.add(event.key.toLowerCase());
    });
    window.addEventListener('keyup', (event) => this.keys.delete(event.key.toLowerCase()));
    this.resize();
  }

  async loadRegionMap() {
    if (this.regionMap || this.regionMapLoading) return;
    this.regionMapLoading = true;
    this.regionMapError = null;
    try {
      const response = await fetch(regionMapUrl);
      if (!response.ok) throw new Error(`Region map request failed: ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data.boundaries) || !Array.isArray(data.regions)) {
        throw new Error('Region map vector data is invalid.');
      }
      this.regionMap = data;
      this.regionBoundaryLods = this.buildRegionBoundaryLods(data.boundaries);
    } catch (error) {
      this.regionMapError = error.message;
      console.warn(error);
    } finally {
      this.regionMapLoading = false;
    }
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    this.overlay.width = this.canvas.width;
    this.overlay.height = this.canvas.height;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  setTarget(x, y, z) {
    const coords = toRenderCoords({ x, y, z });
    this.target = [coords.x, coords.y, coords.z];
    this.distance = 850;
    this.orbitLocked = true;
    this.notifyTargetChange();
  }

  targetCoords() {
    return fromRenderCoords({ x: this.target[0], y: this.target[1], z: this.target[2] });
  }

  notifyTargetChange() {
    this.placeDrawKey = '';
    this.onTargetChange?.(this.targetCoords());
  }

  setLandmarks(landmarks) {
    this.landmarks = landmarks.map((landmark) => ({
      ...landmark,
      ...toRenderCoords(landmark.coords),
    }));
  }

  setPlaces(places) {
    this.places = places.map((place) => ({
      ...place,
      ...toRenderCoords(place.coords),
    }));
    this.placeDrawKey = '';
  }

  setCarrierRange(range) {
    this.carrierRange = range
      ? {
        ...range,
        ...toRenderCoords(range.coords),
        radius: Number(range.radius ?? 500),
      }
      : null;
  }

  setStarScale(scale) {
    this.starScale = clamp(Number(scale) || 4, 0.2, 8);
    this.rebuildDrawBuffers(true);
  }

  setAutoStarScale(enabled) {
    this.autoStarScale = Boolean(enabled);
    this.lastReportedStarScale = null;
    this.rebuildDrawBuffers(true);
  }

  setDepthEmphasis(enabled) {
    this.showDepthEmphasis = Boolean(enabled);
    this.lastBufferKey = '';
    this.rebuildDrawBuffers(true);
  }

  autoStarScalePercent() {
    return zoomStarScalePercent(this.distance);
  }

  effectiveStarScale() {
    return this.autoStarScale ? this.autoStarScalePercent() / 50 : this.starScale;
  }

  setSelectedSystem(system) {
    this.selectedSystem = system
      ? {
        index: Number.isInteger(system.index) ? system.index : -1,
        name: system.name,
        ...toRenderCoords(system.coords),
        typeName: system.mainStar,
        flags: system.visited ? 4 : 0,
        special: specialKind(system.mainStar),
      }
      : null;
    if (system) this.selectedPlace = null;
  }

  setSelectedPlace(place) {
    this.selectedPlace = place
      ? {
        ...place,
        ...toRenderCoords(place.coords),
      }
      : null;
    if (place) this.selectedSystem = null;
    this.placeDrawKey = '';
  }

  resetOrientation() {
    this.yaw = 0.55;
    this.pitch = -0.48;
  }

  move(direction) {
    const step = Math.max(8, this.distance * 0.08);
    const forward = [Math.sin(this.yaw), 0, Math.cos(this.yaw)];
    const right = [Math.cos(this.yaw), 0, -Math.sin(this.yaw)];
    this.orbitLocked = false;
    if (direction === 'forward') this.target = this.target.map((v, i) => v + forward[i] * step);
    if (direction === 'backward') this.target = this.target.map((v, i) => v - forward[i] * step);
    if (direction === 'left') this.target = this.target.map((v, i) => v - right[i] * step);
    if (direction === 'right') this.target = this.target.map((v, i) => v + right[i] * step);
    if (direction === 'up') this.target[1] += step;
    if (direction === 'down') this.target[1] -= step;
    this.notifyTargetChange();
  }

  panOrbitPoint(dx, dy) {
    const scale = Math.max(0.2, this.distance * 0.0016);
    const right = [Math.cos(this.yaw), 0, -Math.sin(this.yaw)];
    const forward = [Math.sin(this.yaw), 0, Math.cos(this.yaw)];
    this.target = [
      this.target[0] - right[0] * dx * scale - forward[0] * dy * scale,
      this.target[1],
      this.target[2] - right[2] * dx * scale - forward[2] * dy * scale,
    ];
    this.orbitLocked = false;
    this.notifyTargetChange();
  }

  moveOrbitVertical(dy) {
    const scale = Math.max(0.2, this.distance * 0.0016);
    this.target = [
      this.target[0],
      this.target[1] + dy * scale,
      this.target[2],
    ];
    this.orbitLocked = false;
    this.notifyTargetChange();
  }

  keyboardMove() {
    if (isTextInputActive()) {
      this.keys.clear();
      return;
    }
    if (this.keys.has('w')) this.move('forward');
    if (this.keys.has('s')) this.move('backward');
    if (this.keys.has('a')) this.move('left');
    if (this.keys.has('d')) this.move('right');
    if (this.keys.has('r')) this.move('up');
    if (this.keys.has('f')) this.move('down');
    if (this.keys.has('q')) this.yaw -= 0.025;
    if (this.keys.has('e')) this.yaw += 0.025;
  }

  setPoints(buffer, meta) {
    this.basePoints = this.decodePoints(buffer, meta);
    this.mergePointSources();
  }

  setLocalPoints(buffer, meta) {
    this.localPoints = this.decodePoints(buffer, meta);
    this.mergePointSources();
  }

  decodePoints(buffer, meta) {
    const view = new DataView(buffer);
    const points = [];
    for (let offset = 0; offset + 20 <= buffer.byteLength; offset += 20) {
      const x = view.getFloat32(offset, true);
      const y = view.getFloat32(offset + 4, true);
      const z = view.getFloat32(offset + 8, true);
      const typeCode = view.getUint16(offset + 12, true);
      const flags = view.getUint16(offset + 14, true);
      const index = view.getUint32(offset + 16, true);
      const typeName = meta.typeNames[typeCode] ?? '';
      points.push({ ...toRenderCoords({ x, y, z }), typeName, flags, index, special: specialKind(typeName), bucket: stableBucket(index) });
    }
    return points;
  }

  mergePointSources() {
    const indexes = new Set(this.basePoints.map((point) => point.index));
    this.allPoints = [...this.basePoints];
    for (const point of this.localPoints) {
      if (indexes.has(point.index)) continue;
      indexes.add(point.index);
      this.allPoints.push(point);
    }
    this.lastBufferKey = '';
    this.rebuildDrawBuffers(true);
  }

  rebuildDrawBuffers(force = false) {
    const now = performance.now();
    const budget = this.drawBudget();
    const maxDistance = this.maxDrawDistance();
    const gridStep = this.gridStep();
    const key = `${Math.round(this.target[0] / 25)}:${Math.round(this.target[1] / gridStep)}:${Math.round(this.target[2] / 25)}:${Math.round(this.distance)}:${budget}:${maxDistance}:${this.showDepthEmphasis ? 1 : 0}`;
    if (!force && key === this.lastBufferKey && now - this.lastBufferBuild < 250) return;

    this.lastBufferKey = key;
    this.lastBufferBuild = now;
    const required = new Set([
      ...this.searchResults.map((result) => result.index),
      this.selectedSystem?.index,
    ].filter((index) => Number.isInteger(index) && index >= 0));
    const positions = [];
    const colors = [];
    const sizes = [];
    const styles = [];
    const phases = [];
    const alphas = [];
    const importantPoints = [];
    const candidates = [];
    const densityRadiusSq = this.priorityDensityRadius() ** 2;
    let nearbyCandidateCount = 0;

    for (const point of this.allPoints) {
      const dx = point.x - this.target[0];
      const dy = point.y - this.target[1];
      const dz = point.z - this.target[2];
      const distanceSq = dx * dx + dy * dy + dz * dz;
      const important = required.has(point.index) || point.special || (point.flags & 2) || (this.showVisited && (point.flags & 4));
      if (!important && distanceSq > maxDistance * maxDistance) continue;
      if (important) importantPoints.push(point);
      else {
        candidates.push({ point, distanceSq });
        if (distanceSq <= densityRadiusSq) nearbyCandidateCount += 1;
      }
    }

    const available = Math.max(0, budget - importantPoints.length);
    const nearFraction = densityPriorityFraction(candidates.length, nearbyCandidateCount, available);
    const prioritized = prioritizeDrawCandidates(candidates, available, nearFraction)
      .sort((a, b) => a.distanceSq - b.distanceSq);
    const drawPoints = [
      ...importantPoints,
      ...prioritized.map((candidate) => candidate.point),
    ];
    this.updateGridAnchors(drawPoints);
    const gridAnchorIndexes = new Set(this.gridAnchorPoints.map((point) => point.index));
    const sizeScale = this.starSizeScale();
    for (const point of drawPoints) {
      const visual = starVisual(point.typeName);
      const distanceAlpha = this.starDistanceAlpha(this.distanceFromTarget(point));
      const gridAnchor = gridAnchorIndexes.has(point.index);
      const depthExempt = required.has(point.index) || (this.showVisited && (point.flags & 4));
      const depth = this.showDepthEmphasis && !depthExempt
        ? gridDepthEmphasis(point.y - this.target[1], gridStep)
        : { alpha: 1, size: 1 };
      const combinedAlpha = distanceAlpha * depth.alpha;
      positions.push(point.x, point.y, point.z);
      colors.push(...visual.color);
      sizes.push(visual.size * sizeScale * (0.62 + distanceAlpha * 0.38) * depth.size * (gridAnchor ? 1.5 : 1));
      styles.push(visual.style);
      phases.push((point.bucket % 4096) / 4096);
      alphas.push(gridAnchor ? Math.max(0.9, combinedAlpha) : combinedAlpha);
    }
    this.points = drawPoints;
    this.count = drawPoints.length;
    this.upload(this.positionBuffer, new Float32Array(positions));
    this.upload(this.colorBuffer, new Float32Array(colors));
    this.upload(this.sizeBuffer, new Float32Array(sizes));
    this.upload(this.styleBuffer, new Float32Array(styles));
    this.upload(this.phaseBuffer, new Float32Array(phases));
    this.upload(this.alphaBuffer, new Float32Array(alphas));
  }

  starSizeScale() {
    let distanceScale = 0.58;
    if (this.distance < 120) distanceScale = 1.2;
    else if (this.distance < 350) distanceScale = 1.05;
    else if (this.distance < 900) distanceScale = 0.94;
    else if (this.distance < 2500) distanceScale = 0.8;
    else if (this.distance < 7500) distanceScale = 0.68;
    const effectivePercent = this.autoStarScale ? this.autoStarScalePercent() : this.starScale * 50;
    if (this.lastReportedStarScale === null || Math.abs(effectivePercent - this.lastReportedStarScale) >= 1) {
      this.lastReportedStarScale = effectivePercent;
      this.onStarScaleChange?.(effectivePercent);
    }
    return distanceScale * this.effectiveStarScale();
  }

  drawBudget() {
    return zoomDrawBudget(this.distance);
  }

  localPointLimit() {
    return zoomLocalPointLimit(this.distance);
  }

  priorityDensityRadius() {
    if (this.distance < 350) return 500;
    if (this.distance < 900) return 1000;
    if (this.distance < 2500) return 2000;
    return 5000;
  }

  maxDrawDistance() {
    const step = this.gridStep();
    if (step <= 5) return 750;
    if (step <= 10) return 1500;
    if (step <= 25) return 5000;
    if (step <= 50) return 16000;
    if (step <= 100) return 30000;
    return Infinity;
  }

  starDistanceAlpha(distance) {
    const step = this.gridStep();
    if (step > 10) return 1;
    const fullStrength = step <= 5 ? 80 : 160;
    const fadeEnd = step <= 5 ? 750 : 1500;
    const progress = clamp((distance - fullStrength) / Math.max(1, fadeEnd - fullStrength), 0, 1);
    const eased = progress * progress * (3 - 2 * progress);
    return 1 - eased * 0.92;
  }

  updateGridAnchors(points) {
    const grid = this.gridSpec();
    const limit = grid.step <= 5 ? 32 : grid.step <= 10 ? 40 : grid.step <= 25 ? 64 : 96;
    const candidates = points
      .filter((point) => point.x >= grid.minX && point.x <= grid.maxX
        && point.z >= grid.minZ && point.z <= grid.maxZ
        && Math.abs(point.y - grid.y) >= 1)
      .map((point) => ({ point, distanceSq: (point.x - this.target[0]) ** 2 + (point.y - this.target[1]) ** 2 + (point.z - this.target[2]) ** 2 }));
    this.gridAnchorPoints = prioritizeDrawCandidates(candidates, limit, 1)
      .sort((a, b) => a.distanceSq - b.distanceSq)
      .map((item) => item.point);
  }

  setSearchResults(results, meta) {
    this.searchResults = results.map((result) => ({
      ...result,
      coords: toRenderCoords(result.coords),
      typeName: meta.typeNames[result.typeCode] ?? '',
      special: specialKind(meta.typeNames[result.typeCode] ?? ''),
    }));
    this.rebuildDrawBuffers(true);
  }

  upload(buffer, data) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  }

  camera() {
    const cp = Math.cos(this.pitch);
    const eye = [
      this.target[0] + Math.sin(this.yaw) * cp * this.distance,
      this.target[1] + Math.sin(this.pitch) * this.distance,
      this.target[2] + Math.cos(this.yaw) * cp * this.distance,
    ];
    const aspect = this.canvas.width / this.canvas.height;
    const near = Math.max(0.1, this.distance / 5000);
    const far = Math.max(10000, this.distance * 16);
    this.matrix = multiply(perspective(Math.PI / 4, aspect, near, far), lookAt(eye, this.target, [0, 1, 0]));
    return this.matrix;
  }

  drawStars(matrix) {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.useProgram(this.program);
    const matrixLoc = gl.getUniformLocation(this.program, 'u_matrix');
    gl.uniformMatrix4fv(matrixLoc, false, new Float32Array(matrix));
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_pixel_ratio'), Math.min(window.devicePixelRatio || 1, 2));
    this.attrib('a_position', this.positionBuffer, 3);
    this.attrib('a_color', this.colorBuffer, 3);
    this.attrib('a_size', this.sizeBuffer, 1);
    this.attrib('a_style', this.styleBuffer, 1);
    this.attrib('a_phase', this.phaseBuffer, 1);
    this.attrib('a_alpha', this.alphaBuffer, 1);
    gl.drawArrays(gl.POINTS, 0, this.count);
  }

  attrib(name, buffer, size) {
    const gl = this.gl;
    const loc = gl.getAttribLocation(this.program, name);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  }

  screen(point, rect = this.canvas.getBoundingClientRect()) {
    const projected = transform(this.matrix, [point.x, point.y, point.z]);
    if (projected[3] <= 0 || projected[2] < -1 || projected[2] > 1) return null;
    return {
      x: (projected[0] * 0.5 + 0.5) * rect.width,
      y: (-projected[1] * 0.5 + 0.5) * rect.height,
      z: projected[2],
    };
  }

  projected(point) {
    const projected = transform(this.matrix, [point.x, point.y, point.z]);
    const rect = this.canvas.getBoundingClientRect();
    const visible = projected[3] > 0 && projected[2] >= -1 && projected[2] <= 1
      && projected[0] >= -1 && projected[0] <= 1
      && projected[1] >= -1 && projected[1] <= 1;
    let x = projected[0];
    let y = projected[1];
    if (projected[3] <= 0) {
      x = -x;
      y = -y;
    }
    return {
      visible,
      ndc: { x, y },
      screen: {
        x: (projected[0] * 0.5 + 0.5) * rect.width,
        y: (-projected[1] * 0.5 + 0.5) * rect.height,
        z: projected[2],
      },
      rect,
    };
  }

  drawOverlay() {
    const ctx = this.ctx;
    const rect = this.overlay.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    if (this.showSectorMap) this.drawSectorMapOverlay();
    const grid = this.showGrid ? this.drawGrid() : this.gridSpec();
    this.labeledPlaceNames.clear();
    if (this.showDropLines && this.gridFadeAlpha() > 0.02) this.drawDropLines(grid);
    this.drawGridIndicators(grid);
    if (this.showCarrierRange) this.drawCarrierRange();
    const drawList = this.overlayMarkers()
      .sort((a, b) => a.distance - b.distance)
      .slice(0, this.overlayMarkerBudget())
      .sort((a, b) => b.screen.z - a.screen.z);
    for (const item of drawList) this.drawMarker(item.point, false, item.alpha);
    for (const result of this.searchResults) this.drawMarker({ ...result.coords, ...result, flags: 0 }, true);
    if (this.showPlaces || this.showMurderBinaries) this.drawPlaceIndicators();
    if (this.selectedSystem) this.drawSelectedSystem();
    if (this.selectedPlace) this.drawSelectedPlace();
    this.drawHoverMarker();
    if (this.showLandmarks) this.drawLandmarkIndicators();
    this.drawOrbitPoint(grid);
  }

  drawPlaceIndicators() {
    const visible = [];
    for (const place of this.visiblePlaces()) {
      const screen = this.screen(place);
      if (!screen) continue;
      visible.push({ place, screen, distance: this.distanceFromTarget(place) });
    }
    visible.sort((a, b) => a.distance - b.distance);
    const labelLimit = this.distance < 2500 ? 16 : 28;
    const labeled = new Set(visible.slice(0, labelLimit).map((item) => item.place.id));
    for (const item of visible) this.drawPlaceMarker(item.place, item.screen, labeled.has(item.place.id));
  }

  drawCarrierRange() {
    if (!this.carrierRange) return;
    const ctx = this.ctx;
    const radius = this.carrierRange.radius || 500;
    const center = this.carrierRange;
    ctx.save();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(182, 255, 0, 0.32)';
    ctx.fillStyle = 'rgba(182, 255, 0, 0.035)';
    this.drawWorldCircle(center, radius, 'xz', true);
    ctx.strokeStyle = 'rgba(182, 255, 0, 0.2)';
    this.drawWorldCircle(center, radius, 'xy', false);
    this.drawWorldCircle(center, radius, 'yz', false);
    ctx.restore();
  }

  drawWorldCircle(center, radius, plane, fill = false) {
    const ctx = this.ctx;
    const segments = 160;
    let drawing = false;
    ctx.beginPath();
    for (let i = 0; i <= segments; i += 1) {
      const angle = i / segments * Math.PI * 2;
      const ca = Math.cos(angle) * radius;
      const sa = Math.sin(angle) * radius;
      const point = {
        x: center.x + (plane === 'yz' ? 0 : ca),
        y: center.y + (plane === 'xz' ? 0 : sa),
        z: center.z + (plane === 'xy' ? 0 : plane === 'yz' ? ca : sa),
      };
      const screen = this.screen(point);
      if (!screen) {
        drawing = false;
        continue;
      }
      if (!drawing) {
        ctx.moveTo(screen.x, screen.y);
        drawing = true;
      } else {
        ctx.lineTo(screen.x, screen.y);
      }
    }
    if (fill) ctx.fill();
    ctx.stroke();
  }

  visiblePlaces() {
    const selectedId = this.selectedPlace?.id ?? '';
    const key = `${Math.round(this.target[0])}:${Math.round(this.target[1])}:${Math.round(this.target[2])}:${this.showAllPlaces ? 'all' : 'near'}:${this.showPlaces ? 'places' : 'no-places'}:${this.showMurderBinaries ? 'murder' : 'no-murder'}:${selectedId}`;
    if (key === this.placeDrawKey) return this.placeDrawList;

    const regularCandidates = this.showPlaces
      ? this.places.filter((place) => place.category !== 'Murder Binaries')
      : [];
    const murderCandidates = this.showMurderBinaries
      ? this.places.filter((place) => place.category === 'Murder Binaries')
      : [];

    const nearest = (candidates) => candidates
      .map((place) => ({ place, distance: this.distanceFromTarget(place) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 50)
      .map((item) => item.place);
    if (this.showAllPlaces) {
      this.placeDrawList = [...regularCandidates, ...nearest(murderCandidates)];
    } else {
      const visible = [...nearest(regularCandidates), ...nearest(murderCandidates)];
      if (this.selectedPlace && !visible.some((place) => place.id === this.selectedPlace.id)) {
        visible.push(this.selectedPlace);
      }
      this.placeDrawList = visible;
    }
    this.placeDrawKey = key;
    return this.placeDrawList;
  }

  drawPlaceMarker(place, screen, labeled = false) {
    const ctx = this.ctx;
    const selected = this.selectedPlace?.id === place.id;
    const style = placeStyle(place);
    ctx.save();
    ctx.translate(screen.x, screen.y);
    ctx.strokeStyle = style.color;
    ctx.fillStyle = style.color;
    ctx.lineWidth = selected ? 2.2 : 1.4;
    this.drawPlaceShape(ctx, style.shape, selected);
    if (labeled || selected) {
      this.labeledPlaceNames.add(place.name);
      const label = place.name;
      ctx.font = selected ? '700 13px Segoe UI, sans-serif' : '600 12px Segoe UI, sans-serif';
      ctx.textBaseline = 'middle';
      const width = ctx.measureText(label).width;
      this.drawLabelPlate(14, -12, width + 14, 24, style.color);
      ctx.fillStyle = style.color;
      ctx.fillText(label, 20, 0);
    }
    ctx.restore();
  }

  drawPlaceShape(ctx, shape, selected = false) {
    const radius = selected ? 10 : 8;
    if (selected) {
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.beginPath();
      ctx.arc(0, 0, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    if (shape === 'hazard') {
      const warningRadius = selected ? 12 : 10;
      ctx.save();
      ctx.shadowColor = '#ff334f';
      ctx.shadowBlur = selected ? 14 : 10;
      ctx.lineWidth = selected ? 2.4 : 2;
      ctx.beginPath();
      ctx.moveTo(0, -warningRadius);
      ctx.lineTo(warningRadius, warningRadius * 0.78);
      ctx.lineTo(-warningRadius, warningRadius * 0.78);
      ctx.closePath();
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -4);
      ctx.lineTo(0, 3);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 6, 1.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (shape === 'diamond') {
      ctx.beginPath();
      ctx.moveTo(0, -radius);
      ctx.lineTo(radius, 0);
      ctx.lineTo(0, radius);
      ctx.lineTo(-radius, 0);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, selected ? 3.4 : 2.4, 0, Math.PI * 2);
      ctx.fill();
    } else if (shape === 'square') {
      ctx.strokeRect(-7, -7, 14, 14);
      ctx.beginPath();
      ctx.moveTo(-4, -4);
      ctx.lineTo(4, 4);
      ctx.moveTo(4, -4);
      ctx.lineTo(-4, 4);
      ctx.stroke();
    } else if (shape === 'star') {
      ctx.beginPath();
      ctx.moveTo(-9, 0);
      ctx.lineTo(9, 0);
      ctx.moveTo(0, -9);
      ctx.lineTo(0, 9);
      ctx.moveTo(-6, -6);
      ctx.lineTo(6, 6);
      ctx.moveTo(6, -6);
      ctx.lineTo(-6, 6);
      ctx.stroke();
    } else if (shape === 'circle') {
      ctx.beginPath();
      ctx.arc(0, 0, radius - 1, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 3, 0, Math.PI * 2);
      ctx.fill();
    } else if (shape === 'hex') {
      ctx.beginPath();
      for (let i = 0; i < 6; i += 1) {
        const angle = Math.PI / 6 + i * Math.PI / 3;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    } else if (shape === 'triangle') {
      ctx.beginPath();
      ctx.moveTo(0, -radius);
      ctx.lineTo(radius, radius - 2);
      ctx.lineTo(-radius, radius - 2);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 1, 2.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (shape === 'chevron') {
      ctx.beginPath();
      ctx.moveTo(-8, -7);
      ctx.lineTo(0, 0);
      ctx.lineTo(-8, 7);
      ctx.moveTo(0, -7);
      ctx.lineTo(8, 0);
      ctx.lineTo(0, 7);
      ctx.stroke();
    } else if (shape === 'flag') {
      ctx.beginPath();
      ctx.moveTo(-6, 8);
      ctx.lineTo(-6, -8);
      ctx.lineTo(7, -5);
      ctx.lineTo(-6, -1);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(-8, 0);
      ctx.lineTo(8, 0);
      ctx.moveTo(0, -8);
      ctx.lineTo(0, 8);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  drawLandmarkIndicators() {
    for (const landmark of this.landmarks) this.drawLandmarkIndicator(landmark);
  }

  drawLandmarkIndicator(landmark) {
    if (landmark.hideWhenPlaceLabelVisible && this.labeledPlaceNames.has(landmark.name)) return;
    const ctx = this.ctx;
    const projection = this.projected(landmark);
    const distance = this.distanceFromTarget(landmark);
    const label = `${landmark.shortName} ${Math.round(distance).toLocaleString()} ly`;
    if (projection.visible) {
      this.drawLandmarkOnscreen(landmark, projection.screen, label);
      return;
    }

    const safe = {
      left: 20,
      right: projection.rect.width - 20,
      top: 70,
      bottom: projection.rect.height - 56,
    };
    const center = { x: (safe.left + safe.right) / 2, y: (safe.top + safe.bottom) / 2 };
    const dx = projection.ndc.x;
    const dy = -projection.ndc.y;
    const angle = Math.atan2(dy, dx);
    const cos = Math.cos(angle) || 0.0001;
    const sin = Math.sin(angle) || 0.0001;
    const halfW = (safe.right - safe.left) / 2;
    const halfH = (safe.bottom - safe.top) / 2;
    const scale = Math.min(Math.abs(halfW / cos), Math.abs(halfH / sin));
    const x = center.x + cos * scale;
    const y = center.y + sin * scale;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = landmark.color;
    ctx.strokeStyle = 'rgba(5, 7, 11, 0.88)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(11, 0);
    ctx.lineTo(-8, -7);
    ctx.lineTo(-5, 0);
    ctx.lineTo(-8, 7);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.font = '600 12px Segoe UI, sans-serif';
    ctx.textBaseline = 'middle';
    const width = ctx.measureText(label).width;
    const labelX = clamp(x + (cos >= 0 ? -width - 18 : 18), safe.left, safe.right - width);
    const labelY = clamp(y, safe.top + 12, safe.bottom - 12);
    this.drawLabelPlate(labelX - 7, labelY - 12, width + 14, 24, landmark.color);
    ctx.fillStyle = landmark.color;
    ctx.fillText(label, labelX, labelY);
    ctx.restore();
  }

  drawLandmarkOnscreen(landmark, screen, label) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(screen.x, screen.y);
    ctx.strokeStyle = landmark.color;
    ctx.fillStyle = landmark.color;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(10, 0);
    ctx.lineTo(0, 10);
    ctx.lineTo(-10, 0);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '600 12px Segoe UI, sans-serif';
    ctx.textBaseline = 'middle';
    const width = ctx.measureText(label).width;
    this.drawLabelPlate(14, -12, width + 14, 24, landmark.color);
    ctx.fillStyle = landmark.color;
    ctx.fillText(label, 20, 0);
    ctx.restore();
  }

  drawLabelPlate(x, y, width, height, strokeStyle = 'rgba(242, 165, 65, 0.65)') {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = 'rgba(5, 8, 12, 0.74)';
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = 1;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.36)';
    ctx.shadowBlur = 10;
    roundedRect(ctx, x, y, width, height, 5);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.72;
    ctx.stroke();
    ctx.restore();
  }

  overlayMarkers() {
    const radius = this.overlayMarkerRadius();
    const fadeStart = radius * 0.62;
    const items = [];
    for (const point of this.points) {
      if (!point.special && !(this.showVisited && (point.flags & 4))) continue;
      const distance = this.distanceFromTarget(point);
      if (distance > radius) continue;
      const screen = this.screen(point);
      if (!screen) continue;
      const alpha = clamp(1 - Math.max(0, distance - fadeStart) / Math.max(1, radius - fadeStart), 0.18, 1);
      items.push({ point, screen, alpha, distance });
    }
    return items;
  }

  overlayMarkerRadius() {
    if (this.distance < 120) return 900;
    if (this.distance < 350) return 1800;
    if (this.distance < 900) return 4200;
    if (this.distance < 2500) return 9000;
    if (this.distance < 7500) return 22000;
    return 50000;
  }

  overlayMarkerBudget() {
    const step = this.gridStep();
    if (step <= 5) return 300;
    if (step <= 10) return 450;
    if (step <= 25) return 700;
    if (step <= 50) return 1000;
    return 1400;
  }

  distanceFromTarget(point) {
    return Math.hypot(point.x - this.target[0], point.y - this.target[1], point.z - this.target[2]);
  }

  gridSpec() {
    const step = this.gridStep();
    const extent = step * 16;
    const centerX = Math.round(this.target[0] / step) * step;
    const centerZ = Math.round(this.target[2] / step) * step;
    return {
      step,
      extent,
      centerX,
      centerZ,
      minX: centerX - extent,
      maxX: centerX + extent,
      minZ: centerZ - extent,
      maxZ: centerZ + extent,
      y: this.target[1],
    };
  }

  gridStep() {
    const steps = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
    const desired = Math.max(5, this.distance / 12);
    return steps.find((candidate) => candidate >= desired) ?? steps.at(-1);
  }

  gridFadeAlpha() {
    return 1 - smoothstep(45000, 76000, this.distance);
  }

  gridDetailAlpha(step) {
    const desired = Math.max(5, this.distance / 12);
    return 1 - smoothstep(0.42, 0.95, desired / Math.max(1, step));
  }

  drawGrid() {
    const grid = this.gridSpec();
    const alpha = this.gridFadeAlpha();
    if (alpha <= 0.01) return grid;
    const ctx = this.ctx;
    const clip = this.centerClipRect();
    ctx.save();
    ctx.beginPath();
    ctx.rect(clip.x, clip.y, clip.width, clip.height);
    ctx.clip();
    ctx.lineCap = 'round';
    ctx.globalAlpha = alpha;
    if (grid.step >= 10) {
      this.drawGridLines(grid, grid.step / 10, this.gridDetailAlpha(grid.step), false);
    }
    this.drawGridLines(grid, grid.step, 1, true);
    this.drawGridCoordinateLabels(grid, alpha);

    ctx.restore();
    return grid;
  }

  drawGridLines(grid, step, alpha, primary) {
    if (alpha <= 0.01) return;
    const ctx = this.ctx;
    const lineCount = Math.round(grid.extent / step);
    for (let index = -lineCount; index <= lineCount; index += 1) {
      const x = grid.centerX + index * step;
      if (!primary && Math.abs(x / grid.step - Math.round(x / grid.step)) < 0.001) continue;
      const edgeFade = 1 - Math.abs(index) / (lineCount + 1);
      const center = Math.abs(x - grid.centerX) < step * 0.5;
      const major = primary || Math.abs(x / grid.step - Math.round(x / grid.step)) < 0.001;
      ctx.lineWidth = center ? 1.8 : major ? 1.15 : 0.55;
      ctx.strokeStyle = center
        ? `rgba(72, 220, 230, ${(this.showDepthEmphasis ? 0.72 : 0.62) * alpha})`
        : major
          ? `rgba(78, 138, 150, ${((this.showDepthEmphasis ? 0.18 : 0.14) + edgeFade * 0.24) * alpha})`
          : `rgba(60, 111, 124, ${((this.showDepthEmphasis ? 0.08 : 0.055) + edgeFade * 0.1) * alpha})`;
      this.drawWorldLine({ x, y: grid.y, z: grid.minZ }, { x, y: grid.y, z: grid.maxZ });
    }
    for (let index = -lineCount; index <= lineCount; index += 1) {
      const z = grid.centerZ + index * step;
      if (!primary && Math.abs(z / grid.step - Math.round(z / grid.step)) < 0.001) continue;
      const edgeFade = 1 - Math.abs(index) / (lineCount + 1);
      const center = Math.abs(z - grid.centerZ) < step * 0.5;
      const major = primary || Math.abs(z / grid.step - Math.round(z / grid.step)) < 0.001;
      ctx.lineWidth = center ? 1.8 : major ? 1.15 : 0.55;
      ctx.strokeStyle = center
        ? `rgba(255, 177, 76, ${(this.showDepthEmphasis ? 0.66 : 0.55) * alpha})`
        : major
          ? `rgba(78, 138, 150, ${((this.showDepthEmphasis ? 0.18 : 0.14) + edgeFade * 0.24) * alpha})`
          : `rgba(60, 111, 124, ${((this.showDepthEmphasis ? 0.08 : 0.055) + edgeFade * 0.1) * alpha})`;
      this.drawWorldLine({ x: grid.minX, y: grid.y, z }, { x: grid.maxX, y: grid.y, z });
    }
  }

  drawGridIndicators(grid) {
    const clip = this.centerClipRect();
    let y = clip.y + 10;
    if (this.showGrid && this.gridFadeAlpha() > 0.02) {
      this.drawMapBadge(`${grid.step.toLocaleString()} ly grid`, clip.x + 10, y, {
        stroke: 'rgba(72, 220, 230, 0.5)',
        text: 'rgba(184, 210, 219, 0.86)',
      });
      y += 28;
    }
    if (this.showSectorMap && this.sectorMapAlpha() > 0.02) {
      this.drawMapBadge('Sector regions', clip.x + 10, y, {
        stroke: 'rgba(242, 165, 65, 0.46)',
        text: 'rgba(255, 202, 139, 0.88)',
      });
      y += 28;
    }
    if (this.showDropLines && this.gridFadeAlpha() > 0.02 && this.gridAnchorPoints.length > 0) {
      const range = dropLineAnchorRange(this.gridAnchorPoints, this.target);
      this.drawMapBadge(`Drop lines max ${formatDistanceBadge(range)} ly`, clip.x + 10, y, {
        stroke: 'rgba(99, 231, 235, 0.5)',
        text: 'rgba(199, 244, 245, 0.9)',
      });
    }
  }

  drawMapBadge(text, x, y, options = {}) {
    const ctx = this.ctx;
    ctx.save();
    ctx.shadowBlur = 0;
    ctx.font = '600 11px Segoe UI, sans-serif';
    ctx.textBaseline = 'middle';
    const width = Math.ceil(ctx.measureText(text).width) + 20;
    ctx.fillStyle = options.fill ?? 'rgba(4, 10, 14, 0.9)';
    ctx.strokeStyle = options.stroke ?? 'rgba(72, 220, 230, 0.5)';
    ctx.lineWidth = 1;
    roundedRect(ctx, x, y, Math.max(64, width), 24, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = options.text ?? 'rgba(184, 210, 219, 0.86)';
    ctx.fillText(text, x + 10, y + 12);
    ctx.restore();
  }

  drawGridCoordinateLabels(grid, gridAlpha) {
    if (grid.step > 1000 || gridAlpha <= 0.05) return;
    const center = this.screen({ x: grid.centerX, y: grid.y, z: grid.centerZ });
    const cell = this.screen({ x: grid.centerX + grid.step, y: grid.y, z: grid.centerZ });
    if (!center || !cell) return;
    const screenCell = Math.hypot(cell.x - center.x, cell.y - center.y);
    if (screenCell < 128) return;
    const skip = Math.max(2, Math.ceil(220 / screenCell));
    const alpha = gridAlpha * smoothstep(128, 190, screenCell) * (1 - smoothstep(7000, 16000, this.distance));
    if (alpha <= 0.03) return;

    const ctx = this.ctx;
    const lineCount = Math.round(grid.extent / grid.step);
    let drawn = 0;
    ctx.save();
    ctx.font = '600 10px "Segoe UI", system-ui, sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = `rgba(72, 220, 230, ${Math.min(0.74, alpha * 0.8)})`;
    ctx.shadowColor = 'rgba(4, 10, 14, 0.7)';
    ctx.shadowBlur = 4;
    for (let xi = -lineCount + 1; xi <= lineCount; xi += skip) {
      for (let zi = -lineCount + 1; zi <= lineCount; zi += skip) {
        if (drawn > 24) break;
        const x = grid.centerX + xi * grid.step;
        const z = grid.centerZ + zi * grid.step;
        const screen = this.screen({ x, y: grid.y, z });
        if (!screen || screen.x < 0 || screen.y < 0 || screen.x > this.overlay.clientWidth || screen.y > this.overlay.clientHeight) continue;
        const edgeFade = Math.min(1 - Math.abs(xi) / (lineCount + 1), 1 - Math.abs(zi) / (lineCount + 1));
        ctx.globalAlpha = Math.max(0, edgeFade) * alpha;
        ctx.fillText(`${this.formatGridCoordinate(x)} : ${this.formatGridCoordinate(grid.y)} : ${this.formatGridCoordinate(z)}`, screen.x + 5, screen.y - 5);
        drawn += 1;
      }
    }
    ctx.restore();
  }

  formatGridCoordinate(value) {
    const rounded = Math.round(value);
    if (Math.abs(rounded) >= 1000) return `${(rounded / 1000).toFixed(Math.abs(rounded) >= 10000 ? 0 : 1)}k`;
    return String(rounded);
  }

  sectorMapAlpha() {
    const step = this.gridStep();
    if (step < 1000) return 0;
    if (step === 1000) return 0.38;
    if (step === 2500) return 1;
    if (step === 5000) return 0.76;
    return 0.42;
  }

  buildRegionBoundaryLods(boundaries) {
    const longEnough = (minLength) => boundaries.filter((segment) => (
      Math.hypot(segment[2] - segment[0], segment[3] - segment[1]) >= minLength
    ));
    return {
      all: boundaries,
      min20: longEnough(20),
      min30: longEnough(30),
    };
  }

  regionBoundarySegmentsForDistance() {
    const lods = this.regionBoundaryLods;
    if (!lods) return this.regionMap?.boundaries ?? [];
    const step = this.gridStep();
    if (step <= 2500) return lods.all ?? [];
    if (step <= 5000) return lods.min20 ?? lods.all ?? [];
    return lods.min30 ?? lods.min20 ?? lods.all ?? [];
  }

  sectorMapWorldRadius() {
    if (this.gridStep() >= 10000) return Infinity;
    return clamp(this.distance * 4.8, 18000, 144000);
  }

  regionMapPoint(x, z) {
    return { x: -Number(x ?? 0), z: Number(z ?? 0) };
  }

  isRegionSegmentNearView(segment, radius) {
    if (!Number.isFinite(radius)) return true;
    const a = this.regionMapPoint(segment[0], segment[1]);
    const b = this.regionMapPoint(segment[2], segment[3]);
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    const minZ = Math.min(segment[1], segment[3]);
    const maxZ = Math.max(segment[1], segment[3]);
    const targetZ = this.target[2];
    if (maxZ < targetZ - radius || minZ > targetZ + radius) return false;
    const targetX = this.target[0];
    return !(maxX < targetX - radius || minX > targetX + radius);
  }

  drawSectorMapOverlay() {
    const alpha = this.sectorMapAlpha();
    if (alpha <= 0.01) return;
    if (!this.regionMap) {
      this.loadRegionMap();
      return;
    }
    const y = this.target[1];
    this.drawRegionBoundarySegments(y, alpha);
    this.drawRegionLabels(y, alpha);
  }

  drawRegionBoundarySegments(y, alpha) {
    const boundaries = this.regionBoundarySegmentsForDistance();
    if (!boundaries.length) return;
    const ctx = this.ctx;
    const rect = this.overlay.getBoundingClientRect();
    const margin = 120;
    const worldRadius = this.sectorMapWorldRadius();
    const internalPath = new Path2D();
    const outerPath = new Path2D();
    let internalCount = 0;
    let outerCount = 0;

    const appendSegment = (segment, path) => {
      if (!this.isRegionSegmentNearView(segment, worldRadius)) return false;
      const [x1, z1, x2, z2] = segment;
      const start = this.regionMapPoint(x1, z1);
      const end = this.regionMapPoint(x2, z2);
      const a = this.screen({ x: start.x, y, z: start.z }, rect);
      const b = this.screen({ x: end.x, y, z: end.z }, rect);
      if (!a || !b) return false;
      if ((a.x < -margin && b.x < -margin)
        || (a.x > rect.width + margin && b.x > rect.width + margin)
        || (a.y < -margin && b.y < -margin)
        || (a.y > rect.height + margin && b.y > rect.height + margin)) return false;
      path.moveTo(a.x, a.y);
      path.lineTo(b.x, b.y);
      return true;
    };

    for (const segment of boundaries) {
      const isOuter = segment[4] === 0 || segment[5] === 0;
      if (appendSegment(segment, isOuter ? outerPath : internalPath)) {
        if (isOuter) outerCount += 1;
        else internalCount += 1;
      }
    }

    const baseWidth = this.distance > 42000 ? 3.4 : this.distance > 22000 ? 2.8 : 2.2;
    const strokePath = (path, count, {
      color,
      lineWidth,
      lineAlpha,
      dash = null,
      shadowColor = 'transparent',
      shadowBlur = 0,
    }) => {
      if (!count) return;
      ctx.save();
      ctx.globalAlpha = alpha * lineAlpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowColor = shadowColor;
      ctx.shadowBlur = shadowBlur;
      ctx.setLineDash(dash ?? []);
      ctx.stroke(path);
      ctx.restore();
    };

    strokePath(internalPath, internalCount, {
      color: 'rgba(1, 6, 8, 0.92)',
      lineWidth: baseWidth + 3.4,
      lineAlpha: 0.92,
    });
    strokePath(outerPath, outerCount, {
      color: 'rgba(1, 6, 8, 0.86)',
      lineWidth: baseWidth + 2.8,
      lineAlpha: 0.74,
      dash: [12, 8],
    });
    strokePath(internalPath, internalCount, {
      color: 'rgba(255, 176, 62, 0.82)',
      lineWidth: baseWidth,
      lineAlpha: 0.9,
      shadowColor: 'rgba(255, 151, 34, 0.32)',
      shadowBlur: 6,
    });
    strokePath(outerPath, outerCount, {
      color: 'rgba(255, 207, 124, 0.68)',
      lineWidth: Math.max(1.8, baseWidth - 0.3),
      lineAlpha: 0.7,
      dash: [12, 8],
      shadowColor: 'rgba(255, 151, 34, 0.22)',
      shadowBlur: 4,
    });
  }

  drawRegionLabels(y, alpha) {
    const regions = this.regionMap?.regions ?? [];
    if (!regions.length) return;
    const ctx = this.ctx;
    const fontSize = this.distance > 42000 ? 15 : 12;
    ctx.save();
    ctx.font = `700 ${fontSize}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(255, 151, 34, 0.16)';
    ctx.shadowBlur = 8;
    for (const region of regions) {
      const [x, z] = region.label ?? [];
      if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
      const point = this.regionMapPoint(x, z);
      const screen = this.screen({ x: point.x, y, z: point.z });
      if (!screen) continue;
      const label = String(region.name ?? '').toUpperCase();
      const metrics = ctx.measureText(label);
      const plateWidth = metrics.width + 14;
      const plateHeight = fontSize + 8;
      ctx.globalAlpha = alpha * 0.72;
      ctx.fillStyle = 'rgba(2, 8, 10, 0.56)';
      roundedRect(ctx, screen.x - plateWidth / 2, screen.y - plateHeight / 2, plateWidth, plateHeight, 4);
      ctx.fill();
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.82)';
      ctx.strokeText(label, screen.x, screen.y);
      ctx.fillStyle = 'rgba(255, 211, 142, 0.9)';
      ctx.fillText(label, screen.x, screen.y);
    }
    ctx.restore();
  }

  centerClipRect() {
    const rect = this.overlay.getBoundingClientRect();
    return {
      x: rect.width / 6,
      y: rect.height / 6,
      width: rect.width * 2 / 3,
      height: rect.height * 2 / 3,
    };
  }

  drawWorldLine(a, b) {
    const ctx = this.ctx;
    const segments = 32;
    let drawing = false;
    ctx.beginPath();
    for (let i = 0; i <= segments; i += 1) {
      const t = i / segments;
      const point = {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        z: a.z + (b.z - a.z) * t,
      };
      const screen = this.screen(point);
      if (!screen) {
        drawing = false;
        continue;
      }
      if (!drawing) {
        ctx.moveTo(screen.x, screen.y);
        drawing = true;
      } else {
        ctx.lineTo(screen.x, screen.y);
      }
    }
    ctx.stroke();
  }

  drawDropLines(grid) {
    const ctx = this.ctx;
    const clip = this.centerClipRect();
    ctx.save();
    ctx.beginPath();
    ctx.rect(clip.x, clip.y, clip.width, clip.height);
    ctx.clip();
    for (const [index, point] of this.gridAnchorPoints.entries()) {
      const start = this.screen(point);
      const end = this.screen({ x: point.x, y: grid.y, z: point.z });
      if (!start || !end) continue;
      const color = colorsForType(point.typeName).map((component) => Math.round(component * 255));
      const prominence = 1 - index / Math.max(1, this.gridAnchorPoints.length);
      const colorText = color.join(',');
      ctx.strokeStyle = `rgba(${colorText}, ${0.3 + prominence * 0.34})`;
      ctx.lineWidth = 1 + prominence * 0.8;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();

      const groundedStart = {
        x: start.x + (end.x - start.x) * 0.68,
        y: start.y + (end.y - start.y) * 0.68,
      };
      ctx.strokeStyle = `rgba(99, 231, 235, ${0.46 + prominence * 0.38})`;
      ctx.lineWidth = 1.2 + prominence;
      ctx.beginPath();
      ctx.moveTo(groundedStart.x, groundedStart.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();

      const footSize = 3 + prominence * 1.4;
      ctx.strokeStyle = `rgba(128, 242, 244, ${0.66 + prominence * 0.28})`;
      ctx.lineWidth = 1 + prominence * 0.5;
      ctx.beginPath();
      ctx.moveTo(end.x - footSize, end.y);
      ctx.lineTo(end.x + footSize, end.y);
      ctx.moveTo(end.x, end.y - footSize);
      ctx.lineTo(end.x, end.y + footSize);
      ctx.stroke();
      ctx.fillStyle = `rgba(224, 255, 255, ${0.72 + prominence * 0.24})`;
      ctx.beginPath();
      ctx.arc(end.x, end.y, 1.2 + prominence * 0.7, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = `rgba(${colorText}, ${0.62 + prominence * 0.32})`;
      ctx.fillStyle = `rgba(${colorText}, ${0.72 + prominence * 0.25})`;
      ctx.lineWidth = 1 + prominence;
      ctx.beginPath();
      ctx.arc(start.x, start.y, 4 + prominence * 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(start.x, start.y, 1.4 + prominence, 0, Math.PI * 2);
      ctx.fill();
    }
    this.drawHoverDepthCue(grid);
    ctx.restore();
  }

  drawHoverDepthCue(grid) {
    const point = this.hoverPoint;
    if (!this.showDepthEmphasis || !point
      || point.x < grid.minX || point.x > grid.maxX
      || point.z < grid.minZ || point.z > grid.maxZ
      || Math.abs(point.y - grid.y) < 0.5) return;
    const start = this.screen(point);
    const end = this.screen({ x: point.x, y: grid.y, z: point.z });
    if (!start || !end) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = 'rgba(151, 249, 250, 0.86)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();

    const phase = (performance.now() % 1100) / 1100;
    const pulseX = start.x + (end.x - start.x) * phase;
    const pulseY = start.y + (end.y - start.y) * phase;
    ctx.fillStyle = 'rgba(224, 255, 255, 0.96)';
    ctx.shadowColor = 'rgba(88, 238, 242, 0.95)';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(pulseX, pulseY, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawOrbitPoint(grid) {
    const screen = this.screen({ x: this.target[0], y: this.target[1], z: this.target[2] });
    if (!screen) return;
    const ctx = this.ctx;
    const coords = fromRenderCoords({ x: this.target[0], y: this.target[1], z: this.target[2] });
    const label = `X ${coords.x.toFixed(1)}, Y ${coords.y.toFixed(1)}, Z ${coords.z.toFixed(1)}`;
    ctx.save();
    ctx.strokeStyle = this.orbitLocked ? 'rgba(242, 165, 65, 0.8)' : 'rgba(66, 209, 199, 0.72)';
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(screen.x - 7, screen.y);
    ctx.lineTo(screen.x + 7, screen.y);
    ctx.moveTo(screen.x, screen.y - 7);
    ctx.lineTo(screen.x, screen.y + 7);
    ctx.stroke();
    ctx.font = '12px Segoe UI, sans-serif';
    ctx.fillText(label, screen.x + 10, screen.y + 10);
    ctx.restore();
  }

  drawSelectedSystem() {
    const screen = this.screen(this.selectedSystem);
    if (!screen) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(screen.x, screen.y);
    ctx.strokeStyle = '#f2a541';
    ctx.fillStyle = '#f2a541';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(0, 0, 16, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-22, 0);
    ctx.lineTo(-11, 0);
    ctx.moveTo(11, 0);
    ctx.lineTo(22, 0);
    ctx.moveTo(0, -22);
    ctx.lineTo(0, -11);
    ctx.moveTo(0, 11);
    ctx.lineTo(0, 22);
    ctx.stroke();
    ctx.font = '600 13px Segoe UI, sans-serif';
    ctx.textBaseline = 'middle';
    const width = ctx.measureText(this.selectedSystem.name).width;
    this.drawLabelPlate(24, -13, width + 16, 26, 'rgba(242, 165, 65, 0.72)');
    ctx.fillStyle = '#f2a541';
    ctx.fillText(this.selectedSystem.name, 31, 0);
    ctx.restore();
  }

  drawSelectedPlace() {
    const screen = this.screen(this.selectedPlace);
    if (!screen) return;
    this.drawPlaceMarker(this.selectedPlace, screen, true);
  }

  drawHoverMarker() {
    if (!this.hoverScreen || this.selectedSystem?.index === this.hoverIndex) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(this.hoverScreen.x, this.hoverScreen.y);
    ctx.strokeStyle = 'rgba(236, 242, 247, 0.78)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  drawMarker(point, search, alpha = 1) {
    const screen = this.screen(point);
    if (!screen) return;
    const ctx = this.ctx;
    const color = colorsForType(point.typeName);
    const css = `rgb(${color.map((c) => Math.round(c * 255)).join(',')})`;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(screen.x, screen.y);
    ctx.strokeStyle = search ? '#f2a541' : css;
    ctx.fillStyle = search ? '#f2a541' : css;
    ctx.lineWidth = search ? 2 : 1.4;
    if (this.showVisited && (point.flags & 4)) {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (const brace of visitedBraceGeometry()) {
        ctx.moveTo(...brace.start);
        for (const curve of brace.curves) ctx.bezierCurveTo(...curve);
      }
      ctx.stroke();
    }
    if (search) {
      ctx.beginPath();
      ctx.arc(0, 0, 12, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (point.special === 'blackHole') {
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, Math.PI * 2);
      ctx.stroke();
    } else if (point.special === 'neutron') {
      ctx.beginPath();
      ctx.moveTo(-9, 0);
      ctx.lineTo(9, 0);
      ctx.moveTo(0, -4);
      ctx.lineTo(0, 4);
      ctx.stroke();
    } else if (point.special === 'whiteDwarf') {
      ctx.rotate(Math.PI / 4);
      ctx.strokeRect(-4, -4, 8, 8);
    } else if (point.special === 'triangle') {
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(6, 5);
      ctx.lineTo(-6, 5);
      ctx.closePath();
      ctx.stroke();
    } else if (point.special === 'giant') {
      ctx.strokeRect(-6, -6, 12, 12);
    } else if (point.special === 'other') {
      ctx.beginPath();
      ctx.arc(0, 0, 5, 0, Math.PI * 2);
      ctx.moveTo(-7, 0);
      ctx.lineTo(7, 0);
      ctx.stroke();
    }
    ctx.restore();
  }

  pick(event) {
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const placeHit = this.showPlaces || this.showMurderBinaries ? this.findPlaceNear(x, y, 20) : null;
    if (placeHit) {
      this.onPlaceSelect?.(placeHit.place);
      return;
    }
    const hit = this.findPointNear(x, y, 22);
    if (hit) this.onSelect?.(hit.point.index);
  }

  contextPick(event) {
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const hit = this.findPointNear(x, y, 26);
    if (hit) this.onSystemContext?.({ index: hit.point.index, x, y, screen: hit.screen });
  }

  updateHover(event) {
    const now = performance.now();
    if (now - this.lastHoverAt < 60) return;
    this.lastHoverAt = now;
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const placeHit = this.showPlaces || this.showMurderBinaries ? this.findPlaceNear(x, y, 16) : null;
    if (placeHit) {
      this.hoverIndex = null;
      this.hoverPlaceId = placeHit.place.id ?? placeHit.place.name ?? '';
      this.hoverScreen = placeHit.screen;
      this.hoverPoint = null;
      this.onHover?.(null);
      this.onPlaceHover?.({ place: placeHit.place, x: placeHit.screen.x, y: placeHit.screen.y });
      return;
    }
    const hit = this.findPointNear(x, y, 16);
    if (this.hoverPlaceId !== null) {
      this.hoverPlaceId = null;
      if (!hit) this.onPlaceHover?.(null);
    }
    const nextIndex = hit?.point?.index ?? null;
    if (nextIndex === this.hoverIndex) {
      if (hit?.screen) {
        this.hoverScreen = hit.screen;
        this.hoverPoint = hit.point;
      }
      return;
    }
    this.hoverIndex = nextIndex;
    this.hoverScreen = hit?.screen ?? null;
    this.hoverPoint = hit?.point ?? null;
    this.onHover?.(hit ? { index: hit.point.index, x: hit.screen.x, y: hit.screen.y } : null);
  }

  findPointNear(x, y, radius) {
    let best = null;
    let bestScore = Infinity;
    const candidates = [
      ...(Number.isInteger(this.selectedSystem?.index) && this.selectedSystem.index >= 0 ? [this.selectedSystem] : []),
      ...this.searchResults.map((r) => ({ ...r.coords, index: r.index })),
      ...this.points,
    ];
    for (const point of candidates) {
      const screen = this.screen(point);
      if (!screen) continue;
      const hitRadius = this.hitRadius(point, radius);
      const dist = Math.hypot(screen.x - x, screen.y - y);
      if (dist > hitRadius) continue;
      const depthBias = (screen.z + 1) * 4;
      const selectedBias = point.index === this.selectedSystem?.index ? -8 : 0;
      const importantBias = point.special || (point.flags & 4) ? -2 : 0;
      const score = dist + depthBias + selectedBias + importantBias;
      if (score < bestScore) {
        best = { point, screen };
        bestScore = score;
      }
    }
    return best;
  }

  findPlaceNear(x, y, radius) {
    let best = null;
    let bestScore = Infinity;
    for (const place of this.visiblePlaces()) {
      const screen = this.screen(place);
      if (!screen) continue;
      const hitRadius = this.selectedPlace?.id === place.id ? Math.max(radius, 26) : radius;
      const dist = Math.hypot(screen.x - x, screen.y - y);
      if (dist > hitRadius) continue;
      const score = dist + (screen.z + 1) * 4 + (this.selectedPlace?.id === place.id ? -6 : 0);
      if (score < bestScore) {
        best = { place, screen };
        bestScore = score;
      }
    }
    return best;
  }

  hitRadius(point, fallback) {
    if (point.index === this.selectedSystem?.index) return Math.max(fallback, 28);
    if (this.searchResults.some((result) => result.index === point.index)) return Math.max(fallback, 24);
    if (point.special || (point.flags & 4)) return Math.max(fallback, 20);
    return fallback;
  }

  start() {
    const frame = () => {
      this.keyboardMove();
      this.rebuildDrawBuffers();
      const matrix = this.camera();
      this.drawStars(matrix);
      this.drawOverlay();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
}
