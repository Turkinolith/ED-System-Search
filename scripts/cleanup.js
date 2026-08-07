import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanupJunkFiles, describeCleanup } from './cleanup-junk.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.dirname(__dirname);
const dataDir = process.env.EDSS_DATA_DIR ? path.resolve(process.env.EDSS_DATA_DIR) : path.join(rootDir, 'data');

const args = process.argv.slice(2);
const supportedArgs = new Set(['--dry-run', '--include-dumps', '--include-partials']);
const unknownArgs = args.filter((arg) => !supportedArgs.has(arg));
if (unknownArgs.length) {
  console.error(`Unknown cleanup option(s): ${unknownArgs.join(', ')}`);
  process.exit(1);
}
const dryRun = args.includes('--dry-run');
const includeDumps = args.includes('--include-dumps');
const includePartials = args.includes('--include-partials');

cleanupJunkFiles({ rootDir, dataDir, dryRun, includeDumps, includePartials })
  .then((result) => {
    console.log(describeCleanup(result, { dryRun }));
    if (result.errors.length) process.exitCode = 1;
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
