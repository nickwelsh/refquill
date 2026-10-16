import assert from 'node:assert/strict';
import { test } from 'node:test';
import { markdownText } from '../src/markdown-text.js';
import { createReference } from '../src/reference.js';
import { createApiReference } from '../src/index.js';

test('Markdown text retains code syntax, punctuation, nested link labels, and block boundaries', () => {
  assert.equal(markdownText('# Heading\n\n**Bold** and *emphasis*, ~~old~~, [nested **label**](https://example.com/a_(b)).\n\n`List<T> #tag *literal*` &amp; ![Image label](image.png)\n\n- First\n- Second'),
    'Heading\nBold and emphasis, old, nested label.\nList<T> #tag *literal* & Image label\nFirst\nSecond');
  assert.equal(markdownText('```html\n<script>example()</script>\n```'), '<script>example()</script>');
  assert.equal(markdownText('[Reference][target]\n\n[target]: https://example.com'), 'Reference');
  assert.equal(markdownText('First  \nsecond\n\n| A | B |\n| - | - |\n| C | D |'), 'First\nsecond\nA\nB\nC\nD');
});

test('Markdown text follows skipHtml while retaining literal angle brackets as text', () => {
  assert.equal(markdownText('Before <span title="a > b">visible</span> after.'), 'Before visible after.');
  assert.equal(markdownText('<script\ntype="text/javascript">alert(1)</script>\n\nVisible prose.'), 'Visible prose.');
  assert.equal(markdownText('<!-- multiline\ncomment -->\n\nVisible prose.'), 'Visible prose.');
  assert.equal(markdownText('Literal &lt;script&gt;alert(1)&lt;/script&gt;.'), 'Literal <script>alert(1)</script>.');
  const longAttribute = 'x'.repeat(50_000);
  assert.equal(markdownText(`Before <span title="${longAttribute} > b">visible</span> after.`), 'Before visible after.');
});

test('reference and API metadata and search use the same Markdown text extraction', () => {
  const description = '**Use** [nested *labels*](https://example.com/a_(b)) and `List<T>`.';
  const expected = 'Use nested labels and List<T>.';
  const reference = createReference({ input: {
    schemaVersion: 1, title: 'Reference', children: [{ kind: 'page', id: 'item', title: 'Item', description, blocks: [{ kind: 'markdown', value: description }] }],
  } });
  const page = reference.toFumadocsSource().files.find(file => file.type === 'page' && file.data.nodeId === 'item');
  assert.ok(page?.type === 'page');
  assert.equal(page.data.description, expected);
  assert.equal(page.data.structuredData.contents.filter(item => item.content === expected).length, 2);

  const api = createApiReference({ input: {
    schemaVersion: 1, generator: { name: 'refquill', version: 'test' }, title: 'API', fingerprint: 'a'.repeat(64),
    inputs: [{ name: 'TS', language: 'typescript' }], types: [],
    symbols: [{ id: 'item', input: 0, kind: 'class', name: 'Item', declaration: 'class Item', description }],
  } });
  const apiPage = api.toFumadocsSource().files.find(file => file.type === 'page' && file.data.symbolId === 'item');
  assert.ok(apiPage?.type === 'page');
  assert.equal(apiPage.data.description, expected);
  assert.ok(apiPage.data.structuredData.contents.some(item => item.content === expected));
});
