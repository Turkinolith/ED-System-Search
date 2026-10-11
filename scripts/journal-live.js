// Follows the game's journal while it is being written, so the app can show
// where you are and what you have scanned without a manual journal refresh.
//
// The newest Journal.*.log is read once, then polled for appended bytes; a
// folder watch (with a slower poll as backup) switches to a new journal when
// the game starts one. Events update an in-memory picture of the current
// system, its stars and bodies, which listeners receive as small updates.
// Persisting to the app's own files is left to the regular incremental import,
// which the caller triggers through `onPersist`.
import { watch } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

const JOURNAL_PATTERN = /^Journal\..*\.log$/i;
const BIO_SIGNAL = '$SAA_SignalType_Biological;';

export function newestJournalName(names) {
  return names.filter((name) => JOURNAL_PATTERN.test(name)).sort().at(-1) ?? null;
}

function bioCountFromSignals(signals) {
  if (!Array.isArray(signals)) return null;
  return signals.find((signal) => signal.Type === BIO_SIGNAL)?.Count ?? 0;
}

export class LiveJournalState {
  constructor({ regionAt = () => null } = {}) {
    this.regionAt = regionAt;
    this.current = null;
    this.stars = new Map();
    this.bodies = new Map();
    this.fss = null;
    this.lastEventAt = null;
  }

  body(bodyId) {
    if (!this.bodies.has(bodyId)) {
      this.bodies.set(bodyId, { bodyId, name: null, scan: null, bioCount: null, genuses: null, speciesFound: [] });
    }
    return this.bodies.get(bodyId);
  }

  inCurrentSystem(event) {
    return this.current && event.SystemAddress !== undefined && String(event.SystemAddress) === this.current.systemAddress;
  }

  // Applies one journal event; returns a change { type, ... } or null.
  apply(event) {
    if (!event?.event) return null;
    this.lastEventAt = event.timestamp ?? this.lastEventAt;
    switch (event.event) {
      case 'Location':
      case 'FSDJump':
      case 'CarrierJump': {
        if (event.SystemAddress === undefined) return null;
        const systemAddress = String(event.SystemAddress);
        const changed = this.current?.systemAddress !== systemAddress;
        const starPos = Array.isArray(event.StarPos) ? event.StarPos : null;
        this.current = {
          systemAddress,
          systemName: event.StarSystem ?? null,
          starPos,
          region: starPos ? this.regionAt(starPos[0], starPos[2]) : null,
          arrivedAt: event.timestamp ?? null,
          docked: event.Docked === true,
          body: event.Body ?? null,
        };
        if (changed) {
          this.stars.clear();
          this.bodies.clear();
          this.fss = null;
        }
        return { type: 'location', jumped: changed && event.event !== 'Location', current: this.current };
      }
      case 'FSSDiscoveryScan':
        if (!this.inCurrentSystem(event)) return null;
        this.fss = { bodyCount: event.BodyCount ?? null, progress: event.Progress ?? null, complete: false };
        return { type: 'status', fss: this.fss };
      case 'FSSAllBodiesFound':
        if (!this.inCurrentSystem(event)) return null;
        this.fss = { ...(this.fss ?? {}), bodyCount: event.Count ?? this.fss?.bodyCount ?? null, progress: 1, complete: true };
        return { type: 'status', fss: this.fss };
      case 'Scan': {
        if (!this.inCurrentSystem(event) || event.BodyID === undefined) return null;
        if (event.StarType) {
          this.stars.set(event.BodyID, event);
          return { type: 'star', star: event };
        }
        if (!event.PlanetClass) return null;
        const body = this.body(event.BodyID);
        body.scan = event;
        body.name = event.BodyName ?? body.name;
        return { type: 'body', body };
      }
      case 'FSSBodySignals':
      case 'SAASignalsFound': {
        if (!this.inCurrentSystem(event) || event.BodyID === undefined) return null;
        const body = this.body(event.BodyID);
        body.name = event.BodyName ?? body.name;
        const count = bioCountFromSignals(event.Signals);
        if (count !== null) body.bioCount = count;
        if (Array.isArray(event.Genuses)) body.genuses = event.Genuses.map((item) => item.Genus);
        return { type: 'body', body };
      }
      case 'ScanOrganic': {
        if (!this.inCurrentSystem(event) || event.Body === undefined) return null;
        const body = this.body(event.Body);
        const species = event.Species_Localised ?? event.Species;
        if (species && !body.speciesFound.includes(species)) body.speciesFound.push(species);
        if (event.Genus && !(body.genuses ?? []).includes(event.Genus)) body.genuses = [...(body.genuses ?? []), event.Genus];
        return { type: 'body', body, organic: { species, scanType: event.ScanType } };
      }
      default:
        return null;
    }
  }

