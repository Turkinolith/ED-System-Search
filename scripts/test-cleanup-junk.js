import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cleanupJunkFiles, describeCleanup } from './cleanup-junk.js';
import {
  COORDINATOR_FILE_NAME,
  startImportActivity,
  withCleanupCoordinator,
} from './import-activity.js';
import { writeFileAtomic } from './atomic-file.js';
import { createCleanupScheduler } from './cleanup-scheduler.js';

const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'edss-cleanup-'));
const rootDir = path.join(fixture, 'project');
const dataDir = path.join(rootDir, 'data');
const galaxyDir = path.join(dataDir, 'galaxy');
const suggestDir = path.join(dataDir, 'suggest');
await fs.mkdir(galaxyDir, { recursive: true });
await fs.mkdir(suggestDir, { recursive: true });

const old = new Date(Date.now() - 6 * 60 * 60 * 1000);

async function write(relativePath, { aged = false } = {}) {
  const full = path.join(rootDir, relativePath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, 'x');
  if (aged) await fs.utimes(full, old, old);
  return full;
}

// Live files that must survive every run.
const live = [
  'data/systems-search.tsv',
  'data/systems.bin',
  'data/systems-lod-6.bin',
  'data/galaxy/base.pack',
  'data/galaxy/base.idx',
  'data/galaxy/manifest.json',
  'data/galaxy/systems-lod-6-rich.bin',
  'data/suggest/sol.tsv',
  'data/murder-binaries.bin',
  'data/atomic-check.json',
  'galaxy.json.gz',
];
for (const item of live) await write(item, { aged: true });

const atomicCheckPath = path.join(dataDir, 'atomic-check.json');
await writeFileAtomic(atomicCheckPath, JSON.stringify({ ok: true }));
assert.deepEqual(JSON.parse(await fs.readFile(atomicCheckPath, 'utf8')), { ok: true });
assert.equal((await fs.readdir(dataDir)).filter((name) => name.startsWith('atomic-check.json.') && name.endsWith('.tmp')).length, 0);

// Every temp shape the importers and the server can strand.
const temps = [
  'data/base.pack.1752120000000.tmp',
  'data/systems.bin.native-delta-1752120000000.tmp',
  'data/name-lookup-overlay.tsv.native-overlay-1752120000000.tmp',
  'data/suggest-overlay.tsv.native-suggest-overlay-1752120000000.tmp',
  'data/places.json.4321.tmp',
  'data/galaxy/base.idx.1752120000000.tmp',
  'data/galaxy/systems-lod-6-rich.bin.1752120000000.tmp',
];
for (const item of temps) await write(item, { aged: true });

// Temp directories created by the JS index builders.
const tempDirs = ['data/.suggest-overlay-index-4321-1752120000000.tmp', 'data/.places-index-4321-1752120000000.tmp'];
for (const dir of tempDirs) {
  await write(path.join(dir, 'shard.tsv'), { aged: true });
  await fs.utimes(path.join(rootDir, dir), old, old);
}

// A directory's own mtime can be old while an importer is still updating a
// file below it. Freshness must include descendants, not just the parent.
const activeTempDir = 'data/.suggest-overlay-index-9999-1752120000000.tmp';
const activeTempChild = await write(path.join(activeTempDir, 'partitions', '00.tsv'));
await fs.utimes(path.join(rootDir, activeTempDir), old, old);

const partial = await write('Unconfirmed 344958.crdownload', { aged: true });
// A temp from an import that is still running must never be touched.
const fresh = await write('data/base.pack.9999999999999.tmp');

const dryRun = await cleanupJunkFiles({ rootDir, dataDir, dryRun: true });
assert.equal(dryRun.removed.length, temps.length + tempDirs.length, 'dry run should match every aged temp');
assert.ok(dryRun.skipped.some((item) => item.path === partial), 'dry run should report but retain recoverable partials');
assert.ok(await fs.stat(path.join(dataDir, COORDINATOR_FILE_NAME)).then(() => false, () => true), 'dry run created a coordinator lock');
for (const item of temps) {
  assert.ok(await fs.stat(path.join(rootDir, item)).then(() => true, () => false), `dry run must not delete ${item}`);
}

