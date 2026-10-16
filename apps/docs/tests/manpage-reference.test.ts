import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loader } from 'fumadocs-core/source';
import { createManPageSource } from '../src/lib/manpage-reference.ts';
import { getDocsSections } from '../src/lib/docs-navigation.ts';

const source = loader({ source: createManPageSource(['0.x']), baseUrl: '/docs' });

void test('the CLI manual uses the packaged manpage and belongs to versioned documentation', () => {
    const page = source.getPage(['0.x', 'manpage']);
    assert.ok(page);
    assert.equal(page.url, '/docs/0.x/manpage');
    assert.equal(page.data.title, 'CLI manual');
    const { reference } = page.data;
    assert.equal(reference.baseUrl, page.url);
    const manpageUrl = new URL(import.meta.resolve('@nickwelsh/refquill/manpage'));
    assert.equal(reference.input, readFileSync(manpageUrl, 'utf8'));
    assert.equal(reference.sourceUrl, 'https://github.com/nickwelsh/refquill/blob/main/packages/cli/man/refquill.1');
    const version = source.getPageTree().children.find((node) => node.name === '0.x');
    assert.ok(version?.type === 'folder');
    const sections = getDocsSections({ name: version.name, children: version.children }, '/docs/0.x');
    assert.equal(sections.find((section) => section.name === 'Documentation')?.pages.includes(page.url), true);
});

void test('the manual exposes option anchors, search descriptions, and complete Markdown examples', () => {
    const page = source.getPage(['0.x', 'manpage']);
    assert.ok(page);
    assert.ok(page.data.toc.some((item) => item.title === '--force'));
    assert.ok(page.data.structuredData.contents.some((item) => item.content.includes('REFQUILL_TYPESCRIPT_WORKER')));
    const markdown = page.data.reference.getPageText();
    assert.ok(markdown.includes('refquill generate refquill.json --force'));
    assert.ok(markdown.includes('Exit status'));
    assert.ok(markdown.includes('```text'));
});
