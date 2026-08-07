import fs from 'node:fs/promises';
import path from 'node:path';
import { ACTIVITY_DIR_NAME, findActiveImports, withCleanupCoordinator } from './import-activity.js';

// Native importers, index builders, and atomic JSON writers rename temp output
// into place. A crash, forced shutdown, or killed import can leave those temps
// behind, and a full-galaxy temp can be well over 100 GB. No live data file
// ends in .tmp, so the suffix is a safe signal inside the data directory.
const TEMP_SUFFIX = '.tmp';

// Browser partials from a manually downloaded Spansh dump. These sit in the
// project root next to the finished .gz and may still be resumable, so cleanup
// only removes them through a separate explicit opt-in.
const PARTIAL_DOWNLOAD_SUFFIXES = ['.crdownload', '.part', '.partial', '.download'];

// Source dumps the importers consume. Deltas stream straight from the URL, so
// these only exist when someone downloaded one by hand. Reported by default and
// only removed when the caller opts in, because a local copy avoids a very
// large re-download.
const CONSUMED_DUMP_PATTERN = /^(galaxy|systems)(_\d+(day|week|month|year)s?)?\.json\.gz$/;

// Temps are only removed once they are older than this. An import that is still
// running holds a fresh temp, so the age check keeps cleanup from racing it even
// if the caller's running-state guard is wrong.
const DEFAULT_MIN_AGE_MS = 60 * 60 * 1000;

// Temp files are always created as siblings of their final destination, and
// every destination lives at data/ or one level below it (galaxy/, suggest/,
// name-lookup/, suggest-overlay-index/, places-index/).
const MAX_DEPTH = 2;

function formatBytes(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function scanError(targetPath, error) {
  return {
    path: targetPath,
    code: error.code ?? null,
    message: error.message,
  };
}

async function readDirectory(dirPath, errors) {
  try {
    return await fs.readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    if (error.code !== 'ENOENT') errors.push(scanError(dirPath, error));
    return null;
  }
}

async function treeStats(targetPath, errors) {
  let stat;
  try {
    stat = await fs.lstat(targetPath);
  } catch (error) {
    if (error.code !== 'ENOENT') errors.push(scanError(targetPath, error));
    return null;
  }

  if (!stat.isDirectory()) {
    return { size: stat.size, newestMtimeMs: stat.mtimeMs, complete: true };
  }

  const errorCountBefore = errors.length;
  const entries = await readDirectory(targetPath, errors);
  if (!entries) {
    return { size: 0, newestMtimeMs: stat.mtimeMs, complete: errors.length === errorCountBefore };
  }

  let size = 0;
  let newestMtimeMs = stat.mtimeMs;
  let complete = true;
  for (const entry of entries) {
    const child = await treeStats(path.join(targetPath, entry.name), errors);
    if (!child) continue;
    size += child.size;
    newestMtimeMs = Math.max(newestMtimeMs, child.newestMtimeMs);
    complete = complete && child.complete;
  }
  if (errors.length !== errorCountBefore) complete = false;
  return { size, newestMtimeMs, complete };
}

async function collectTemps(dirPath, cutoff, depth, found, errors) {
  const entries = await readDirectory(dirPath, errors);
  if (!entries) return;
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    const isTemp = entry.name.endsWith(TEMP_SUFFIX);
    if (isTemp) {
      const stats = await treeStats(full, errors);
      if (!stats || !stats.complete || stats.newestMtimeMs > cutoff) continue;
      found.push({ path: full, size: stats.size, kind: entry.isDirectory() ? 'temp directory' : 'temp file' });
      continue;
    }
    if (entry.isDirectory() && depth < MAX_DEPTH) {
      await collectTemps(full, cutoff, depth + 1, found, errors);
    }
  }
}

async function collectRootJunk(rootDir, cutoff, includeDumps, includePartials, found, errors) {
  const entries = await readDirectory(rootDir, errors);
  if (!entries) return;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const isPartial = PARTIAL_DOWNLOAD_SUFFIXES.some((suffix) => entry.name.endsWith(suffix));
    const isDump = CONSUMED_DUMP_PATTERN.test(entry.name);
    if (!isPartial && !isDump) continue;
    const full = path.join(rootDir, entry.name);
    const stats = await treeStats(full, errors);
    if (!stats || !stats.complete || stats.newestMtimeMs > cutoff) continue;
    if (isPartial) {
      found.push({
        path: full,
        size: stats.size,
        kind: 'partial download',
        ...(includePartials ? {} : { keepReason: 'pass includePartials to remove recoverable downloads' }),
      });
    } else if (includeDumps) {
      found.push({ path: full, size: stats.size, kind: 'consumed source dump' });
    } else {
      found.push({ path: full, size: stats.size, kind: 'consumed source dump', keepReason: 'pass includeDumps to remove' });
    }
  }
}

