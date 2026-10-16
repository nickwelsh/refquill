import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const compiler = spawnSync('rustc', ['-vV'], { cwd, encoding: 'utf8' });
if (compiler.error) throw compiler.error;
const host = /^host: (.+)$/m.exec(compiler.stdout)?.[1];
if (!host) throw new Error('Cannot determine the Rust compiler host');
const metadata = spawnSync('cargo', ['metadata', '--locked', '--format-version', '1', '--filter-platform', host], {
  cwd, encoding: 'utf8',
});
if (metadata.error) throw metadata.error;
if (metadata.status !== 0) {
  process.stderr.write(metadata.stderr);
  process.exit(metadata.status ?? 1);
}
// Pin registry dependency links to the versions Cargo selected for this build.
const roots = JSON.parse(metadata.stdout).packages
  .filter(pkg => pkg.source?.startsWith('registry+'))
  .flatMap(pkg => pkg.targets.filter(target => target.kind.some(kind => ['lib', 'proc-macro'].includes(kind)))
    .map(target => `--extern-html-root-url=${target.name}=https://docs.rs/${pkg.name}/${pkg.version}/`));

// Cargo doc also emits companion dependency JSON, which Refquill uses to
// inherit trait method descriptions omitted from implementation items.
const result = spawnSync('cargo', [
  'doc', '--locked', '--package', 'refquill', '--lib',
], {
  cwd,
  env: { ...process.env, RUSTC_BOOTSTRAP: '1',
    CARGO_ENCODED_RUSTDOCFLAGS: ['-Z', 'unstable-options', '--output-format', 'json', ...roots].join('\x1f') },
  stdio: 'inherit',
});

if (result.error) throw result.error;
if (result.signal) process.kill(process.pid, result.signal);
else process.exitCode = result.status ?? 1;
