import assert from 'node:assert/strict';
import { createShutdownController, queueMessage, forceMessage } from '../shutdown-guard.js';

function makeHarness(initialActivity = null) {
  const state = { activity: initialActivity };
  const logs = [];
  const errors = [];
  const exits = [];
  let capturedTick = null;
  const controller = createShutdownController({
    getActivity: () => state.activity,
    exit: (code) => exits.push(code),
    log: (message) => logs.push(message),
    error: (message) => errors.push(message),
    schedulePoll: (tick) => { capturedTick = tick; },
  });
  return {
    controller,
    state,
    logs,
    errors,
    exits,
    tick: () => capturedTick?.(),
    pollScheduled: () => capturedTick !== null,
  };
}

// 1. Idle shutdown exits immediately with code 0.
{
  const h = makeHarness(null);
  h.controller.handleSignal('SIGINT');
  assert.deepEqual(h.exits, [0], 'Idle shutdown should exit with code 0.');
  assert.equal(h.controller.getState(), 'closing');
  assert.equal(h.pollScheduled(), false, 'Idle shutdown should not start a poll.');
}

// 2. Busy shutdown queues, does not exit, then exits when the write finishes.
{
  const h = makeHarness('journal scan (all scan)');
  h.controller.handleSignal('SIGINT');
  assert.equal(h.controller.getState(), 'queued', 'Busy shutdown should queue.');
  assert.deepEqual(h.exits, [], 'Queued shutdown must not exit while busy.');
  assert.equal(h.pollScheduled(), true, 'Queued shutdown should start a poll.');
  assert.ok(h.errors.some((m) => m.includes('QUEUED')), 'User should be told the shutdown was queued.');

  assert.equal(h.tick(), 'continue', 'Poll should keep waiting while still busy.');
  assert.deepEqual(h.exits, [], 'Still no exit while the write is in progress.');

  h.state.activity = null; // write finished
  assert.equal(h.tick(), 'stop', 'Poll should stop once the write finishes.');
  assert.deepEqual(h.exits, [0], 'Queued shutdown should exit 0 after the write finishes.');
  assert.equal(h.controller.getState(), 'closing');
}

// 3. A second signal while queued forces an immediate exit with code 1.
{
  const h = makeHarness('system/galaxy update (import full galaxy data)');
  h.controller.handleSignal('SIGINT');
  assert.equal(h.controller.getState(), 'queued');
  h.controller.handleSignal('SIGINT');
  assert.deepEqual(h.exits, [1], 'Second signal should force-quit with code 1.');
  assert.ok(h.errors.some((m) => m.includes('Force-quitting')), 'Force-quit should warn the user.');
}

// 4. Signals after shutdown has begun are ignored.
{
  const h = makeHarness(null);
  h.controller.handleSignal('SIGINT');
  h.controller.handleSignal('SIGINT');
  assert.deepEqual(h.exits, [0], 'Extra signals after exit should be ignored.');
}

// 5. Messages name the activity and the correct interrupt key.
assert.ok(queueMessage('SIGINT', 'journal scan (all scan)').includes('journal scan (all scan)'));
assert.ok(queueMessage('SIGINT', 'x').includes('Ctrl+C'), 'SIGINT queue message should mention Ctrl+C.');
assert.ok(queueMessage('SIGBREAK', 'x').includes('Ctrl+Break'), 'SIGBREAK queue message should mention Ctrl+Break.');
assert.ok(forceMessage('journal scan (all scan)').includes('journal scan (all scan)'));

console.log('Shutdown guard test passed.');
