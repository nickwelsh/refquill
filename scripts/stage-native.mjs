import { mkdir, copyFile, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';

const binary = process.platform === 'win32' ? 'refquill.exe' : 'refquill';
const source = resolve(process.argv[2] ?? `target/debug/${binary}`);
await mkdir('packages/cli/native', { recursive: true });
await copyFile(source, `packages/cli/native/${binary}`);
await chmod(`packages/cli/native/${binary}`, 0o755);
