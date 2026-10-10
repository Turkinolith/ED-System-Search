import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSecretStore } from '../secret-store.js';

const secret = JSON.stringify({ apiKey: 'sk-test "quoted" ünïcode', baseUrl: 'https://api.example.com' });

// A fake command runner standing in for security / secret-tool / powershell.
// It records every call so the tests can check secrets never reach argv.
function fakeRunner(handler) {
  const calls = [];
  const run = async (command, args, input = '') => {
    calls.push({ command, args, input });
    return handler(command, args, input);
  };
  return { run, calls };
}

function assertSecretNotInArgs(calls) {
  for (const call of calls) {
    const joined = call.args.join(' ');
    assert.ok(!joined.includes('sk-test'), `${call.command} received the secret as an argument`);
    assert.ok(!joined.includes(Buffer.from(secret).toString('base64')), `${call.command} received the encoded secret as an argument`);
  }
}

// macOS Keychain
{
  const items = new Map();
  const { run, calls } = fakeRunner((command, args, input) => {
    assert.equal(command, 'security');
    if (args[0] === '-i') {
      const match = input.match(/^add-generic-password -U -a (\S+) -s (\S+) -w (\S+)\n$/);
      assert.ok(match, `unexpected interactive input: ${input}`);
      items.set(match[1], match[3]);
      return { code: 0, stdout: '', stderr: '' };
    }
    const account = args[args.indexOf('-a') + 1];
    if (args[0] === 'find-generic-password') {
      if (!items.has(account)) return { code: 44, stdout: '', stderr: 'could not be found' };
      return { code: 0, stdout: args.includes('-w') ? `${items.get(account)}\n` : '', stderr: '' };
    }
    if (args[0] === 'delete-generic-password') {
      return items.delete(account) ? { code: 0, stdout: '', stderr: '' } : { code: 44, stdout: '', stderr: 'not found' };
    }
    throw new Error(`unexpected security call ${args.join(' ')}`);
  });
  const store = createSecretStore({ platform: 'darwin', run, fallbackFile: 'unused' });
  assert.equal((await store.info()).name, 'macos-keychain');
  await store.set('llm-anthropic', secret);
  assert.equal(await store.get('llm-anthropic'), secret);
  assert.deepEqual(await store.getMany(['llm-anthropic', 'llm-openai']), [secret, null]);
  await store.delete('llm-anthropic');
  await store.delete('llm-anthropic');
  assert.equal(await store.get('llm-anthropic'), null);
  assertSecretNotInArgs(calls);
  assert.ok(calls.some((call) => call.args[0] === '-i' && call.input.includes(Buffer.from(secret).toString('base64'))), 'secret should travel on stdin');
}

// Linux Secret Service
{
  const items = new Map();
  const { run, calls } = fakeRunner((command, args, input) => {
    assert.equal(command, 'secret-tool');
    const account = args[args.indexOf('account') + 1];
    if (args[0] === 'lookup') {
      return items.has(account) ? { code: 0, stdout: items.get(account), stderr: '' } : { code: 1, stdout: '', stderr: '' };
    }
    if (args[0] === 'store') {
      items.set(account, input);
      return { code: 0, stdout: '', stderr: '' };
    }
    if (args[0] === 'clear') {
      items.delete(account);
      return { code: 0, stdout: '', stderr: '' };
    }
    throw new Error(`unexpected secret-tool call ${args.join(' ')}`);
  });
  const store = createSecretStore({ platform: 'linux', run, fallbackFile: 'unused' });
  assert.equal((await store.info()).name, 'linux-secret-service');
  await store.set('llm-openai', secret);
  assert.deepEqual(await store.getMany(['llm-openai', 'llm-kobold']), [secret, null]);
  await store.delete('llm-openai');
  assert.equal(await store.get('llm-openai'), null);
  assertSecretNotInArgs(calls);
}

// Windows: operations, secrets included, are sent as JSON on stdin.
{
  const items = new Map();
  const { run, calls } = fakeRunner((command, args, input) => {
    assert.equal(command, 'powershell.exe');
    assert.ok(args.includes('-EncodedCommand'));
    const results = JSON.parse(input).map((operation) => {
      if (operation.op === 'get') return { ok: true, value: items.get(operation.target) ?? null };
      if (operation.op === 'set') {
        items.set(operation.target, operation.secret);
        return { ok: true };
      }
      return { ok: true, deleted: items.delete(operation.target) };
    });
    return { code: 0, stdout: JSON.stringify(results), stderr: '' };
  });
  const store = createSecretStore({ platform: 'win32', run, fallbackFile: 'unused' });
  assert.equal((await store.info()).name, 'windows-credential-manager');
  await store.set('llm-anthropic', secret);
  assert.deepEqual(await store.getMany(['llm-anthropic', 'llm-openai']), [secret, null]);
  assert.ok(items.has('ed-system-search/llm-anthropic'));
  await store.delete('llm-anthropic');
  assert.equal(await store.get('llm-anthropic'), null);
  assertSecretNotInArgs(calls);
}

// Falls back to the plain-text file when the platform store is unusable
// (here: secret-tool reports no reachable Secret Service).
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'edss-secrets-'));
try {
  const fallbackFile = path.join(tempDir, 'llm-keys.local.json');
  const { run } = fakeRunner(() => ({ code: 1, stdout: '', stderr: 'Cannot autolaunch D-Bus without X11 $DISPLAY' }));
  const store = createSecretStore({ platform: 'linux', run, fallbackFile });
  const info = await store.info();
  assert.equal(info.name, 'plain-file');
  assert.equal(info.secure, false);
  assert.match(info.reason, /D-Bus/);
  await store.set('llm-openai', secret);
  assert.equal(await store.get('llm-openai'), secret);
  await store.delete('llm-openai');
  assert.equal(await store.get('llm-openai'), null);

  const missing = createSecretStore({
    platform: 'darwin',
    run: async () => { throw Object.assign(new Error('spawn security ENOENT'), { code: 'ENOENT' }); },
    fallbackFile,
  });
  assert.equal((await missing.info()).name, 'plain-file');
  assert.equal((await createSecretStore({ platform: 'freebsd', fallbackFile }).info()).name, 'plain-file');
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}

console.log('Secret store checks passed.');
