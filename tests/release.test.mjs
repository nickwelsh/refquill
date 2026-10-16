import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const validate = resolve('scripts/validate-release.mjs');
const pack = resolve('scripts/package-release.mjs');
async function fixture(t, version = '0.1.0') {
  const cwd = await mkdtemp(join(tmpdir(), 'refquill-release-test-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(join(cwd, 'crates/refquill'), { recursive: true });
  await writeFile(join(cwd, 'Cargo.toml'), `[workspace.package]\nversion = "${version}"\n`);
  await writeFile(join(cwd, 'Cargo.lock'), `[[package]]\nname = "refquill"\nversion = "${version}"\n`);
  await writeFile(join(cwd, 'crates/refquill/Cargo.toml'), 'version.workspace = true\n');
  for (const name of ['cli', 'schema', 'fumadocs']) {
    await mkdir(join(cwd, 'packages', name), { recursive: true });
    await writeFile(join(cwd, 'packages', name, 'package.json'), JSON.stringify({ name: name === 'cli' ? '@nickwelsh/refquill' : `@nickwelsh/refquill-${name}`, version }));
  }
  return cwd;
}
const run = (script, cwd, ...args) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });

test('release validation selects stable and prerelease npm tags only for exact aligned versions', async t => {
  for (const [version, tag] of [['0.1.0', 'latest'], ['0.1.0-beta.1', 'next']]) {
    const cwd = await fixture(t, version);
    const output = join(cwd, 'github-output');
    const result = spawnSync(process.execPath, [validate, `v${version}`], { cwd, encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: output } });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(output, 'utf8'), `npm-tag=${tag}\n`);
    assert.notEqual(run(validate, cwd, `v${version}-wrong`).status, 0);
  }
});

test('release validation rejects stale manifests, lockfiles, crate versions, and package identities', async t => {
  const mutations = [
    ['packages/cli/package.json', JSON.stringify({ name: '@nickwelsh/refquill', version: '0.2.0' }), /version must match Cargo/],
    ['packages/schema/package.json', JSON.stringify({ name: '@other/schema', version: '0.1.0' }), /Public packages must use/],
    ['Cargo.lock', '[[package]]\nname = "refquill"\nversion = "0.2.0"\n', /Cargo.lock must match/],
    ['crates/refquill/Cargo.toml', 'version = "0.1.0"\n', /must inherit/],
    ['Cargo.toml', '[workspace.package]\nversion = "01.1.0"\n', /npm-compatible SemVer/],
  ];
  for (const [file, contents, diagnostic] of mutations) {
    const cwd = await fixture(t);
    await writeFile(join(cwd, file), contents);
    const result = run(validate, cwd, 'v0.1.0');
    assert.notEqual(result.status, 0, file);
    assert.match(result.stderr, diagnostic);
  }
});

test('packaging rejects incomplete binary sets and stale release archives before packing', async t => {
  const cwd = await fixture(t);
  const missing = run(pack, cwd);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /ENOENT/);
  for (const platform of ['darwin-arm64', 'linux-arm64', 'linux-x64', 'win32-x64']) {
    const directory = join(cwd, '.release/binaries', platform);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, platform.startsWith('win32') ? 'refquill.exe' : 'refquill'), 'fixture');
  }
  const output = join(cwd, '.release/packages');
  await mkdir(output, { recursive: true });
  await writeFile(join(output, 'nickwelsh-refquill-0.0.1.tgz'), 'old archive');
  const stale = run(pack, cwd);
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /archives from another release/);
  assert.deepEqual(await readdir(output), ['nickwelsh-refquill-0.0.1.tgz']);
  assert.equal(await readFile(join(output, 'nickwelsh-refquill-0.0.1.tgz'), 'utf8'), 'old archive');
});
