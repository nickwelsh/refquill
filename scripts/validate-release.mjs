import assert from 'node:assert/strict';
import { appendFile, readFile } from 'node:fs/promises';

// Release tags and every published package share the workspace Cargo version.
const cargo = await readFile('Cargo.toml', 'utf8');
const version = cargo.match(/\[workspace\.package\]\s*\nversion = "([^"]+)"/)?.[1];
assert.ok(version, 'Cargo.toml must declare the workspace package version');
assert.match(version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?$/, 'The release version must be npm-compatible SemVer');
assert.equal(process.argv[2], `v${version}`, 'Release tag must match the package version exactly');
for (const name of ['cli', 'schema', 'fumadocs']) {
  const manifest = JSON.parse(await readFile(`packages/${name}/package.json`, 'utf8'));
  assert.equal(manifest.version, version, `${manifest.name} version must match Cargo`);
  assert.equal(manifest.name, name === 'cli' ? '@nickwelsh/refquill' : `@nickwelsh/refquill-${name}`, 'Public packages must use their @nickwelsh names');
}
const crate = await readFile('crates/refquill/Cargo.toml', 'utf8');
assert.match(crate, /^version\.workspace = true$/m, 'The CLI crate must inherit the workspace version');
const lock = await readFile('Cargo.lock', 'utf8');
assert.equal(lock.match(/\[\[package\]\]\s*\nname = "refquill"\s*\nversion = "([^"]+)"/)?.[1], version, 'Cargo.lock must match the release version');
const npmTag = version.includes('-') ? 'next' : 'latest';
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `npm-tag=${npmTag}\n`);
console.log(`Validated v${version}; npm dist-tag: ${npmTag}`);
