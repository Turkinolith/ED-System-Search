// Colour-by map modes, shared by the server (which packs a category index into
// point flag bits 12..15) and the client (palette and legend). Each mode maps
// onto one of the existing System features filters, so legend toggles and the
// filter dropdowns drive the same request parameter. Values follow the rich
// sidecar bit order; "none" stands for systems without that data.
export const colorCategoryShift = 12;

export const colorModes = Object.freeze({
  economy: {
    label: 'Economy',
    filter: 'economy',
    offset: 28,
    values: [
      { value: 'extraction', label: 'Extraction', bit: 1 << 0, color: '#e8483f' },
      { value: 'refinery', label: 'Refinery', bit: 1 << 1, color: '#f08a3a' },
      { value: 'industrial', label: 'Industrial', bit: 1 << 2, color: '#f2d24a' },
      { value: 'agriculture', label: 'Agriculture', bit: 1 << 3, color: '#9be24f' },
      { value: 'highTech', label: 'High Tech', bit: 1 << 4, color: '#3fe0d8' },
      { value: 'military', label: 'Military', bit: 1 << 5, color: '#b45cf2' },
      { value: 'tourism', label: 'Tourism', bit: 1 << 6, color: '#6a62f2' },
      { value: 'service', label: 'Service', bit: 1 << 7, color: '#3f7cf0' },
      { value: 'colony', label: 'Colony', bit: 1 << 8, color: '#5fb6f5' },
      { value: 'other', label: 'Other', bit: 1 << 15, color: '#c9a98a' },
    ],
    // The sidecar merges primary and secondary economies into one mask, so a
    // two-economy system takes the less common of the two.
    precedence: ['military', 'tourism', 'highTech', 'refinery', 'extraction', 'industrial', 'agriculture', 'colony', 'service', 'other'],
    note: 'Systems with two economies show the less common one.',
  },
  security: {
    label: 'Security',
    filter: 'security',
    offset: 32,
    values: [
      { value: 'anarchy', label: 'Anarchy', bit: 1 << 0, color: '#e8483f' },
      { value: 'low', label: 'Low', bit: 1 << 1, color: '#7fd34e' },
      { value: 'medium', label: 'Medium', bit: 1 << 2, color: '#3fd6d0' },
      { value: 'high', label: 'High', bit: 1 << 3, color: '#4a78f2' },
    ],
  },
  government: {
    label: 'Government',
    filter: 'government',
    offset: 36,
    values: [
      { value: 'anarchy', label: 'Anarchy', bit: 1 << 0, color: '#f2c94a' },
      { value: 'communism', label: 'Communism', bit: 1 << 1, color: '#3fd6d0' },
      { value: 'confederacy', label: 'Confederacy', bit: 1 << 2, color: '#e8483f' },
      { value: 'cooperative', label: 'Cooperative', bit: 1 << 3, color: '#9b5cf2' },
      { value: 'corporate', label: 'Corporate', bit: 1 << 4, color: '#2fb98f' },
      { value: 'democracy', label: 'Democracy', bit: 1 << 5, color: '#7fd34e' },
      { value: 'dictatorship', label: 'Dictatorship', bit: 1 << 6, color: '#3a56d8' },
      { value: 'feudal', label: 'Feudal', bit: 1 << 7, color: '#3f9cf0' },
      { value: 'patronage', label: 'Patronage', bit: 1 << 8, color: '#e05ad0' },
      { value: 'theocracy', label: 'Theocracy', bit: 1 << 9, color: '#7a6af2' },
      { value: 'other', label: 'Other', bit: 1 << 15, color: '#c9a98a' },
    ],
  },
});

export const noDataColor = '#6b7680';

// 1-based index into mode.values for a rich summary mask, or 0 for no data.
export function colorCategoryForMask(mode, mask) {
  if (!mode || !mask) return 0;
  const order = mode.precedence ?? mode.values.map((entry) => entry.value);
  for (const value of order) {
    const index = mode.values.findIndex((entry) => entry.value === value);
    if (index >= 0 && (mask & mode.values[index].bit)) return index + 1;
  }
  return 0;
}

export function hexToRgb(hex) {
  const value = Number.parseInt(String(hex).replace('#', ''), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((component) => component / 255);
}