const result = await cleanupJunkFiles({ rootDir, dataDir });
assert.equal(result.removed.length, temps.length + tempDirs.length);

for (const item of live) {
  assert.ok(await fs.stat(path.join(rootDir, item)).then(() => true, () => false), `live file removed: ${item}`);
}
for (const item of [...temps, ...tempDirs]) {
  assert.ok(await fs.stat(path.join(rootDir, item)).then(() => false, () => true), `temp survived: ${item}`);
}
assert.ok(await fs.stat(partial).then(() => true, () => false), 'recoverable partial download was removed by default');
assert.ok(await fs.stat(fresh).then(() => true, () => false), 'a running import lost its temp');
assert.ok(await fs.stat(activeTempChild).then(() => true, () => false), 'an active temp directory was removed using only its parent mtime');

// Configuration and permission failures must not be reported as a clean scan.
const failedScan = await cleanupJunkFiles({ dataDir: path.join(rootDir, 'galaxy.json.gz'), dryRun: true });
assert.equal(failedScan.errors.length, 1, 'a non-directory data path should produce a visible scan error');

// An importer in another process may own even an old temp. Its activity lease
// blocks destructive cleanup until that importer exits.
const leasedTemp = await write('data/systems.bin.native-delta-leased.tmp', { aged: true });
const activity = await startImportActivity(dataDir, 'cleanup regression test');
try {
  const whileActive = await cleanupJunkFiles({ rootDir, dataDir });
  assert.equal(whileActive.activeImports.length, 1, 'cleanup did not detect the active import lease');
  assert.ok(await fs.stat(leasedTemp).then(() => true, () => false), 'cleanup removed a temp owned by an active importer');
} finally {
  await activity.close();
}
const afterActivity = await cleanupJunkFiles({ rootDir, dataDir });
assert.ok(await fs.stat(leasedTemp).then(() => false, () => true), 'cleanup did not resume after the import lease closed');

// A crash can strand its marker too. Once both the heartbeat and owner are
// gone, the stale lease must not block cleanup forever.
const activityDir = path.join(dataDir, '.active-imports');
const staleMarker = path.join(activityDir, 'stale.json');
await fs.mkdir(activityDir, { recursive: true });
await fs.writeFile(staleMarker, JSON.stringify({ pid: -1, label: 'crashed import' }));
await fs.utimes(staleMarker, old, old);
const staleLeaseTemp = await write('data/systems.bin.native-delta-stale-lease.tmp', { aged: true });
const afterStaleLease = await cleanupJunkFiles({ rootDir, dataDir });
assert.equal(afterStaleLease.activeImports.length, 0, 'a stale lease blocked cleanup');
assert.ok(await fs.stat(staleLeaseTemp).then(() => false, () => true), 'cleanup did not remove junk after expiring a stale lease');

// A live process remains protective even if its heartbeat has stopped for more
// than an hour. That preserves work across machine sleep or process suspension.
// A recycled PID is indistinguishable with portable PID APIs and may therefore
// require manual review rather than risking deletion of active work.
const recycledMarker = path.join(activityDir, 'recycled.json');
await fs.mkdir(activityDir, { recursive: true });
await fs.writeFile(recycledMarker, JSON.stringify({ pid: process.pid, label: 'import on a recycled pid' }));
await fs.utimes(recycledMarker, old, old);
const recycledTemp = await write('data/systems.bin.native-delta-recycled.tmp', { aged: true });
const afterRecycled = await cleanupJunkFiles({ rootDir, dataDir });
assert.equal(afterRecycled.activeImports.length, 1, 'a suspended live process did not keep its lease');
assert.equal(afterRecycled.activeImports[0].reason, 'pid');
assert.ok(await fs.stat(recycledTemp).then(() => true, () => false), 'cleanup removed work behind a suspended-live lease');
assert.match(describeCleanup(afterRecycled), /owner process is still running/, 'cleanup output hid why the lease was held');
await fs.rm(recycledMarker);
const afterSuspendedLease = await cleanupJunkFiles({ rootDir, dataDir });
assert.ok(await fs.stat(recycledTemp).then(() => false, () => true), 'cleanup did not resume after manual stale-lease review');

