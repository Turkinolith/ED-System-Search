// Guards process shutdown against interrupting an in-progress data write.
//
// When a shutdown signal arrives while an import/scan is running, quitting
// immediately can corrupt the galaxy database or the notes/places files. This
// controller instead QUEUES the shutdown, keeps serving until the write
// finishes, then exits — unless the user insists by signalling a second time,
// which forces an immediate (risky) exit.
//
// The logic is dependency-injected so it can be unit-tested without real
// signals, timers, or process exits.

function interruptKeyFor(signal) {
  if (signal === 'SIGINT') return 'Ctrl+C';
  if (signal === 'SIGBREAK') return 'Ctrl+Break';
  return 'the interrupt key';
}

export function queueMessage(signal, activity) {
  return [
    '',
    '============================================================',
    ` Shutdown requested, but a data write is in progress:`,
    `   ${activity}`,
    '',
    ' Quitting now could corrupt the galaxy database or your',
    ' notes/places files, likely requiring a re-import to recover.',
    '',
    ' Shutdown has been QUEUED and will complete automatically when',
    ' this operation finishes.',
    ` Press ${interruptKeyFor(signal)} again to force-quit now (risks corruption).`,
    '============================================================',
    '',
  ].join('\n');
}

export function forceMessage(activity) {
  return `Force-quitting now despite "${activity || 'a data write in progress'}". Data may be left inconsistent and require a re-import.`;
}

export function createShutdownController({ getActivity, exit, log, error, schedulePoll }) {
  let state = 'none'; // 'none' | 'queued' | 'closing'
  let queuedActivity = null;

  function beginExit(code, message) {
    if (state === 'closing') return;
    state = 'closing';
    if (message) log(message);
    exit(code);
  }

  // Called repeatedly by the host's poll loop while a shutdown is queued.
  // Returns 'stop' when the poll should be cleared, 'continue' otherwise.
  function pollTick() {
    if (state !== 'queued') return 'stop';
    if (!getActivity()) {
      beginExit(0, 'Queued operation finished. Shutting down now.');
      return 'stop';
    }
    return 'continue';
  }

  function handleSignal(signal) {
    if (state === 'closing') return;
    if (state === 'queued') {
      error(forceMessage(queuedActivity));
      beginExit(1);
      return;
    }
    const activity = getActivity();
    if (!activity) {
      beginExit(0, 'Shutting down Elite Dangerous System Search...');
      return;
    }
    state = 'queued';
    queuedActivity = activity;
    error(queueMessage(signal, activity));
    schedulePoll(pollTick);
  }

  return {
    handleSignal,
    getState: () => state,
    getQueuedActivity: () => queuedActivity,
  };
}
