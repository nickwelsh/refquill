import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loader } from 'fumadocs-core/source';
import type { ReferenceDocument, ReferenceNode } from '@nickwelsh/refquill-schema';
import { collectReferencePage, createReference } from '../src/reference.js';

const page = (id: string, title: string, url?: string): ReferenceNode => ({ kind: 'page', id, title, blocks: [], ...(url ? { url } : {}) });
const document = (children: ReferenceNode[]): ReferenceDocument => ({ schemaVersion: 1, title: 'Reference', children });

test('routing resolves collisions deterministically and reserves explicit and natural routes', () => {
  const children = [page('b', 'Same'), page('a', 'Same'), page('c', 'Same--b'), page('z', 'Custom', '/reference/Same')];
  const reference = createReference({ input: document(children) });
  const reversed = createReference({ input: document([...children].reverse()) });
  for (const child of children) assert.equal(reference.getUrl(child.id), reversed.getUrl(child.id));
  assert.equal(reference.getUrl('z'), '/reference/Same');
  assert.equal(reference.getUrl('a'), '/reference/Same--a');
  assert.equal(reference.getUrl('b'), '/reference/Same--b-2');
  assert.equal(reference.getUrl('c'), '/reference/Same--b');
  assert.equal(children[0].url, undefined, 'projection must not mutate its input');
  const urls = loader({ baseUrl: reference.baseUrl, source: reference.toFumadocsSource() }).getPages().map(value => value.url);
  for (const child of children) assert.ok(urls.includes(reference.getUrl(child.id)));
});

test('source construction is stable and root identity cannot collide with document targets', () => {
  const input = document([{
    ...page('one', 'One'), blocks: [{ kind: 'section', id: '$reference-root', title: 'Section', blocks: [] }],
  }]);
  const reference = createReference({ input });
  const first = reference.toFumadocsSource();
  assert.deepEqual(reference.toFumadocsSource(), first);
  assert.deepEqual(reference.toFumadocsSource(), first);
  const root = first.files.find(value => value.type === 'page' && value.slugs.length === 0)!;
  assert.equal(root.type, 'page');
  if (root.type !== 'page') assert.fail();
  assert.equal(root.data.nodeId, '$reference-root$');
  assert.equal(reference.getNode(root.data.nodeId).title, 'Reference');
  assert.equal(reference.getUrl(root.data.nodeId), '/reference');
  assert.equal(reference.getUrl('$reference-root'), '/reference/One#%24reference-root');
});

test('directories supply landing content, nested routes, and navigation metadata', () => {
  const reference = createReference({ input: document([{
    kind: 'directory', id: 'module', title: 'Network', description: 'Networking **tools**.', type: { key: 'module', label: 'Module' },
    blocks: [{ kind: 'markdown', value: 'Module overview.' }], children: [page('client', 'Client')],
  }]) });
  const source = loader({ baseUrl: reference.baseUrl, source: reference.toFumadocsSource() });
  const landing = source.getPages().find(value => value.data.nodeId === 'module')!;
  assert.equal(landing.url, '/reference/Network');
  assert.equal(landing.data.description, 'Networking tools.');
  assert.ok(landing.data.structuredData.contents.some(value => value.content === 'Module overview.'));
  assert.equal(reference.getUrl('client'), '/reference/Network/Client');
  const network = source.pageTree.children.find(value => value.type === 'folder' && value.name === 'Network');
  assert.ok(network && network.type === 'folder');
  assert.deepEqual(network.children.map(value => ({ type: value.type, name: value.name })), [{ type: 'page', name: 'Client' }]);
  assert.ok(!reference.getPageText('module').includes('[Client](/reference/Network/Client)'), 'explicit directory content owns its listings');
  const automatic = createReference({ input: document([{ kind: 'directory', id: 'automatic', title: 'Automatic', blocks: [], children: [page('child', 'Child')] }]) });
  assert.ok(automatic.getPageText('automatic').includes('[Child](/reference/Automatic/Child)'));
  assert.ok(reference.toFumadocsSource().files.some(value => value.type === 'meta' && value.data.title === 'Network' && value.data.pagesIndex === '$index'));
});

test('explicit nested routes cannot collide with source metadata or index filenames', () => {
  const reference = createReference({ input: document([{
    kind: 'directory', id: 'dir', title: 'Directory', url: '/reference/dir', blocks: [], children: [
      page('meta', 'Metadata', '/reference/dir/meta.json'),
      page('index', 'Index', '/reference/dir/$index.mdx'),
      page('nested', 'Nested', '/reference/dir/meta.json/child'),
    ],
  }]) });
  const files = reference.toFumadocsSource().files;
  assert.equal(new Set(files.map(value => value.path)).size, files.length);
  for (const file of files) assert.ok(!files.some(other => other.path.startsWith(`${file.path}/`)), file.path);
  const urls = loader({ baseUrl: reference.baseUrl, source: { files } }).getPages().map(value => value.url);
  for (const id of ['dir', 'meta', 'index', 'nested']) assert.ok(urls.includes(reference.getUrl(id)), id);
});

