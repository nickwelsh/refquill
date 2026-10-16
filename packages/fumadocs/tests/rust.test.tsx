import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { codeToHast, codeToHtml } from 'shiki';
import { loader } from 'fumadocs-core/source';
import type { Folder, Node } from 'fumadocs-core/page-tree';
import { createApiReference, memberAnchor, transformerApiReference } from '../src/index.js';
import { ApiReference, apiReferenceIcon } from '../src/components.js';
import { declarationOutline } from '../src/declarations.js';

const fixture = {
  schemaVersion: 1, generator: { name: 'refquill', version: 'test' }, title: 'Rust API', fingerprint: 'a'.repeat(64),
  inputs: [{ name: 'Rust', language: 'rust' }],
  types: [{ text: 'ImportedRecord', references: [{ name: 'ImportedRecord', targetId: 1 }] }],
  symbols: [
    { id: 'module', input: 0, kind: 'module', name: 'demo', declaration: 'pub mod demo' },
    { id: 'record', input: 0, kind: 'struct', name: 'Record', qualifiedName: 'demo::api::Record', group: 'demo::api', parentId: 0, declaration: 'pub struct Record {\n    pub value: u64,\n}', description: 'See [State] and [wrap!].', rustdocId: '1' },
    { id: 'value', input: 0, kind: 'property', name: 'value', parentId: 1, declaration: 'pub value: u64' },
    { id: 'impl', input: 0, kind: 'impl', name: 'impl Record', parentId: 1, qualifiedName: 'demo::api::Record::{impl#0}', declaration: 'impl Record {\n    pub fn new() -> Self;\n}' },
    { id: 'new', input: 0, kind: 'method', name: 'new', parentId: 3, qualifiedName: 'demo::api::Record::impl Record#0::new', declaration: 'pub fn new() -> ImportedRecord', signatures: [{ returns: 0 }] },
    { id: 'state', input: 0, kind: 'enum', name: 'State', qualifiedName: 'demo::api::State', group: 'demo::api', parentId: 0, declaration: 'pub enum State { Named { payload: u64 } }', rustdocId: '5' },
    { id: 'named', input: 0, kind: 'enum-case', name: 'Named', parentId: 5, declaration: 'Named { payload: u64 }' },
    { id: 'payload', input: 0, kind: 'property', name: 'payload', parentId: 6, declaration: 'payload: u64', description: 'The named variant payload.' },
    { id: 'wrap', input: 0, kind: 'macro', name: 'wrap', qualifiedName: 'demo::api::wrap', group: 'demo::api', parentId: 0, declaration: 'macro_rules! wrap { ($value:expr) => { ... }; }', rustdocId: '8' },
    { id: 'union', input: 0, kind: 'union', name: 'Bits', qualifiedName: 'demo::api::Bits', group: 'demo::api', parentId: 0, declaration: 'pub union Bits { pub raw: u64 }' },
    { id: 'primitive', input: 0, kind: 'primitive', name: 'u64', group: 'demo::api', parentId: 0, declaration: 'u64' },
    { id: 'extern', input: 0, kind: 'extern-type', name: 'Foreign', group: 'demo::api', parentId: 0, declaration: 'extern "C" { pub type Foreign; }' },
  ],
  rustdoc: [{ api: 'Rust', data: { format_version: 57, index: { '1': { links: { State: 5, 'wrap!': 8 } }, '5': {}, '8': {} }, paths: {}, external_crates: {} } }],
};
const reference = createApiReference({ input: fixture });

