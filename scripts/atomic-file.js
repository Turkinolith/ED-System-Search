import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

export async function writeFileAtomic(filePath, data, options) {
  const tempPath = `${filePath}.${process.pid}-${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tempPath, data, options);
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => null);
    throw error;
  }
}
