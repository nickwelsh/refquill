import { rm } from 'node:fs/promises';

// Waku can retain prerendered routes and hashed assets from previous builds.
// Start each production build with a fresh output directory.
await rm(new URL('../apps/docs/dist/', import.meta.url), { recursive: true, force: true });
