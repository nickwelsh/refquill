import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createDocsReferences } from './references.mjs';

const schemaInputs = Object.fromEntries(
    await Promise.all(
        ['config', 'document', 'resolved', 'reference'].map(async (name) => [
            name,
            JSON.parse(
                await readFile(new URL(`../../../packages/schema/${name}.schema.json`, import.meta.url), 'utf8'),
            ),
        ]),
    ),
);
const references = createDocsReferences({
    schemaInputs,
    manpage: await readFile(new URL(import.meta.resolve('@nickwelsh/refquill/manpage')), 'utf8'),
    ref: process.env.VITE_DOCS_REF || 'main',
});
await mkdir(new URL('../generated/', import.meta.url), { recursive: true });
for (const [name, document] of references) {
    await writeFile(new URL(`../generated/${name}.reference.json`, import.meta.url), JSON.stringify(document));
}
