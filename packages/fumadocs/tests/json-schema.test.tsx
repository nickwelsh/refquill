import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import React from 'react';
import { parseReferenceDocument, type ReferenceBlock } from '@nickwelsh/refquill-schema';
import { renderToString } from 'react-dom/server';
import { loader } from 'fumadocs-core/source';
import { createJsonSchemaReference, jsonSchemaAnchor } from '../src/index.js';
import { JsonSchemaReference } from '../src/components.js';

const composer = JSON.parse(readFileSync(new URL('../../../tests/fixtures/composer.schema.json', import.meta.url), 'utf8'));

test('Composer renders directly with Fumadocs navigation, search, TOC, and copyable source', () => {
  const before = JSON.stringify(composer);
  const reference = createJsonSchemaReference({ schema: composer, baseUrl: '/reference/composer', sourceUrl: 'https://getcomposer.org/schema.json' });
  assert.equal(reference.schema, composer);
  const source = loader({ baseUrl: reference.baseUrl, source: reference.toFumadocsSource() });
  const [page] = source.getPages();
  assert.equal(page.url, '/reference/composer');
  assert.equal(page.data.title, 'Composer Package');
  assert.ok(page.data.toc.some(item => item.url === `#${jsonSchemaAnchor('/properties/authors')}`));
  assert.ok(page.data.structuredData.contents.some(item => item.content.includes('PSR-4')));
  assert.equal(reference.resolveRef('#/definitions/authors'), `#${jsonSchemaAnchor('/definitions/authors')}`);
  assert.ok(reference.getPageText().includes('```json'));
  assert.deepEqual(JSON.parse(reference.code), composer);
  const html = renderToString(<JsonSchemaReference reference={reference} />);
  assert.ok(html.includes('Composer Package'));
  assert.ok(html.includes('Pattern properties'));
  assert.ok(html.includes('Any of'));
  assert.ok(html.includes('required'));
  assert.ok(html.includes(`href="#${jsonSchemaAnchor('/definitions/authors')}"`));
  assert.ok(html.includes('data-reference-declaration='));
  assert.ok(!html.includes('unresolved reference'));
  assert.equal(JSON.stringify(composer), before);
  const lines = reference.code.split('\n');
  const nameLine = lines.findIndex(line => line.trim() === '"name": {') + 1;
  assert.equal(reference.memberLines[nameLine], jsonSchemaAnchor('/properties/name'));
  assert.equal(Object.keys(reference.memberLines).length, lines.length);
});

test('recursive refs, escaped and encoded pointers, anchors, and nested resource IDs remain links', () => {
  const reference = createJsonSchemaReference({ schema: {
    $id: 'https://example.com/root.json',
    $defs: {
      node: { $anchor: 'node', properties: { next: { $ref: '#node' } } },
      'a/b~c #%': { type: 'string' },
      resource: { $id: 'child.json', $defs: { inner: { type: 'integer' } }, properties: { x: { $ref: '#/$defs/inner' } } },
    },
    properties: { self: { $ref: '#' } },
  } });
  assert.equal(reference.resolveRef('#'), `#${jsonSchemaAnchor('')}`);
  assert.equal(reference.resolveRef('#node'), `#${jsonSchemaAnchor('/$defs/node')}`);
  assert.equal(reference.resolveRef('#/$defs/a~1b~0c%20%23%25'), `#${jsonSchemaAnchor('/$defs/a~1b~0c #%')}`);
  assert.equal(reference.resolveRef('child.json#/$defs/inner'), `#${jsonSchemaAnchor('/$defs/resource/$defs/inner')}`);
  assert.equal(reference.resolveRef('#/$defs/inner', '/$defs/resource/properties/x'), `#${jsonSchemaAnchor('/$defs/resource/$defs/inner')}`);
  assert.equal(reference.resolveRef('#/missing'), null);
  assert.equal(reference.resolveRef('#/%bad'), null);
  assert.equal(reference.resolveRef('other.json#thing'), 'https://example.com/other.json#thing');
  const html = renderToString(<JsonSchemaReference reference={reference} renderCode={code => <pre>{code}</pre>} />);
  assert.ok(html.length < 50_000);
  assert.ok(html.includes(`href="#${jsonSchemaAnchor('')}"`));
});

