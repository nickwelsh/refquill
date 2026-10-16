import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { loader } from 'fumadocs-core/source';
import { jsonSchemaAnchor, parseReferenceDocument } from '@nickwelsh/refquill-fumadocs';
import { createJsonSchemaSource } from '../src/lib/json-schema-reference.ts';

const source = loader({ source: createJsonSchemaSource(['0.x']), baseUrl: '/docs' });

void test('every shipped JSON Schema has a reference page with the original schema and source link', () => {
    const filenames = readdirSync(new URL('../../../packages/schema/', import.meta.url))
        .filter((name) => name.endsWith('.schema.json'))
        .toSorted();
    const pages = source.getPages();
    assert.equal(pages.length, filenames.length);
    assert.deepEqual(pages.map((page) => `${page.slugs.at(-1)}.schema.json`).toSorted(), filenames);
    for (const filename of filenames) {
        const name = filename.replace('.schema.json', '');
        const page = source.getPage(['0.x', 'schemas', name]);
        assert.ok(page);
        const original: unknown = JSON.parse(
            readFileSync(new URL(`../../../packages/schema/${filename}`, import.meta.url), 'utf8'),
        );
        assert.deepEqual(page.data.reference.schema, original);
        assert.equal(page.data.reference.baseUrl, page.url);
        assert.equal(
            page.data.reference.sourceUrl,
            `https://github.com/nickwelsh/refquill/blob/main/packages/schema/${filename}`,
        );
        assert.ok(page.data.reference.getPageText().includes('```json'));
        assert.deepEqual(JSON.parse(page.data.reference.code), original);
    }
});

void test('schema pages retain searchable properties, required fields, and local definition links', () => {
    const config = source.getPage(['0.x', 'schemas', 'config']);
    assert.ok(config);
    assert.ok(config.data.structuredData.contents.some((item) => item.content.includes('includeProtected')));
    assert.equal(config.data.reference.root.children.find((node) => node.name === 'output')?.required, true);
    assert.equal(config.data.reference.resolveRef('#/$defs/Input'), `#${jsonSchemaAnchor('/$defs/Input')}`);
    assert.ok(config.data.toc.some((item) => item.url === `#${jsonSchemaAnchor('/$defs/Input')}`));

    const document = source.getPage(['0.x', 'schemas', 'document']);
    assert.ok(document);
    assert.equal(
        document.data.reference.resolveRef('#/$defs/CompactSymbol'),
        `#${jsonSchemaAnchor('/$defs/CompactSymbol')}`,
    );
    assert.ok(document.data.structuredData.contents.some((item) => item.content.includes('fingerprint')));

    const resolved = source.getPage(['0.x', 'schemas', 'resolved']);
    assert.ok(resolved);
    assert.equal(resolved.data.reference.resolveRef('#/$defs/Symbol'), `#${jsonSchemaAnchor('/$defs/Symbol')}`);
});

void test('schema navigation, search, Markdown and rendering consume the validated shared reference document', () => {
    for (const page of source.getPages()) {
        const { rendering, nodeId, reference } = page.data;
        assert.equal(parseReferenceDocument(rendering.document), rendering.document);
        const node = rendering.getNode(nodeId);
        assert.equal(rendering.getUrl(nodeId), page.url);
        assert.equal(node.definition?.code, reference.code);
        assert.equal(node.sourceUrl, reference.sourceUrl);
        assert.equal(node.description?.includes(page.data.description), true);
        const file = rendering.toFumadocsSource().files.find((candidate) => candidate.type === 'page');
        assert.ok(file?.type === 'page');
        assert.deepEqual(page.data.toc, file.data.toc);
        assert.deepEqual(page.data.structuredData, file.data.structuredData);
        assert.ok(rendering.getPageText(nodeId).includes('```json'));
        assert.ok(node.definition.links);
        assert.ok(node.definition.links.length > 0);
        for (const link of node.definition.links) {
            const text: unknown = JSON.parse(reference.code.slice(link.start, link.end));
            assert.equal(typeof text, 'string');
            assert.ok(String(text).startsWith('#'));
            assert.equal(link.url?.startsWith('#schema-'), true);
        }
    }
});
