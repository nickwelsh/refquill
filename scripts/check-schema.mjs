import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileFromFile } from 'json-schema-to-typescript';
import assert from 'node:assert/strict';

const dir = await mkdtemp(join(tmpdir(), 'refquill-schema-'));
try {
  const result = spawnSync('cargo', ['run', '--locked', '--quiet', '--', 'schema', '--output', dir], { stdio: 'inherit' });
  assert.equal(result.status, 0, 'Schema generation failed');
  for (const name of ['document', 'resolved', 'config']) assert.equal(await readFile(join(dir, `${name}.schema.json`), 'utf8'), await readFile(`packages/schema/${name}.schema.json`, 'utf8'), `${name} schema drift; run pnpm schema`);
  for (const name of ['document', 'resolved']) {
    const types = await compileFromFile(join(dir, `${name}.schema.json`), { bannerComment: '// Generated from the Rust model. Run pnpm schema; do not edit.' });
    assert.equal(types, await readFile(`packages/schema/${name}.d.ts`, 'utf8'), 'Type declaration drift; run pnpm schema');
  }
} finally { await rm(dir, { recursive: true, force: true }); }
