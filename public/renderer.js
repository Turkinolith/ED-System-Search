import { decodeId64, massCodeFromFlags } from './id64.js?v=mass-layers-1';

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

// The galaxy glow: a top-down density image on the galactic plane, drawn
// before the stars the way the in-game map draws its Milky Way impostors
// separately from the capped star instances. Luminance is log density, alpha
// is the share of heavy (mass code e..h) systems, 0.5 = galaxy average.
const glowVertexShader = `
attribute vec3 a_position;
attribute vec2 a_uv;
uniform mat4 u_matrix;
varying vec2 v_uv;
void main() {
  gl_Position = u_matrix * vec4(a_position, 1.0);
  v_uv = a_uv;
}
`;

const glowFragmentShader = `
precision mediump float;
uniform sampler2D u_density;
uniform float u_alpha;
varying vec2 v_uv;
void main() {
  vec4 texel = texture2D(u_density, v_uv);
  float glow = pow(texel.r, 1.8);
  vec3 warm = vec3(1.0, 0.74, 0.48);
  vec3 cool = vec3(0.56, 0.7, 1.0);
  vec3 color = mix(warm, cool, smoothstep(0.4, 0.85, texel.a));
  vec2 edge = smoothstep(vec2(0.0), vec2(0.04), v_uv) * smoothstep(vec2(1.0), vec2(0.96), v_uv);
  float strength = glow * u_alpha * edge.x * edge.y * 0.55;
  gl_FragColor = vec4(color * strength, strength);
}
`;

// Nebula clouds: soft billboards at known nebula positions, the counterpart
// of the in-game map's background nebula impostors.
const nebulaVertexShader = `
attribute vec3 a_center;
attribute vec2 a_corner;
attribute float a_radius;
attribute vec3 a_color;
attribute float a_seed;
uniform mat4 u_matrix;
uniform vec3 u_right;
uniform vec3 u_up;
uniform vec3 u_eye;
uniform float u_alpha;
varying vec2 v_uv;
varying vec3 v_color;
varying float v_alpha;
void main() {
  vec3 world = a_center + (u_right * a_corner.x + u_up * a_corner.y) * a_radius;
  gl_Position = u_matrix * vec4(world, 1.0);
  float angle = a_seed * 6.2831853;
  mat2 spin = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
  v_uv = spin * a_corner * 0.5 + 0.5;
  v_color = a_color;
  float cameraDistance = length(a_center - u_eye);
  v_alpha = u_alpha * smoothstep(a_radius * 0.6, a_radius * 2.5, cameraDistance);
}
`;

const nebulaFragmentShader = `
precision mediump float;
uniform sampler2D u_cloud;
varying vec2 v_uv;
varying vec3 v_color;
varying float v_alpha;
void main() {
  float density = texture2D(u_cloud, v_uv).a * v_alpha;
  gl_FragColor = vec4(v_color * density, density);
}
`;

