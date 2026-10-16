import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { codeToHast } from 'shiki';
import { parseReferenceDocument, type ReferenceDocument } from '@nickwelsh/refquill-schema';
import { ReferencePage, ReferenceEntry } from '../src/reference-components.js';
import { referenceHighlightTransformer } from '../src/reference-code.js';

const input: ReferenceDocument = {
  schemaVersion: 1, title: 'Custom language', children: [{
    kind: 'page', id: 'page', title: 'Client', type: { key: 'custom-client', label: 'Client' },
    definition: { id: 'definition', language: 'typescript', code: 'let first = 1; let second = 2;' },
    blocks: [{ kind: 'section', id: 'actions', title: 'Actions', blocks: [{
      kind: 'entry', id: 'first', title: { code: 'first: number', language: 'typescript' },
      display: 'disclosure', description: 'The **first** value.',
      badges: [{ label: 'opening', visibility: 'open' }, { label: 'closing', visibility: 'closed' }, { label: 'always' }],
      highlights: [{ definitionId: 'definition', range: { start: { line: 1, column: 5 }, end: { line: 1, column: 10 } } }],
      blocks: [{ kind: 'section', id: 'nested-section', title: 'Nested', blocks: [{ kind: 'entry', id: 'nested', title: 'Nested value', display: 'static', description: 'Inherits its owner range.' }] }],
    }, { kind: 'entry', id: 'second', title: 'second', display: 'static', highlights: [{ definitionId: 'definition', range: { start: { line: 1, column: 20 }, end: { line: 1, column: 26 } } }] }] }],
  }],
};

test('shared entries render mixed recursive content, syntax labels, safe Markdown, and stateful badges', () => {
  const document = parseReferenceDocument(input);
  const html = renderToString(<ReferencePage page={document.children[0]} document={document} />);
  assert.match(html, /<h2>Actions<\/h2>/);
  assert.match(html, /<h4>Nested<\/h4>/);
  assert.match(html, /<strong>first<\/strong>/);
  assert.match(html, /class="refquill-label-code shiki"/);
  assert.match(html, /data-reference-badge-visibility="open"/);
  assert.match(html, /data-reference-badge-visibility="closed"/);
  assert.match(html, /id="second" class="refquill-entry refquill-static-entry"/);
  assert.match(html, /data-reference-declaration="first nested" data-reference-range="">first<\/span>/);
  assert.match(html, /data-reference-declaration="second" data-reference-range="">second<\/span>/);
  assert.doesNotMatch(html, /data-reference-range="">let /);
});

test('column boundaries split syntax tokens, retain exact text, and support overlaps and multiple lines', async () => {
  const code = 'const alpha = 1;\r\nconst beta = alpha;';
  const tree = await codeToHast(code, { lang: 'typescript', theme: 'github-light', transformers: [referenceHighlightTransformer('code', {
    first: [{ definitionId: 'code', range: { start: { line: 1, column: 7 }, end: { line: 2, column: 6 } } }],
    overlap: [{ definitionId: 'code', range: { start: { line: 1, column: 9 }, end: { line: 1, column: 12 } } }],
    full: [{ definitionId: 'code', range: { start: { line: 2 }, end: { line: 2 } } }],
  })] });
  const text = (node: any): string => node.type === 'text' ? node.value : (node.children ?? []).map(text).join('');
  assert.equal(text(tree), code.replaceAll('\r\n', '\n'));
  const owned: { owners: string; text: string }[] = [];
  const visit = (node: any) => { if (node.properties?.['data-reference-declaration']) owned.push({ owners: node.properties['data-reference-declaration'], text: text(node) }); for (const child of node.children ?? []) visit(child); };
  visit(tree);
  assert.ok(owned.some(part => part.owners === 'first overlap' && part.text === 'pha'));
  assert.ok(owned.some(part => part.owners === 'first' && part.text === 'const'));
  assert.ok(owned.some(part => part.owners === 'full' && part.text === 'const beta = alpha;'));
});

test('component overrides receive normalized content and can reuse default entries', () => {
  let calls = 0;
  const html = renderToString(<ReferencePage page={input.children[0]} components={{ Entry: props => { calls++; return <article data-custom-entry><ReferenceEntry {...props} /></article>; } }} />);
  assert.equal(calls, 3);
  assert.match(html, /data-custom-entry/);
  assert.match(html, /id="nested"/);
});

