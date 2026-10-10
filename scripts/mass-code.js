// Mirrors the native importer: point flag bits 8..11 hold the ID64 mass code
// plus one (zero when there is no ID64), and coarse LODs favour heavy systems
// the way the in-game galaxy map does. Keep in sync with
// native/ed-data-importer/src/main.rs.
export const massCodeShift = 8;
const massCodeMask = 0x0f << massCodeShift;

export function massCode(id64) {
  try {
    const value = BigInt(id64 ?? 0);
    return value === 0n ? null : Number(value & 7n);
  } catch {
    return null;
  }
}

export function withMassCode(flags, id64) {
  const code = massCode(id64);
  const field = code === null ? 0 : code + 1;
  return ((flags & ~massCodeMask) | (field << massCodeShift)) & 0xffff;
}

export function weightedLodDivisor(divisor, code) {
  if (divisor <= 1) return 1;
  if (code === 0 || code === 1) return divisor * 2;
  const boost = { 4: 3, 5: 5, 6: 6, 7: 7 }[code];
  return boost === undefined ? divisor : Math.max(1, divisor >> boost);
}
