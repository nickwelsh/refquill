import assert from 'node:assert/strict';
import React from 'react';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { renderToString } from 'react-dom/server';
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import { loader } from 'fumadocs-core/source';
import { createApiReference, memberAnchor } from '../src/index.js';
import { ApiReference } from '../src/components.js';

const input = JSON.parse(readFileSync(new URL('../../../tests/output/mixed.json', import.meta.url), 'utf8'));
type HtmlNode = DefaultTreeAdapterMap['node'];
const htmlNodes = (node: HtmlNode): HtmlNode[] => [node, ...('childNodes' in node ? node.childNodes.flatMap(htmlNodes) : [])];
const htmlText = (html: string): string => htmlNodes(parseFragment(html)).map(node => node.nodeName === '#text' && 'value' in node ? node.value : '').join('');

test('a real Fumadocs loader resolves both languages, members, TOC, and search text', () => {
  const reference = createApiReference({ input, baseUrl: '/api/0.x' });
  const source = loader({ baseUrl: reference.baseUrl, source: reference.toFumadocsSource() });
  const person = reference.document.symbols.find(s => s.qualifiedName === 'Demo\\Person')!;
  const method = reference.document.symbols.find(s => s.qualifiedName === 'Demo\\Person::name')!;
  const page = source.getPages().find(page => page.data.symbolId === person.id)!;
  assert.equal(page.url, reference.getUrl(person.id));
  assert.equal(reference.getUrl(method.id), `${page.url}#${memberAnchor(method.id)}`);
  assert.ok(page.data.toc.some(item => item.url === `#${memberAnchor(method.id)}`));
  assert.ok(page.data.structuredData.contents.some(item => item.content.includes('name()')));
  assert.ok(source.getPages().some(page => page.data.symbolId === reference.document.symbols.find(s => s.qualifiedName === 'identifier')!.id));
  assert.ok(reference.getPageText(page.data).includes('```php'));
  const before = source.getPages().map(p => p.url);
  assert.deepEqual(loader({ baseUrl: reference.baseUrl, source: reference.toFumadocsSource() }).getPages().map(p => p.url), before);
});

test('Markdown includes TypeScript member signature summaries, parameters, and returns', () => {
  const reference = createApiReference({ input });
  const client = reference.document.symbols.find(s => s.qualifiedName === 'ProjectClient')!;
  const method = reference.getMembers(client.id).find(s => s.name === 'list')!;
  const summary = 'List projects, optionally filtering by status.';
  assert.equal(method.description, '');
  assert.equal(method.signatures[0].description, summary);
  const markdown = reference.getPageText({ symbolId: client.id, inputName: client.api });
  assert.ok(markdown.includes(summary));
  assert.ok(markdown.includes('Filter by project status.'));
  assert.ok(markdown.includes('Matching project identifiers.'));
});

test('Markdown includes identical symbol and signature descriptions only once', () => {
  const edited = structuredClone(input);
  const method = edited.symbols.find((s: { name: string }) => s.name === 'list');
  const summary = 'List projects, optionally filtering by status.';
  method.description = summary;
  const reference = createApiReference({ input: edited });
  const client = reference.document.symbols.find(s => s.qualifiedName === 'ProjectClient')!;
  const member = reference.getMembers(client.id).find(s => s.name === 'list')!;
  assert.equal(member.signatures[0].description, summary);
  const markdown = reference.getPageText({ symbolId: client.id, inputName: client.api });
  assert.equal(markdown.split(summary).length - 1, 1);
});

test('reference rendering retains signatures and protects Markdown and source links', () => {
  const edited = structuredClone(input);
  const symbol = edited.symbols.find((s: { name: string }) => s.name === 'identifier');
  symbol.description = 'An identifier. <script>alert(1)</script> [unsafe](javascript:alert)';
  const reference = createApiReference({ input: edited, sourceUrl: source => `https://example.com/source/${source.file}#L${source.line}` });
  const html = renderToString(<ApiReference reference={reference} symbolId={symbol.id} renderCode={value => <pre><code>{value}</code></pre>} />);
  const text = htmlText(html);
  const elements = htmlNodes(parseFragment(html)).filter(node => 'tagName' in node);
  assert.ok(text.includes('Signature 1'));
  assert.ok(text.includes('Signature 2'));
  assert.match(html, /<h[3-6]>Parameters<\/h[3-6]>/);
  assert.ok(html.includes('View source'));
  assert.ok(elements.every(node => node.tagName !== 'script'));
  assert.ok(elements.every(node => node.attrs.every(attribute => attribute.name !== 'href' || ['http:', 'https:'].includes(new URL(attribute.value, 'https://example.com').protocol))));
  assert.throws(() => createApiReference({ input, sourceUrl: () => 'javascript:alert(1)' }).getSourceUrl(reference.getSymbol(symbol.id).source!), /Unsafe source URL/);
  assert.throws(() => createApiReference({ input, baseUrl: '//elsewhere' }), /baseUrl/);
  assert.throws(() => reference.getSymbol('missing'), /Unknown Refquill/);
  assert.ok(htmlText(renderToString(<ApiReference reference={reference} symbolId={symbol.id} />)).includes('function identifier'));
});

test('raw HTML and adversarial Markdown cannot create active rendered elements or attributes', () => {
  for (const description of [
    '<script\ntype="text/javascript">alert(1)</script>\n\nVisible prose.',
    'Visible <img src=x onerror="alert(1)"> prose. [unsafe](javascript:alert)',
    'Visible [unsafe](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==) prose.',
    'Visible [unsafe](vbscript:msgbox) prose.',
    'Visible [unsafe](JaVaScRiPt:alert) prose.',
    '<!-- multiline\ncomment --><iframe src="https://example.com"></iframe>\n\nVisible prose.',
    'Visible <span title="a > b" onclick="alert(1)">prose</span>.',
    'Visible &lt;script&gt;alert(1)&lt;/script&gt; prose.',
    'Visible <scr<script>ipt>alert(1)</scr<script>ipt> prose.',
  ]) {
    const edited = structuredClone(input);
    const symbol = edited.symbols.find((s: { name: string }) => s.name === 'identifier');
    symbol.description = description;
    const reference = createApiReference({ input: edited });
    const html = renderToString(<ApiReference reference={reference} symbolId={symbol.id} />);
    const elements = htmlNodes(parseFragment(html)).filter(node => 'tagName' in node);
    assert.ok(elements.every(node => !['script', 'iframe', 'img'].includes(node.tagName)), description);
    assert.ok(elements.every(node => node.attrs.every(attribute => !attribute.name.startsWith('on') && (attribute.name !== 'href' || ['http:', 'https:'].includes(new URL(attribute.value, 'https://example.com').protocol)))), description);
    assert.ok(htmlText(html).includes('Visible'), description);
  }
});
