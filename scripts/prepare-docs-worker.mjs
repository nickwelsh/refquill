import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const ref = process.env.VITE_DOCS_REF || 'main';

// Workers assets use public URL paths, while Waku emits assets relative to basePath.
await rm(new URL('../apps/docs/dist/assets/', import.meta.url), { recursive: true, force: true });
await mkdir(new URL('../apps/docs/dist/assets/', import.meta.url), { recursive: true });
await cp(
    new URL('../apps/docs/dist/public/', import.meta.url),
    new URL('../apps/docs/dist/assets/refquill/', import.meta.url),
    {
        recursive: true,
    },
);
await cp(
    new URL('../apps/docs/dist/public/404.html', import.meta.url),
    new URL('../apps/docs/dist/assets/404.html', import.meta.url),
);
const publicDirectory = new URL('../apps/docs/dist/assets/refquill/', import.meta.url);
await writeFile(
    new URL('build.json', publicDirectory),
    JSON.stringify({
        ref,
        commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    }),
);
const schemaDirectory = new URL('../apps/docs/dist/assets/refquill/schema/', import.meta.url);
await mkdir(schemaDirectory, { recursive: true });
for (const name of ['config', 'document', 'resolved', 'reference']) {
    await cp(
        new URL(`../packages/schema/${name}.schema.json`, import.meta.url),
        new URL(`${name}-v1.json`, schemaDirectory),
    );
}
await writeFile(
    new URL('../apps/docs/dist/assets/_headers', import.meta.url),
    `/refquill/api/search
  Content-Type: application/json; charset=utf-8
/refquill/llms.mdx/*
  Content-Type: text/markdown; charset=utf-8
/refquill/RSC/*
  Content-Type: text/x-component
`,
);
