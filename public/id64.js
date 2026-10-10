// Decodes Elite Dangerous ID64 / SystemAddress values. Layout (verified against
// journal SystemAddress values and this app's data): 3 bits mass code, then
// 14-mc bits z cell, 13-mc bits y cell, 14-mc bits x cell, then the system's
// index in that cell.
// Cells are cubes of 10 * 2^mc ly measured from the galaxy corner, which sits
// at -galaxyOrigin in Sol-centred coordinates.
export const galaxyOrigin = Object.freeze({ x: 49985, y: 40985, z: 24105 });
export const massCodeLetters = 'abcdefgh';

// Typical primaries per mass code in this app's data (LOD-1 cross-tab).
export const massCodeTypicalStars = Object.freeze([
  'brown dwarfs',
  'M dwarfs',
  'K and G stars',
  'F, A, and G stars, white dwarfs, neutron stars',
  'B stars and neutron stars',
  'black holes and B stars',
  'O stars and black holes',
  'O stars, Wolf-Rayet stars, and black holes',
]);

export function massCodeFromFlags(flags) {
  const field = (Number(flags) >> 8) & 0x0f;
  return field >= 1 && field <= 8 ? field - 1 : -1;
}

export function decodeId64(value) {
  let id;
  try {
    id = BigInt(String(value ?? '').trim());
  } catch {
    return null;
  }
  if (id <= 0n || id > 0xffffffffffffffffn) return null;
  const massCode = Number(id & 7n);
  const bits = (count) => {
    const field = Number(rest & ((1n << BigInt(count)) - 1n));
    rest >>= BigInt(count);
    return field;
  };
  let rest = id >> 3n;
  const cellZ = bits(14 - massCode);
  const cellY = bits(13 - massCode);
  const cellX = bits(14 - massCode);
  const cellEdge = 10 * 2 ** massCode;
  const min = {
    x: cellX * cellEdge - galaxyOrigin.x,
    y: cellY * cellEdge - galaxyOrigin.y,
    z: cellZ * cellEdge - galaxyOrigin.z,
  };
  return {
    massCode,
    letter: massCodeLetters[massCode],
    cellEdge,
    cell: { x: cellX, y: cellY, z: cellZ },
    systemIndex: Number(rest),
    min,
    max: { x: min.x + cellEdge, y: min.y + cellEdge, z: min.z + cellEdge },
  };
}

export function boxelContains(boxel, coords, tolerance = 0.5) {
  if (!boxel || !coords) return false;
  return ['x', 'y', 'z'].every((axis) => Number(coords[axis]) >= boxel.min[axis] - tolerance
    && Number(coords[axis]) <= boxel.max[axis] + tolerance);
}
