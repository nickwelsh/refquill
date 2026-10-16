import { compileFromFile } from 'json-schema-to-typescript';
import { writeFile } from 'node:fs/promises';

for (const name of ['document', 'resolved']) {
  await writeFile(`packages/schema/${name}.d.ts`, await compileFromFile(`packages/schema/${name}.schema.json`, { bannerComment: '// Generated from the Rust model. Run pnpm schema; do not edit.' }));
}