test('modern and legacy schema shapes retain booleans, tuples, branches, constraints, and unknown keywords', () => {
  const schema = {
    type: ['object', 'null'], required: ['yes'],
    properties: { yes: true, no: false, tuple: { items: [{ const: 0 }, false], additionalItems: false } },
    patternProperties: { '^x-': { type: 'string', minLength: 1 } },
    additionalProperties: false,
    $defs: { list: { type: 'array', prefixItems: [true], contains: { const: 'x' }, minContains: 1 } },
    if: { required: ['yes'] }, then: { dependentSchemas: { yes: { required: ['no'] } } }, else: false,
    allOf: [{ not: { const: null } }], oneOf: [true, false],
    dependencies: { yes: ['must-install'], no: { properties: { yes: true } } },
    'x-custom': { description: 'extension' }, examples: [{ yes: 1 }],
  };
  const reference = createJsonSchemaReference({ schema });
  const html = renderToString(<JsonSchemaReference reference={reference} renderCode={() => <pre>source</pre>} />);
  for (const text of ['Accepts any value.', 'Does not accept any value.', 'minContains', 'Prefix items', 'One of', 'All of', 'x-custom', 'examples', 'required', 'optional', 'must-install']) assert.ok(html.includes(text), text);
  assert.ok(!reference.root.children.some(node => node.keyword === 'examples' || node.keyword === 'x-custom'));
  assert.ok(reference.root.children.find(node => node.name === 'yes')?.required);
  assert.ok(renderToString(<JsonSchemaReference reference={createJsonSchemaReference({ schema: false })} />).includes('Does not accept any value.'));
});

test('untrusted content and destinations stay safe while host hooks retain their contracts', () => {
  const reference = createJsonSchemaReference({ schema: {
    description: '<script>alert(1)</script>\n\n[bad](javascript:alert) [good](https://example.com)',
    properties: { unsafe: { $ref: 'javascript:alert(1)', deprecated: true } },
  } });
  assert.equal(reference.resolveRef('javascript:alert(1)'), null);
  let codeCalls = 0;
  const html = renderToString(<JsonSchemaReference reference={reference}
    renderHeader={props => <header data-host="header"><h1>{props.title}</h1>{props.description}{props.badges}</header>}
    renderBadge={badge => <b data-host="badge">{badge.label}</b>}
    renderLink={props => <a {...props} data-host="link" />}
    renderCode={(code, language, options) => { codeCalls++; assert.equal(language, 'json'); assert.ok(options.memberLines[1]); return <pre data-host="code">{code}</pre>; }}
  />);
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('href="javascript:'));
  for (const hook of ['header', 'badge', 'link', 'code']) assert.ok(html.includes(`data-host="${hook}"`));
  assert.equal(codeCalls, 1);
  assert.equal(html.split('href="https://example.com"').length - 1, 1);
  assert.ok(html.includes('unresolved reference'));
  assert.throws(() => createJsonSchemaReference({ schema: {}, sourceUrl: 'javascript:alert(1)' }), /sourceUrl/);
  assert.throws(() => createJsonSchemaReference({ schema: {}, baseUrl: '//unsafe' }), /baseUrl/);
  assert.throws(() => createJsonSchemaReference({ schema: [] }), /object or boolean/);
  assert.throws(() => createJsonSchemaReference({ schema: { default: undefined } }), /JSON values/);
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  assert.throws(() => createJsonSchemaReference({ schema: cycle }), /acyclic/);
  let deep: unknown = {}; for (let i = 0; i < 65; i++) deep = { properties: { x: deep } };
  assert.throws(() => createJsonSchemaReference({ schema: deep }), /limits/);
});


