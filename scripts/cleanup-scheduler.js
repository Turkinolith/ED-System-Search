export function cleanupNeedsRetry(result) {
  return result === null
    || result.activeImports.length > 0
    || result.errors.length > 0;
}

/**
 * Build the server's delayed cleanup loop with injectable timing for tests.
 * Failed scans and active writers retry after a bounded, fixed delay; a clean
 * result ends the loop.
 */
export function createCleanupScheduler({
  runCleanup,
  defaultDelayMs,
  retryDelayMs,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let timer = null;

  function schedule(reason, delayMs = defaultDelayMs) {
    if (timer) clearTimer(timer);
    timer = setTimer(async () => {
      timer = null;
      const result = await runCleanup(reason);
      if (cleanupNeedsRetry(result)) schedule(reason, retryDelayMs);
    }, delayMs);
    timer?.unref?.();
  }

  function cancel() {
    if (timer) clearTimer(timer);
    timer = null;
  }

  return { cancel, schedule };
}
