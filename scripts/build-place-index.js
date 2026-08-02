import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlaceIndex } from './place-index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.dirname(__dirname);
const dataDir = process.env.EDSS_DATA_DIR ? path.resolve(process.env.EDSS_DATA_DIR) : path.join(rootDir, 'data');

buildPlaceIndex(dataDir).then((meta) => {
  const categories = meta.summary.categoryDetails.filter((entry) => entry.file).length;
  const regular = meta.summary.categoryDetails.filter((entry) => entry.file).reduce((sum, entry) => sum + entry.count, 0);
  console.log(`Indexed ${regular.toLocaleString()} places across ${categories.toLocaleString()} lazy-load categories.`);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
