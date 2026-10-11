// Gets everything the high-value bio scan needs: the Bioforge statistics
// (downloaded once), the region raster, and a fresh data/bio-model.json.
//
// Usage: node scripts/prepare-bio-model.js [--refresh-bioforge]
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchBioforge } from './fetch-bioforge.js';
import { buildRegionRaster } from './build-region-raster.js';
import { writeBioModel } from './build-bio-model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');

const newer = (a, b) => existsSync(a) && (!existsSync(b) || statSync(a).mtimeMs > statSync(b).mtimeMs);

async function main() {
  if (process.argv.includes('--refresh-bioforge') || !existsSync(path.join(dataDir, 'bioforge', 'meta.json'))) {
    await fetchBioforge();
  }
  const vectors = path.join(dataDir, 'region-map-vectors.json');
  const raster = path.join(dataDir, 'region-raster.bin');
  if (!existsSync(vectors) && !existsSync(raster)) {
    throw new Error('Region data is missing. Run npm run import:regions first.');
  }
  if (newer(vectors, raster)) {
    console.log('PROGRESS\tBuilding region raster');
    await buildRegionRaster();
  }
  console.log('PROGRESS\tBuilding species model');
  await writeBioModel();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
