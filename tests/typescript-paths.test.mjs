import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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

test('directory entry points retain nested TypeScript exports and respect exclusions', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'refquill-typescript-paths-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const file of ['src/index.ts', 'src/nested/child.ts', 'src/nested/deep/leaf.ts', 'src/nested/excluded.ts', 'other/outside.ts']) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), `export const ${path.basename(file, '.ts')} = 42;\n`);
  }
  await writeFile(path.join(root, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { strict: true, target: 'ES2022', module: 'NodeNext', skipLibCheck: true },
    include: ['**/*.ts'],
  }));
  const { symbols } = await analyze({ name: 'nested', sourceRoot: root,
    tsconfig: path.join(root, 'tsconfig.json'), entryPoints: [path.join(root, 'src')],
    exclude: ['**/excluded.ts'], includeProtected: false });
  const exports = symbols.filter(symbol => symbol.kind === 'variable');
  assert.deepEqual(exports.map(symbol => symbol.name).sort(), ['child', 'index', 'leaf']);
  assert.equal(exports.find(symbol => symbol.name === 'leaf').source.file, 'src/nested/deep/leaf.ts');
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