test('Rust uses field, variant, associated-item, and static terminology throughout its presentation', () => {
  assert.equal(reference.getSymbolKind('value'), 'field');
  assert.equal(reference.getSymbolKind('payload'), 'field');
  assert.equal(reference.getSymbolKind('named'), 'variant');
  assert.equal(reference.getSymbolKind('new'), 'associated-function');
  const record = renderToString(<ApiReference reference={reference} symbolId="record" />);
  assert.ok(record.includes('<h2>Fields</h2>'));
  assert.ok(record.includes('data-reference-type="field"'));
  assert.ok(record.includes('refquill-entry-type">field</span>'));
  assert.ok(!record.includes('<h2>Members</h2>'));
  const state = renderToString(<ApiReference reference={reference} symbolId="state" />);
  assert.ok(state.includes('<h2>Variants</h2>'));
  assert.match(state, /<h[2-6]>Fields<\/h[2-6]>/, 'variant payloads contain fields');
  assert.ok(state.includes('data-reference-type="variant"'));
  const implementation = renderToString(<ApiReference reference={reference} symbolId="impl" />);
  assert.ok(implementation.includes('<h2>Associated functions</h2>'));
  const input = JSON.parse(readFileSync(new URL('../../../tests/output/rust.json', import.meta.url), 'utf8'));
  const api = createApiReference({ input });
  for (const [kind, presentation] of [['type-alias', 'associated-type'], ['constant', 'associated-constant'], ['variable', 'static']] as const) {
    const symbol = api.document.symbols.find(symbol => symbol.kind === kind && (kind === 'variable' || (symbol.parentId && ['trait', 'impl'].includes(api.getSymbol(symbol.parentId).kind))))!;
    assert.ok(symbol, `compiler fixture has ${presentation}`);
    assert.equal(api.getSymbolKind(symbol.id), presentation);
  }
  const method = api.document.symbols.find(symbol => symbol.kind === 'method' && symbol.signatures.some(signature => signature.parameters.some(parameter => parameter.name === 'self')))!;
  assert.ok(method);
  assert.equal(api.getSymbolKind(method.id), 'method');
  assert.ok(renderToString(<ApiReference reference={api} symbolId={method.parentId!} />).includes('<h2>Methods</h2>'));
});

