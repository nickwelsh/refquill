import assert from 'node:assert/strict';
import test from 'node:test';
import { parseReferenceDocument } from '../packages/schema/index.js';

function fixture() {
  return {
    schemaVersion: 1, title: 'Reference', children: [{
      kind: 'directory', id: 'module', title: 'Module', type: { key: 'module', label: 'Module' }, blocks: [], children: [{
        kind: 'page', id: 'client', title: 'Client', sourceUrl: 'https://example.test/client.ts#L1',
        definition: { id: 'client-code', language: 'typescript', code: 'class Client {\r\n  request(😀: string);\r\n}', links: [{ start: 6, end: 12, targetId: 'client' }] },
        blocks: [{ kind: 'section', id: 'methods', title: 'Methods', blocks: [{
          kind: 'entry', id: 'request', title: { code: 'request(url)', language: 'typescript', links: [{ start: 0, end: 7, targetId: 'request' }] },
          type: { key: 'method', label: 'Method' }, display: 'disclosure', defaultOpen: true,
          badges: [{ label: 'deprecated', visibility: 'both' }, { label: 'public', visibility: 'open' }],
          highlights: [{ definitionId: 'client-code', range: { start: { line: 2, column: 3 }, end: { line: 2, column: 10 } } }],
          blocks: [{ kind: 'markdown', value: 'Send a request.' }, { kind: 'section', id: 'parameters', title: 'Arguments', blocks: [{ kind: 'entry', id: 'url', title: 'url', display: 'static' }] }],
        }] }],
      }],
    }],
  };
}
const page = document => document.children[0].children[0];
const entry = document => page(document).blocks[0].blocks[0];

test('reference contract preserves custom terminology, recursive blocks and code positions', () => {
  const document = fixture();
  assert.equal(parseReferenceDocument(document), document);
  assert.equal(entry(document).blocks[1].title, 'Arguments');
});

test('entry source links use the same safe URL rules as page sources', () => {
  const document = fixture();
  entry(document).sourceUrl = 'https://example.test/client.ts#L2';
  assert.equal(parseReferenceDocument(document), document);
  entry(document).sourceUrl = 'javascript:alert(1)';
  assert.throws(() => parseReferenceDocument(document), /URL/);
});

test('whole-line highlights include their final line and work with CRLF', () => {
  const document = fixture();
  entry(document).highlights[0].range = { start: { line: 1 }, end: { line: 3 } };
  assert.doesNotThrow(() => parseReferenceDocument(document));
});

test('column highlights use UTF-16, exclusive ends, and allow the end of a line', () => {
  const document = fixture();
  const code = page(document).definition.code.split('\r\n')[1];
  entry(document).highlights[0].range = { start: { line: 2, column: 11 }, end: { line: 2, column: code.length + 1 } };
  assert.doesNotThrow(() => parseReferenceDocument(document));
  entry(document).highlights[0].range.end.column++;
  assert.throws(() => parseReferenceDocument(document), /invalid highlight column/);
});

test('position ranges reject split surrogates, empty/reversed ranges, and missing columns', () => {
  for (const range of [
    { start: { line: 2, column: 12 }, end: { line: 2, column: 15 } },
    { start: { line: 2, column: 3 }, end: { line: 2, column: 3 } },
    { start: { line: 3 }, end: { line: 2 } },
    { start: { line: 2, column: 3 }, end: { line: 2 } },
    { start: { line: 1 }, end: { line: 4 } },
  ]) {
    const document = fixture();
    entry(document).highlights[0].range = range;
    assert.throws(() => parseReferenceDocument(document), /highlight/);
  }
});

test('definition ranges are page-local, including definitions in nested code blocks', () => {
  const document = fixture();
  entry(document).blocks.push({ kind: 'code', definition: { id: 'example', language: 'text', code: 'test' } });
  entry(document).highlights = [{ definitionId: 'example', range: { start: { line: 1 }, end: { line: 1 } } }];
  assert.doesNotThrow(() => parseReferenceDocument(document));
  document.children[0].definition = { id: 'directory-code', language: 'text', code: 'test' };
  entry(document).highlights[0].definitionId = 'directory-code';
  assert.throws(() => parseReferenceDocument(document), /missing page-local definition/);
});

