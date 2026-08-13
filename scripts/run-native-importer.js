import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startImportActivity } from './import-activity.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.dirname(__dirname);
const exeName = process.platform === 'win32' ? 'ed-data-importer.exe' : 'ed-data-importer';
const nativeExe = path.join(rootDir, 'native', 'ed-data-importer', 'target', 'release', exeName);
const dataDir = process.env.EDSS_DATA_DIR ? path.resolve(process.env.EDSS_DATA_DIR) : path.join(rootDir, 'data');
const mode = process.argv[2];
const args = process.argv.slice(3);

if (!['full', 'delta', 'galaxy', 'galaxy-delta', 'galaxy-repack', 'galaxy-filters', 'green-gas-giants', 'murder-binaries', 'murder-index', 'spatial-index'].includes(mode)) {
  console.error('Usage: node scripts/run-native-importer.js <full|delta|galaxy|galaxy-delta|galaxy-repack|galaxy-filters|green-gas-giants|murder-binaries|murder-index|spatial-index> [--source <path-or-url>]');
  process.exit(1);
}

function argValue(name, fallback) {
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  const bareSource = args.find((arg) => !arg.startsWith('--'));
  return bareSource ?? fallback;
}

function run(command, commandArgs) {
  const child = spawn(command, commandArgs, {
    cwd: rootDir,
    stdio: 'inherit',
  });
  const completed = new Promise((resolve, reject) => {
    let settled = false;
    child.on('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      resolve({ code, signal });
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
  return { child, completed };
}

async function main() {
  let command;
  let commandArgs;
  if (existsSync(nativeExe)) {
    command = nativeExe;
    commandArgs = [mode, ...args];
  } else {
    if (mode === 'galaxy' || mode === 'galaxy-delta' || mode === 'galaxy-repack' || mode === 'galaxy-filters' || mode === 'green-gas-giants' || mode === 'murder-binaries' || mode === 'murder-index' || mode === 'spatial-index') {
      throw new Error('The rich galaxy importer requires the native Rust executable. Run npm run native:build first.');
    }
    console.warn(`Native importer not built at ${nativeExe}; falling back to JS importer.`);
    const source = argValue('--source', mode === 'full' ? 'systems.json.gz' : 'systems_1month.json.gz');
    const script = mode === 'full' ? 'scripts/import-systems.js' : 'scripts/import-systems-delta.js';
    command = process.execPath;
    commandArgs = mode === 'delta'
      ? ['--max-old-space-size=98304', script, source]
      : [script, source];
  }

  const activity = await startImportActivity(dataDir, `${mode} import`);
  let outcome;
  try {
    const childRun = run(command, commandArgs);
    await activity.trackProcess(childRun.child.pid).catch((error) => {
      console.warn(`Could not record importer worker PID: ${error.message}`);
    });
    outcome = await childRun.completed;
  } finally {
    await activity.close().catch((error) => {
      console.warn(`Could not close import activity marker ${activity.path}: ${error.message}`);
    });
  }
  if (outcome.signal) {
    process.kill(process.pid, outcome.signal);
    return;
  }
  process.exitCode = outcome.code ?? 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
