import assert from 'node:assert/strict';
import test from 'node:test';
import { initAdvancedSearch } from 'fumadocs-core/search/server';
import type { StructuredData } from 'fumadocs-core/mdx-plugins/remark-structure';
import { searchExcerpt, sectionSearchData } from '../src/lib/search.ts';

const data: StructuredData = {
    headings: [
        { id: 'fields', content: 'Fields' },
        { id: 'field/name', content: 'Name' },
        { id: 'field-type', content: 'Type' },
        { id: 'methods', content: 'Methods' },
        { id: 'unlisted', content: 'Unlisted heading' },
    ],
    contents: [
        { heading: undefined, content: 'Page introduction' },
        { heading: 'fields', content: 'Fields' },
        { heading: 'field/name', content: 'quartz field documentation' },
        { heading: 'field-type', content: 'string' },
        { heading: 'methods', content: 'Call examples' },
        { heading: 'unlisted', content: 'Additional details' },
    ],
};
const toc = [
    { url: '#fields', title: 'Fields', depth: 2 },
    { url: '#field%2Fname', title: 'Name', depth: 3 },
    { url: '#field-type', title: 'Type', depth: 4 },
    { url: '#methods', title: 'Methods', depth: 2 },
];

void test('search sections retain all text, encoded anchors, unlisted headings, and the original data', () => {
    const original = structuredClone(data);
    const compact = sectionSearchData(data, toc);
    assert.deepEqual(compact, {
        headings: [],
        contents: [
            { heading: 'fields', content: 'Fields\nName\nType\nquartz field documentation\nstring' },
            { heading: 'methods', content: 'Methods\nCall examples' },
            { heading: 'unlisted', content: 'Unlisted heading\nAdditional details' },
            { heading: undefined, content: 'Page introduction' },
        ],
    });
    assert.deepEqual(data, original);
});

void test('native full-text search retains section anchors and combined version and section filters', async () => {
    const compact = sectionSearchData(data, toc);
    const server = initAdvancedSearch({
        sort: { enabled: false },
        indexes: [
            { id: 'current', title: 'Current', url: '/docs/current', tag: ['v1', 'api'], structuredData: compact },
            { id: 'old', title: 'Old', url: '/docs/old', tag: ['v0', 'api'], structuredData: compact },
            { id: 'guide', title: 'Guide', url: '/docs/guide', tag: ['v1', 'guides'], structuredData: compact },
        ],
    });
    const results = await server.search('quartz', { tag: ['v1', 'api'] });
    assert.equal(results.length, 2);
    assert.equal(results[0]?.url, '/docs/current');
    assert.equal(results[1]?.url, '/docs/current#fields');
    assert.ok(results[1].content.includes('quartz field documentation'));
    const unlisted = await server.search('Additional details', { tag: ['v1', 'api'] });
    assert.ok(unlisted.some((result) => result.url === '/docs/current#unlisted'));
});

void test('long result excerpts expose distant phrase or token matches within a bounded escaped text row', () => {
    const content = `${'Opening content. '.repeat(100)}schemaVersion retains the document contract. ${'Ending content. '.repeat(100)}`;
    const exact = searchExcerpt(content, 'schemaVersion');
    assert.ok(exact !== undefined);
    assert.ok(exact.includes('schemaVersion'));
    assert.ok(exact.startsWith('…'));
    assert.ok(exact.length <= 240);
    const token = searchExcerpt(content, 'missing schemaVersion');
    assert.equal(token?.includes('schemaVersion'), true);
    const fallback = searchExcerpt(content, 'unmatched');
    assert.ok(fallback !== undefined);
    assert.ok(fallback.startsWith('Opening content.'));
    assert.ok(fallback.length <= 240);
    assert.equal(searchExcerpt('<strong>Short rich result</strong>', 'rich'), undefined);
});