function shader(gl, type, source) {
  const s = gl.createShader(type);
  gl.shaderSource(s, source);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

function program(gl, vertexSource = vertexShader, fragmentSource = fragmentShader) {
  const p = gl.createProgram();
  gl.attachShader(p, shader(gl, gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(p, shader(gl, gl.FRAGMENT_SHADER, fragmentSource));
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

export function gridAxisCueLayout(origin, positivePoint, clip, preferredDistance = 210, padding = 74) {
  if (!origin || !positivePoint || !clip) return null;
  const dx = positivePoint.x - origin.x;
  const dy = positivePoint.y - origin.y;
  const projectedLength = Math.hypot(dx, dy);
  if (!Number.isFinite(projectedLength) || projectedLength < 28) return null;
  const unit = { x: dx / projectedLength, y: dy / projectedLength };
  const left = clip.x + padding;
  const right = clip.x + clip.width - padding;
  const top = clip.y + padding;
  const bottom = clip.y + clip.height - padding;
  const xRoom = Math.abs(unit.x) < 0.0001
    ? Number.POSITIVE_INFINITY
    : unit.x > 0 ? (right - origin.x) / unit.x : (left - origin.x) / unit.x;
  const yRoom = Math.abs(unit.y) < 0.0001
    ? Number.POSITIVE_INFINITY
    : unit.y > 0 ? (bottom - origin.y) / unit.y : (top - origin.y) / unit.y;
  const available = Math.min(xRoom, yRoom);
  if (!Number.isFinite(available) || available < 54) return null;
  const distance = Math.min(preferredDistance, available * 0.82);
  return {
    unit,
    perpendicular: { x: -unit.y, y: unit.x },
    tip: { x: origin.x + unit.x * distance, y: origin.y + unit.y * distance },
  };
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

function routeStarColor(starClass = '') {
  const key = String(starClass ?? '').trim().charAt(0).toUpperCase();
  const colors = {
    O: '#9db9ff',
    B: '#b9ccff',
    A: '#d7e3ff',
    F: '#fff4cf',
    G: '#ffd27d',
    K: '#ffad5d',
    M: '#ff7a45',
    N: '#67e9ff',
    D: '#d6f4ff',
  };
  return colors[key] ?? '#66e0c2';
}

export function colorsForType(typeName = '') {
  return cachedStarVisual(typeName).color;
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

// Context slots (beyond the nearest share of the budget) go to the heaviest
// mass codes first, like the in-game map's mass-layered octree; the stable
// hash bucket breaks ties within a layer. Unknown mass codes rank as class d.
export function contextRank(massCode, bucket) {
  const layer = Number.isInteger(massCode) && massCode >= 0 && massCode <= 7 ? massCode : 3;
  return (7 - layer) * 2 ** 32 + (bucket >>> 0);
}

function pointContextRank(point) {
  return point.contextRank ?? contextRank(point.massCode, point.bucket);
}

export function prioritizeDrawCandidates(candidates, limit, nearFraction = 0.8) {
  if (limit <= 0 || candidates.length === 0) return [];
  if (candidates.length <= limit) return candidates;
  const nearestCount = Math.max(1, Math.min(limit, Math.floor(limit * nearFraction)));
  quickselectPrefix(candidates, nearestCount, (item) => item.distanceSq);
  const nearest = candidates.slice(0, nearestCount);
  const context = candidates.slice(nearestCount);
  const contextCount = limit - nearestCount;
  quickselectPrefix(context, contextCount, (item) => pointContextRank(item.point));
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

export function starViewVolumeContains(height, step) {
  const gridStep = Math.max(1, Number(step) || 1);
  if (gridStep > 10) return true;
  return Math.abs(Number(height) || 0) <= 50;
}

const defaultVisitedBraceGeometry = visitedBraceGeometry();
const giantCageVertices = Array.from({ length: 6 }, (_, index) => {
  const angle = Math.PI / 6 + index * Math.PI / 3;
  return [Math.cos(angle) * 9, Math.sin(angle) * 9];
});
// Eased camera glide between focus points. Long jumps pull the camera back
// mid-flight so the move reads as travel rather than a cut.
export function flightDuration(from, to) {
  const travel = Math.hypot(...to.target.map((value, index) => value - from.target[index]));
  return clamp(0.55 + Math.log10(1 + travel / 50) * 0.16, 0.55, 1.2);
}

export function flightPose(from, to, t) {
  const progress = clamp(t, 0, 1);
  const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - ((-2 * progress + 2) ** 3) / 2;
  const target = from.target.map((value, index) => value + (to.target[index] - value) * eased);
  const travel = Math.hypot(...to.target.map((value, index) => value - from.target[index]));
  const logFrom = Math.log(Math.max(1, from.distance));
  const logTo = Math.log(Math.max(1, to.distance));
  const base = Math.exp(logFrom + (logTo - logFrom) * eased);
  const lift = Math.max(0, Math.min(travel * 0.6, 60000) - Math.max(from.distance, to.distance));
  return { target, distance: base + lift * Math.sin(Math.PI * progress) };
}

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

// Text laid flat on the grid plane: an affine basis whose x axis reads left
// to right on screen and whose y axis keeps the glyphs unmirrored.
export function planeTextBasis(origin, axisA, axisB) {
  if (!origin || !axisA || !axisB) return null;
  const vectors = [
    { x: axisA.x - origin.x, y: axisA.y - origin.y },
    { x: axisB.x - origin.x, y: axisB.y - origin.y },
  ];
  const candidates = [
    { right: vectors[0], other: vectors[1] },
    { right: { x: -vectors[0].x, y: -vectors[0].y }, other: vectors[1] },
    { right: vectors[1], other: vectors[0] },
    { right: { x: -vectors[1].x, y: -vectors[1].y }, other: vectors[0] },
  ];
  let best = null;
  for (const candidate of candidates) {
    const length = Math.hypot(candidate.right.x, candidate.right.y);
    if (length < 1e-6) continue;
    const score = candidate.right.x / length;
    if (!best || score > best.score) best = { ...candidate, score };
  }
  if (!best) return null;
  let down = best.other;
  if (best.right.x * down.y - best.right.y * down.x < 0) down = { x: -down.x, y: -down.y };
  return { origin, right: best.right, down };
}

// Deterministic fractal-noise cloud with a soft radial falloff, used as the
// alpha mask for every nebula billboard.
export function buildCloudTexels(size = 128) {
  const lattice = (x, y, seed) => {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2147483647);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const valueNoise = (x, y, seed) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const top = lattice(x0, y0, seed) + (lattice(x0 + 1, y0, seed) - lattice(x0, y0, seed)) * sx;
    const bottom = lattice(x0, y0 + 1, seed) + (lattice(x0 + 1, y0 + 1, seed) - lattice(x0, y0 + 1, seed)) * sx;
    return top + (bottom - top) * sy;
  };
  const texels = new Uint8Array(size * size);
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const u = column / (size - 1) * 2 - 1;
      const v = row / (size - 1) * 2 - 1;
      let noise = 0;
      let amplitude = 0.55;
      let frequency = 3;
      for (let octave = 0; octave < 5; octave += 1) {
        noise += valueNoise((u + 1) * frequency, (v + 1) * frequency, octave + 1) * amplitude;
        amplitude *= 0.5;
        frequency *= 2;
      }
      const radius = Math.hypot(u, v);
      const falloff = 1 - smoothstep(0.25, 1, radius);
      const cloud = clamp((noise - 0.32) * 1.9, 0, 1) * falloff;
      texels[row * size + column] = Math.round(cloud * 255);
    }
  }
  return texels;
}

function nameHash(text) {
  let hash = 2166136261;
  for (const char of String(text ?? '')) hash = Math.imul(hash ^ char.codePointAt(0), 16777619);
  return hash >>> 0;
}

const nebulaTints = [
  [0.86, 0.42, 0.48],
  [0.42, 0.62, 0.9],
  [0.42, 0.82, 0.76],
  [0.66, 0.66, 0.7],
];

export function nebulaSprite(place) {
  const hash = nameHash(place?.name ?? place?.id);
  const tint = nebulaTints[hash % nebulaTints.length];
  return {
    radius: 60 + (hash >>> 8) % 101,
    // Mostly grey, like the in-game backdrop clouds, with a hint of colour.
    color: tint.map((component) => component * 0.55 + 0.6 * 0.45),
    seed: ((hash >>> 16) % 1000) / 1000,
  };
}

// Fine grids need exact values (every label near Colonia would otherwise
// read "-10k"); coarse grids keep the compact thousands form.
export function formatPlaneCoordinate(value, step) {
  const rounded = Math.round(value);
  if (step >= 1000 && Math.abs(rounded) >= 1000) return `${(rounded / 1000).toFixed(1)}k`;
  return rounded.toLocaleString('en-US');
}

export function parseGalaxyDensity(buffer) {
  if (!buffer || buffer.byteLength < 32) return null;
  const view = new DataView(buffer);
  const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 8));
  if (magic !== 'EDGDENS1' || view.getUint32(8, true) !== 1) return null;
  const width = view.getUint32(12, true);
  const height = view.getUint32(16, true);
  if (!width || !height || buffer.byteLength < 32 + width * height * 2) return null;
  return {
    width,
    height,
    minX: view.getFloat32(20, true),
    minZ: view.getFloat32(24, true),
    cellSize: view.getFloat32(28, true),
    texels: new Uint8Array(buffer, 32, width * height * 2),
  };
}

// A quad on the galactic plane (y = 0) in render coordinates, where x is
// mirrored from galactic x.
export function galaxyGlowQuad(image) {
  const maxX = image.minX + image.width * image.cellSize;
  const maxZ = image.minZ + image.height * image.cellSize;
  const corners = [
    [image.minX, image.minZ, 0, 0],
    [maxX, image.minZ, 1, 0],
    [image.minX, maxZ, 0, 1],
    [maxX, maxZ, 1, 1],
  ];
  return {
    positions: new Float32Array(corners.flatMap(([x, z]) => {
      const render = toRenderCoords({ x, y: 0, z });
      return [render.x, render.y, render.z];
    })),
    uvs: new Float32Array(corners.flatMap(([, , u, v]) => [u, v])),
  };
}

// Fades in once the view is wide enough for the capped star layer to look
// sparse, and softens when looking edge-on at the flat plane.
export function galaxyGlowAlpha(distance, pitch) {
  const zoom = smoothstep(1500, 9000, Number(distance) || 0);
  const tilt = 0.3 + 0.7 * Math.abs(Math.sin(Number(pitch) || 0));
  return zoom * tilt;
}

export function boxelCorners(boxel) {
  const corners = [];
  for (const x of [boxel.min.x, boxel.max.x]) {
    for (const y of [boxel.min.y, boxel.max.y]) {
      for (const z of [boxel.min.z, boxel.max.z]) corners.push({ x, y, z });
    }
  }
  return corners;
}

// Index pairs into boxelCorners() that differ along exactly one axis.
const boxelEdges = [
  [0, 1], [2, 3], [4, 5], [6, 7],
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

const starVisualCache = new Map();
const specialKindCache = new Map();

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

// Spectral stand-ins for each mass code, from the classes that dominate it in
// the imported data. Used only when the primary star type is unknown.
const massCodeStandInTypes = [
  'L (Brown dwarf) Star',
  'M (Red dwarf) Star',
  'K (Yellow-Orange) Star',
  'F (White) Star',
  'B (Blue-White) Star',
  'B (Blue-White) Star',
  'O (Blue-White) Star',
  'O (Blue-White) Star',
];
const estimatedVisualCache = new Map();

export function isUnknownStarType(typeName = '') {
  const text = String(typeName ?? '').trim();
  return text === '' || text === 'Unknown';
}

export function estimatedStarVisual(massCode) {
  const standIn = massCodeStandInTypes[massCode];
  if (!standIn) return starVisual('Unknown');
  const base = starVisual(standIn);
  const unknownColor = starVisual('Unknown').color;
  // Pull the colour partway back to the unknown grey so estimates read as
  // softer than catalogued stars.
  return {
    color: base.color.map((component, index) => component * 0.65 + unknownColor[index] * 0.35),
    size: base.size * 0.9,
    style: base.style,
    estimated: true,
  };
}

function pointStarVisual(point) {
  if (!isUnknownStarType(point.typeName) || !(point.massCode >= 0)) return cachedStarVisual(point.typeName);
  let visual = estimatedVisualCache.get(point.massCode);
  if (!visual) {
    visual = estimatedStarVisual(point.massCode);
    estimatedVisualCache.set(point.massCode, visual);
  }
  return visual;
}

function cachedStarVisual(typeName = '') {
  const key = String(typeName ?? '');
  let visual = starVisualCache.get(key);
  if (!visual) {
    visual = starVisual(key);
    starVisualCache.set(key, visual);
  }
  return visual;
}

export function specialKind(typeName = '') {
  if (typeName.includes('Black Hole')) return 'blackHole';
  if (typeName.includes('Neutron')) return 'neutron';
  if (typeName.includes('White Dwarf')) return 'whiteDwarf';
  if (typeName.includes('T Tauri') || typeName.includes('Herbig')) return 'protostar';
  if (isGiantStarType(typeName)) return 'giant';
  if (/Wolf-Rayet|C Star|CJ Star|CN Star|S-type|MS-type/i.test(typeName)) return 'other';
  return '';
}

function cachedSpecialKind(typeName = '') {
  const key = String(typeName ?? '');
  if (!specialKindCache.has(key)) specialKindCache.set(key, specialKind(key));
  return specialKindCache.get(key);
}

function isPrioritySpecial(point) {
  return Boolean(point?.special && point.special !== 'giant');
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

function yieldToUi() {
  if (typeof scheduler !== 'undefined' && typeof scheduler.yield === 'function') return scheduler.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export class GalaxyRenderer {
  constructor(canvas, overlay) {
    this.canvas = canvas;
    this.overlay = overlay;
    this.gl = canvas.getContext('webgl', { antialias: true, alpha: true });
    this.ctx = overlay.getContext('2d');
    this.program = program(this.gl);
    this.uniformLocations = {
      matrix: this.gl.getUniformLocation(this.program, 'u_matrix'),
      pixelRatio: this.gl.getUniformLocation(this.program, 'u_pixel_ratio'),
    };
    this.attributeLocations = {
      position: this.gl.getAttribLocation(this.program, 'a_position'),
      color: this.gl.getAttribLocation(this.program, 'a_color'),
      size: this.gl.getAttribLocation(this.program, 'a_size'),
      style: this.gl.getAttribLocation(this.program, 'a_style'),
      phase: this.gl.getAttribLocation(this.program, 'a_phase'),
      alpha: this.gl.getAttribLocation(this.program, 'a_alpha'),
    };
    this.matrixData = new Float32Array(16);
    this.positionBuffer = this.gl.createBuffer();
    this.colorBuffer = this.gl.createBuffer();
    this.sizeBuffer = this.gl.createBuffer();
    this.styleBuffer = this.gl.createBuffer();
    this.phaseBuffer = this.gl.createBuffer();
    this.alphaBuffer = this.gl.createBuffer();
    this.basePoints = [];
    this.localPoints = [];
    this.showBasePoints = true;
    this.allPoints = [];
    this.pointDecodeTokens = { basePoints: 0, localPoints: 0 };
    this.mergeToken = 0;
    this.pointByIndex = new Map();
    this.pointSpatialBuckets = new Map();
    this.pointSpatialCellSize = 2500;
    this.alwaysPriorityPoints = [];
    this.visitedPriorityPoints = [];
    this.points = [];
    this.searchResults = [];
    this.selectedSystem = null;
    this.routeOverlay = null;
    this.routeHops = [];
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
    this.showGalaxyGlow = true;
    this.showBoxel = true;
    this.showNebulae = true;
    this.galaxyGlow = null;
    this.nebulae = null;
    this.flight = null;
    this.colorMode = null;
    this.eye = [0, 0, 0];
    this.showPlaces = true;
    this.showAllPlaces = false;
    this.isolatePlaces = false;
    this.showMurderBinaries = false;
    this.showCarrierRange = false;
    this.showRouteOverlay = false;
    this.starScale = 4;
    this.autoStarScale = true;
    this.onStarScaleChange = null;
    this.onDrawCountChange = null;
    this.lastReportedDrawCount = -1;
    this.onTargetChange = null;
    this.lastReportedStarScale = null;
    this.drag = null;
    this.hoverIndex = null;
    this.hoverPlaceId = null;
    this.hoverRouteIndex = null;
    this.hoverScreen = null;
    this.hoverPoint = null;
    this.lastHoverAt = 0;
    this.frameRect = null;
    this.renderSerial = 0;
    this.pickCacheSerial = -1;
    this.pickCellSize = 48;
    this.pickBuckets = new Map();
    this.searchResultIndexes = new Set();
    this.keys = new Set();
    this.onSelect = null;
    this.onHover = null;
    this.onSystemContext = null;
    this.onPlaceContext = null;
    this.onPlaceSelect = null;
    this.onPlaceHover = null;
    this.matrix = identity();
    this.lastBufferKey = '';
    this.lastBufferBuild = 0;
    this.renderRequested = false;
    this.dropLinePulseTimer = null;
    this.frameHandle = null;
    this.continuousUntil = 0;
    this.frameCostMs = 16;
    this.performanceScale = 1;
    this.lastQualityUpdate = 0;
    this.regionMap = null;
    this.regionBoundaryLods = null;
    this.regionPathCacheKey = '';
    this.regionPathCache = null;
    this.regionMapLoading = false;
    this.regionMapError = null;
    this.accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#f2a541';
    this.glowProgram = program(this.gl, glowVertexShader, glowFragmentShader);
    this.glowLocations = {
      matrix: this.gl.getUniformLocation(this.glowProgram, 'u_matrix'),
      alpha: this.gl.getUniformLocation(this.glowProgram, 'u_alpha'),
      density: this.gl.getUniformLocation(this.glowProgram, 'u_density'),
      position: this.gl.getAttribLocation(this.glowProgram, 'a_position'),
      uv: this.gl.getAttribLocation(this.glowProgram, 'a_uv'),
    };
    this.nebulaProgram = program(this.gl, nebulaVertexShader, nebulaFragmentShader);
    this.nebulaLocations = {
      matrix: this.gl.getUniformLocation(this.nebulaProgram, 'u_matrix'),
      right: this.gl.getUniformLocation(this.nebulaProgram, 'u_right'),
      up: this.gl.getUniformLocation(this.nebulaProgram, 'u_up'),
      eye: this.gl.getUniformLocation(this.nebulaProgram, 'u_eye'),
      alpha: this.gl.getUniformLocation(this.nebulaProgram, 'u_alpha'),
      cloud: this.gl.getUniformLocation(this.nebulaProgram, 'u_cloud'),
      center: this.gl.getAttribLocation(this.nebulaProgram, 'a_center'),
      corner: this.gl.getAttribLocation(this.nebulaProgram, 'a_corner'),
      radius: this.gl.getAttribLocation(this.nebulaProgram, 'a_radius'),
      color: this.gl.getAttribLocation(this.nebulaProgram, 'a_color'),
      seed: this.gl.getAttribLocation(this.nebulaProgram, 'a_seed'),
    };
    this.bind();
    this.loadRegionMap();
    this.loadGalaxyGlow();
  }

  setNebulae(places) {
    const gl = this.gl;
    const sprites = (places ?? [])
      .filter((place) => place?.type === 'nebula' && place.coords)
      .map((place) => ({ ...nebulaSprite(place), center: toRenderCoords(place.coords) }));
    if (!sprites.length) {
      this.nebulae = null;
      this.requestRender();
      return;
    }
    const corners = [[-1, -1], [1, -1], [-1, 1], [-1, 1], [1, -1], [1, 1]];
    const vertexCount = sprites.length * corners.length;
    const centers = new Float32Array(vertexCount * 3);
    const cornerData = new Float32Array(vertexCount * 2);
    const radii = new Float32Array(vertexCount);
    const colors = new Float32Array(vertexCount * 3);
    const seeds = new Float32Array(vertexCount);
    let vertex = 0;
    for (const sprite of sprites) {
      for (const [cx, cy] of corners) {
        centers.set([sprite.center.x, sprite.center.y, sprite.center.z], vertex * 3);
        cornerData.set([cx, cy], vertex * 2);
        radii[vertex] = sprite.radius;
        colors.set(sprite.color, vertex * 3);
        seeds[vertex] = sprite.seed;
        vertex += 1;
      }
    }
    const buffer = (data) => {
      const handle = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, handle);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      return handle;
    };
    let texture = this.nebulae?.texture;
    if (!texture) {
      const size = 128;
      texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.ALPHA, size, size, 0, gl.ALPHA, gl.UNSIGNED_BYTE, buildCloudTexels(size));
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    for (const old of ['centers', 'corners', 'radii', 'colors', 'seeds']) {
      if (this.nebulae?.[old]) gl.deleteBuffer(this.nebulae[old]);
    }
    this.nebulae = {
      texture,
      vertexCount,
      centers: buffer(centers),
      corners: buffer(cornerData),
      radii: buffer(radii),
      colors: buffer(colors),
      seeds: buffer(seeds),
    };
    this.requestRender();
  }

  drawNebulae(matrix) {
    if (!this.showNebulae || !this.nebulae) return;
    const alpha = 0.38 * smoothstep(120, 900, this.distance);
    if (alpha < 0.01) return;
    const gl = this.gl;
    const locations = this.nebulaLocations;
    const forward = normalize(this.target.map((value, index) => value - this.eye[index]));
    const right = normalize(cross(forward, [0, 1, 0]));
    const up = cross(right, forward);
    gl.useProgram(this.nebulaProgram);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.uniformMatrix4fv(locations.matrix, false, matrix);
    gl.uniform3fv(locations.right, right);
    gl.uniform3fv(locations.up, up);
    gl.uniform3fv(locations.eye, this.eye);
    gl.uniform1f(locations.alpha, alpha);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.nebulae.texture);
    gl.uniform1i(locations.cloud, 0);
    this.attrib(locations.center, this.nebulae.centers, 3);
    this.attrib(locations.corner, this.nebulae.corners, 2);
    this.attrib(locations.radius, this.nebulae.radii, 1);
    this.attrib(locations.color, this.nebulae.colors, 3);
    this.attrib(locations.seed, this.nebulae.seeds, 1);
    gl.drawArrays(gl.TRIANGLES, 0, this.nebulae.vertexCount);
    for (const name of ['center', 'corner', 'radius', 'color', 'seed']) gl.disableVertexAttribArray(locations[name]);
  }

  // Colour-by map modes: the server packs a category index into point flag
  // bits 12..15; the palette maps it to a colour. Null restores star classes.
  setColorMode(mode) {
    this.colorMode = mode?.palette ? mode : null;
    this.lastBufferKey = '';
    this.rebuildDrawBuffers(true);
    this.requestRender();
  }

  pointColor(point) {
    if (this.colorMode) {
      return this.colorMode.palette[point.category] ?? this.colorMode.noData ?? [0.42, 0.46, 0.5];
    }
    return pointStarVisual(point).color;
  }

  async loadGalaxyGlow() {
    try {
      const response = await fetch('/api/galaxy-density');
      if (!response.ok) return;
      const image = parseGalaxyDensity(await response.arrayBuffer());
      if (!image) return;
      const gl = this.gl;
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE_ALPHA, image.width, image.height, 0, gl.LUMINANCE_ALPHA, gl.UNSIGNED_BYTE, image.texels);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const quad = galaxyGlowQuad(image);
      const positionBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, quad.positions, gl.STATIC_DRAW);
      const uvBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, quad.uvs, gl.STATIC_DRAW);
      this.galaxyGlow = { texture, positionBuffer, uvBuffer };
      this.requestRender();
    } catch (error) {
      console.warn('Galaxy glow unavailable:', error);
    }
  }

  galaxyGlowAlpha() {
    if (!this.showGalaxyGlow || !this.galaxyGlow) return 0;
    return galaxyGlowAlpha(this.distance, this.pitch);
  }

  drawGalaxyGlow(matrix) {
    const alpha = this.galaxyGlowAlpha();
    if (alpha < 0.01) return;
    const gl = this.gl;
    const glow = this.galaxyGlow;
    gl.useProgram(this.glowProgram);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.uniformMatrix4fv(this.glowLocations.matrix, false, matrix);
    gl.uniform1f(this.glowLocations.alpha, alpha);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, glow.texture);
    gl.uniform1i(this.glowLocations.density, 0);
    this.attrib(this.glowLocations.position, glow.positionBuffer, 3);
    this.attrib(this.glowLocations.uv, glow.uvBuffer, 2);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disableVertexAttribArray(this.glowLocations.position);
    gl.disableVertexAttribArray(this.glowLocations.uv);
  }

  bind() {
    window.addEventListener('resize', () => {
      this.resize();
      this.requestRender();
    });
    this.canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.cancelFlight();
      this.distance = Math.max(8, this.distance * (event.deltaY > 0 ? 1.12 : 0.88));
      this.notifyTargetChange();
      this.requestRender(240);
    }, { passive: false });
    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    this.canvas.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.cancelFlight();
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
        this.requestRender(240);
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
      this.requestRender();
    });
    window.addEventListener('keydown', (event) => {
      if (isTextInputActive()) return;
      this.cancelFlight();
      this.keys.add(event.key.toLowerCase());
      this.requestRender(180);
    });
    window.addEventListener('keyup', (event) => {
      this.keys.delete(event.key.toLowerCase());
      this.requestRender();
    });
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
      this.requestRender();
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

  setTarget(x, y, z, { animate = true } = {}) {
    const coords = toRenderCoords({ x, y, z });
    const to = { target: [coords.x, coords.y, coords.z], distance: 850 };
    this.orbitLocked = true;
    // The first focus happens before anything is drawn, so it lands instantly.
    if (!animate || this.renderSerial === 0 || prefersReducedMotion()) {
      this.flight = null;
      this.target = to.target;
      this.distance = to.distance;
      this.notifyTargetChange();
      return;
    }
    const from = { target: [...this.target], distance: this.distance };
    this.flight = { from, to, start: performance.now(), duration: flightDuration(from, to) };
    this.requestRender(this.flight.duration * 1000 + 60);
  }

  advanceFlight(now) {
    const flight = this.flight;
    if (!flight) return;
    const t = (now - flight.start) / (flight.duration * 1000);
    const pose = flightPose(flight.from, flight.to, t);
    this.target = pose.target;
    this.distance = pose.distance;
    if (t >= 1) {
      this.flight = null;
      this.target = [...flight.to.target];
      this.distance = flight.to.distance;
      this.notifyTargetChange();
    }
  }

  // Any manual camera input takes over from a glide where it currently is.
  cancelFlight() {
    if (!this.flight) return;
    this.flight = null;
    this.notifyTargetChange();
  }

  targetCoords() {
    return fromRenderCoords({ x: this.target[0], y: this.target[1], z: this.target[2] });
  }

  notifyTargetChange() {
    this.placeDrawKey = '';
    this.onTargetChange?.(this.targetCoords());
    this.requestRender(120);
  }

  setLandmarks(landmarks) {
    this.landmarks = landmarks.map((landmark) => ({
      ...landmark,
      ...toRenderCoords(landmark.coords),
    }));
    this.requestRender();
  }

  setPlaces(places) {
    this.places = places.map((place) => ({
      ...place,
      ...toRenderCoords(place.coords),
    }));
    this.placeDrawKey = '';
    this.requestRender();
  }

  setIsolatePlaces(enabled) {
    this.isolatePlaces = Boolean(enabled);
    this.placeDrawKey = '';
    this.hoverIndex = null;
    this.hoverRouteIndex = null;
    this.hoverPoint = null;
    this.onHover?.(null);
    this.requestRender();
  }

  setRouteOverlay(routePayload) {
    this.routeOverlay = routePayload;
    this.routeHops = Array.isArray(routePayload?.route)
      ? routePayload.route
        .filter((hop) => hop?.coords)
        .map((hop) => ({
          ...hop,
          ...toRenderCoords(hop.coords),
        }))
      : [];
    this.hoverRouteIndex = null;
    this.requestRender();
  }

  setCarrierRange(range) {
    this.carrierRange = range
      ? {
        ...range,
        ...toRenderCoords(range.coords),
        radius: Number(range.radius ?? 500),
      }
      : null;
    this.requestRender();
  }

  setStarScale(scale) {
    this.starScale = clamp(Number(scale) || 4, 0.2, 8);
    this.rebuildDrawBuffers(true);
    this.requestRender();
  }

  setAutoStarScale(enabled) {
    this.autoStarScale = Boolean(enabled);
    this.lastReportedStarScale = null;
    this.rebuildDrawBuffers(true);
    this.requestRender();
  }

  setDepthEmphasis(enabled) {
    this.showDepthEmphasis = Boolean(enabled);
    this.lastBufferKey = '';
    this.rebuildDrawBuffers(true);
    this.requestRender();
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
        special: cachedSpecialKind(system.mainStar),
        boxel: system.id64 ? decodeId64(system.id64) : null,
      }
      : null;
    if (system) this.selectedPlace = null;
    this.pickCacheSerial = -1;
    this.requestRender();
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
    this.requestRender();
  }

  resetOrientation() {
    this.yaw = 0.55;
    this.pitch = -0.48;
    this.requestRender();
  }

  move(direction) {
    this.cancelFlight();
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
    const before = `${this.target.join(':')}:${this.yaw}:${this.pitch}`;
    if (this.keys.has('w')) this.move('forward');
    if (this.keys.has('s')) this.move('backward');
    if (this.keys.has('a')) this.move('left');
    if (this.keys.has('d')) this.move('right');
    if (this.keys.has('r')) this.move('up');
    if (this.keys.has('f')) this.move('down');
    if (this.keys.has('q')) this.yaw -= 0.025;
    if (this.keys.has('e')) this.yaw += 0.025;
    if (before !== `${this.target.join(':')}:${this.yaw}:${this.pitch}`) this.requestRender(80);
  }

  setPoints(buffer, meta) {
    return this.replacePointSource('basePoints', buffer, meta);
  }

  setLocalPoints(buffer, meta) {
    return this.replacePointSource('localPoints', buffer, meta);
  }

  setShowBasePoints(enabled) {
    const next = Boolean(enabled);
    if (this.showBasePoints === next) return Promise.resolve();
    this.showBasePoints = next;
    return this.mergePointSources();
  }

  // Decode and merge are time-sliced so a 300k-point payload never freezes
  // the UI; a newer call for the same source cancels the in-flight one.
  async replacePointSource(sourceKey, buffer, meta) {
    const token = ++this.pointDecodeTokens[sourceKey];
    const isCurrent = () => this.pointDecodeTokens[sourceKey] === token;
    const points = await this.decodePoints(buffer, meta, isCurrent);
    if (!points || !isCurrent()) return;
    this[sourceKey] = points;
    await this.mergePointSources();
  }

  async decodePoints(buffer, meta, isCurrent = () => true) {
    const view = new DataView(buffer);
    const points = [];
    const chunkRecords = 10000;
    let recordsInChunk = 0;
    for (let offset = 0; offset + 20 <= buffer.byteLength; offset += 20) {
      const x = view.getFloat32(offset, true);
      const y = view.getFloat32(offset + 4, true);
      const z = view.getFloat32(offset + 8, true);
      const typeCode = view.getUint16(offset + 12, true);
      const flags = view.getUint16(offset + 14, true);
      const index = view.getUint32(offset + 16, true);
      const typeName = meta.typeNames[typeCode] ?? '';
      const bucket = stableBucket(index);
      const massCode = massCodeFromFlags(flags);
      points.push({
        ...toRenderCoords({ x, y, z }),
        typeName,
        flags,
        index,
        massCode,
        category: (flags >> 12) & 0x0f,
        special: cachedSpecialKind(typeName),
        bucket,
        contextRank: contextRank(massCode, bucket),
      });
      if (++recordsInChunk >= chunkRecords) {
        recordsInChunk = 0;
        await yieldToUi();
        if (!isCurrent()) return null;
      }
    }
    return points;
  }

  async mergePointSources() {
    const token = ++this.mergeToken;
    const isCurrent = () => this.mergeToken === token;
    const indexes = new Set();
    const all = [];
    const sources = this.showBasePoints ? [this.basePoints, this.localPoints] : [this.localPoints];
    for (const source of sources) {
      for (let i = 0; i < source.length; i += 1) {
        const point = source[i];
        if (indexes.has(point.index)) continue;
        indexes.add(point.index);
        all.push(point);
        if (all.length % 25000 === 0) {
          await yieldToUi();
          if (!isCurrent()) return;
        }
      }
    }
    const spatial = await this.buildPointSpatialIndex(all, isCurrent);
    if (!spatial || !isCurrent()) return;
    this.allPoints = all;
    this.pointByIndex = spatial.byIndex;
    this.pointSpatialBuckets = spatial.buckets;
    this.alwaysPriorityPoints = spatial.alwaysPriority;
    this.visitedPriorityPoints = spatial.visitedPriority;
    this.lastBufferKey = '';
    this.pickCacheSerial = -1;
    this.rebuildDrawBuffers(true);
    this.requestRender();
  }

  async buildPointSpatialIndex(allPoints, isCurrent = () => true) {
    const buckets = new Map();
    const byIndex = new Map();
    const alwaysPriority = [];
    const visitedPriority = [];
    const cellSize = this.pointSpatialCellSize;
    for (let i = 0; i < allPoints.length; i += 1) {
      const point = allPoints[i];
      byIndex.set(point.index, point);
      const key = `${Math.floor(point.x / cellSize)}:${Math.floor(point.y / cellSize)}:${Math.floor(point.z / cellSize)}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = [];
        buckets.set(key, bucket);
      }
      bucket.push(point);
      if (point.special || (point.flags & 2)) alwaysPriority.push(point);
      if (point.flags & 4) visitedPriority.push(point);
      if (i > 0 && i % 25000 === 0) {
        await yieldToUi();
        if (!isCurrent()) return null;
      }
    }
    return { buckets, byIndex, alwaysPriority, visitedPriority };
  }

  // Journal scans only ever add visits, so flags are set (never cleared) in
  // place on the shared point objects; a full reload handles anything else.
  applyVisitedFlags(indexSet) {
    let changed = 0;
    for (const point of this.allPoints) {
      if ((point.flags & 4) === 0 && indexSet.has(point.index)) {
        point.flags |= 4;
        changed += 1;
      }
    }
    if (!changed) return 0;
    this.visitedPriorityPoints = this.allPoints.filter((point) => point.flags & 4);
    this.lastBufferKey = '';
    this.rebuildDrawBuffers(true);
    this.requestRender();
    return changed;
  }

  addPointCandidate(out, seen, point) {
    if (!point || seen.has(point.index)) return;
    seen.add(point.index);
    out.push(point);
  }

  pointCandidatesForBuffer(maxDistance, requiredIndexes) {
    if (!Number.isFinite(maxDistance) || !this.pointSpatialBuckets.size) return this.allPoints;
    const out = [];
    const seen = new Set();
    const cellSize = this.pointSpatialCellSize;
    const minX = Math.floor((this.target[0] - maxDistance) / cellSize);
    const maxX = Math.floor((this.target[0] + maxDistance) / cellSize);
    const minY = Math.floor((this.target[1] - maxDistance) / cellSize);
    const maxY = Math.floor((this.target[1] + maxDistance) / cellSize);
    const minZ = Math.floor((this.target[2] - maxDistance) / cellSize);
    const maxZ = Math.floor((this.target[2] + maxDistance) / cellSize);
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        for (let z = minZ; z <= maxZ; z += 1) {
          const bucket = this.pointSpatialBuckets.get(`${x}:${y}:${z}`);
          if (!bucket) continue;
          for (const point of bucket) this.addPointCandidate(out, seen, point);
        }
      }
    }
    for (const point of this.alwaysPriorityPoints) this.addPointCandidate(out, seen, point);
    if (this.showVisited) {
      for (const point of this.visitedPriorityPoints) this.addPointCandidate(out, seen, point);
    }
    for (const index of requiredIndexes) this.addPointCandidate(out, seen, this.pointByIndex.get(index));
    return out;
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
    const pointCandidates = this.pointCandidatesForBuffer(maxDistance, required);
    const importantPoints = [];
    const candidates = [];
    const densityRadiusSq = this.priorityDensityRadius() ** 2;
    let nearbyCandidateCount = 0;

    for (const point of pointCandidates) {
      const dx = point.x - this.target[0];
      const dy = point.y - this.target[1];
      const dz = point.z - this.target[2];
      const distanceSq = dx * dx + dy * dy + dz * dz;
      const requiredForNavigation = required.has(point.index);
      if (!requiredForNavigation && !starViewVolumeContains(dy, gridStep)) continue;
      const important = requiredForNavigation || isPrioritySpecial(point) || (point.flags & 2) || (this.showVisited && (point.flags & 4));
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
    const positions = new Float32Array(drawPoints.length * 3);
    const colors = new Float32Array(drawPoints.length * 3);
    const sizes = new Float32Array(drawPoints.length);
    const styles = new Float32Array(drawPoints.length);
    const phases = new Float32Array(drawPoints.length);
    const alphas = new Float32Array(drawPoints.length);
    const gridAnchorIndexes = new Set(this.gridAnchorPoints.map((point) => point.index));
    const sizeScale = this.starSizeScale();
    for (let pointIndex = 0; pointIndex < drawPoints.length; pointIndex += 1) {
      const point = drawPoints[pointIndex];
      const visual = pointStarVisual(point);
      const distanceAlpha = this.starDistanceAlpha(this.distanceFromTarget(point));
      const gridAnchor = gridAnchorIndexes.has(point.index);
      const depthExempt = required.has(point.index) || (this.showVisited && (point.flags & 4));
      const depth = this.showDepthEmphasis && !depthExempt
        ? gridDepthEmphasis(point.y - this.target[1], gridStep)
        : null;
      const depthAlpha = depth?.alpha ?? 1;
      const depthSize = depth?.size ?? 1;
      const combinedAlpha = distanceAlpha * depthAlpha;
      const vectorOffset = pointIndex * 3;
      positions[vectorOffset] = point.x;
      positions[vectorOffset + 1] = point.y;
      positions[vectorOffset + 2] = point.z;
      const color = this.pointColor(point);
      const uncategorised = this.colorMode && !this.colorMode.palette[point.category];
      colors[vectorOffset] = color[0];
      colors[vectorOffset + 1] = color[1];
      colors[vectorOffset + 2] = color[2];
      sizes[pointIndex] = visual.size * sizeScale * (0.62 + distanceAlpha * 0.38) * depthSize * (gridAnchor ? 1.5 : 1)
        * (uncategorised ? 0.75 : 1);
      styles[pointIndex] = visual.style;
      phases[pointIndex] = (point.bucket % 4096) / 4096;
      alphas[pointIndex] = (gridAnchor ? Math.max(0.9, combinedAlpha) : combinedAlpha) * (uncategorised ? 0.45 : 1);
    }
    this.points = drawPoints;
    this.count = drawPoints.length;
    if (this.count !== this.lastReportedDrawCount) {
      this.lastReportedDrawCount = this.count;
      this.onDrawCountChange?.(this.count);
    }
    this.upload(this.positionBuffer, positions);
    this.upload(this.colorBuffer, colors);
    this.upload(this.sizeBuffer, sizes);
    this.upload(this.styleBuffer, styles);
    this.upload(this.phaseBuffer, phases);
    this.upload(this.alphaBuffer, alphas);
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
    return Math.max(3000, Math.round(zoomDrawBudget(this.distance) * this.performanceScale));
  }

  localPointLimit() {
    return Math.max(0, Math.round(zoomLocalPointLimit(this.distance) * this.performanceScale));
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
      special: cachedSpecialKind(meta.typeNames[result.typeCode] ?? ''),
    }));
    this.searchResultIndexes = new Set(this.searchResults.map((result) => result.index));
    this.pickCacheSerial = -1;
    this.rebuildDrawBuffers(true);
    this.requestRender();
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
    this.eye = eye;
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
    if (this.isolatePlaces) return;
    gl.enable(gl.BLEND);
    this.matrixData.set(matrix);
    this.drawGalaxyGlow(this.matrixData);
    this.drawNebulae(this.matrixData);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uniformLocations.matrix, false, this.matrixData);
    gl.uniform1f(this.uniformLocations.pixelRatio, Math.min(window.devicePixelRatio || 1, 2));
    this.attrib(this.attributeLocations.position, this.positionBuffer, 3);
    this.attrib(this.attributeLocations.color, this.colorBuffer, 3);
    this.attrib(this.attributeLocations.size, this.sizeBuffer, 1);
    this.attrib(this.attributeLocations.style, this.styleBuffer, 1);
    this.attrib(this.attributeLocations.phase, this.phaseBuffer, 1);
    this.attrib(this.attributeLocations.alpha, this.alphaBuffer, 1);
    gl.drawArrays(gl.POINTS, 0, this.count);
  }

  attrib(location, buffer, size) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
  }

  screen(point, rect = this.frameRect ?? this.canvas.getBoundingClientRect()) {
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
    const rect = this.frameRect ?? this.canvas.getBoundingClientRect();
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
    if (!this.isolatePlaces && this.showDropLines && this.gridFadeAlpha() > 0.02) this.drawDropLines(grid);
    if (!this.isolatePlaces) this.drawGridIndicators(grid);
    if (!this.isolatePlaces && this.showCarrierRange) this.drawCarrierRange();
    if (!this.isolatePlaces && this.showRouteOverlay) this.drawRouteOverlay();
    if (!this.isolatePlaces) {
      const drawList = this.overlayMarkers()
        .sort((a, b) => a.distance - b.distance)
        .slice(0, this.overlayMarkerBudget())
        .sort((a, b) => b.screen.z - a.screen.z);
      for (const item of drawList) this.drawMarker(item.point, false, item.alpha);
      for (const result of this.searchResults) this.drawMarker({ ...result.coords, ...result, flags: 0 }, true);
    }
    if (this.isolatePlaces || this.showPlaces || this.showMurderBinaries) this.drawPlaceIndicators();
    if (this.selectedSystem) this.drawSelectedSystem();
    if (this.selectedPlace) this.drawSelectedPlace();
    if (!this.isolatePlaces) this.drawHoverMarker();
    if (!this.isolatePlaces && this.showLandmarks) this.drawLandmarkIndicators();
    this.drawOrbitPoint(grid);
    if (this.showGrid) this.drawGridAxisDirections(grid, this.gridFadeAlpha());
  }

  drawRouteOverlay() {
    if (!this.routeHops.length) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let index = 1; index < this.routeHops.length; index += 1) {
      const previous = this.routeHops[index - 1];
      const current = this.routeHops[index];
      ctx.save();
      ctx.lineWidth = index === 1 ? 2.4 : 1.8;
      ctx.strokeStyle = index === 1 ? 'rgba(103, 233, 255, 0.82)' : 'rgba(102, 224, 194, 0.56)';
      ctx.shadowColor = index === 1 ? 'rgba(103, 233, 255, 0.34)' : 'rgba(102, 224, 194, 0.2)';
      ctx.shadowBlur = this.isNavigating() ? 0 : index === 1 ? 10 : 5;
      this.drawWorldLine(previous, current);
      ctx.restore();
    }
    for (const hop of this.routeHops) this.drawRouteHop(hop);
    ctx.restore();
  }

  drawRouteHop(hop) {
    const screen = this.screen(hop);
    if (!screen) return;
    const ctx = this.ctx;
    const first = hop.routeIndex === 0;
    const final = hop.routeIndex === this.routeHops.length - 1;
    const hover = this.hoverRouteIndex === hop.routeIndex;
    const color = first ? '#67e9ff' : final ? '#f2a541' : routeStarColor(hop.starClass);
    const radius = hover ? 7 : first || final ? 6 : 4.5;
    ctx.save();
    ctx.translate(screen.x, screen.y);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = hover ? 2.2 : 1.6;
    ctx.shadowColor = color;
    ctx.shadowBlur = this.isNavigating() ? 0 : hover ? 12 : 7;
    ctx.beginPath();
    if (final && !first) {
      ctx.moveTo(0, -radius - 1);
      ctx.lineTo(radius + 1, radius);
      ctx.lineTo(-radius - 1, radius);
      ctx.closePath();
    } else if (first) {
      ctx.rect(-radius, -radius, radius * 2, radius * 2);
    } else {
      // Waypoints are chevrons pointing along the route, as in game.
      const next = this.routeHops[hop.routeIndex + 1];
      const nextScreen = next ? this.screen(next) : null;
      const angle = nextScreen ? Math.atan2(nextScreen.y - screen.y, nextScreen.x - screen.x) : Math.PI / 2;
      ctx.rotate(angle);
      ctx.moveTo(radius + 1.5, 0);
      ctx.lineTo(-radius, radius);
      ctx.lineTo(-radius * 0.35, 0);
      ctx.lineTo(-radius, -radius);
      ctx.closePath();
    }
    ctx.stroke();
    ctx.globalAlpha = hover ? 0.34 : 0.2;
    ctx.fill();
    ctx.restore();

    if (first || final || hover) {
      const label = first ? 'Route start' : final ? hop.name : `#${hop.routeIndex + 1} ${hop.name}`;
      ctx.save();
      ctx.font = '600 12px Segoe UI, sans-serif';
      const width = Math.ceil(ctx.measureText(label).width) + 16;
      this.drawLabelPlate(screen.x + 10, screen.y - 13, width, 24, first ? 'rgba(103, 233, 255, 0.62)' : 'rgba(242, 165, 65, 0.64)');
      ctx.fillStyle = first ? 'rgba(199, 244, 245, 0.94)' : 'rgba(255, 219, 165, 0.94)';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, screen.x + 18, screen.y);
      ctx.restore();
    }
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
    const key = `${Math.round(this.target[0])}:${Math.round(this.target[1])}:${Math.round(this.target[2])}:${this.isolatePlaces ? 'isolate' : this.showAllPlaces ? 'all' : 'near'}:${this.showPlaces ? 'places' : 'no-places'}:${this.showMurderBinaries ? 'murder' : 'no-murder'}:${selectedId}`;
    if (key === this.placeDrawKey) return this.placeDrawList;

    const regularCandidates = this.isolatePlaces || this.showPlaces
      ? this.places.filter((place) => place.category !== 'Murder Binaries')
      : [];
    const murderCandidates = this.isolatePlaces || this.showMurderBinaries
      ? this.places.filter((place) => place.category === 'Murder Binaries')
      : [];

    const nearest = (candidates) => candidates
      .map((place) => ({ place, distance: this.distanceFromTarget(place) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 50)
      .map((item) => item.place);
    if (this.isolatePlaces) {
      this.placeDrawList = [...regularCandidates, ...murderCandidates];
      if (this.selectedPlace && !this.placeDrawList.some((place) => place.id === this.selectedPlace.id)) {
        this.placeDrawList.push(this.selectedPlace);
      }
    } else if (this.showAllPlaces) {
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
    let budget = 1400;
    if (step <= 5) budget = 300;
    else if (step <= 10) budget = 450;
    else if (step <= 25) budget = 700;
    else if (step <= 50) budget = 1000;
    return Math.max(120, Math.round(budget * this.performanceScale));
  }

  distanceFromTarget(point) {
    return Math.hypot(point.x - this.target[0], point.y - this.target[1], point.z - this.target[2]);
  }

  gridSpec() {
    const step = this.gridStep();
    const extent = step * 16;
    // The emphasized cyan/yellow lines mark the current map target. Keep their
    // intersection at that exact world coordinate when zoom changes grid LOD.
    const centerX = this.target[0];
    const centerZ = this.target[2];
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
    const clip = this.renderClipRect();
    ctx.save();
    ctx.beginPath();
    ctx.rect(clip.x, clip.y, clip.width, clip.height);
    ctx.clip();
    ctx.lineCap = 'round';
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
      const lineWidth = center ? 2.2 : major ? 1.1 : 0.7;
      const strokeStyle = center
        ? `rgba(72, 220, 230, ${(this.showDepthEmphasis ? 0.72 : 0.62) * alpha})`
        : major
          ? `rgba(104, 181, 194, ${((this.showDepthEmphasis ? 0.17 : 0.13) + edgeFade * 0.19) * alpha})`
          : `rgba(84, 150, 164, ${((this.showDepthEmphasis ? 0.075 : 0.055) + edgeFade * 0.08) * alpha})`;
      this.drawGridWorldLine(
        { x, y: grid.y, z: grid.minZ },
        { x, y: grid.y, z: grid.maxZ },
        { lineWidth, strokeStyle, center, major },
      );
    }
    for (let index = -lineCount; index <= lineCount; index += 1) {
      const z = grid.centerZ + index * step;
      if (!primary && Math.abs(z / grid.step - Math.round(z / grid.step)) < 0.001) continue;
      const edgeFade = 1 - Math.abs(index) / (lineCount + 1);
      const center = Math.abs(z - grid.centerZ) < step * 0.5;
      const major = primary || Math.abs(z / grid.step - Math.round(z / grid.step)) < 0.001;
      const lineWidth = center ? 2.2 : major ? 1.1 : 0.7;
      const strokeStyle = center
        ? `rgba(255, 177, 76, ${(this.showDepthEmphasis ? 0.66 : 0.55) * alpha})`
        : major
          ? `rgba(104, 181, 194, ${((this.showDepthEmphasis ? 0.17 : 0.13) + edgeFade * 0.19) * alpha})`
          : `rgba(84, 150, 164, ${((this.showDepthEmphasis ? 0.075 : 0.055) + edgeFade * 0.08) * alpha})`;
      this.drawGridWorldLine(
        { x: grid.minX, y: grid.y, z },
        { x: grid.maxX, y: grid.y, z },
        { lineWidth, strokeStyle, center, major },
      );
    }
  }

  drawGridWorldLine(a, b, { lineWidth, strokeStyle, center = false, major = false }) {
    const ctx = this.ctx;
    if (center) {
      ctx.save();
      ctx.lineWidth = lineWidth + 3.4;
      ctx.strokeStyle = 'rgba(0, 5, 8, 0.7)';
      this.drawWorldLine(a, b);
      ctx.restore();
    }

    ctx.save();
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = strokeStyle;
    ctx.shadowColor = center ? strokeStyle : 'transparent';
    ctx.shadowBlur = this.isNavigating() || !center ? 0 : 8;
    this.drawWorldLine(a, b);
    ctx.restore();
  }

  drawGridAxisDirections(grid, gridAlpha) {
    if (gridAlpha <= 0.08) return;
    const origin = this.screen({ x: grid.centerX, y: grid.y, z: grid.centerZ });
    if (!origin) return;
    const probeLength = grid.extent * 0.85;
    const clip = this.renderClipRect();
    const cues = [
      {
        point: { x: grid.centerX, y: grid.y, z: grid.centerZ + probeLength },
        label: 'N  GALACTIC NORTH  +Z',
        color: 'rgba(103, 233, 255, 0.96)',
      },
      {
        point: { x: grid.centerX - probeLength, y: grid.y, z: grid.centerZ },
        label: 'E  GALACTIC EAST  +X',
        color: 'rgba(255, 185, 92, 0.96)',
      },
    ];
    for (const cue of cues) {
      const positivePoint = this.screen(cue.point);
      const layout = gridAxisCueLayout(origin, positivePoint, clip);
      if (!layout) continue;
      this.drawGridAxisCue(layout, cue.label, cue.color, gridAlpha);
    }
  }

  drawGridAxisCue(layout, label, color, gridAlpha) {
    const ctx = this.ctx;
    const { tip, unit, perpendicular } = layout;
    const stem = { x: tip.x - unit.x * 46, y: tip.y - unit.y * 46 };
    const wingA = {
      x: tip.x - unit.x * 14 + perpendicular.x * 8,
      y: tip.y - unit.y * 14 + perpendicular.y * 8,
    };
    const wingB = {
      x: tip.x - unit.x * 14 - perpendicular.x * 8,
      y: tip.y - unit.y * 14 - perpendicular.y * 8,
    };
    const alpha = clamp(0.72 + gridAlpha * 0.28, 0.72, 1);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(stem.x, stem.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.moveTo(wingA.x, wingA.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.lineTo(wingB.x, wingB.y);
    ctx.strokeStyle = 'rgba(1, 5, 8, 0.96)';
    ctx.lineWidth = 7;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
    ctx.shadowBlur = this.isNavigating() ? 0 : 8;
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.6;
    ctx.shadowColor = color;
    ctx.shadowBlur = this.isNavigating() ? 0 : 5;
    ctx.stroke();

    const mostlyVertical = Math.abs(unit.x) < 0.28;
    const labelGap = 15;
    ctx.font = '800 11px "Segoe UI", system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const textWidth = Math.ceil(ctx.measureText(label).width);
    const plateWidth = textWidth + 18;
    const plateHeight = 24;
    let plateX;
    let plateY;
    if (mostlyVertical) {
      plateX = tip.x - plateWidth / 2;
      plateY = unit.y > 0 ? tip.y + labelGap : tip.y - labelGap - plateHeight;
    } else {
      plateX = unit.x > 0 ? tip.x + labelGap : tip.x - labelGap - plateWidth;
      plateY = tip.y - plateHeight / 2;
    }
    const clip = this.renderClipRect();
    plateX = clamp(plateX, clip.x + 6, clip.x + clip.width - plateWidth - 6);
    plateY = clamp(plateY, clip.y + 6, clip.y + clip.height - plateHeight - 6);
    ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
    ctx.shadowBlur = this.isNavigating() ? 0 : 10;
    ctx.fillStyle = 'rgba(2, 8, 12, 0.94)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    roundedRect(ctx, plateX, plateY, plateWidth, plateHeight, 4);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = color;
    ctx.fillText(label, plateX + 9, plateY + plateHeight / 2);
    ctx.restore();
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

  // Coordinate labels lie flat on the grid plane in perspective, like the
  // in-game map's grid numbers, so near labels read larger than far ones.
  drawGridCoordinateLabels(grid, gridAlpha) {
    if (grid.step > 1000 || gridAlpha <= 0.05) return;
    const center = this.screen({ x: grid.centerX, y: grid.y, z: grid.centerZ });
    const cell = this.screen({ x: grid.centerX + grid.step, y: grid.y, z: grid.centerZ });
    if (!center || !cell) return;
    const screenCell = Math.hypot(cell.x - center.x, cell.y - center.y);
    if (screenCell < 20) return;
    const skip = Math.max(2, Math.ceil(220 / screenCell));
    const alpha = gridAlpha * smoothstep(20, 40, screenCell) * (1 - smoothstep(7000, 16000, this.distance));
    if (alpha <= 0.03) return;

    // Glyph units: 10 units of font span 5.5% of the label spacing, about
    // 12 px near the focus, growing and shrinking with perspective.
    const unit = grid.step * skip * 0.0055;
    const ctx = this.ctx;
    const lineCount = Math.round(grid.extent / grid.step);
    const width = this.overlay.clientWidth;
    const height = this.overlay.clientHeight;
    let drawn = 0;
    ctx.save();
    ctx.font = '600 10px "Segoe UI", system-ui, sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgb(96, 206, 214)';
    for (let xi = -lineCount + 1; xi <= lineCount; xi += skip) {
      for (let zi = -lineCount + 1; zi <= lineCount; zi += skip) {
        if (drawn > 32) break;
        const anchor = { x: grid.centerX + xi * grid.step, y: grid.y, z: grid.centerZ + zi * grid.step };
        const origin = this.screen(anchor);
        if (!origin || origin.x < 0 || origin.y < 0 || origin.x > width || origin.y > height) continue;
        const basis = planeTextBasis(
          origin,
          this.screen({ ...anchor, x: anchor.x + unit }),
          this.screen({ ...anchor, z: anchor.z + unit }),
        );
        if (!basis) continue;
        const glyphPixels = Math.hypot(basis.down.x, basis.down.y) * 10;
        const sizeFade = smoothstep(5, 8, glyphPixels) * (1 - smoothstep(30, 44, glyphPixels));
        const edgeFade = Math.min(1 - Math.abs(xi) / (lineCount + 1), 1 - Math.abs(zi) / (lineCount + 1));
        const labelAlpha = Math.max(0, edgeFade) * alpha * sizeFade * 0.62;
        if (labelAlpha <= 0.02) continue;
        const coords = fromRenderCoords(anchor);
        ctx.save();
        ctx.globalAlpha = labelAlpha;
        ctx.transform(basis.right.x, basis.right.y, basis.down.x, basis.down.y, origin.x, origin.y);
        ctx.fillText(
          [coords.x, coords.y, coords.z].map((value) => formatPlaneCoordinate(value, grid.step)).join(' · '),
          3,
          -3,
        );
        ctx.restore();
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
    const cacheKey = [
      boundaries.length,
      rect.width.toFixed(0),
      rect.height.toFixed(0),
      this.target.map((value) => value.toFixed(1)).join(':'),
      this.yaw.toFixed(4),
      this.pitch.toFixed(4),
      this.distance.toFixed(1),
      y.toFixed(1),
      String(worldRadius),
    ].join('|');
    let paths = this.regionPathCacheKey === cacheKey ? this.regionPathCache : null;

    if (!paths) {
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

      paths = { internalPath, outerPath, internalCount, outerCount };
      this.regionPathCacheKey = cacheKey;
      this.regionPathCache = paths;
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
      ctx.shadowBlur = this.isNavigating() ? 0 : shadowBlur;
      ctx.setLineDash(dash ?? []);
      ctx.stroke(path);
      ctx.restore();
    };

    strokePath(paths.internalPath, paths.internalCount, {
      color: 'rgba(1, 6, 8, 0.92)',
      lineWidth: baseWidth + 3.4,
      lineAlpha: 0.92,
    });
    strokePath(paths.outerPath, paths.outerCount, {
      color: 'rgba(1, 6, 8, 0.86)',
      lineWidth: baseWidth + 2.8,
      lineAlpha: 0.74,
      dash: [12, 8],
    });
    strokePath(paths.internalPath, paths.internalCount, {
      color: 'rgba(255, 176, 62, 0.82)',
      lineWidth: baseWidth,
      lineAlpha: 0.9,
      shadowColor: 'rgba(255, 151, 34, 0.32)',
      shadowBlur: 6,
    });
    strokePath(paths.outerPath, paths.outerCount, {
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

  renderClipRect() {
    const rect = this.overlay.getBoundingClientRect();
    return {
      x: 0,
      y: 0,
      width: rect.width,
      height: rect.height,
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
    const clip = this.renderClipRect();
    ctx.save();
    ctx.beginPath();
    ctx.rect(clip.x, clip.y, clip.width, clip.height);
    ctx.clip();
    for (const [index, point] of this.gridAnchorPoints.entries()) {
      const start = this.screen(point);
      const end = this.screen({ x: point.x, y: grid.y, z: point.z });
      if (!start || !end) continue;
      const color = this.pointColor(point).map((component) => Math.round(component * 255));
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

      const pulsePhase = ((performance.now() / 1400) + index * 0.117) % 1;
      const cameraScale = 0.62 + 0.38 / (1 + this.distance / 1800);
      const ringWorldScale = Math.min(grid.step, 10);
      const ringRadius = ringWorldScale * (0.055 + pulsePhase * 0.17) * cameraScale;
      const ringAlpha = (1 - pulsePhase) ** 1.35 * (0.3 + prominence * 0.24);
      this.drawGridPlaneRing(point.x, grid.y, point.z, ringRadius, {
        strokeStyle: `rgba(128, 242, 244, ${ringAlpha})`,
        lineWidth: 1 + prominence * 0.4,
      });

      // Footprint: a filled disc lying in the grid plane, sized in world
      // units so it shrinks with distance like the in-game stalk bases.
      this.drawGridPlaneRing(point.x, grid.y, point.z, ringWorldScale * 0.11, {
        fillStyle: `rgba(64, 206, 214, ${0.42 + prominence * 0.3})`,
        strokeStyle: `rgba(150, 246, 248, ${0.5 + prominence * 0.3})`,
        lineWidth: 0.8,
      });

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

  drawGridPlaneRing(centerX, y, centerZ, radius, style) {
    const ctx = this.ctx;
    const segments = 18;
    let drawing = false;
    ctx.save();
    ctx.strokeStyle = style.strokeStyle;
    ctx.lineWidth = style.lineWidth;
    ctx.beginPath();
    for (let index = 0; index <= segments; index += 1) {
      const angle = index / segments * Math.PI * 2;
      const screen = this.screen({
        x: centerX + Math.cos(angle) * radius,
        y,
        z: centerZ + Math.sin(angle) * radius,
      });
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
    if (style.fillStyle) {
      ctx.fillStyle = style.fillStyle;
      ctx.fill();
    }
    ctx.stroke();
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

  // The camera focus shows as a ring lying on the grid plane, like the
  // in-game map's focus ellipse; orange while locked to a selected system.
  drawOrbitPoint(grid) {
    const screen = this.screen({ x: this.target[0], y: this.target[1], z: this.target[2] });
    if (!screen) return;
    const locked = this.orbitLocked;
    const radius = this.distance * 0.024;
    this.drawGridPlaneRing(this.target[0], grid.y, this.target[2], radius, {
      fillStyle: locked ? 'rgba(242, 165, 65, 0.06)' : 'rgba(66, 209, 199, 0.07)',
      strokeStyle: locked ? 'rgba(242, 165, 65, 0.78)' : 'rgba(96, 226, 230, 0.82)',
      lineWidth: 1.6,
    });
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = locked ? 'rgba(242, 165, 65, 0.9)' : 'rgba(150, 246, 248, 0.9)';
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Outlines the ID64 boxel (the octree cell the game files this system in)
  // while it is large enough on screen to read as a cube.
  drawSelectedBoxel() {
    const boxel = this.selectedSystem?.boxel;
    if (!this.showBoxel || !boxel) return;
    const projected = boxelCorners(boxel).map((corner) => this.screen(toRenderCoords(corner)));
    if (projected.some((point) => !point)) return;
    const xs = projected.map((point) => point.x);
    const span = Math.max(...xs) - Math.min(...xs);
    const rect = this.frameRect ?? this.canvas.getBoundingClientRect();
    if (span < 10 || span > rect.width * 3) return;
    const alpha = clamp((span - 10) / 30, 0, 1) * 0.6;
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = `rgba(242, 165, 65, ${alpha})`;
    ctx.lineWidth = 1.1;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    for (const [a, b] of boxelEdges) {
      ctx.moveTo(projected[a].x, projected[a].y);
      ctx.lineTo(projected[b].x, projected[b].y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    const top = projected.reduce((best, point) => (point.y < best.y ? point : best), projected[0]);
    ctx.font = '600 11px Segoe UI, sans-serif';
    ctx.fillStyle = `rgba(242, 165, 65, ${Math.min(1, alpha * 1.5)})`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`boxel ${boxel.letter} · ${boxel.cellEdge} ly`, top.x, top.y - 4);
    ctx.restore();
  }

  drawSelectedSystem() {
    this.drawSelectedBoxel();
    const screen = this.screen(this.selectedSystem);
    if (!screen) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(screen.x, screen.y);
    ctx.strokeStyle = this.accentColor;
    ctx.fillStyle = this.accentColor;
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
    ctx.fillStyle = this.accentColor;
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
    ctx.strokeStyle = search ? this.accentColor : css;
    ctx.fillStyle = search ? this.accentColor : css;
    ctx.lineWidth = search ? 2 : 1.4;
    if (this.showVisited && (point.flags & 4)) {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (const brace of defaultVisitedBraceGeometry) {
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
    } else if (point.special === 'protostar') {
      // Young stars use a flare rather than a warning-like triangle. Keep this
      // open so it remains readable over dense points and search rings.
      const flareRadius = 7;
      const diagonalRadius = 4.8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-flareRadius, 0);
      ctx.lineTo(flareRadius, 0);
      ctx.moveTo(0, -flareRadius);
      ctx.lineTo(0, flareRadius);
      ctx.moveTo(-diagonalRadius, -diagonalRadius);
      ctx.lineTo(diagonalRadius, diagonalRadius);
      ctx.moveTo(diagonalRadius, -diagonalRadius);
      ctx.lineTo(-diagonalRadius, diagonalRadius);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 2.2, 0, Math.PI * 2);
      ctx.stroke();
    } else if (point.special === 'triangle') {
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(6, 5);
      ctx.lineTo(-6, 5);
      ctx.closePath();
      ctx.stroke();
    } else if (point.special === 'giant') {
      const radius = 9;
      ctx.save();
      ctx.lineWidth = search ? 2.2 : 1.6;
      ctx.shadowColor = search ? this.accentColor : css;
      ctx.shadowBlur = this.isNavigating() ? 0 : search ? 9 : 7;
      ctx.beginPath();
      for (let index = 0; index < giantCageVertices.length; index += 1) {
        const [x, y] = giantCageVertices[index];
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalAlpha *= 0.82;
      ctx.beginPath();
      ctx.ellipse(0, 0, radius * 0.82, radius * 0.34, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(0, 0, radius * 0.82, radius * 0.34, Math.PI / 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(0, 0, radius * 0.82, radius * 0.34, -Math.PI / 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
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
    const routeHit = this.isolatePlaces ? null : this.findRouteHopNear(x, y, 22);
    if (routeHit) {
      this.onRouteSelect?.(routeHit.hop);
      return;
    }
    const placeHit = this.isolatePlaces || this.showPlaces || this.showMurderBinaries ? this.findPlaceNear(x, y, 20) : null;
    if (placeHit) {
      this.onPlaceSelect?.(placeHit.place);
      return;
    }
    if (this.isolatePlaces) return;
    const hit = this.findPointNear(x, y, 22);
    if (hit) this.onSelect?.(hit.point.index);
  }

  contextPick(event) {
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (!this.isolatePlaces && this.findRouteHopNear(x, y, 26)) return;
    const placeHit = this.isolatePlaces || this.showPlaces || this.showMurderBinaries
      ? this.findPlaceNear(x, y, 26)
      : null;
    if (placeHit) {
      this.onPlaceContext?.({ place: placeHit.place, x, y, screen: placeHit.screen });
      return;
    }
    const hit = this.isolatePlaces
      ? this.findSelectedSystemNear(x, y, 26)
      : this.findPointNear(x, y, 26);
    if (hit) this.onSystemContext?.({ index: hit.point.index, x, y, screen: hit.screen });
  }

  findSelectedSystemNear(x, y, radius) {
    if (!this.selectedSystem) return null;
    const screen = this.screen(this.selectedSystem);
    if (!screen || Math.hypot(screen.x - x, screen.y - y) > radius) return null;
    return { point: this.selectedSystem, screen };
  }

  updateHover(event) {
    const now = performance.now();
    if (now - this.lastHoverAt < 60) return;
    this.lastHoverAt = now;
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const routeHit = this.isolatePlaces ? null : this.findRouteHopNear(x, y, 18);
    if (routeHit) {
      this.hoverIndex = null;
      this.hoverPlaceId = null;
      this.hoverRouteIndex = routeHit.hop.routeIndex;
      this.hoverScreen = routeHit.screen;
      this.hoverPoint = routeHit.hop;
      this.onPlaceHover?.(null);
      this.onHover?.({ kind: 'route', hop: routeHit.hop, x: routeHit.screen.x, y: routeHit.screen.y });
      this.requestRender();
      return;
    }
    const placeHit = this.isolatePlaces || this.showPlaces || this.showMurderBinaries ? this.findPlaceNear(x, y, 16) : null;
    if (placeHit) {
      this.hoverIndex = null;
      this.hoverRouteIndex = null;
      this.hoverPlaceId = placeHit.place.id ?? placeHit.place.name ?? '';
      this.hoverScreen = placeHit.screen;
      this.hoverPoint = null;
      this.onHover?.(null);
      this.onPlaceHover?.({ place: placeHit.place, x: placeHit.screen.x, y: placeHit.screen.y });
      return;
    }
    const hit = this.isolatePlaces ? null : this.findPointNear(x, y, 16);
    if (this.hoverPlaceId !== null) {
      this.hoverPlaceId = null;
      if (!hit) this.onPlaceHover?.(null);
    }
    const hadRouteHover = this.hoverRouteIndex !== null;
    this.hoverRouteIndex = null;
    const nextIndex = hit?.point?.index ?? null;
    if (nextIndex === this.hoverIndex) {
      if (!hit && hadRouteHover) this.onHover?.(null);
      if (hit?.screen) {
        this.hoverScreen = hit.screen;
        this.hoverPoint = hit.point;
        this.requestRender();
      }
      return;
    }
    this.hoverIndex = nextIndex;
    this.hoverScreen = hit?.screen ?? null;
    this.hoverPoint = hit?.point ?? null;
    this.onHover?.(hit ? { index: hit.point.index, x: hit.screen.x, y: hit.screen.y } : null);
    this.requestRender();
  }

  findRouteHopNear(x, y, radius) {
    if (!this.showRouteOverlay || !this.routeHops.length) return null;
    let best = null;
    let bestScore = Infinity;
    for (const hop of this.routeHops) {
      const screen = this.screen(hop);
      if (!screen) continue;
      const hitRadius = hop.routeIndex === 0 || hop.routeIndex === this.routeHops.length - 1 ? Math.max(radius, 22) : radius;
      const dist = Math.hypot(screen.x - x, screen.y - y);
      if (dist > hitRadius) continue;
      const score = dist + (screen.z + 1) * 4;
      if (score < bestScore) {
        best = { hop, screen };
        bestScore = score;
      }
    }
    return best;
  }

  rebuildPickBuckets() {
    if (this.pickCacheSerial === this.renderSerial) return;
    const buckets = new Map();
    const seen = new Set();
    const rect = this.frameRect ?? this.canvas.getBoundingClientRect();
    const margin = 32;
    const add = (point) => {
      if (!point || seen.has(point.index)) return;
      seen.add(point.index);
      const screen = this.screen(point, rect);
      if (!screen
        || screen.x < -margin || screen.x > rect.width + margin
        || screen.y < -margin || screen.y > rect.height + margin) return;
      const key = `${Math.floor(screen.x / this.pickCellSize)}:${Math.floor(screen.y / this.pickCellSize)}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = [];
        buckets.set(key, bucket);
      }
      bucket.push({ point, screen });
    };
    if (Number.isInteger(this.selectedSystem?.index) && this.selectedSystem.index >= 0) add(this.selectedSystem);
    for (const result of this.searchResults) add({ ...result.coords, ...result, flags: 0 });
    for (const point of this.points) add(point);
    this.pickBuckets = buckets;
    this.pickCacheSerial = this.renderSerial;
  }

  findPointNear(x, y, radius) {
    this.rebuildPickBuckets();
    let best = null;
    let bestScore = Infinity;
    const cellX = Math.floor(x / this.pickCellSize);
    const cellY = Math.floor(y / this.pickCellSize);
    const reach = Math.max(1, Math.ceil(Math.max(radius, 28) / this.pickCellSize));
    for (let dx = -reach; dx <= reach; dx += 1) {
      for (let dy = -reach; dy <= reach; dy += 1) {
        const bucket = this.pickBuckets.get(`${cellX + dx}:${cellY + dy}`);
        if (!bucket) continue;
        for (const item of bucket) {
          const { point, screen } = item;
          const hitRadius = this.hitRadius(point, radius);
          const dist = Math.hypot(screen.x - x, screen.y - y);
          if (dist > hitRadius) continue;
          const depthBias = (screen.z + 1) * 4;
          const selectedBias = point.index === this.selectedSystem?.index ? -8 : 0;
          const importantBias = isPrioritySpecial(point) || (point.flags & 4) ? -2 : 0;
          const score = dist + depthBias + selectedBias + importantBias;
          if (score < bestScore) {
            best = item;
            bestScore = score;
          }
        }
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
    if (this.searchResultIndexes.has(point.index)) return Math.max(fallback, 24);
    if (point.special || (point.flags & 4)) return Math.max(fallback, 20);
    return fallback;
  }

  requestRender(continuousMs = 0) {
    const now = performance.now();
    if (continuousMs > 0) this.continuousUntil = Math.max(this.continuousUntil, now + continuousMs);
    if (this.frameHandle !== null) return;
    this.frameHandle = requestAnimationFrame(() => this.renderFrame());
  }

  isNavigating() {
    return Boolean(this.flight || this.drag || this.keys.size > 0 || performance.now() < this.continuousUntil);
  }

  updatePerformanceQuality(frameCost) {
    this.frameCostMs = this.frameCostMs * 0.86 + frameCost * 0.14;
    const now = performance.now();
    if (now - this.lastQualityUpdate < 450) return;
    this.lastQualityUpdate = now;
    // Keep the controller centered on a 60 Hz frame budget. Scale down before
    // sustained work reaches a visibly choppy 28 ms, and recover conservatively
    // so quality changes do not oscillate during navigation.
    if (this.frameCostMs > 19) {
      this.performanceScale = Math.max(0.5, this.performanceScale * 0.88);
      this.lastBufferKey = '';
    } else if (this.frameCostMs < 13.5 && this.performanceScale < 1) {
      this.performanceScale = Math.min(1, this.performanceScale * 1.04 + 0.015);
      this.lastBufferKey = '';
    }
  }

  renderFrame() {
    this.frameHandle = null;
    const started = performance.now();
    this.frameRect = this.canvas.getBoundingClientRect();
    this.renderSerial += 1;
    this.advanceFlight(performance.now());
    this.keyboardMove();
    this.rebuildDrawBuffers();
    const matrix = this.camera();
    this.drawStars(matrix);
    this.drawOverlay();
    this.updatePerformanceQuality(performance.now() - started);
    if (this.flight || this.keys.size > 0 || this.drag || performance.now() < this.continuousUntil) {
      this.requestRender();
    }
    this.scheduleDropLinePulse();
  }

  scheduleDropLinePulse() {
    const shouldAnimate = this.showDropLines
      && !this.isolatePlaces
      && (this.gridAnchorPoints.length > 0 || (this.showDepthEmphasis && this.hoverPoint))
      && this.gridFadeAlpha() > 0.02
      && document.visibilityState !== 'hidden';
    if (!shouldAnimate || this.dropLinePulseTimer !== null) return;
    // Navigation already renders at the display refresh rate. At rest, a
    // restrained cadence keeps the pulse alive without turning the whole map
    // into a permanent 60 FPS workload.
    this.dropLinePulseTimer = window.setTimeout(() => {
      this.dropLinePulseTimer = null;
      this.requestRender();
    }, 80);
  }

  start() {
    this.requestRender(120);
  }
}
