import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const ACTIVITY_DIR_NAME = '.active-imports';
const COORDINATOR_FILE_NAME = '.cleanup-coordinator.lock';
const HEARTBEAT_MS = 30 * 1000;
const DEFAULT_STALE_AFTER_MS = 5 * 60 * 1000;
const DEFAULT_FUTURE_SKEW_MS = 5 * 60 * 1000;
const COORDINATOR_RETRY_MS = 50;
const COORDINATOR_TIMEOUT_MS = 10 * 60 * 1000;
const MALFORMED_LOCK_STALE_MS = 5 * 60 * 1000;

function activityDir(dataDir) {
  return path.join(dataDir, ACTIVITY_DIR_NAME);
}

function processIsRunning(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function recoverAbandonedCoordinator(lockPath, now = Date.now()) {
  let stat;
  let owner;
  try {
    stat = await fs.stat(lockPath);
    owner = JSON.parse(await fs.readFile(lockPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return true;
    // A contender can observe the file between its exclusive creation and the
    // owner write. Treat that as held unless it has remained malformed long
    // enough to prove that the creating process did not finish the operation.
    if (!(error instanceof SyntaxError) || !stat || now - stat.mtimeMs < MALFORMED_LOCK_STALE_MS) return false;
  }

  if (owner && processIsRunning(Number(owner.pid))) return false;
  if (!owner && now - stat.mtimeMs < MALFORMED_LOCK_STALE_MS) return false;
  try {
    await fs.rm(lockPath);
    return true;
  } catch (error) {
    return error.code === 'ENOENT';
  }
}

/**
 * Serialize cleanup with the creation of activity markers. Cleanup holds this
 * gate through its complete scan/delete pass; writers hold it only long enough
 * to publish a marker. That makes "no active imports" and deletion one atomic
 * decision with respect to new writers.
 */
export async function withCleanupCoordinator(dataDir, purpose, action, {
  timeoutMs = COORDINATOR_TIMEOUT_MS,
  retryMs = COORDINATOR_RETRY_MS,
} = {}) {
  await fs.mkdir(dataDir, { recursive: true });
  const lockPath = path.join(dataDir, COORDINATOR_FILE_NAME);
  const token = randomUUID();
  const started = Date.now();

  while (true) {
    let handle;
    let created = false;
    try {
      handle = await fs.open(lockPath, 'wx');
      created = true;
      await handle.writeFile(JSON.stringify({
        token,
        pid: process.pid,
        purpose: String(purpose || 'data operation'),
        createdAt: new Date().toISOString(),
      }));
      await handle.close();
      handle = null;
      break;
    } catch (error) {
      await handle?.close().catch(() => null);
      if (created) await fs.rm(lockPath, { force: true }).catch(() => null);
      if (error.code !== 'EEXIST') throw error;
      if (await recoverAbandonedCoordinator(lockPath)) continue;
      if (Date.now() - started >= timeoutMs) {
        throw new Error(`Timed out waiting for data cleanup coordinator ${lockPath}`);
      }
      await delay(retryMs);
    }
  }

  try {
    return await action();
  } finally {
    try {
      const owner = JSON.parse(await fs.readFile(lockPath, 'utf8'));
      if (owner.token === token) await fs.rm(lockPath, { force: true });
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn(`Could not release data cleanup coordinator ${lockPath}: ${error.message}`);
      }
    }
  }
}

export async function startImportActivity(dataDir, label) {
  const token = randomUUID();
  const markerPath = path.join(activityDir(dataDir), `${process.pid}-${token}.json`);
  let payload = {
    token,
    pid: process.pid,
    label: String(label || 'data import'),
    startedAt: new Date().toISOString(),
  };
  await withCleanupCoordinator(dataDir, `start ${payload.label}`, async () => {
    await fs.mkdir(activityDir(dataDir), { recursive: true });
    await fs.writeFile(markerPath, JSON.stringify(payload, null, 2), { flag: 'wx' });
  });

  let closed = false;
  const heartbeat = setInterval(() => {
    const now = new Date();
    fs.utimes(markerPath, now, now).catch(() => null);
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  return {
    ...payload,
    path: markerPath,
    async trackProcess(workerPid) {
      if (!Number.isSafeInteger(workerPid) || workerPid <= 0) return;
      payload = { ...payload, workerPid };
      await fs.writeFile(markerPath, JSON.stringify(payload, null, 2));
    },
    async close() {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      // The shared directory is deliberately left in place. Removing it races
      // another process between its mkdir and its exclusive marker write, which
      // would fail that import with ENOENT.
      await fs.rm(markerPath, { force: true });
    },
  };
}

export async function withImportActivity(dataDir, label, action) {
  const activity = await startImportActivity(dataDir, label);
  try {
    return await action();
  } finally {
    await activity.close().catch((error) => {
      console.warn(`Could not close import activity marker ${activity.path}: ${error.message}`);
    });
  }
}

export async function findActiveImports(dataDir, {
  now = Date.now(),
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
  futureSkewMs = DEFAULT_FUTURE_SKEW_MS,
  // Callers previewing a cleanup (dry run) must not unlink expired markers.
  pruneStale = true,
} = {}) {
  const dir = activityDir(dataDir);
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const active = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const markerPath = path.join(dir, entry.name);
    let stat;
    let payload = null;
    try {
      stat = await fs.stat(markerPath);
      payload = JSON.parse(await fs.readFile(markerPath, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      const age = stat ? now - stat.mtimeMs : Infinity;
      if (error instanceof SyntaxError && age >= -futureSkewMs && age <= staleAfterMs) {
        // A torn read of a marker being rewritten. Fail safe: a fresh marker is
        // treated as active rather than prunable.
        active.push({ path: markerPath, pid: null, label: 'unreadable active import marker', reason: 'heartbeat' });
        continue;
      }
      if (!(error instanceof SyntaxError)) throw error;
    }

    const pid = Number(payload?.pid);
    const workerPid = Number(payload?.workerPid);
    const age = stat ? now - stat.mtimeMs : Infinity;
    const fresh = age >= -futureSkewMs && age <= staleAfterMs;
    const ownerRunning = processIsRunning(pid);
    const workerRunning = processIsRunning(workerPid);
    const pidAlive = ownerRunning || workerRunning;
    // A known-live process remains protective even if its heartbeat pauses
    // during sleep/suspension. This intentionally favors retaining work. A PID
    // can be recycled, so an old marker can occasionally require manual review.
    if (fresh || pidAlive) {
      active.push({
        path: markerPath,
        pid: workerRunning ? workerPid : (Number.isSafeInteger(pid) ? pid : null),
        label: String(payload?.label || 'data import'),
        startedAt: payload?.startedAt ?? null,
        reason: fresh ? 'heartbeat' : 'pid',
      });
      continue;
    }

    if (pruneStale) await fs.rm(markerPath, { force: true });
  }

  return active;
}

export {
  ACTIVITY_DIR_NAME,
  COORDINATOR_FILE_NAME,
  DEFAULT_FUTURE_SKEW_MS,
  DEFAULT_STALE_AFTER_MS,
};