/**
 * Find and optionally remove leftover import artifacts.
 *
 * Only ever touches temp files/directories under the data directory and,
 * when explicitly selected, partial downloads in the project root. Live data
 * files are never matched.
 * Returns removed/skipped artifacts, scan errors, active imports, and reclaimed
 * bytes so callers can report an accurate summary.
 */
export async function cleanupJunkFiles({
  rootDir,
  dataDir,
  dryRun = false,
  includeDumps = false,
  includePartials = false,
  minAgeMs = DEFAULT_MIN_AGE_MS,
} = {}) {
  const runCleanup = async () => {
    const cutoff = Date.now() - minAgeMs;
    const found = [];
    const errors = [];
    let activeImports = [];
    if (dataDir) {
      try {
        // A dry run must not unlink expired markers - it only previews.
        activeImports = await findActiveImports(dataDir, { pruneStale: !dryRun });
      } catch (error) {
        errors.push(scanError(path.join(dataDir, ACTIVITY_DIR_NAME), error));
        return { removed: [], skipped: [], errors, activeImports, bytes: 0 };
      }
    }
    if (activeImports.length) {
      return { removed: [], skipped: [], errors, activeImports, bytes: 0 };
    }
    if (dataDir) await collectTemps(dataDir, cutoff, 0, found, errors);
    if (rootDir) await collectRootJunk(rootDir, cutoff, includeDumps, includePartials, found, errors);

    const removed = [];
    const skipped = [];
    for (const item of found) {
      if (item.keepReason) {
        skipped.push(item);
        continue;
      }
      if (dryRun) {
        removed.push(item);
        continue;
      }
      try {
        await fs.rm(item.path, { recursive: true, force: true });
        removed.push(item);
      } catch (error) {
        skipped.push({ ...item, keepReason: error.message });
      }
    }

    return {
      removed,
      skipped,
      errors,
      activeImports,
      bytes: removed.reduce((sum, item) => sum + item.size, 0),
    };
  };

  // A preview creates no coordinator file and prunes no markers. Destructive
  // cleanup holds the coordinator until every selected artifact is handled, so
  // no writer can appear after the active-import check and before deletion.
  if (dryRun || !dataDir) return runCleanup();
  try {
    return await withCleanupCoordinator(dataDir, 'junk cleanup', runCleanup);
  } catch (error) {
    return {
      removed: [],
      skipped: [],
      errors: [scanError(dataDir, error)],
      activeImports: [],
      bytes: 0,
    };
  }
}

export function describeCleanup(result, { dryRun = false } = {}) {
  if (!result.removed.length && !result.skipped.length && !result.errors.length && !result.activeImports.length) {
    return 'No leftover import artifacts found.';
  }
  const lines = [];
  for (const activity of result.activeImports) {
    const reason = activity.reason === 'heartbeat'
      ? 'fresh heartbeat'
      : activity.reason === 'pid'
        ? 'owner process is still running'
        : activity.reason;
    lines.push(`Cleanup deferred while ${activity.label} is active${activity.pid ? ` (PID ${activity.pid})` : ''}${reason ? `; ${reason}` : ''}.`);
  }
  for (const item of result.removed) {
    lines.push(`${dryRun ? 'Would remove' : 'Removed'} ${item.kind}: ${item.path} (${formatBytes(item.size)})`);
  }
  for (const item of result.skipped) {
    lines.push(`Kept ${item.kind}: ${item.path} (${formatBytes(item.size)}) - ${item.keepReason}`);
  }
  for (const error of result.errors) {
    lines.push(`Could not scan ${error.path}: ${error.message}`);
  }
  if (result.removed.length) {
    lines.push(`${dryRun ? 'Would reclaim' : 'Reclaimed'} ${formatBytes(result.bytes)} across ${result.removed.length} item(s).`);
  }
  return lines.join('\n');
}

export { DEFAULT_MIN_AGE_MS, formatBytes };
