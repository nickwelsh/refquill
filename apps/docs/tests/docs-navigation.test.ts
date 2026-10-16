import assert from 'node:assert/strict';
import test from 'node:test';
import type { Folder, Root } from 'fumadocs-core/page-tree';
import { getDocsPageUrl, getDocsSections, getVersionPageUrl } from '../src/lib/docs-navigation.ts';
import type { DocsVersion } from '../src/lib/docs-navigation.ts';

const guides: Folder = {
    type: 'folder',
    name: 'Guides',
    description: 'Customize the site',
    index: { type: 'page', name: 'Overview', url: '/docs/0.x/guides' },
    children: [
        {
            type: 'folder',
            name: 'Customization',
            children: [{ type: 'page', name: 'Theme', url: '/docs/0.x/guides/theme' }],
        },
    ],
};
const introduction = { type: 'page' as const, name: 'Introduction', url: '/docs/0.x' };
const tree: Root = {
    name: '0.x',
    children: [
        introduction,
        { ...guides, root: 'section' },
        { type: 'folder', name: 'Empty', root: true, children: [] },
    ],
};

void test('sections partition pages, include folder indexes, and skip empty roots', () => {
    const sections = getDocsSections(tree, '/docs/0.x');
    assert.deepEqual(
        sections.map((section) => section.name),
        ['Documentation', 'Guides'],
    );
    assert.deepEqual(
        sections.map((section) => section.pages),
        [['/docs/0.x'], ['/docs/0.x/guides', '/docs/0.x/guides/theme']],
    );
    const pages = sections.flatMap((section) => section.pages);
    assert.equal(new Set(pages).size, pages.length);
    const [, section] = sections;
    assert.ok(section);
    assert.equal(section.description, 'Customize the site');
    assert.equal(section.tree.children[0], guides.index);
});

void test('ordinary folders stay in Documentation and version roots do not become sections', () => {
    const sections = getDocsSections(
        { name: 'Docs', children: [introduction, guides, { ...guides, root: 'version', name: 'Old version' }] },
        '/docs/0.x',
    );
    assert.deepEqual(
        sections.map((section) => section.name),
        ['Documentation'],
    );
    const [section] = sections;
    assert.ok(section);
    assert.equal(section.tree.children.length, 3);
});

void test('an index already listed as a child appears only once', () => {
    assert.ok(guides.index);
    const sections = getDocsSections(
        { name: 'Docs', children: [{ ...guides, root: true, children: [guides.index, ...guides.children] }] },
        '/docs/0.x',
    );
    assert.deepEqual(sections[0]?.pages, ['/docs/0.x/guides', '/docs/0.x/guides/theme']);
});

void test('section search tags are distinct between version tracks', () => {
    const first = getDocsSections(tree, '/docs/0.x').map((section) => section.id);
    const next = getDocsSections(tree, '/docs/1.x').map((section) => section.id);
    assert.equal(new Set([...first, ...next]).size, first.length + next.length);
});

const previous: DocsVersion = {
    name: '0.x',
    status: 'deprecated',
    badges: [],
    url: '/docs/0.x',
    pages: ['/docs/0.x', '/docs/0.x/test', '/docs/0.x/guides/theme'],
    sections: [],
    searchSections: [],
};
const current: DocsVersion = {
    name: '1.x',
    status: 'latest',
    badges: [],
    url: '/docs/1.x',
    pages: ['/docs/1.x', '/docs/1.x/test', '/docs/1.x/guides/theme', '/docs/1.x/guides/migration'],
    sections: [],
    searchSections: [],
};

void test('version switching preserves nested pages and falls back when a page is absent', () => {
    assert.equal(getVersionPageUrl(current, previous, '/docs/1.x/guides/theme'), '/docs/0.x/guides/theme');
    assert.equal(getVersionPageUrl(current, previous, '/docs/1.x/guides/migration'), '/docs/0.x');
    assert.equal(getVersionPageUrl(previous, current, '/docs/0.x'), '/docs/1.x');
});

void test('unversioned aliases resolve to the selected version for navigation and switching', () => {
    assert.equal(getDocsPageUrl(current, '/'), '/docs/1.x');
    assert.equal(getDocsPageUrl(current, '/docs'), '/docs/1.x');
    assert.equal(getDocsPageUrl(current, '/docs/test'), '/docs/1.x/test');
    assert.equal(getDocsPageUrl(current, '/docs/guides/theme'), '/docs/1.x/guides/theme');
    assert.equal(getDocsPageUrl(previous, '/docs/0.x/guides/theme'), '/docs/0.x/guides/theme');
    assert.equal(getVersionPageUrl(current, previous, getDocsPageUrl(current, '/docs/test')), '/docs/0.x/test');
});