test('automatic directory listings reuse namespace entry rows with inline Markdown summaries and host hooks', () => {
  let calls = 0;
  const html = renderToString(<ReferencePage page={{
    kind: 'directory', id: 'root', title: 'API reference', blocks: [], children: [{
      kind: 'directory', id: 'crate', title: 'Crate', url: '/api/crate', type: { key: 'module', label: 'module' }, blocks: [], children: [],
      description: 'Use [`Document`](/api/Document) to generate references.\n\nDetailed module documentation.',
    }],
  }} components={{ Entry: props => { calls++; return <ReferenceEntry {...props} />; } }} />);
  assert.equal(calls, 1);
  assert.match(html, /class="refquill-entry refquill-static-entry"/);
  assert.match(html, /class="refquill-entry-label"/);
  assert.match(html, /href="\/api\/crate">Crate<\/a>/);
  assert.match(html, /<p>Use <a href="\/api\/Document"><code>Document<\/code><\/a> to generate references\.<\/p>/);
  assert.doesNotMatch(html, /Detailed module documentation/);
  assert.doesNotMatch(html, /refquill-entries/);
});

test('entry source links remain separate from their linked code labels', () => {
  const html = renderToString(<ReferenceEntry entry={{ kind: 'entry', id: 'source', title: { code: 'Client', language: 'typescript', links: [{ start: 0, end: 6, url: '/Client' }] }, display: 'static', sourceUrl: 'https://example.test/client.ts#L1' }} />);
  assert.match(html, /href="\/Client"/);
  assert.match(html, /class="refquill-source" href="https:\/\/example.test\/client.ts#L1">Source<\/a>/);
});

test('unsupported code grammars fall back to escaped text and definition hooks run once', () => {
  const page = { ...input.children[0], definition: { id: 'unknown-code', language: 'made-up-language', code: '<script>unsafe()</script>' }, blocks: [] };
  const fallback = renderToString(<ReferencePage page={page} />);
  assert.match(fallback, /&lt;script&gt;unsafe\(\)&lt;\/script&gt;/);
  let calls = 0;
  renderToString(<ReferencePage page={page} renderCode={code => { calls++; return <pre>{code}</pre>; }} />);
  assert.equal(calls, 1);
});

test('explicit links and code ranges compose without losing source text', () => {
  const document: ReferenceDocument = { schemaVersion: 1, title: 'Links', children: [{ kind: 'page', id: 'links', title: 'Links', definition: { id: 'linked', language: 'typescript', code: 'Client', links: [{ start: 0, end: 6, targetId: 'target' }] }, blocks: [{ kind: 'entry', id: 'target', title: 'Target', display: 'static', highlights: [{ definitionId: 'linked', range: { start: { line: 1, column: 2 }, end: { line: 1, column: 5 } } }] }] }] };
  parseReferenceDocument(document);
  const html = renderToString(<ReferencePage page={document.children[0]} document={document} />);
  assert.match(html, /href="#target"/);
  assert.match(html, /data-reference-range="">lie<\/span>/);
  const customized = renderToString(<ReferencePage page={{ ...document.children[0], title: 'Custom title' }} document={document} />);
  assert.match(customized, /href="#target"/);
});

test('prototype-like identities retain ownership and entry destinations avoid nested links', () => {
  const document: ReferenceDocument = { schemaVersion: 1, title: 'IDs', children: [{ kind: 'page', id: 'ids', title: 'IDs', definition: { id: 'id-source', language: 'typescript', code: 'Client' }, blocks: [{ kind: 'entry', id: '__proto__', title: { code: 'Client', language: 'typescript', links: [{ start: 0, end: 6, url: '/inner' }] }, url: '/outer', display: 'static', highlights: [{ definitionId: 'id-source', range: { start: { line: 1 }, end: { line: 1 } } }] }] }] };
  parseReferenceDocument(document);
  const html = renderToString(<ReferencePage page={document.children[0]} document={document} />);
  assert.match(html, /data-reference-declaration="__proto__"/);
  assert.match(html, /href="\/outer"/);
  assert.doesNotMatch(html, /href="\/inner"/);
});