test('identities are unique across pages, entries, sections and definitions', () => {
  for (const setDuplicate of [
    document => { page(document).id = 'module'; },
    document => { entry(document).id = 'methods'; },
    document => { page(document).definition.id = 'client'; },
  ]) {
    const document = fixture();
    setDuplicate(document);
    assert.throws(() => parseReferenceDocument(document), /duplicate ID/);
  }
});

test('code links resolve across the document and validate their exclusive offsets', () => {
  const document = fixture();
  page(document).definition.links[0].targetId = 'module';
  assert.doesNotThrow(() => parseReferenceDocument(document));
  page(document).definition.links[0].targetId = 'missing';
  assert.throws(() => parseReferenceDocument(document), /missing code link target/);
  page(document).definition.links[0] = { start: 0, end: 9999, url: '/reference' };
  assert.throws(() => parseReferenceDocument(document), /invalid code link offsets/);
  page(document).definition.links[0] = { start: 0, end: 2, url: '/reference', targetId: 'client' };
  assert.throws(() => parseReferenceDocument(document), /Invalid Refquill/);
});

test('code links allow unsorted adjacent ranges and reject overlaps', () => {
  const document = fixture();
  page(document).definition.links = [{ start: 6, end: 12, targetId: 'client' }, { start: 0, end: 6, targetId: 'module' }];
  assert.doesNotThrow(() => parseReferenceDocument(document));
  page(document).definition.links[1].end = 7;
  assert.throws(() => parseReferenceDocument(document), /overlapping code links/);
});

test('explicit DOM anchors are safe and unique within a page', () => {
  const document = fixture();
  entry(document).anchor = 'canonical-request';
  assert.doesNotThrow(() => parseReferenceDocument(document));
  entry(document).anchor = 'methods';
  assert.throws(() => parseReferenceDocument(document), /duplicate page anchor/);
  entry(document).anchor = 'two words';
  assert.throws(() => parseReferenceDocument(document), /Invalid Refquill/);
  delete entry(document).anchor;
  const second = structuredClone(page(document));
  second.id = 'second';
  second.blocks = [{ kind: 'section', id: 'second-methods', anchor: 'methods', title: 'Methods', blocks: [] }];
  delete second.definition;
  document.children[0].children.push(second);
  assert.doesNotThrow(() => parseReferenceDocument(document));
});

test('URL-bearing fields reject browser-normalized script and protocol-relative URLs', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,x', '//evil.test', '\\evil.test', 'java\nscript:alert(1)', ' https://example.test', 'http:']) {
    const document = fixture();
    page(document).url = url;
    assert.throws(() => parseReferenceDocument(document), /URL/);
  }
  for (const url of ['https://example.test/a#x', 'mailto:docs@example.test', '/api/client', './client', '../client', '#request']) {
    const document = fixture();
    page(document).url = url;
    assert.doesNotThrow(() => parseReferenceDocument(document));
  }
});

test('shape validation rejects unknown keys, missing fields and meaningless disclosure options', () => {
  for (const mutate of [
    document => { document.extra = true; },
    document => { delete page(document).blocks; },
    document => { entry(document).blocks = []; delete entry(document).description; },
    document => { entry(document).display = 'static'; },
    document => { entry(document).badges[0].visibility = 'sometimes'; },
  ]) {
    const document = fixture();
    mutate(document);
    assert.throws(() => parseReferenceDocument(document), /Invalid Refquill/);
  }
});

test('a disclosure may expand a description without nested blocks', () => {
  const document = fixture();
  entry(document).description = 'Useful details.';
  delete entry(document).blocks;
  assert.doesNotThrow(() => parseReferenceDocument(document));
});

test('JSON preflight rejects cycles, accessors, non-JSON objects and sparse arrays', () => {
  const cycle = {}; cycle.self = cycle;
  const getter = Object.defineProperty({}, 'title', { enumerable: true, get() { throw new Error('must not execute'); } });
  for (const value of [cycle, getter, new Date(), [undefined], new Array(5), { number: Infinity }, { [Symbol()]: 'x' }]) {
    assert.throws(() => parseReferenceDocument(value), /Invalid Refquill/);
  }
});

test('JSON preflight bounds nesting and text before recursive schema validation', () => {
  let value = {};
  for (let index = 0; index < 1000; index++) value = { value };
  assert.throws(() => parseReferenceDocument(value), /structure limit/);
  assert.throws(() => parseReferenceDocument({ title: 'x'.repeat(10 * 1024 * 1024 + 1) }), /text limit/);
});
