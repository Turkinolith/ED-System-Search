import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';

const callsignPattern = /^[A-Z0-9]{3}-[A-Z0-9]{3}$/;

// Accepts "NAME", "XXX-XXX" or the "NAME [XXX-XXX]" label the app displays.
export function parseCarrierQuery(value) {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!text) return null;
  const labelled = text.match(/^(.*?)\s*\[([A-Za-z0-9]{3}-[A-Za-z0-9]{3})\]$/);
  if (labelled) {
    return { name: labelled[1].trim() || null, callsign: labelled[2].toUpperCase() };
  }
  const upper = text.toUpperCase();
  return callsignPattern.test(upper) ? { name: null, callsign: upper } : { name: text, callsign: null };
}

function same(a, b) {
  return Boolean(a && b) && String(a).trim().toUpperCase() === String(b).trim().toUpperCase();
}

function identityFromEvent(event, query) {
  const nameMatches = same(event.Name, query.name);
  const callsignMatches = same(event.Callsign, query.callsign);
  if (event.event === 'CarrierStats' || event.event === 'CarrierNameChange') {
    if (!nameMatches && !callsignMatches) return null;
    return { id: Number(event.CarrierID), name: event.Name ?? null, callsign: event.Callsign ?? null };
  }
  if (event.event === 'CarrierBuy' && callsignMatches) {
    return { id: Number(event.CarrierID), name: null, callsign: event.Callsign };
  }
  if (event.event === 'Docked' && event.StationType === 'FleetCarrier' && same(event.StationName, query.callsign)) {
    return { id: Number(event.MarketID), name: null, callsign: event.StationName };
  }
  return null;
}

// Looks up a carrier's ID, name and callsign from journal events, newest
// journal first. CarrierLocation events only carry the numeric CarrierID, so
// the ID is what lets the importer follow the carrier between sessions.
export async function findCarrierIdentity(journalDir, query) {
  if (!query?.name && !query?.callsign) return null;
  let entries;
  try {
    entries = await fs.readdir(journalDir, { withFileTypes: true });
  } catch {
    return null;
  }
  const files = await Promise.all(entries
    .filter((entry) => entry.isFile() && /^Journal\..*\.log$/i.test(entry.name))
    .map(async (entry) => {
      const file = path.join(journalDir, entry.name);
      const stat = await fs.stat(file).catch(() => null);
      return { file, mtimeMs: stat?.mtimeMs ?? 0 };
    }));
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const needles = [query.name, query.callsign].filter(Boolean).map((value) => value.toUpperCase());
  let partial = null;
  for (const { file } of files) {
    let newestInFile = null;
    const rl = readline.createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.includes('Carrier')) continue;
      const upper = line.toUpperCase();
      if (!needles.some((needle) => upper.includes(needle))) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      const identity = identityFromEvent(event, query);
      if (!identity || !Number.isSafeInteger(identity.id)) continue;
      // Later lines in the same file are newer, so keep overwriting, but never
      // let a nameless Docked/CarrierBuy match replace a named one.
      if (!newestInFile || identity.name || !newestInFile.name) newestInFile = identity;
    }
    if (newestInFile?.name) return newestInFile;
    partial ??= newestInFile;
  }
  return partial;
}