// A live PID with a stale heartbeat is honored.
const freshPidMarker = path.join(activityDir, 'fresh-pid.json');
await fs.writeFile(freshPidMarker, JSON.stringify({ pid: process.pid, label: 'import with a live pid' }));
await fs.utimes(freshPidMarker, new Date(Date.now() - 10 * 60 * 1000), new Date(Date.now() - 10 * 60 * 1000));
const heldTemp = await write('data/systems.bin.native-delta-held.tmp', { aged: true });
const whileHeld = await cleanupJunkFiles({ rootDir, dataDir });
assert.equal(whileHeld.activeImports.length, 1, 'a live PID should hold the lease');
assert.equal(whileHeld.activeImports[0].reason, 'pid', 'lease should report why it is held');
assert.ok(await fs.stat(heldTemp).then(() => true, () => false), 'cleanup removed a temp behind a live-PID lease');

// A dry run only previews. It must not unlink expired markers or the lease dir.
await fs.rm(freshPidMarker);
const expiredPreviewMarker = path.join(activityDir, 'expired-preview.json');
await fs.writeFile(expiredPreviewMarker, JSON.stringify({ pid: -1, label: 'expired preview marker' }));
await fs.utimes(expiredPreviewMarker, old, old);
const previewed = await cleanupJunkFiles({ rootDir, dataDir, dryRun: true });
assert.ok(previewed.removed.some((item) => item.path === heldTemp), 'dry run should preview the now-orphaned temp');
assert.ok(await fs.stat(expiredPreviewMarker).then(() => true, () => false), 'dry run unlinked an expired lease marker');
assert.ok(await fs.stat(activityDir).then(() => true, () => false), 'dry run removed the activity directory');
assert.ok(await fs.stat(heldTemp).then(() => true, () => false), 'dry run deleted a temp');

// Closing a lease must not remove the shared directory out from under another
// process that is between its mkdir and its exclusive marker write. Prune the
// expired markers left by the blocks above first, so the directory is empty and
// nothing else keeps it alive.
await cleanupJunkFiles({ rootDir, dataDir });
assert.equal((await fs.readdir(activityDir)).length, 0, 'expired markers should have been pruned');
const first = await startImportActivity(dataDir, 'first concurrent import');
const second = await startImportActivity(dataDir, 'second concurrent import');
await first.close();
assert.ok(await fs.stat(activityDir).then(() => true, () => false), 'closing one lease removed the shared activity directory');
const third = await startImportActivity(dataDir, 'import started after a close');
await Promise.all([second.close(), third.close()]);
// Even with every lease closed the directory stays, so a process that has just
// mkdir'd cannot have it pulled away before its exclusive marker write lands.
assert.ok(await fs.stat(activityDir).then(() => true, () => false), 'closing the last lease removed the shared activity directory');
const afterAllClosed = await cleanupJunkFiles({ rootDir, dataDir });
assert.equal(afterAllClosed.activeImports.length, 0, 'closed leases still reported as active');
assert.ok(await fs.stat(activityDir).then(() => true, () => false), 'cleanup removed the shared activity directory');

// Marker creation and destructive cleanup share one coordinator. A writer that
// starts after cleanup owns the gate cannot publish its lease until cleanup has
// finished, eliminating the check-then-delete race.
let delayedActivityPromise;
let delayedActivityStarted = false;
await withCleanupCoordinator(dataDir, 'coordinator exclusion regression', async () => {
  delayedActivityPromise = startImportActivity(dataDir, 'writer waiting for cleanup')
    .then((lease) => {
      delayedActivityStarted = true;
      return lease;
    });
  await new Promise((resolve) => setTimeout(resolve, 75));
  assert.equal(delayedActivityStarted, false, 'a writer published its lease while cleanup owned the coordinator');
});
const delayedActivity = await delayedActivityPromise;
await delayedActivity.close();