test('JSON Schema projects safe references, arbitrary keywords, nested entries, and source ranges to the shared document', () => {
  const reference = createJsonSchemaReference({ schema: {
    description: 'Root documentation', properties: { value: { type: 'string', 'x-custom': { nested: ['retained'] } }, 'value-keyword-x-custom': {} },
    $defs: { recursive: { $ref: '#/$defs/recursive' } },
  } });
  const document = parseReferenceDocument(JSON.parse(JSON.stringify(reference.toReferenceDocument())));
  const page = document.children[0];
  assert.equal(page.definition?.code, reference.code);
  assert.equal(page.description, 'Root documentation');
  const blocks: ReferenceBlock[] = [];
  const visit = (children: ReferenceBlock[]) => { for (const block of children) { blocks.push(block); if (block.kind === 'section' || block.kind === 'entry') visit(block.blocks ?? []); } };
  visit(page.blocks);
  const value = blocks.find(block => block.kind === 'entry' && block.id === jsonSchemaAnchor('/properties/value'));
  assert.ok(value?.kind === 'entry');
  assert.equal(value.display, 'disclosure');
  const range = value.highlights?.[0];
  assert.equal(range?.definitionId, page.definition?.id);
  assert.ok(reference.code.split('\n')[range!.range.start.line - 1].includes('"value"'));
  assert.ok(range!.range.end.line > range!.range.start.line);
  assert.ok(blocks.some(block => block.kind === 'entry' && typeof block.title !== 'string' && block.title.code.includes('retained')));
  assert.ok(blocks.some(block => block.kind === 'entry' && typeof block.title !== 'string' && block.title.links?.[0].url === `#${jsonSchemaAnchor('/$defs/recursive')}`));
  assert.ok(page.definition?.links?.some(link => link.url === `#${jsonSchemaAnchor('/$defs/recursive')}`));
  assert.ok(blocks.every(block => block.kind !== 'code'), 'keyword values stay visible as shared labels on desktop');
  assert.ok(reference.getPageText().includes('retained'));
});


test('schema keyword rows retain syntax, exact source ranges and links in the full definition', () => {
  const reference = createJsonSchemaReference({ schema: {
    properties: { input: { $ref: '#/$defs/Input', default: ['one', 'two'] } },
    $defs: { Input: { type: 'string' } },
  } });
  const document = parseReferenceDocument(reference.toReferenceDocument());
  const page = document.children[0];
  const entries: Extract<ReferenceBlock, { kind: 'entry' }>[] = [];
  const visit = (blocks: ReferenceBlock[]) => { for (const block of blocks) {
    if (block.kind === 'entry') entries.push(block);
    if (block.kind === 'entry' || block.kind === 'section') visit(block.blocks ?? []);
  } };
  visit(page.blocks);
  const defaults = entries.find(entry => typeof entry.title !== 'string' && entry.title.code.startsWith('"default":'))!;
  const range = defaults.highlights![0].range;
  assert.equal(range.end.line - range.start.line, 3);
  assert.ok(reference.code.split('\n')[range.start.line - 1].includes('"default": ['));
  const target = `#${jsonSchemaAnchor('/$defs/Input')}`;
  const link = page.definition!.links!.find(link => link.url === target)!;
  assert.equal(JSON.parse(reference.code.slice(link.start, link.end)), '#/$defs/Input');
  const html = renderToString(<JsonSchemaReference reference={reference} />);
  assert.ok(html.includes(`href="${target}"`));
  assert.match(html, /data-reference-declaration="[^"]*json-keyword:/);
});


test('boolean property policies explain unknown properties without treating the whole object as forbidden', () => {
  for (const keyword of ['additionalProperties', 'unevaluatedProperties']) for (const allowed of [true, false]) {
    const reference = createJsonSchemaReference({ schema: { type: 'object', properties: { name: { type: 'string' } }, [keyword]: allowed } });
    const document = parseReferenceDocument(reference.toReferenceDocument());
    const group = document.children[0].blocks.find(block => block.kind === 'section' && block.blocks.some(entry => entry.kind === 'entry' && entry.id === jsonSchemaAnchor(`/${keyword}`)));
    assert.ok(group?.kind === 'section');
    const entry = group.blocks[0];
    assert.ok(entry.kind === 'entry');
    assert.equal(entry.display, 'static');
    assert.ok(typeof entry.title !== 'string');
    assert.equal(entry.title.code, `"${keyword}": ${allowed}`);
    assert.deepEqual(entry.badges, []);
    assert.deepEqual(entry.blocks, []);
    assert.match(entry.description!, allowed ? /may have any value/ : /are not allowed/);
    assert.ok(entry.highlights?.length);
  }
  const root = renderToString(<JsonSchemaReference reference={createJsonSchemaReference({ schema: false })} />);
  assert.ok(root.includes('Does not accept any value.'));
});
