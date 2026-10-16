import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { analyze, compilerPath } from '../packages/cli/src/typescript.mjs';

test('compiler paths normalize Windows drive and UNC namespaces for TypeDoc globs', () => {
  assert.equal(compilerPath(String.raw`C:\work\src\index.ts`, 'win32'), 'C:/work/src/index.ts');
  assert.equal(compilerPath(String.raw`\\?\C:\work\src\index.ts`, 'win32'), 'C:/work/src/index.ts');
  assert.equal(compilerPath(String.raw`\\server\share\src\index.ts`, 'win32'), '//server/share/src/index.ts');
  assert.equal(compilerPath(String.raw`\\?\UNC\server\share\src\index.ts`, 'win32'), '//server/share/src/index.ts');
});

test('compiler paths preserve POSIX filenames including literal backslashes', () => {
  const file = String.raw`/work/a\b/index.ts`;
  assert.equal(compilerPath(file, 'linux'), file);
  assert.equal(compilerPath(file, 'darwin'), file);
});

test('namespaced Windows inputs preserve TypeScript symbols and source paths', { skip: process.platform !== 'win32' }, async () => {
  const config = { name: 'frontend', sourceRoot: path.resolve('tests/fixtures'),
    tsconfig: path.resolve('tests/fixtures/typescript/tsconfig.json'),
    entryPoints: [path.resolve('tests/fixtures/typescript/index.ts')], exclude: [], includeProtected: false };
  const ordinary = await analyze(config);
  const namespaced = await analyze({ ...config, sourceRoot: path.toNamespacedPath(config.sourceRoot),
    tsconfig: path.toNamespacedPath(config.tsconfig), entryPoints: config.entryPoints.map(file => path.toNamespacedPath(file)) });
  assert.deepEqual(namespaced, ordinary);
  assert.ok(namespaced.symbols.some(symbol => symbol.source?.file === 'typescript/index.ts'));
});
