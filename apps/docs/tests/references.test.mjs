import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { createReference } from '@nickwelsh/refquill-fumadocs';
import { createDocsReferences } from '../tooling/references.mjs';

const schemaInputs = Object.fromEntries(
    readdirSync(new URL('../../../packages/schema/', import.meta.url))
        .filter((name) => name.endsWith('.schema.json'))
        .map((filename) => [
            filename.replace('.schema.json', ''),
            JSON.parse(readFileSync(new URL(`../../../packages/schema/${filename}`, import.meta.url), 'utf8')),
        ]),
);
const documents = createDocsReferences({
    schemaInputs,
    manpage: readFileSync(new URL(import.meta.resolve('@nickwelsh/refquill/manpage')), 'utf8'),
    ref: 'v0.1.0',
});

test('all shipped schemas produce validated portable references at their existing URLs', () => {
    assert.equal(documents.size, Object.keys(schemaInputs).length + 1);
    for (const [name, schema] of Object.entries(schemaInputs)) {
        const document = documents.get(name);
        const baseUrl = `/docs/0.x/schemas/${name}`;
        const reference = createReference({ input: document, baseUrl });
        assert.equal(document.children.length, 1);
        const page = document.children[0];
        assert.equal(reference.getUrl(page.id), baseUrl);
        assert.deepEqual(JSON.parse(page.definition.code), schema);
        assert.equal(
            page.sourceUrl,
            `https://github.com/nickwelsh/refquill/blob/v0.1.0/packages/schema/${name}.schema.json`,
        );
        assert.match(reference.getPageText(page.id), /```json/);
        const files = reference.toFumadocsSource().files.filter((file) => file.type === 'page');
        assert.equal(files.length, 1);
        assert.ok(files[0].data.structuredData.contents.length > 0);
        assert.ok(files[0].data.toc.length > 0);
    }
});

test('the packaged CLI manual retains option anchors, searchable text, examples and release source links', () => {
    const document = documents.get('manpage');
    const reference = createReference({ input: document, baseUrl: '/docs/0.x/manpage' });
    const page = document.children[0];
    assert.equal(page.title, 'CLI manual');
    assert.equal(reference.getUrl(page.id), '/docs/0.x/manpage');
    assert.equal(page.sourceUrl, 'https://github.com/nickwelsh/refquill/blob/v0.1.0/packages/cli/man/refquill.1');
    const markdown = reference.getPageText(page.id);
    assert.match(markdown, /refquill generate refquill.json --force/);
    assert.match(markdown, /Exit status/);
    const file = reference.toFumadocsSource().files.find((file) => file.type === 'page');
    assert.ok(file.data.toc.some((entry) => entry.title === '--force'));
    assert.ok(file.data.structuredData.contents.some((entry) => entry.content.includes('REFQUILL_TYPESCRIPT_WORKER')));
});