  snapshot() {
    return {
      current: this.current,
      fss: this.fss,
      stars: [...this.stars.values()],
      bodies: [...this.bodies.values()],
      lastEventAt: this.lastEventAt,
    };
  }
}

export class JournalLive {
  constructor({
    journalDir,
    regionAt,
    onChange = () => {},
    onPersist = () => {},
    pollMs = 1000,
    folderPollMs = 5000,
    persistAfterBodyMs = 15000,
    persistAfterJumpMs = 3000,
  }) {
    this.journalDir = journalDir;
    this.onChange = onChange;
    this.onPersist = onPersist;
    this.pollMs = pollMs;
    this.folderPollMs = folderPollMs;
    this.persistAfterBodyMs = persistAfterBodyMs;
    this.persistAfterJumpMs = persistAfterJumpMs;
    this.state = new LiveJournalState({ regionAt });
    this.file = null;
    this.offset = 0;
    this.partial = '';
    this.running = false;
    this.timers = [];
    this.watcher = null;
    this.persistTimer = null;
    this.reading = false;
  }

  status() {
    return { running: this.running, file: this.file ? path.basename(this.file) : null, journalDir: this.journalDir };
  }

  async start() {
    if (this.running) return;
    this.running = true;
    await this.switchToNewest({ replay: true });
    this.timers.push(setInterval(() => this.poll().catch(() => null), this.pollMs));
    this.timers.push(setInterval(() => this.switchToNewest({ replay: false }).catch(() => null), this.folderPollMs));
    try {
      this.watcher = watch(this.journalDir, (eventType, filename) => {
        if (filename && JOURNAL_PATTERN.test(String(filename))) this.switchToNewest({ replay: false }).catch(() => null);
      });
      this.watcher.on('error', () => {
        this.watcher?.close();
        this.watcher = null;
      });
    } catch {
      this.watcher = null; // the folder poll still notices new journals
    }
  }

  stop() {
    this.running = false;
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    clearTimeout(this.persistTimer);
    this.persistTimer = null;
    this.watcher?.close();
    this.watcher = null;
  }

  async switchToNewest({ replay }) {
    let names;
    try {
      names = await fs.readdir(this.journalDir);
    } catch {
      return;
    }
    const newest = newestJournalName(names);
    if (!newest) return;
    const file = path.join(this.journalDir, newest);
    if (file === this.file) return;
    const previous = this.file;
    this.file = file;
    this.offset = 0;
    this.partial = '';
    // On start the current journal is replayed silently to rebuild where you
    // are; a journal the game opens later is read in full as live events.
    await this.poll({ quiet: replay && !previous });
    if (replay && !previous) this.onChange({ type: 'snapshot', snapshot: this.state.snapshot() });
  }

  async poll({ quiet = false } = {}) {
    if (!this.running || !this.file || this.reading) return;
    this.reading = true;
    try {
      const handle = await fs.open(this.file, 'r');
      try {
        const { size } = await handle.stat();
        if (size < this.offset) {
          this.offset = 0;
          this.partial = '';
        }
        if (size === this.offset) return;
        const buffer = Buffer.alloc(size - this.offset);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, this.offset);
        this.offset += bytesRead;
        this.consume(buffer.subarray(0, bytesRead).toString('utf8'), quiet);
      } finally {
        await handle.close();
      }
    } catch {
      // The game may hold the file briefly; the next poll retries.
    } finally {
      this.reading = false;
    }
  }

  consume(text, quiet) {
    const lines = (this.partial + text).split(/\r?\n/);
    this.partial = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      const change = this.state.apply(event);
      if (!change || quiet) continue;
      this.onChange(change);
      this.schedulePersist(change.type === 'location' && change.jumped ? this.persistAfterJumpMs : this.persistAfterBodyMs);
    }
  }

  // Debounced: a burst of scans persists once, shortly after it ends.
  schedulePersist(delayMs) {
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.onPersist();
    }, delayMs);
  }
}