// A far-future filesystem timestamp is invalid, not a fresh heartbeat. With no
// live owner it must neither block cleanup nor survive stale-marker pruning.
const futureMarker = path.join(activityDir, 'future.json');
await fs.writeFile(futureMarker, JSON.stringify({ pid: -1, label: 'future-dated crashed import' }));
const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
await fs.utimes(futureMarker, future, future);
const futureMarkerTemp = await write('data/systems.bin.native-delta-future-marker.tmp', { aged: true });
const afterFutureMarker = await cleanupJunkFiles({ rootDir, dataDir });
assert.equal(afterFutureMarker.activeImports.length, 0, 'a future-dated dead marker was treated as a heartbeat');
assert.ok(await fs.stat(futureMarker).then(() => false, () => true), 'a future-dated dead marker was not pruned');
assert.ok(await fs.stat(futureMarkerTemp).then(() => false, () => true), 'future marker blocked removal of orphaned junk');

const futureLiveMarker = path.join(activityDir, 'future-live.json');
await fs.writeFile(futureLiveMarker, JSON.stringify({ pid: process.pid, label: 'future-dated live import' }));
await fs.utimes(futureLiveMarker, future, future);
const futureLiveTemp = await write('data/systems.bin.native-delta-future-live.tmp', { aged: true });
const whileFutureLive = await cleanupJunkFiles({ rootDir, dataDir });
assert.equal(whileFutureLive.activeImports[0].reason, 'pid', 'a future timestamp was accepted as a heartbeat');
assert.ok(await fs.stat(futureLiveTemp).then(() => true, () => false), 'future timestamp bypassed live-owner protection semantics');
await fs.rm(futureLiveMarker);
await cleanupJunkFiles({ rootDir, dataDir });
assert.ok(await fs.stat(futureLiveTemp).then(() => false, () => true), 'cleanup did not resume after the future live marker was reviewed');

// Partial downloads are recoverable work and require a separate explicit opt-in.
const withPartials = await cleanupJunkFiles({ rootDir, dataDir, includePartials: true });
assert.ok(withPartials.removed.some((item) => item.path === partial), 'includePartials did not remove the selected partial');
assert.ok(await fs.stat(partial).then(() => false, () => true), 'includePartials left the selected partial behind');

// Delayed cleanup retries scan failures instead of silently abandoning the
// orphan until the next server restart. Short injected delays exercise the real
// timer callback without waiting for the production one-hour window.
let scheduledRuns = 0;
await new Promise((resolve, reject) => {
  const watchdog = setTimeout(() => reject(new Error('cleanup scheduler did not retry a scan failure')), 1000);
  const scheduler = createCleanupScheduler({
    runCleanup: async () => {
      scheduledRuns += 1;
      if (scheduledRuns === 1) {
        return { removed: [], skipped: [], errors: [{ message: 'scan failed' }], activeImports: [], bytes: 0 };
      }
      clearTimeout(watchdog);
      resolve();
      return { removed: [], skipped: [], errors: [], activeImports: [], bytes: 0 };
    },
    defaultDelayMs: 5,
    retryDelayMs: 5,
    setTimer: (callback, delayMs) => ({ id: setTimeout(callback, delayMs) }),
    clearTimer: (timer) => clearTimeout(timer.id),
  });
  scheduler.schedule('retry regression');
});
assert.equal(scheduledRuns, 2, 'cleanup scheduler should stop after the retry succeeds');

// The consumed dump is reported but kept unless the caller opts in.
const reported = result.skipped.find((item) => item.path.endsWith('galaxy.json.gz'));
assert.ok(reported, 'galaxy.json.gz should be reported as a consumed dump');
assert.ok(await fs.stat(path.join(rootDir, 'galaxy.json.gz')).then(() => true, () => false), 'galaxy.json.gz must be kept by default');

const withDumps = await cleanupJunkFiles({ rootDir, dataDir, includeDumps: true });
assert.equal(withDumps.removed.length, 1);
assert.ok(await fs.stat(path.join(rootDir, 'galaxy.json.gz')).then(() => false, () => true), 'includeDumps should remove the dump');

await fs.rm(fixture, { recursive: true, force: true });
console.log('Cleanup junk-file tests passed.');
