export const nameLookupShardCount = 4096;

export function nameLookupKey(value) {
  const text = String(value ?? '').trim().toLowerCase();
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return String(hash % nameLookupShardCount).padStart(4, '0');
}
