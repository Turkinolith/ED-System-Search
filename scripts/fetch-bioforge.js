// Downloads the Canonn Bioforge species statistics bundled by
// EliteDangerousWarboard (https://github.com/Mirooz/EliteDangerousWarboard, MIT;
// data from https://bioforge.canonn.tech/) into data/bioforge/. Only the genera
// that hold high-value species are fetched. Nothing here is committed.
//
// Usage: node scripts/fetch-bioforge.js [commit-sha]
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileAtomic } from './atomic-file.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '..', 'data', 'bioforge');
const commit = process.argv[2] ?? '647e9e6209fb38594a20996c0231a9660ab2b750';
const base = `https://raw.githubusercontent.com/Mirooz/EliteDangerousWarboard/${commit}/bioforge-biodatas/src/main/resources/species`;

export const bioforgeFiles = Object.freeze([
  'aleoida_150m.json',
  'bacterium_500m.json',
  'cactoida_300m.json',
  'clypeus_150m.json',
  'concha_150m.json',
  'fonticulua_500m.json',
  'fumerola_100m.json',
  'osseus_800m.json',
  'recepta_150m.json',
  'stratum_500m.json',
  'tussock_200m.json',
]);

export async function fetchBioforge() {
  await fs.mkdir(outDir, { recursive: true });
  let bytes = 0;
  for (const [index, file] of bioforgeFiles.entries()) {
    console.log(`PROGRESS\tDownloading Bioforge ${file} (${Math.round((index / bioforgeFiles.length) * 100)}%)`);
    const response = await fetch(`${base}/${file}`, { headers: { 'User-Agent': 'ed-system-search' } });
    if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
    const text = await response.text();
    JSON.parse(text);
    await writeFileAtomic(path.join(outDir, file), text);
    bytes += Buffer.byteLength(text);
  }
  const meta = {
    source: 'Canonn Bioforge statistics via EliteDangerousWarboard (MIT), https://github.com/Mirooz/EliteDangerousWarboard',
    commit,
    files: bioforgeFiles,
    bytes,
    fetchedAt: new Date().toISOString(),
  };
  await writeFileAtomic(path.join(outDir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
  console.log(`Bioforge statistics saved: ${bioforgeFiles.length} files, ${(bytes / 1e6).toFixed(1)} MB.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fetchBioforge().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
