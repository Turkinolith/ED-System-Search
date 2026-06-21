import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.dirname(__dirname);
const exeName = process.platform === 'win32' ? 'ed-data-importer.exe' : 'ed-data-importer';
const nativeExe = path.join(rootDir, 'native', 'ed-data-importer', 'target', 'release', exeName);
const mode = process.argv[2];
const args = process.argv.slice(3);

if (!['full', 'delta', 'galaxy', 'galaxy-delta', 'murder-binaries', 'murder-index', 'spatial-index'].includes(mode)) {
  console.error('Usage: node scripts/run-native-importer.js <full|delta|galaxy|galaxy-delta|murder-binaries|murder-index|spatial-index> --source <path-or-url>');
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
  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
  child.on('error', (error) => {
    console.error(error);
    process.exit(1);
  });
}

if (existsSync(nativeExe)) {
  run(nativeExe, [mode, ...args]);
} else {
  if (mode === 'galaxy' || mode === 'galaxy-delta' || mode === 'murder-binaries' || mode === 'murder-index' || mode === 'spatial-index') {
    console.error('The rich galaxy importer requires the native Rust executable. Run npm run native:build first.');
    process.exit(1);
  }
  console.warn(`Native importer not built at ${nativeExe}; falling back to JS importer.`);
  const source = argValue('--source', mode === 'full' ? 'systems.json.gz' : 'systems_1month.json.gz');
  const script = mode === 'full' ? 'scripts/import-systems.js' : 'scripts/import-systems-delta.js';
  const nodeArgs = mode === 'delta'
    ? ['--max-old-space-size=98304', script, source]
    : [script, source];
  run(process.execPath, nodeArgs);
}