test('duplicate custom URLs, aliases, encoded traversal, and routes outside the base are rejected', () => {
  for (const urls of [
    ['/reference/Same', '/reference/same'],
    ['/reference/A', '/reference/%41'],
    ['/reference/valid', '/outside/page'],
    ['/reference/valid', '/reference/%2e%2e/private'],
    ['/reference/valid', '/reference/a%2fb'],
  ]) assert.throws(() => createReference({ input: document(urls.map((url, index) => page(`p${index}`, `Page ${index}`, url))) }), /URL/);
});

test('a sole top-level node may own the base URL without an extra root landing page', () => {
  const reference = createReference({ input: document([{
    kind: 'directory', id: 'home', title: 'Home', url: '/reference', blocks: [], children: [page('child', 'Child')],
  }]) });
  const source = loader({ baseUrl: reference.baseUrl, source: reference.toFumadocsSource() });
  assert.equal(source.getPages().length, 2);
  assert.equal(source.getPages().find(value => value.data.nodeId === 'home')!.url, '/reference');
  assert.equal(reference.getUrl('child'), '/reference/Child');
  assert.throws(() => createReference({ input: document([page('home', 'Home', '/reference'), page('other', 'Other')]) }), /sole top-level/);
  const atRoot = createReference({ input: document([page('home', 'Home', '/')]), baseUrl: '/' });
  assert.equal(atRoot.getUrl('home'), '/');
  assert.equal(atRoot.toFumadocsSource().files.filter(value => value.type === 'page').length, 1);
});

test('stable targets include definition IDs and honor explicit section and entry anchors', () => {
  const input = document([{
    ...page('client', 'Client'), definition: { id: 'definition', language: 'typescript', code: 'type Client = string;' },
    blocks: [{ kind: 'section', id: 'section', anchor: 'methods', title: 'Methods', blocks: [{
      kind: 'entry', id: 'occurrence', anchor: 'canonical-member', title: 'request', display: 'static',
      blocks: [{ kind: 'code', definition: { id: 'example', language: 'typescript', code: 'request();' } }],
    }] }],
  }]);
  const reference = createReference({ input });
  assert.equal(reference.getUrl('definition'), '/reference/Client#definition');
  assert.equal(reference.getUrl('section'), '/reference/Client#methods');
  assert.equal(reference.getUrl('occurrence'), '/reference/Client#canonical-member');
  assert.equal(reference.getUrl('example'), '/reference/Client#example');
  const collected = collectReferencePage(reference.getNode('client'));
  assert.deepEqual(collected.toc.map(value => value.url), ['#methods', '#canonical-member']);
  assert.deepEqual(collected.structuredData.headings.map(value => value.id), ['methods', 'canonical-member']);
  assert.ok(collected.text.includes('{#canonical-member}'));
});

test('TOC, search, and Markdown include collapsed nested bodies, labels, badges and code syntax', () => {
  const input = document([{
    ...page('client', 'Client'), badges: [{ label: 'Preview' }], type: { key: 'class', label: 'Class' },
    blocks: [{ kind: 'entry', id: 'method', title: { code: 'request<T>()', language: 'typescript' }, display: 'disclosure', defaultOpen: false,
      badges: [{ label: 'Hidden badge', visibility: 'closed' }], blocks: [{ kind: 'section', id: 'args', title: 'Arguments', blocks: [
        { kind: 'markdown', value: 'Hidden **argument** documentation.' },
        { kind: 'code', definition: { id: 'example', language: 'typescript', code: 'request<Result>(); // ````' } },
      ] }],
    }],
  }]);
  const reference = createReference({ input });
  const node = reference.getNode('client');
  const collected = collectReferencePage(node);
  for (const value of ['Preview', 'Class', 'request<T>()', 'Hidden badge', 'Hidden **argument** documentation.', 'request<Result>();', '`````typescript']) assert.ok(collected.text.includes(value), value);
  const search = collected.structuredData.contents.map(value => value.content).join('\n');
  for (const value of ['request<T>()', 'Hidden argument documentation.', 'request<Result>();', 'Hidden badge']) assert.ok(search.includes(value), value);
  assert.deepEqual(collected.toc.map(value => value.url), ['#method', '#args']);
  assert.ok(collected.structuredData.contents.every(value => value.heading === undefined || collected.structuredData.headings.some(heading => heading.id === value.heading)));
  assert.equal(reference.getPageText('client'), collected.text);
  const metadata = collectReferencePage(node, { codeMeta: 'api' });
  assert.ok(metadata.text.includes('`````typescript api'));
  assert.deepEqual(metadata.structuredData, collected.structuredData);
});
