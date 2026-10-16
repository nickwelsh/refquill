#!/usr/bin/env node
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const executable = process.platform === 'win32' ? 'refquill.exe' : 'refquill';
const local = fileURLToPath(new URL(`../native/${executable}`, import.meta.url));
let binary = process.env.REFQUILL_BINARY;
if (!binary) {
  if (existsSync(local)) binary = local;
  else {
    try { binary = require.resolve(`@nickwelsh/refquill-${process.platform}-${process.arch}/${executable}`); }
    catch {
      console.error(`No Refquill binary is installed for ${process.platform}/${process.arch}. Install with optional dependencies enabled, or build from source with pnpm build. Supported: macOS arm64 (Apple Silicon), Linux arm64/x64, Windows x64.`);
      process.exit(1);
    }
  }
}
const result = spawnSync(binary, process.argv.slice(2), {
  stdio: 'inherit',
  env: { ...process.env, REFQUILL_TYPESCRIPT_WORKER: fileURLToPath(new URL('../src/typescript.mjs', import.meta.url)), REFQUILL_NODE: process.execPath },
});
if (result.error) { console.error(`Cannot run Refquill: ${result.error.message}`); process.exit(1); }
if (result.signal) { process.kill(process.pid, result.signal); }
else process.exit(result.status ?? 1);
