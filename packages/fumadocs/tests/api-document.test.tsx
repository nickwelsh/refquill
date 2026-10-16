import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { createApiReference, createReference, memberAnchor, parseReferenceDocument, type ReferenceBlock, type ReferenceEntry, type ReferenceNode } from '../src/index.js';
import { ReferencePage } from '../src/components.js';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../../tests/output/${name}.json`, import.meta.url), 'utf8'));
const nodes = (children: ReferenceNode[]): ReferenceNode[] => children.flatMap(node => [node, ...(node.kind === 'directory' ? nodes(node.children) : [])]);
const entries = (blocks: ReferenceBlock[]): ReferenceEntry[] => blocks.flatMap(block => block.kind === 'entry' ? [block, ...entries(block.blocks ?? [])] : block.kind === 'section' ? entries(block.blocks) : []);

test('all generated API languages validate and retain their routes through the generic source', () => {
  for (const name of ['mixed', 'rust']) {
    const api = createApiReference({ input: fixture(name), baseUrl: '/api/v1' });
    const document = api.toReferenceDocument();
    assert.equal(api.toReferenceDocument(), document, 'projection is cached');
    assert.equal(parseReferenceDocument(document), document);
    const generic = createReference({ input: document, baseUrl: api.baseUrl });
    const projected = nodes(document.children);
    for (const file of api.toFumadocsSource().files) if (file.type === 'page' && file.data.symbolId) {
      const page = projected.find(page => page.url === api.getUrl(file.data.symbolId))!;
      assert.ok(page);
      assert.equal(generic.getUrl(page.id), api.getUrl(file.data.symbolId));
      assert.ok(generic.getPageText(page.id).includes(page.title));
    }
  }
});

test('promoted parameters and properties share definition ranges without duplicating code', () => {
  const api = createApiReference({ input: fixture('mixed') });
  const person = api.document.symbols.find(symbol => symbol.qualifiedName === 'Demo\\Person')!;
  const members = api.getMembers(person.id);
  const constructor = members.find(member => member.kind === 'constructor')!;
  const property = members.find(member => member.name === '$label')!;
  const page = nodes(api.toReferenceDocument().children).find(page => page.url === api.getUrl(person.id))!;
  assert.equal(page.definition!.code.split('$label').length - 1, 1);
  const rows = entries(page.blocks);
  const constructorRanges = rows.find(row => row.id === memberAnchor(constructor.id))!.highlights!;
  const propertyRanges = rows.find(row => row.id === memberAnchor(property.id))!.highlights!;
  assert.ok(propertyRanges.length);
  assert.ok(propertyRanges.every(range => constructorRanges.some(parent => JSON.stringify(parent) === JSON.stringify(range))));
});

test('the portable projection includes syntax-aware URLs and renders without the API component', () => {
  const api = createApiReference({ input: fixture('mixed') });
  const symbol = api.document.symbols.find(symbol => symbol.qualifiedName === 'Demo\\format')!;
  const person = api.document.symbols.find(symbol => symbol.qualifiedName === 'Demo\\Person')!;
  const document = api.toReferenceDocument();
  const page = nodes(document.children).find(page => page.url === api.getUrl(symbol.id))!;
  const links = page.definition!.links!;
  assert.ok(links.some(link => link.url === api.getUrl(person.id)));
  for (const link of links) assert.ok(page.definition!.code.slice(link.start, link.end));
  const html = renderToString(<ReferencePage page={page} document={document} />);
  assert.ok(html.includes(`href="${api.getUrl(person.id)}"`));
  assert.ok(html.includes('Parameters'));
});

test('embedded trait occurrences have unique identities and preserve canonical member anchors', () => {
  const input = {
    schemaVersion: 1, generator: { name: 'refquill', version: 'test' }, title: 'Traits', fingerprint: 'a'.repeat(64),
    inputs: [{ name: 'PHP API', language: 'php' }], types: [], symbols: [
      { id: 'trait', input: 0, kind: 'trait', name: 'Shared', declaration: 'trait Shared' },
      { id: 'run', input: 0, kind: 'method', name: 'run', parentId: 0, declaration: 'public function run(): void;' },
      { id: 'first', input: 0, kind: 'class', name: 'First', declaration: 'class First', relations: [{ kind: 'uses', name: 'Shared', targetId: 0 }] },
      { id: 'second', input: 0, kind: 'class', name: 'Second', declaration: 'class Second', relations: [{ kind: 'uses', name: 'Shared', targetId: 0 }] },
    ],
  };
  const api = createApiReference({ input });
  const document = parseReferenceDocument(api.toReferenceDocument());
  const occurrences = nodes(document.children).flatMap(node => entries(node.blocks)).filter(entry => entry.id === memberAnchor('run') || entry.anchor === memberAnchor('run'));
  assert.equal(occurrences.length, 3);
  assert.equal(new Set(occurrences.map(entry => entry.id)).size, 3);
  assert.ok(occurrences.filter(entry => entry.anchor).every(entry => JSON.stringify(entry.blocks).includes(api.getUrl('run'))));
});

test('projected links retain original UTF-16 offsets across CRLF and exclude comments and strings', () => {
  const code = '// 🐈\r\nfunction f(\\Demo\\Thing $arg): \\Demo\\Thing;\r\n// \\Demo\\Thing\r\nconst NOTE = "\\Demo\\Thing";\r\nnew \\Demo\\Thing();';
  const input = {
    schemaVersion: 1, generator: { name: 'refquill', version: 'test' }, title: 'Offsets', fingerprint: 'a'.repeat(64),
    inputs: [{ name: 'PHP', language: 'php' }], types: [], symbols: [
      { id: 'thing', input: 0, kind: 'class', name: 'Thing', group: 'Demo', declaration: 'class Thing' },
      { id: 'function', input: 0, kind: 'function', name: 'f', group: 'Demo', declaration: code },
    ],
  };
  const api = createApiReference({ input });
  const document = parseReferenceDocument(api.toReferenceDocument());
  const page = nodes(document.children).find(page => page.url === api.getUrl('function'))!;
  const links = page.definition!.links!;
  assert.equal(links.length, 3);
  assert.ok(links.every(link => code.slice(link.start, link.end) === '\\Demo\\Thing'));
  assert.equal(links.at(-1)!.start, code.lastIndexOf('\\Demo\\Thing'));
});

test('object parameters expose recursive compiler properties and target their definition', () => {
  const api = createApiReference({ input: fixture('mixed') });
  const symbol = api.document.symbols.find(symbol => symbol.qualifiedName === 'configure')!;
  const page = nodes(api.toReferenceDocument().children).find(page => page.url === api.getUrl(symbol.id))!;
  const rows = entries(page.blocks);
  const parameter = rows.find(row => row.id.endsWith('-param-0'))!;
  assert.equal(parameter.display, 'disclosure');
  assert.equal(typeof parameter.title === 'string' ? parameter.title : parameter.title.code, '{ retry, connection }');
  assert.ok(parameter.highlights?.length);
  const retry = rows.find(row => row.description === 'Number of retry attempts.')!;
  assert.equal(retry.badges![0].label, 'optional');
  assert.ok(rows.some(row => row.description === 'Destination hostname.'));
  assert.ok(rows.some(row => row.display === 'disclosure' && typeof row.title !== 'string' && row.title.code === 'connection'));
  const html = renderToString(<ReferencePage page={page} />);
  assert.ok(!html.includes('Permalink'));
  assert.ok(html.includes('data-reference-declaration'));
});

test('Rust fields highlight their existing declaration and impl traits are not repeated as relationships', () => {
  const api = createApiReference({ input: fixture('rust') });
  const document = api.toReferenceDocument();
  const pages = nodes(document.children);
  const field = api.document.symbols.find(symbol => symbol.kind === 'property' && symbol.parentId && api.getSymbol(symbol.parentId).kind === 'struct')!;
  assert.ok(field);
  const page = pages.find(page => page.url === api.getUrl(field.id).split('#')[0])!;
  const row = entries(page.blocks).find(entry => entry.id === memberAnchor(field.id))!;
  assert.ok(row.highlights!.length);
  const line = row.highlights![0].range.start.line;
  assert.ok(page.definition!.code.split('\n')[line - 1].includes(field.name));
  for (const entry of pages.flatMap(page => entries(page.blocks)).filter(entry => entry.type?.key === 'impl')) {
    assert.ok(!entry.blocks?.some(block => block.kind === 'section' && block.title === 'Relationships'));
  }
});

test('optional and required TypeScript property labels retain type links and consistent syntax colors', () => {
  const input = {
    schemaVersion: 1, generator: { name: 'refquill', version: 'test' }, title: 'Parameters', fingerprint: 'a'.repeat(64),
    inputs: [{ name: 'TS', language: 'typescript' }], types: [
      { text: '{ icons?: IconMap; kind: Kind }' },
      { text: 'IconMap', references: [{ name: 'IconMap', targetId: 0 }] },
      { text: 'Kind', references: [{ name: 'Kind', targetId: 1 }] },
    ], symbols: [
      { id: 'icons-type', input: 0, kind: 'interface', name: 'IconMap', declaration: 'interface IconMap {}' },
      { id: 'kind-type', input: 0, kind: 'type-alias', name: 'Kind', declaration: 'type Kind = string;' },
      { id: 'function', input: 0, kind: 'function', name: 'render', declaration: 'function render(options: { icons?: IconMap; kind: Kind }): void;', signatures: [{ parameters: [{ name: 'options', type: 0, properties: [{ name: 'icons', optional: true, type: 1 }, { name: 'kind', type: 2 }] }] }] },
    ],
  };
  const api = createApiReference({ input });
  const document = parseReferenceDocument(api.toReferenceDocument());
  const page = nodes(document.children).find(page => page.url === api.getUrl('function'))!;
  const properties = entries(page.blocks).filter(row => row.id.includes('-property-'));
  for (const [row, name, id] of [[properties[0], 'IconMap', 'icons-type'], [properties[1], 'Kind', 'kind-type']] as const) {
    const title = row.title;
    assert.ok(typeof title !== 'string');
    assert.ok(title.links?.some(link => title.code.slice(link.start, link.end) === name && link.url === api.getUrl(id)));
  }
  const html = properties.map(entry => renderToString(<ReferencePage page={{ kind: 'page', id: 'property', title: 'Property', blocks: [entry] }} />));
  const optionalStyle = /style="([^"]+)">icons<\/span>/.exec(html[0])?.[1];
  assert.ok(optionalStyle);
  assert.equal(/style="([^"]+)">kind<\/span>/.exec(html[1])?.[1], optionalStyle);
  assert.ok(!html.some(value => value.includes('__Refquill')));
});

test('type aliases display compiler union alternatives and nested generic arguments without an Overview wrapper', () => {
  const api = createApiReference({ input: fixture('mixed') });
  const document = parseReferenceDocument(api.toReferenceDocument());
  const mode = api.document.symbols.find(symbol => symbol.qualifiedName === 'Mode')!;
  const generic = api.document.symbols.find(symbol => symbol.qualifiedName === 'AccountsByMode')!;
  const modePage = nodes(document.children).find(page => page.url === api.getUrl(mode.id))!;
  assert.ok(!modePage.blocks.some(block => block.kind === 'section' && block.title === 'Overview'));
  assert.equal(modePage.blocks[0].kind, 'section');
  const alternatives = entries(modePage.blocks).filter(entry => entry.type?.key === 'type-alternative');
  assert.equal(alternatives.length, 2);
  assert.ok(alternatives.every(entry => entry.display === 'static'));
  const genericPage = nodes(document.children).find(page => page.url === api.getUrl(generic.id))!;
  const names = entries(genericPage.blocks).map(entry => typeof entry.title === 'string' ? entry.title : entry.title.code);
  assert.ok(names.includes('Partial'));
  assert.ok(names.includes('Record'));
  assert.ok(names.includes('Account'));
  assert.equal(genericPage.definition!.code, generic.declaration, 'the exact declaration remains available');
});

test('compiler external origins distinguish React Element from a local declaration with the same name', () => {
  const input = {
    schemaVersion: 1, generator: { name: 'refquill', version: 'test' }, title: 'External types', fingerprint: 'a'.repeat(64),
    inputs: [{ name: 'TS', language: 'typescript' }], types: [{ text: 'Element', references: [{ name: 'Element', package: '@types/react', qualifiedName: 'React.JSX.Element' }] }],
    symbols: [
      { id: 'local', input: 0, kind: 'interface', name: 'Element', declaration: 'interface Element {}' },
      { id: 'component', input: 0, kind: 'function', name: 'Component', declaration: 'function Component(): Element;', signatures: [{ returns: 0 }] },
    ],
  };
  const url = 'https://react.dev/reference/react/createElement#returns';
  const api = createApiReference({ input, resolveExternal: (_name, context) => context.reference?.package === '@types/react' && context.reference.qualifiedName === 'React.JSX.Element' ? url : null });
  assert.equal(api.resolveLink('Element', { language: 'typescript', symbolId: 'component' })?.url, url);
  assert.equal(api.resolveLink('Element', { language: 'typescript' })?.url, api.getUrl('local'));
  const document = api.toReferenceDocument();
  const page = nodes(document.children).find(page => page.url === api.getUrl('component'))!;
  const html = renderToString(<ReferencePage document={document} page={page} />);
  assert.ok(html.includes(`href="${url}"`));
});


test('callback properties and nested options expose documented parameter children', () => {
  const api = createApiReference({ input: fixture('mixed') });
  const document = parseReferenceDocument(api.toReferenceDocument());
  const pages = nodes(document.children);
  for (const name of ['RenderOptions', 'renderWith']) {
    const symbol = api.document.symbols.find(symbol => symbol.qualifiedName === name)!;
    const page = pages.find(page => page.url === api.getUrl(symbol.id))!;
    const rows = entries(page.blocks);
    assert.ok(rows.some(row => row.description === 'Text to render.'));
    assert.ok(rows.some(row => row.description === 'Rendered text.'));
    const options = rows.find(row => row.description === 'Rendering settings.')!;
    assert.equal(options.display, 'disclosure');
    assert.ok(entries(options.blocks!).some(row => typeof row.title !== 'string' && row.title.code === 'compact?: boolean'));
    if (name === 'renderWith') {
      const callback = rows.find(row => row.description === 'Render a value.')!;
      assert.equal(callback.display, 'disclosure');
      assert.equal(typeof callback.title === 'string' ? callback.title : callback.title.code, 'render?');
    }
  }
});

test('generic argument headings use known roles and compiler documentation without guessing local names', () => {
  const api = createApiReference({ input: fixture('mixed') });
  const pages = nodes(api.toReferenceDocument().children);
  const page = (name: string) => pages.find(page => page.url === api.getUrl(api.document.symbols.find(symbol => symbol.qualifiedName === name)!.id))!;
  const titles = (blocks: ReferenceBlock[]): string[] => blocks.flatMap(block => block.kind === 'section' ? [block.title, ...titles(block.blocks)] : block.kind === 'entry' ? titles(block.blocks ?? []) : []);
  assert.ok(titles(page('AccountsByMode').blocks).includes('Object type'));
  assert.ok(titles(page('AccountsByMode').blocks).includes('Keys'));
  assert.ok(titles(page('AccountsByMode').blocks).includes('Value type'));
  assert.ok(titles(page('AccountBox').blocks).includes('Value'));
  assert.ok(JSON.stringify(page('AccountBox').blocks).includes('The stored value.'));
});
