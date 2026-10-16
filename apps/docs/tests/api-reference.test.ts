// oxlint-disable vitest/require-hook, vitest/no-conditional-in-test -- node:test shares the generated graph and checks optional source and anchor metadata.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loader } from 'fumadocs-core/source';
import { collectReferencePage, parseReferenceDocument } from '@nickwelsh/refquill-fumadocs';
import { createApiSource, getApiPreviewTargets } from '../src/lib/api-reference.ts';
import { getDocsSections } from '../src/lib/docs-navigation.ts';

const input: unknown = JSON.parse(readFileSync(new URL('../src/generated/api.json', import.meta.url), 'utf8'));
const source = loader({ source: createApiSource(input, ['0.x']), baseUrl: '/docs' });
const overview = source.getPage(['0.x', 'api']);
assert.ok(overview);
const { reference } = overview.data;

void test('the reference documents the Rust crate and both workspace packages with unique routes', () => {
    const pages = source.getPages();
    assert.equal(new Set(pages.map((page) => page.url)).size, pages.length);
    assert.equal(overview.data.title, 'Refquill API reference');
    for (const name of ['fumadocs', 'refquill', 'schema']) {
        assert.equal(source.getPage(['0.x', 'api', name])?.data.inputName, name);
    }
    assert.deepEqual([...new Set(reference.document.symbols.map((symbol) => symbol.api))].toSorted(), [
        'fumadocs',
        'refquill',
        'schema',
    ]);
    for (const [api, names] of [
        [
            'fumadocs',
            [
                'createApiReference',
                'ApiReference',
                'ApiReferenceProps',
                'transformerApiReference',
                'ApiReferenceHeaderProps',
            ],
        ],
        ['schema', ['parseDocument', 'resolveDocument', 'Document', 'ResolvedDocument', 'Symbol', 'CompactSymbol']],
    ] as const) {
        for (const name of names) {
            assert.ok(
                reference.document.symbols.some(
                    (symbol) => symbol.api === api && symbol.name === name && symbol.parentId === null,
                ),
                `${api} exports ${name}`,
            );
        }
    }
});

void test('every generated symbol has a routable owning page and member anchors exist', () => {
    for (const symbol of reference.document.symbols) {
        const [pathname, anchor] = reference.getUrl(symbol.id).split('#');
        assert.ok(typeof pathname === 'string');
        const page = source.getPageByUrl(pathname);
        assert.ok(page, `${symbol.name} has a page`);
        if (anchor !== undefined) {
            assert.ok(
                page.data.toc.some((item) => item.url === `#${anchor}`),
                `${symbol.name} has its member anchor`,
            );
        }
    }
});

void test('generated pages provide Markdown, search content, and repository source links', () => {
    const symbol = reference.document.symbols.find(
        (item) => item.api === 'fumadocs' && item.name === 'createApiReference',
    );
    assert.ok(symbol);
    const page = source.getPageByUrl(reference.getUrl(symbol.id));
    assert.ok(page);
    assert.match(reference.getPageText(page.data), /createApiReference/u);
    assert.ok(page.data.structuredData.contents.length > 0);
    assert.ok(symbol.source);
    assert.match(
        reference.getSourceUrl(symbol.source) ?? '',
        /^https:\/\/github\.com\/nickwelsh\/refquill\/blob\/main\/packages\/fumadocs\/src\/index\.ts#L\d+$/u,
    );
});

void test('the site renders, searches, and exports the validated presentation document', () => {
    const { rendering } = overview.data;
    assert.equal(parseReferenceDocument(rendering.document), rendering.document);
    for (const page of source.getPages()) {
        const node = page.data.rendering.getNode(page.data.nodeId);
        assert.equal(node.url, page.url);
        const collected = collectReferencePage(node);
        assert.deepEqual(page.data.toc, collected.toc);
        assert.deepEqual(page.data.structuredData, collected.structuredData);
        assert.equal(page.data.rendering.getPageText(page.data.nodeId), collected.text);
    }
});

void test('the API reference is a section within the 0.x version', () => {
    const version = source.getPageTree().children.find((node) => node.name === '0.x');
    assert.ok(version?.type === 'folder');
    const sections = getDocsSections({ name: version.name, children: version.children }, '/docs/0.x');
    assert.deepEqual(
        sections.map((section) => section.name),
        ['API reference'],
    );
    assert.equal(sections[0]?.pages.length, source.getPages().length);
});

void test('the Rust crate exposes its modules, source links, native snapshot, and implementations', () => {
    const rust = reference.document.symbols.filter((symbol) => symbol.language === 'rust');
    assert.ok(rust.length > 0);
    for (const name of ['artifact', 'config', 'model', 'php', 'rust', 'rust_cargo', 'typescript', 'wire']) {
        assert.ok(rust.some((symbol) => symbol.kind === 'module' && symbol.qualifiedName === `refquill::${name}`));
    }
    const document = rust.find((symbol) => symbol.qualifiedName === 'refquill::model::Document');
    assert.ok(document);
    assert.ok(document.source);
    assert.match(reference.getSourceUrl(document.source) ?? '', /crates\/refquill\/src\/model.rs#L\d+$/u);
    assert.ok(reference.getMembers(document.id).some((member) => member.kind === 'impl'));
    const snapshot = reference.document.rustdoc?.find((entry) => entry.api === 'refquill');
    assert.ok(snapshot);
    assert.equal(snapshot.data['format_version'], 61);
});

void test('page previews include rendered members and references without loading the whole Rust crate', () => {
    const document = reference.document.symbols.find((symbol) => symbol.qualifiedName === 'refquill::model::Document');
    const generator = reference.document.symbols.find(
        (symbol) => symbol.qualifiedName === 'refquill::model::Generator',
    );
    assert.ok(document);
    assert.ok(generator);
    const page = source.getPageByUrl(reference.getUrl(document.id));
    assert.ok(page);
    const targets = getApiPreviewTargets(reference, page.data);
    assert.ok(targets.has(reference.getUrl(document.id)));
    assert.ok(targets.has(reference.getUrl(generator.id)));
    assert.ok(targets.size < reference.document.symbols.length / 10);
});

void test('React component return types retain their compiler origin and link to React documentation', () => {
    const component = reference.document.symbols.find(
        (symbol) => symbol.api === 'fumadocs' && symbol.name === 'ApiKindIcon',
    );
    assert.ok(component);
    const origin = component.signatures[0]?.returns?.references.find((item) => item.name === 'Element');
    assert.equal(origin?.package, '@types/react');
    assert.equal(origin.qualifiedName, 'React.JSX.Element');
    assert.equal(
        reference.resolveLink('Element', { language: 'typescript', symbolId: component.id })?.url,
        'https://react.dev/reference/react/createElement#returns',
    );
});