test('Rust keywords stay unlinked while raw identifiers and qualified paths link', async () => {
  const code = 'pub struct r#struct { value: crate::r#struct }';
  const html = await codeToHtml(code, {
    lang: 'rust', theme: 'github-light', meta: { __raw: 'api' },
    transformers: [transformerApiReference(name => name.replace(/r#/g, '').endsWith('struct') ? { name, label: name, url: '/raw-struct' } : null)],
  });
  assert.equal((html.match(/href="\/raw-struct"/g) ?? []).length, 2);
});

test('Rust compiler IDs link external aliases, declaration fields, and Markdown to recorded documentation roots', async () => {
  const input = structuredClone(fixture);
  const data: any = input.rustdoc[0].data;
  input.symbols[1].description = 'See [Deserialize].';
  input.symbols[2].rustdocId = '2';
  input.symbols[3].rustdocId = '3';
  input.symbols[4].rustdocId = '4';
  data.index['1'].links.Deserialize = 101;
  data.index['2'] = { inner: { struct_field: { resolved_path: { path: 'String', id: 100 } } } };
  data.index['3'] = { inner: { impl: { trait: { path: 'Deserialize', id: 101 }, for: { resolved_path: { path: 'Record', id: 1 } } } } };
  data.index['4'] = { inner: { function: { sig: { output: { resolved_path: { path: '$crate::fmt::Formatter', id: 104 } } } } } };
  data.index['105'] = { inner: { function: { has_body: false } } };
  data.paths = {
    '100': { crate_id: 1, kind: 'struct', path: ['alloc', 'string', 'String'] },
    '101': { crate_id: 2, kind: 'trait', path: ['serde_core', 'de', 'Deserialize'] },
    '102': { crate_id: 3, kind: 'struct', path: ['bad', 'Unsafe'] },
    '103': { crate_id: 4, kind: 'struct', path: ['missing', 'Unknown'] },
    '104': { crate_id: 5, kind: 'struct', path: ['core', 'fmt', 'Formatter'] },
    '105': { crate_id: 2, kind: 'function', path: ['serde_core', 'de', 'Deserialize', 'deserialize'] },
  };
  data.external_crates = {
    '1': { name: 'alloc', html_root_url: 'https://doc.rust-lang.org/1.99.0/' },
    '2': { name: 'serde_core', html_root_url: 'https://docs.rs/serde_core/1.0.229/' },
    '3': { name: 'bad', html_root_url: 'javascript:alert(1)' },
    '4': { name: 'missing', html_root_url: null },
    '5': { name: 'core', html_root_url: 'https://doc.rust-lang.org/1.99.0/' },
  };
  const api = createApiReference({ input });
  const context = { language: 'rust' as const, inputName: 'Rust', symbolId: 'record' };
  const stringUrl = 'https://doc.rust-lang.org/1.99.0/alloc/string/struct.String.html';
  const traitUrl = 'https://docs.rs/serde_core/1.0.229/serde_core/de/trait.Deserialize.html';
  assert.equal(api.resolveLink('String', context)?.url, stringUrl);
  assert.equal(api.resolveLink('alloc::string::String', { language: 'rust', inputName: 'Rust' })?.url, stringUrl);
  assert.equal(api.resolveLink('Deserialize', { ...context, symbolId: 'impl' })?.url, traitUrl);
  assert.equal(api.getDocumentationLinks('record').find(link => link.name === 'Deserialize')?.url, traitUrl);
  assert.equal(api.resolveLink('serde_core::de::Deserialize::deserialize', { language: 'rust', inputName: 'Rust' })?.url, `${traitUrl}#tymethod.deserialize`);
  for (const name of ['bad::Unsafe', 'missing::Unknown', 'String']) assert.equal(api.resolveLink(name, { language: 'rust', inputName: 'Rust' }), null);
  const html = await codeToHtml('pub struct Record { value: String }', { lang: 'rust', theme: 'github-light', meta: { __raw: 'api' }, transformers: [transformerApiReference(api.resolveLink, context)] });
  assert.ok(html.includes(`href="${stringUrl}"`));
  const macroPath = await codeToHtml('$crate::fmt::Formatter', { lang: 'rust', theme: 'github-light', meta: { __raw: 'api' }, transformers: [transformerApiReference(api.resolveLink, { ...context, symbolId: 'new' })] });
  assert.ok(macroPath.includes('href="https://doc.rust-lang.org/1.99.0/core/fmt/struct.Formatter.html"'));
  const docs = renderToString(<ApiReference reference={api} symbolId="record" />);
  assert.ok(docs.includes(`href="${traitUrl}"`));
  assert.ok(!docs.includes('javascript:'));
});

test('the compiler-generated Rust fixture renders every page with complete TOC targets', () => {
  const input = JSON.parse(readFileSync(new URL('../../../tests/output/rust.json', import.meta.url), 'utf8'));
  const api = createApiReference({ input });
  const source = loader({ baseUrl: api.baseUrl, source: api.toFumadocsSource() });
  assert.ok(api.document.symbols.some(symbol => symbol.kind === 'impl' && symbol.modifiers.includes('blanket')));
  assert.ok(api.document.symbols.some(symbol => symbol.kind === 'reexport'));
  for (const page of source.getPages()) {
    const html = renderToString(<ApiReference reference={api} {...page.data} />);
    for (const item of page.data.toc) assert.ok(html.includes(`id="${item.url.slice(1)}"`), `${page.url} is missing ${item.url}`);
  }
});

test('Rust implementations and their members live on their owning type page', () => {
  const source = loader({ baseUrl: '/api', source: reference.toFumadocsSource(), icon: apiReferenceIcon });
  assert.equal(reference.getNamespaceUrl('Rust', 'demo::api'), '/api/Rust/api');
  assert.equal(reference.getNamespace('Rust', 'demo::api').name, 'demo::api');
  assert.equal(reference.getUrl('record'), '/api/Rust/api/Record');
  assert.equal(reference.getUrl('impl'), `${reference.getUrl('record')}#${memberAnchor('impl')}`);
  assert.equal(reference.getUrl('new'), `${reference.getUrl('record')}#${memberAnchor('new')}`);
  const recordPage = source.getPageByUrl(reference.getUrl('record'))!;
  assert.ok(!source.getPages().some(page => page.data.symbolId === 'impl'));
  assert.ok(recordPage.data.toc.some(item => item.url === `#${memberAnchor('new')}`));
  assert.ok(recordPage.data.structuredData.contents.some(item => item.content.includes('pub fn new()')));
  const html = renderToString(<ApiReference reference={reference} symbolId="record" />);
  assert.ok(html.includes('<h2>Implementations</h2>'));
  assert.ok(html.includes(`id="${memberAnchor('impl')}"`));
  assert.ok(html.includes(`id="${memberAnchor('new')}"`));
  const listing = renderToString(<ApiReference reference={reference} inputName="Rust" namespace="demo::api" />);
  assert.ok(!listing.includes(reference.getUrl('impl')));
  assert.ok(!reference.getPageText({ inputName: 'Rust', namespace: 'demo::api', symbolId: null }).includes(reference.getUrl('impl')));
  for (const title of ['Structs', 'Enums', 'Unions', 'Macros', 'Primitives', 'Extern types']) assert.ok(listing.includes(`<h2>${title}</h2>`));
  for (const kind of ['struct', 'union', 'impl', 'macro', 'primitive', 'extern-type']) assert.ok(renderToString(apiReferenceIcon(`refquill-${kind}`)).includes(`data-kind="${kind}"`));
});

test('implementation members render inherited descriptions and trait links without redundant kind badges', () => {
  const input = structuredClone(fixture);
  input.symbols[3].rustdocId = '3';
  input.symbols[4].rustdocId = '4';
  input.symbols[4].description = 'Build a [State].';
  const index: any = input.rustdoc[0].data.index;
  index['3'] = { inner: { impl: { trait: { id: 200 } } } };
  index['4'] = { id: 4, docs: null, links: {} };
  index['200'] = { inner: { trait: { items: [201] } } };
  index['201'] = { name: 'new', docs: 'Build a [State].', links: { State: 5 } };
  const api = createApiReference({ input });
  const html = renderToString(<ApiReference reference={api} symbolId="record" />);
  assert.ok(html.includes(`Build a <a href="${api.getUrl('state')}">State</a>.`));
  assert.ok(!html.includes('data-kind="associated function"'));
  assert.ok(html.includes('--shiki-light:'));
  assert.ok(html.includes('--shiki-dark:'));
  assert.ok(api.getPageText({ inputName: 'Rust', namespace: null, symbolId: 'record' }).includes('Build a [State].'));
});

test('Rust modules own their namespace indexes, including empty modules, without duplicate sidebar entries', () => {
  const input = structuredClone(fixture);
  input.symbols.push({ id: 'api-module', input: 0, kind: 'module', name: 'api', qualifiedName: 'demo::api', group: 'demo', parentId: 0, declaration: 'pub mod api', description: 'Public API module.' } as typeof input.symbols[number]);
  input.symbols.push({ id: 'empty-module', input: 0, kind: 'module', name: 'empty', qualifiedName: 'demo::api::empty', group: 'demo::api', parentId: input.symbols.length - 1, declaration: 'pub mod empty', description: 'An empty module.' } as typeof input.symbols[number]);
  const api = createApiReference({ input });
  const source = loader({ baseUrl: api.baseUrl, source: api.toFumadocsSource(), icon: apiReferenceIcon });
  const folders = (nodes: Node[]): Folder[] => nodes.flatMap(node => node.type === 'folder' ? [node, ...folders(node.children)] : []);
  const allFolders = folders(source.pageTree.children);
  assert.equal(api.getNamespaceUrl('Rust', 'demo'), api.getNamespaceUrl('Rust'));
  assert.equal(api.getUrl('module'), '/api/Rust');
  assert.equal(api.getUrl('api-module'), api.getNamespaceUrl('Rust', 'demo::api'));
  assert.equal(api.getUrl('empty-module'), '/api/Rust/api/empty');
  assert.deepEqual(allFolders.map(folder => folder.name), ['demo', 'api', 'empty']);
  for (const id of ['module', 'api-module', 'empty-module']) {
    assert.equal(source.getPages().filter(page => page.data.symbolId === id).length, 1);
    const page = source.getPageByUrl(api.getUrl(id))!;
    assert.equal(page.data.symbolId, id);
    const folder = allFolders.find(folder => folder.index?.url === page.url)!;
    assert.ok(folder);
    assert.ok(!folder.children.some(node => node.type === 'page' && node.url === page.url));
  }
  assert.ok(!allFolders.some(folder => folder.children.some(node => node.type === 'page' && node.url === api.getUrl('impl'))));
  assert.ok(source.getPageByUrl(api.getUrl('impl').split('#')[0]), 'implementations have an owning page');
  assert.ok(!source.getPages().some(page => page.data.symbolId === 'impl'));
  const page = source.getPageByUrl(api.getUrl('api-module'))!;
  const html = renderToString(<ApiReference reference={api} {...page.data} />);
  assert.ok(html.includes('Public API module.'));
  assert.ok(html.includes(api.getUrl('empty-module')));
  assert.ok(!html.includes(api.getUrl('impl')));
  assert.ok(api.getPageText(page.data).includes('Public API module.'));
});

test('Rust implementation categories match rustdoc in rendered pages, TOCs, and Markdown', () => {
  const input = JSON.parse(readFileSync(new URL('../../../tests/output/rust.json', import.meta.url), 'utf8'));
  const api = createApiReference({ input });
  const owner = api.document.symbols.find(symbol => api.getImplementationGroups(symbol.id).length === 4)!;
  assert.ok(owner, 'compiler fixture contains every implementation category');
  const groups = api.getImplementationGroups(owner.id);
  assert.deepEqual(groups.map(group => group.title), ['Implementations', 'Trait implementations', 'Auto trait implementations', 'Blanket implementations']);
  const impls = api.getMembers(owner.id).filter(symbol => symbol.kind === 'impl');
  assert.deepEqual(groups.flatMap(group => group.symbols.map(symbol => symbol.id)).sort(), impls.map(symbol => symbol.id).sort());
  const source = loader({ baseUrl: api.baseUrl, source: api.toFumadocsSource() });
  const page = source.getPageByUrl(api.getUrl(owner.id))!;
  const html = renderToString(<ApiReference reference={api} {...page.data} />);
  const markdown = api.getPageText(page.data);
  for (const group of groups) {
    assert.ok(html.includes(`id="${group.id}"`));
    assert.ok(html.includes(`<h2>${group.title}</h2>`));
    assert.ok(page.data.toc.some(item => item.url === `#${group.id}`));
    assert.ok(markdown.includes(`## ${group.title}`));
    for (const implementation of group.symbols) {
      assert.ok(html.includes(`id="${memberAnchor(implementation.id)}"`));
      assert.equal(api.getUrl(implementation.id).split('#')[0], page.url);
    }
  }
  assert.ok(!source.getPages().some(page => page.data.symbolId && api.getSymbol(page.data.symbolId).kind === 'impl'));
  for (const symbol of api.document.symbols.filter(symbol => symbol.kind === 'module')) {
    const namespace = api.getNamespace(symbol.api, symbol.qualifiedName);
    assert.ok(!namespace.symbols.some(member => member.kind === 'impl'));
    const modulePage = source.getPageByUrl(api.getUrl(symbol.id))!;
    assert.ok(!api.getPageText(modulePage.data).includes('impl '));
  }
});

test('Rust definitions retain compiler shapes and nested variant fields remain reachable', () => {
  for (const id of ['record', 'state', 'impl', 'union']) {
    const symbol = reference.getSymbol(id);
    assert.equal(declarationOutline(symbol, reference.getMembers(id)).code, symbol.declaration);
  }
  const html = renderToString(<ApiReference reference={reference} symbolId="state" />);
  assert.ok(html.includes(`id="${memberAnchor('payload')}"`));
  assert.ok(html.includes('The named variant payload.'));
  assert.equal(reference.getUrl('payload'), `${reference.getUrl('state')}#${memberAnchor('payload')}`);
  assert.ok(!html.includes('data-kind="modifier">public</span>'), 'Rust enum payload fields do not acquire invented visibility');
  const page = loader({ baseUrl: '/api', source: reference.toFumadocsSource() }).getPageByUrl(reference.getUrl('state'))!;
  assert.ok(page.data.structuredData.contents.some(item => item.content.includes('The named variant payload.')));
  assert.ok(reference.getPageText(page.data).includes('```rust api'));
});

test('Rust paths, macro calls and compiler-resolved documentation links work', async () => {
  const context = { language: 'rust' as const, inputName: 'Rust', group: 'demo::api' };
  for (const path of ['Record', 'demo::api::Record', 'crate::api::Record', 'self::Record', 'super::api::Record']) assert.equal(reference.resolveLink(path, context)?.url, reference.getUrl('record'));
  assert.equal(reference.resolveLink('wrap!', context)?.url, reference.getUrl('wrap'));
  assert.equal(reference.resolveLink('Record::new', context)?.url, reference.getUrl('new'));
  assert.equal(reference.resolveLink('ImportedRecord', { ...context, symbolId: 'new' })?.url, reference.getUrl('record'));
  assert.equal(reference.resolveLink('ImportedRecord', context), null);
  assert.equal(reference.resolveLink('unknown::Record', context), null);
  const code = 'fn build() -> demo::api::Record { wrap!() }';
  const options = { lang: 'rust', theme: 'github-light', meta: { __raw: 'api' }, transformers: [transformerApiReference(reference.resolveLink, context)] };
  const tree = await codeToHast(code, options);
  const textContent = (node: any): string => node.type === 'text' ? node.value : (node.children ?? []).map(textContent).join('');
  assert.equal(textContent(tree), code);
  const html = await codeToHtml(code, options);
  assert.ok(html.includes(`href="${reference.getUrl('record')}"`));
  assert.ok(html.includes(`href="${reference.getUrl('wrap')}"`));
  const protectedHtml = await codeToHtml('"demo::api::Record"; r#"demo::api::Record"#; // demo::api::Record\n', options);
  assert.ok(!protectedHtml.includes('data-reference-name'));
  const docs = renderToString(<ApiReference reference={reference} symbolId="record" />);
  assert.ok(docs.includes(`href="${reference.getUrl('state')}"`));
  assert.ok(docs.includes(`href="${reference.getUrl('wrap')}"`));
});
