const epochMs = Date.UTC(2000, 0, 1);
export const unknownUpdateSeconds = 0xffffffff;

export function parseUpdateSeconds(value) {
  if (!value) return unknownUpdateSeconds;
  const normalized = String(value)
    .replace(' ', 'T')
    .replace(/\+00$/, 'Z');
  const ms = Date.parse(normalized);
  if (!Number.isFinite(ms)) return unknownUpdateSeconds;
  return Math.max(0, Math.min(unknownUpdateSeconds - 1, Math.floor((ms - epochMs) / 1000)));
}

export function secondsToIso(seconds) {
  if (!Number.isFinite(seconds) || seconds === unknownUpdateSeconds) return null;
  return new Date(epochMs + seconds * 1000).toISOString();
}

export function dateInputToSeconds(value, exclusiveEnd = false) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  if (!Number.isFinite(date.getTime())) return null;
  const seconds = Math.floor((date.getTime() - epochMs) / 1000);
  return Math.max(0, seconds + (exclusiveEnd ? 0 : 0));
}

export function isoToDateInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
