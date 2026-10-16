import { cp, mkdir, readFile, readdir, writeFile, chmod, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const platforms = ['darwin-arm64', 'linux-arm64', 'linux-x64', 'win32-x64'];
const input = resolve(process.argv[2] ?? '.release/binaries');
const output = resolve(process.argv[3] ?? '.release/packages');
const cli = JSON.parse(await readFile('packages/cli/package.json', 'utf8'));
const version = cli.version;
const rustVersion = (await readFile('Cargo.toml', 'utf8')).match(/^version = "([^"]+)"$/m)?.[1];
if (rustVersion !== version) throw new Error('Rust and npm package versions must match');
for (const name of ['schema', 'fumadocs']) {
  const manifest = JSON.parse(await readFile(`packages/${name}/package.json`, 'utf8'));
  if (manifest.version !== version) throw new Error('All Refquill packages must have the same release version');
}
// Verify every native executable before preparing a publishable package set.
for (const platform of platforms) {
  const file = join(input, platform, platform.startsWith('win32') ? 'refquill.exe' : 'refquill');
  await readFile(file);
}
await mkdir(output, { recursive: true });
const expected = new Set(['refquill', 'refquill-schema', 'refquill-fumadocs', ...platforms.map(platform => `refquill-${platform}`)]
  .map(name => `nickwelsh-${name}-${version}.tgz`));
const stale = (await readdir(output)).filter(name => name.endsWith('.tgz') && !expected.has(name));
if (stale.length) throw new Error(`Release output contains archives from another release: ${stale.join(', ')}. Use an empty output directory.`);
const staging = await mkdtemp(join(tmpdir(), 'refquill-pack-'));
try {
async function pack(directory, manifest, readme) {
  await writeFile(join(directory, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  await cp('LICENSE', join(directory, 'LICENSE'));
  await writeFile(join(directory, 'README.md'), readme);
  const result = spawnSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', output], { cwd: directory, encoding: 'utf8', shell: process.platform === 'win32', env: { ...process.env, npm_config_cache: join(staging, '.npm-cache') } });
  if (result.status !== 0) throw new Error(result.stderr || 'npm pack failed');
  console.log(JSON.parse(result.stdout)[0].filename);
}
for (const platform of platforms) {
  const [os, cpu] = platform.split('-');
  const binary = os === 'win32' ? 'refquill.exe' : 'refquill';
  const directory = join(staging, platform);
  await mkdir(directory, { recursive: true });
  await cp(join(input, platform, binary), join(directory, binary));
  await chmod(join(directory, binary), 0o755);
  await pack(directory, { name: `@nickwelsh/refquill-${platform}`, version, license: 'MIT', description: `Refquill native executable for ${platform}`, repository: { type: 'git', url: 'git+https://github.com/nickwelsh/refquill.git' }, homepage: 'https://docs.nickwelsh.me/refquill/', bugs: { url: 'https://github.com/nickwelsh/refquill/issues' }, publishConfig: { access: 'public' }, os: [os], cpu: [cpu], files: [binary], exports: { [`./${binary}`]: `./${binary}` } }, `# Refquill for ${platform}\n\nNative executable installed automatically by [@nickwelsh/refquill](https://www.npmjs.com/package/@nickwelsh/refquill). Install the CLI package to use Refquill.\n\n[Documentation](https://docs.nickwelsh.me/refquill/) · [Source](https://github.com/nickwelsh/refquill).\n`);
}
for (const name of ['schema', 'cli', 'fumadocs']) {
  const directory = join(staging, name);
  const manifest = JSON.parse(await readFile(`packages/${name}/package.json`, 'utf8'));
  await mkdir(directory, { recursive: true });
  if (name === 'cli') {
    await cp('packages/cli/bin', join(directory, 'bin'), { recursive: true });
    await cp('packages/cli/src', join(directory, 'src'), { recursive: true });
    await cp('packages/cli/man', join(directory, 'man'), { recursive: true });
    // Never ship a locally staged binary that bypasses platform selection.
    manifest.files = ['bin', 'src', 'man'];
    manifest.optionalDependencies = Object.fromEntries(platforms.map(platform => [`@nickwelsh/refquill-${platform}`, version]));
  } else if (name === 'schema') {
    for (const file of ['document.schema.json', 'config.schema.json', 'resolved.schema.json', 'reference.schema.json', 'document.d.ts', 'resolved.d.ts', 'reference.d.ts', 'index.d.ts', 'index.js', 'reference.js', 'json.js']) await cp(`packages/schema/${file}`, join(directory, file));
  } else {
    await cp('packages/fumadocs/dist', join(directory, 'dist'), { recursive: true });
    await cp('packages/fumadocs/THIRD_PARTY_NOTICES', join(directory, 'THIRD_PARTY_NOTICES'));
    await mkdir(join(directory, 'src'), { recursive: true });
    await cp('packages/fumadocs/src/style.css', join(directory, 'src/style.css'));
  }
  for (const dependencies of [manifest.dependencies, manifest.devDependencies]) {
    for (const [dependency, range] of Object.entries(dependencies ?? {})) if (range.startsWith('workspace:')) dependencies[dependency] = version;
  }
  delete manifest.devDependencies;
  delete manifest.scripts;
  await pack(directory, manifest, await readFile(`packages/${name}/README.md`, 'utf8'));
}
} finally { await rm(staging, { recursive: true, force: true }); }
