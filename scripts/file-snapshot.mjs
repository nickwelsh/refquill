import { open } from 'node:fs/promises';

// Read bytes and metadata from the same open file. Reopen for each snapshot so
// replacing an artifact is visible to the unchanged-generation checks too.
export async function fileSnapshot(path) {
  const file = await open(path, 'r');
  try {
    return { bytes: await file.readFile(), mtimeMs: (await file.stat()).mtimeMs };
  } finally {
    await file.close();
  }
}
