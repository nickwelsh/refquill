import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { codeToHast, codeToHtml } from 'shiki';
import { loader } from 'fumadocs-core/source';
import type { Folder, Node } from 'fumadocs-core/page-tree';
import { createApiReference, transformerApiReference, memberAnchor } from '../src/index.js';
import { ApiReference, ApiKindIcon, apiReferenceIcon, defaultApiReferenceIcons, type ApiReferenceIcons } from '../src/components.js';
import { declarationOutline } from '../src/declarations.js';

const input = JSON.parse(readFileSync(new URL('../../../tests/output/mixed.json', import.meta.url), 'utf8'));
const reference = createApiReference({ input, baseUrl: '/api', resolveExternal: name => name === 'DateTimeImmutable' ? 'https://www.php.net/manual/en/class.datetimeimmutable.php' : null });
const person = reference.document.symbols.find(s => s.qualifiedName === 'Demo\\Person')!;
const declarationOwners = (html: string): Set<string>[] => [...html.matchAll(/data-reference-declaration="([^"]+)"/g)].map(match => new Set(match[1].split(' ')));

test('enum terminology distinguishes TypeScript members from PHP cases', () => {
  const api = createApiReference({ input: {
    schemaVersion: 1, generator: { name: 'refquill', version: 'test' }, title: 'Enums', fingerprint: 'a'.repeat(64),
    inputs: [{ name: 'TS', language: 'typescript' }, { name: 'PHP', language: 'php' }],
    types: [],
    symbols: [
      { id: 'ts-enum', input: 0, kind: 'enum', name: 'Choice', declaration: 'enum Choice { One }' },
      { id: 'ts-case', input: 0, kind: 'enum-case', name: 'One', parentId: 0, declaration: 'One = 0' },
      { id: 'php-enum', input: 1, kind: 'enum', name: 'Choice', declaration: 'enum Choice { case One; }' },
      { id: 'php-case', input: 1, kind: 'enum-case', name: 'One', parentId: 2, declaration: 'case One;' },
    ],
  } });
  assert.equal(api.getSymbolKind('ts-case'), 'enum-member');
  assert.equal(api.getSymbolKind('php-case'), 'enum-case');
  assert.ok(renderToString(<ApiReference reference={api} symbolId="ts-enum" />).includes('<h2>Enum members</h2>'));
  assert.ok(renderToString(<ApiReference reference={api} symbolId="php-enum" />).includes('<h2>Enum cases</h2>'));
});

test('namespace folders link their landing pages without duplicate sidebar children', () => {
  const source = loader({ baseUrl: reference.baseUrl, source: reference.toFumadocsSource(), icon: apiReferenceIcon });
  const folders = (nodes: Node[]): Folder[] => nodes.flatMap(node =>
    node.type === 'folder' ? [node, ...folders(node.children)] : []);
  const namespaceFolders = folders(source.pageTree.children);
  const landingPages = source.getPages().filter(page =>
    page.data.symbolId === null && page.data.inputName !== null);
  const inputCount = new Set(reference.document.symbols.map(symbol => symbol.api)).size;
  assert.ok(namespaceFolders.length > inputCount, 'includes nested namespaces');
  assert.deepEqual(
    namespaceFolders.map(folder => folder.index?.url).sort(),
    landingPages.map(page => page.url).sort(),
  );
  for (const folder of namespaceFolders) {
    assert.ok(folder.icon, 'namespace folder retains its type icon');
    assert.ok(!folder.children.some(child => child.type === 'page' && child.url === folder.index?.url));
  }
  const sidebarUrls = (nodes: Node[]): string[] => nodes.flatMap(node => {
    if (node.type === 'page') return [node.url];
    if (node.type === 'folder') return [node.index!.url, ...sidebarUrls(node.children)];
    return [];
  });
  assert.deepEqual(
    sidebarUrls(source.pageTree.children).sort(),
    source.getPages().filter(page => page.url !== reference.baseUrl).map(page => page.url).sort(),
  );
  assert.equal(source.getPage([])?.url, reference.baseUrl, 'reference root remains routable');
});

test('every implicit namespace gets a landing page with immediate children and declarations', () => {
  const source = loader({ baseUrl: '/api', source: reference.toFumadocsSource(), icon: apiReferenceIcon });
  const namespace = reference.getNamespace(person.api, 'Demo');
  assert.ok(namespace.symbols.some(s => s.id === person.id));
  const page = source.getPages().find(p => p.url === reference.getNamespaceUrl(person.api, 'Demo'))!;
  assert.equal(page.data.namespace, 'Demo');
  assert.equal(page.data.symbolId, null);
  const html = renderToString(<ApiReference reference={reference} inputName={person.api} namespace="Demo" />);
  assert.ok(html.includes(reference.getUrl(person.id)));
  assert.ok(html.includes('<h2>Interfaces</h2>'));
  assert.ok(reference.getPageText(page.data).includes('Person'));
  assert.ok(renderToString(apiReferenceIcon('refquill-class')).includes('aria-label="class"'));
  assert.equal(apiReferenceIcon('unknown'), undefined);
  assert.ok(reference.toFumadocsSource().files.some(f => f.type === 'page' && f.data.symbolId === person.id && f.data.icon === 'refquill-class'));
});

test('qualified snippets shorten display, resolve local/external docs, and retain exact copy text', async () => {
  const code = 'function format(\\Demo\\Person $person): \\DateTimeImmutable;';
  const tree = await codeToHast(code, { lang: 'php', theme: 'github-light', meta: { __raw: 'api' }, transformers: [transformerApiReference(reference.resolveLink, { inputName: person.api })] });
  const textContent = (node: any): string => node.type === 'text' ? node.value : (node.children ?? []).map(textContent).join('');
  assert.equal(textContent(tree), code);
  const html = await codeToHtml(code, { lang: 'php', theme: 'github-light', meta: { __raw: 'api' }, transformers: [transformerApiReference(reference.resolveLink)] });
  assert.ok(html.includes(`href="${reference.getUrl(person.id)}"`));
  assert.ok(html.includes('class.datetimeimmutable.php'));
  assert.ok(html.includes('refquill-copy-prefix'));
  assert.match(html, /<\/span>Person<\/a>/);
  const format = reference.document.symbols.find(s => s.qualifiedName === 'Demo\\format')!;
  const md = reference.getPageText({ symbolId: format.id, inputName: null });
  assert.ok(md.includes('```php api'));
  assert.ok(md.includes('\\Demo\\Person $person'));
});

test('snippet linking preserves comments, string literals, variables, unknown namespaces and opt-out', async () => {
  const render = (code: string, meta = 'api') => codeToHtml(code, { lang: 'php', theme: 'github-light', meta: { __raw: meta }, transformers: [transformerApiReference(reference.resolveLink)] });
  assert.ok(!(await render('"\\Demo\\Person"; // \\Demo\\Person\n$Person; new \\Unknown\\Demo\\Person();')).includes('data-reference-name'));
  assert.ok(!(await render('new \\Demo\\Person();', '')).includes('data-reference-name'));
  const bad = createApiReference({ input, resolveExternal: () => 'javascript:alert(1)' });
  assert.throws(() => bad.resolveLink('External', { language: 'php' }), /Unsafe/);
});

test('TypeScript linking protects parameter names and object keys while linking type positions', async () => {
  const account = reference.document.symbols.find(s => s.qualifiedName === 'Account')!;
  const html = await codeToHtml('function f(Account: string): Account;\ntype Value = { Account: string; other: Account; literal: "Account" };', {
    lang: 'typescript', theme: 'github-light', meta: { __raw: 'api' },
    transformers: [transformerApiReference(reference.resolveLink, { inputName: account.api, group: account.group })],
  });
  assert.equal((html.match(/data-reference-name="Account"/g) ?? []).length, 2);
});

test('colliding short names stay qualified and Unicode/CRLF copy remains exact', async () => {
  const code = 'function f(\\One\\Record $α, \\Two\\Record $β): \\One\\Record;\r\n';
  const resolve = (name: string) => ['One\\Record', 'Two\\Record'].includes(name) ? { name, label: 'Record', url: `/api/${name.startsWith('One') ? 'one' : 'two'}` } : null;
  const tree = await codeToHast(code, { lang: 'php', theme: 'github-light', meta: { __raw: 'api' }, transformers: [transformerApiReference(resolve)] });
  const elements: any[] = [];
  const visit = (node: any) => { if (node.type === 'element' && node.tagName === 'a') elements.push(node); node.children?.forEach(visit); };
  visit(tree);
  const visible = (node: any): string => node.properties?.ariaHidden === 'true' || node.properties?.ariaHidden === true ? '' : node.type === 'text' ? node.value : (node.children ?? []).map(visible).join('');
  assert.equal(visible(elements[0]), 'One\\Record');
  assert.equal(visible(elements[1]), 'Two\\Record');
  const pre = (tree.children[0] as any);
  assert.equal(pre.properties['data-reference-source'], code);
});

test('split view includes badges, member disclosures, outline ownership, and inline mobile definitions', () => {
  const members = reference.getMembers(person.id);
  const outline = declarationOutline(person, members);
  const method = members.find(s => s.name === 'name')!;
  assert.ok(Object.values(outline.memberLines).includes(memberAnchor(method.id)));
  const methodLines = Object.entries(outline.memberLines).filter(([, owner]) => owner === memberAnchor(method.id)).map(([line]) => outline.code.split('\n')[Number(line) - 1]);
  assert.ok(methodLines.some(line => line.includes('function name(')));
  const html = renderToString(<ApiReference reference={reference} symbolId={person.id} />);
  assert.ok(html.includes('<h2>Properties</h2>'));
  assert.ok(html.includes('<h2>Methods</h2>'));
  assert.ok(!html.includes('<h2>Fields</h2>'));
  assert.ok(html.indexOf('refquill-badges') < html.indexOf('<h1>Person</h1>'));
  assert.ok(html.includes('>final</span>'));
  assert.ok(html.includes('>readonly</span>'));
  assert.ok(html.includes('refquill-layout'));
  assert.ok(html.includes('refquill-inline-definition'));
  assert.ok(declarationOwners(html).some(owners => owners.has(memberAnchor(method.id))));
  assert.ok(html.includes(`data-reference-row="${memberAnchor(method.id)}"`));
  assert.ok(html.includes('refquill-member'));
});

test('inline TypeScript shapes assign definition lines to their documented fields', () => {
  const alias = reference.document.symbols.find(s => s.qualifiedName === 'Result')!;
  const members = reference.getMembers(alias.id);
  const outline = declarationOutline(alias, members);
  const field = members.find(s => s.name === 'data')!;
  assert.equal(reference.getSymbolKind(field.id), 'property');
  assert.ok(renderToString(<ApiReference reference={reference} symbolId={alias.id} />).includes('<h2>Properties</h2>'));
  const lines = Object.entries(outline.memberLines).filter(([, id]) => id === memberAnchor(field.id)).map(([line]) => outline.code.split('\n')[Number(line) - 1]);
  assert.ok(lines.some(line => line.includes('data: T')));
});

test('host renderer hooks customize headers and every badge while preserving safe Markdown', () => {
  const description = '**Brief summary** with `code`.\n\nDetailed paragraph.';
  const customReference = { ...reference, getSymbol: (id: string) => id === person.id ? { ...person, description } : reference.getSymbol(id) };
  const html = renderToString(<ApiReference reference={customReference} symbolId={person.id}
    renderHeader={({ title, description, badges }) => <header data-custom-header><h1>{title}</h1>{description}{badges}</header>}
    renderBadge={({ label, category }) => <mark data-category={category}>{label}</mark>}
  />);
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
  assert.ok(header.includes('<strong>Brief summary</strong>'));
  assert.ok(header.includes('<code>code</code>'));
  assert.ok(header.includes('Detailed paragraph'));
  assert.equal(html.split('Detailed paragraph').length - 1, 1);
  assert.ok(header.includes('data-category="kind"'));
  assert.ok(header.includes('data-category="modifier"'));
  assert.ok(html.includes('data-category="modifier">public</mark>'));
  const namespaceHtml = renderToString(<ApiReference reference={reference} inputName={person.api} namespace="Demo"
    renderHeader={({ title, namespace, badges }) => <header data-custom-header><h1>{title}</h1><p>{namespace?.name}</p>{badges}</header>}
    renderBadge={({ label }) => <mark>{label}</mark>}
  />);
  assert.ok(namespaceHtml.includes('<h1>Demo</h1>'));
  assert.ok(namespaceHtml.includes('<mark>namespace</mark>'));
});

test('custom headers use a signature summary when the declaration summary is empty', () => {
  const format = reference.document.symbols.find(s => s.qualifiedName === 'Demo\\format')!;
  const symbol = { ...format, description: '', signatures: format.signatures.map(signature => ({ ...signature, description: '**Signature summary**.' })) };
  const customReference = { ...reference, getSymbol: (id: string) => id === format.id ? symbol : reference.getSymbol(id) };
  const html = renderToString(<ApiReference reference={customReference} symbolId={format.id}
    renderHeader={({ title, description }) => <header><h1>{title}</h1>{description}</header>}
  />);
  assert.equal(html.split('<strong>Signature summary</strong>').length - 1, 1);
  assert.ok(html.includes('<h2>Parameters</h2>'));
  assert.ok(html.includes('<h2>Returns</h2>'));
  const fallback = renderToString(<ApiReference reference={customReference} symbolId={format.id} renderHeader={() => null} />);
  assert.ok(fallback.includes('<strong>Signature summary</strong>'));
});


test('custom header retains distinct overload descriptions in the body', () => {
  const format = reference.document.symbols.find(s => s.qualifiedName === 'Demo\\format')!;
  const symbol = { ...format, description: '', signatures: [
    { ...format.signatures[0], description: 'Primary description.' },
    { ...format.signatures[0], description: 'Alternative overload.' },
  ] };
  const customReference = { ...reference, getSymbol: () => symbol };
  const html = renderToString(<ApiReference reference={customReference} symbolId={format.id}
    renderHeader={({ description }) => <header>{description}</header>}
  />);
  assert.equal(html.split('Primary description.').length - 1, 1);
  assert.ok(html.slice(html.indexOf('</header>')).includes('Alternative overload.'));
});


test('parameter defaults link enum cases while string literals stay literal', () => {
  const format = reference.document.symbols.find(s => s.qualifiedName === 'Demo\\format')!;
  const active = reference.document.symbols.find(s => s.qualifiedName === 'Demo\\Status::Active')!;
  const parameter = format.signatures[0].parameters[0];
  const symbol = { ...format, signatures: [{ ...format.signatures[0], parameters: [
    { ...parameter, default: '\\Demo\\Status::Active', optional: true },
    { ...parameter, name: '$literal', default: "'Demo\\Status::Active'", optional: true },
  ] }] };
  const customReference = { ...reference, getSymbol: (id: string) => id === format.id ? symbol : reference.getSymbol(id) };
  const html = renderToString(<ApiReference reference={customReference} symbolId={format.id} />);
  assert.equal(html.split(`href="${reference.getUrl(active.id)}"`).length - 1, 1);
  assert.ok(html.includes(`data-reference-name="\\Demo\\Status::Active"`));
  assert.match(html, /<h[2-6]>Default<\/h[2-6]>/);
});


test('link hooks cover relationships, types, defaults, Markdown, and namespace navigation', () => {
  const described = { ...person, description: '[Related docs](/api/related).' };
  const customReference = { ...reference, getSymbol: (id: string) => id === person.id ? described : reference.getSymbol(id) };
  const renderLink = (props: React.ComponentProps<'a'>) => <a {...props} data-preview-link="true" />;
  const html = renderToString(<ApiReference reference={customReference} symbolId={person.id} renderLink={renderLink} />);
  const anchors = html.match(/<a\b[^>]*>/g) ?? [];
  assert.ok(anchors.length > 10);
  assert.ok(anchors.every(anchor => anchor.includes('data-preview-link="true"')));
  assert.match(html, /data-reference-name=/);
  assert.match(html, /href="\/api\/related"[^>]*data-preview-link/);
  const relationship = person.relations.find(relation => relation.targetId)!;
  const target = reference.getSymbol(relationship.targetId!);
  assert.ok([...html.matchAll(/<a\b([^>]*)>([^<]*)<\/a>/g)].some(match => match[1].includes(`href="${reference.getUrl(target.id)}"`) && match[2] === target.name), 'relationship displays a short name');
  const namespaceHtml = renderToString(<ApiReference reference={reference} inputName={person.api} namespace="Demo" renderLink={renderLink} />);
  assert.ok((namespaceHtml.match(/<a\b[^>]*>/g) ?? []).every(anchor => anchor.includes('data-preview-link="true"')));
  const fallback = renderToString(<ApiReference reference={reference} symbolId={person.id} renderLink={() => null} />);
  assert.ok(fallback.includes(`href="${reference.getUrl(target.id)}"`));
});


test('icon overrides cover metadata, listings, members, and disclosures with Lucide fallbacks', () => {
  for (const [kind, Icon] of Object.entries(defaultApiReferenceIcons)) {
    assert.ok(renderToString(<Icon />).includes('lucide-'), `${kind} uses the icon set shipped with Fumadocs`);
  }
  const CustomIcon = (props: React.SVGProps<SVGSVGElement>) => <svg {...props} data-host-icon="true" />;
  const partial = { class: CustomIcon } satisfies ApiReferenceIcons;
  const defaultClass = renderToString(<ApiKindIcon kind="class" />);
  assert.ok(defaultClass.includes('lucide-box'));
  assert.ok(renderToString(apiReferenceIcon('refquill-class', partial)).includes('data-host-icon="true"'));
  assert.equal(renderToString(<ApiKindIcon kind="constructor" icons={partial} />), renderToString(<ApiKindIcon kind="constructor" />), 'inherited constructor property is not treated as an override');
  assert.equal(renderToString(apiReferenceIcon('refquill-interface', partial)), renderToString(apiReferenceIcon('refquill-interface')));
  assert.equal(apiReferenceIcon('refquill-chevron-right', partial), undefined);
  const icons = Object.fromEntries(Object.keys(defaultApiReferenceIcons).map(name => [name, CustomIcon])) satisfies ApiReferenceIcons;
  for (const props of [{ symbolId: person.id }, { inputName: person.api, namespace: 'Demo' }, {}]) {
    const html = renderToString(<ApiReference reference={reference} {...props} icons={icons} renderCode={code => <pre>{code}</pre>} />);
    const iconElements = html.match(/<svg\b[^>]*class="refquill-(?:kind|disclosure)-icon"[^>]*>/g) ?? [];
    assert.ok(iconElements.length > 0);
    assert.ok(iconElements.every(icon => icon.includes('data-host-icon="true"')));
    assert.ok(!html.includes('lucide-'));
  }
  assert.ok(renderToString(<ApiReference reference={reference} symbolId={person.id} />).includes('lucide-chevron-right'));
});


test('symbol pages use readable names while member fragments retain their owning page', () => {
  assert.ok(reference.getUrl(person.id).endsWith('/Demo/Person'));
  const method = reference.getMembers(person.id).find(member => member.name === 'name')!;
  assert.equal(reference.getUrl(method.id), `${reference.getUrl(person.id)}#${memberAnchor(method.id)}`);
  const source = loader({ baseUrl: reference.baseUrl, source: reference.toFumadocsSource() });
  const page = source.getPages().find(page => page.data.symbolId === person.id)!;
  assert.equal(page.url, reference.getUrl(person.id));
  assert.equal(page.slugs.at(-1), 'Person');
  assert.ok(reference.getPageText({ symbolId: null, inputName: person.api, namespace: 'Demo' }).includes(`](${page.url})`));
});

test('readable routes disambiguate symbols and namespaces without stealing natural names', () => {
  const symbol = (id: string, name: string, kind = 'class', group = 'Demo') => ({ id, input: 0, kind, name, group, declaration: name });
  const fixture = { ...input, inputs: [{ name: 'PHP', language: 'php' }], types: [], symbols: [
    symbol('class-record', 'Record'),
    symbol('function-record', 'Record', 'function'),
    symbol('natural-suffix', 'Record--class'),
    symbol('nested-child', 'Child', 'class', 'Demo/Record'),
    symbol('upper-case', 'Value'),
    symbol('lower-case', 'value'),
    symbol('reserved-index', 'index'),
    symbol('reserved-meta', 'meta'),
    symbol('punctuation', '../A#B'),
  ] };
  const api = createApiReference({ input: fixture });
  const source = loader({ baseUrl: api.baseUrl, source: api.toFumadocsSource() });
  assert.equal(api.getUrl('class-record'), '/api/PHP/Demo/Record--class--2');
  assert.equal(api.getUrl('function-record'), '/api/PHP/Demo/Record--function');
  assert.equal(api.getUrl('natural-suffix'), '/api/PHP/Demo/Record--class');
  assert.equal(api.getNamespaceUrl('PHP', 'Demo/Record'), '/api/PHP/Demo/Record');
  assert.equal(api.getUrl('nested-child'), '/api/PHP/Demo/Record/Child');
  assert.equal(api.getUrl('reserved-index'), '/api/PHP/Demo/index');
  assert.equal(api.getUrl('reserved-meta'), '/api/PHP/Demo/meta');
  const urls = source.getPages().map(page => page.url.toLowerCase());
  assert.equal(new Set(urls).size, urls.length, 'routes remain unique even on case-insensitive hosts');
  for (const symbol of api.document.symbols) {
    const url = api.getUrl(symbol.id);
    assert.equal(new URL(url, 'https://example.com').pathname, url, 'names cannot change URL structure');
    assert.equal(source.getPageByUrl(url)?.data.symbolId, symbol.id);
  }
  const reversed = createApiReference({ input: { ...fixture, symbols: [...fixture.symbols].reverse() } });
  assert.deepEqual(api.document.symbols.map(symbol => api.getUrl(symbol.id)), api.document.symbols.map(symbol => reversed.getUrl(symbol.id)));
});


test('PHP trait member inventories retain origin links, documentation, and direct-use ownership', () => {
  const base = { id: 'base', input: 0, kind: 'trait', name: 'Base', group: 'Demo', declaration: 'trait Base', relations: [{ kind: 'uses', name: 'Demo\\Wrapper', targetId: 4 }] };
  const fixture = { ...input, inputs: [{ name: 'PHP', language: 'php' }], types: [], symbols: [
    base,
    { id: 'base-run', input: 0, kind: 'method', name: 'run', parentId: 0, declaration: 'public function run(): void', description: 'Run the shared operation.' },
    { id: 'base-label', input: 0, kind: 'property', name: '$label', parentId: 0, declaration: 'public string $label;' },
    { id: 'base-flag', input: 0, kind: 'constant', name: 'FLAG', parentId: 0, declaration: 'public const FLAG = true;' },
    { id: 'wrapper', input: 0, kind: 'trait', name: 'Wrapper', group: 'Demo', declaration: 'trait Wrapper', relations: [{ kind: 'uses', name: 'Demo\\Base', targetId: 0 }] },
    { id: 'wrapper-wrap', input: 0, kind: 'method', name: 'wrap', parentId: 4, declaration: 'public function wrap(): void' },
    { id: 'consumer', input: 0, kind: 'class', name: 'Consumer', group: 'Demo', declaration: 'class Consumer', relations: [
      { kind: 'uses', name: 'Demo\\Wrapper', targetId: 4 },
      { kind: 'uses', name: 'Demo\\Base', targetId: 0 },
      { kind: 'uses', name: 'Vendor\\External', targetId: null },
    ] },
    { id: 'consumer-run', input: 0, kind: 'method', name: 'run', parentId: 6, declaration: 'public function run(): void', description: 'A class-owned override.' },
  ] };
  const api = createApiReference({ input: fixture });
  const entries = api.getTraitMembers('consumer');
  assert.deepEqual(entries.map(entry => entry.member.id), ['wrapper-wrap', 'base-run', 'base-label', 'base-flag']);
  assert.deepEqual(api.getMembers('consumer').map(member => member.id), ['consumer-run']);
  assert.equal(entries.find(entry => entry.member.id === 'base-run')!.declaringTrait.id, 'base');
  assert.ok(entries.every(entry => entry.usedTrait.id === 'wrapper'));
  const html = renderToString(<ApiReference reference={api} symbolId="consumer" renderCode={code => <pre>{code}</pre>}
    renderLink={props => <a {...props} data-host-link="true" />} />);
  assert.ok(html.includes('<h2>Trait members</h2>'));
  assert.ok(html.includes('From trait'));
  assert.ok(html.includes(`href="${api.getUrl('base-run')}"`));
  assert.ok(html.includes('Run the shared operation.'));
  assert.ok(html.includes('A class-owned override.'));
  assert.equal(html.split(`id="${memberAnchor('base-run')}"`).length - 1, 1);
  const source = loader({ baseUrl: api.baseUrl, source: api.toFumadocsSource() });
  const page = source.getPageByUrl(api.getUrl('consumer'))!;
  assert.ok(page.data.toc.some(item => item.url === `#${memberAnchor('base-run')}` && item.title === 'run (from Base)'));
  assert.ok(page.data.structuredData.contents.some(item => item.content.includes('Run the shared operation.')));
  assert.ok(api.getPageText(page.data).includes(`From trait [Base](${api.getUrl('base-run')})`));
  const consumer = api.getSymbol('consumer');
  const outline = declarationOutline(consumer, api.getMembers(consumer.id));
  assert.ok(Object.values(outline.memberLines).includes(memberAnchor('wrapper')));
  const traitOnly = declarationOutline(consumer, []);
  assert.ok(traitOnly.code.includes('use \\Demo\\Wrapper;'));
  assert.ok(Object.values(traitOnly.memberLines).includes(memberAnchor('wrapper')));
  assert.deepEqual(api.getTraitMembers('base-run'), []);
  const ts = createApiReference({ input: { ...fixture, inputs: [{ name: 'TS', language: 'typescript' }] } });
  assert.deepEqual(ts.getTraitMembers('consumer'), []);
});


test('PHP exception presentation follows ancestry and supports default and overridden icons', () => {
  const klass = (id: string, name: string, relations: unknown[] = [], extra = {}) => ({ id, input: 0, kind: 'class', name, group: 'Demo', declaration: `class ${name}`, relations, ...extra });
  const fixture = { ...input, inputs: [{ name: 'PHP', language: 'php' }, { name: 'TS', language: 'typescript' }], types: [], symbols: [
    klass('base-exception', 'SdkException', [{ kind: 'extends', name: '\\rUnTiMeExCePtIoN' }]),
    klass('child-exception', 'ProjectFailure', [{ kind: 'extends', name: 'Demo\\SdkException', targetId: 0 }]),
    klass('ordinary', 'LooksLikeException'),
    klass('unknown-base', 'UnknownFailure', [{ kind: 'extends', name: 'Vendor\\RuntimeException' }]),
    klass('cycle-a', 'CycleA', [{ kind: 'extends', name: 'Demo\\CycleB', targetId: 5 }]),
    klass('cycle-b', 'CycleB', [{ kind: 'extends', name: 'Demo\\CycleA', targetId: 4 }]),
    klass('typed-error', 'TypedFailure', [{ kind: 'extends', name: 'TypeError' }]),
    klass('authoritative-target', 'TargetedFailure', [{ kind: 'extends', name: 'RuntimeException', targetId: 8 }]),
    klass('namespaced-name', 'RuntimeException'),
    { id: 'exception-method', input: 0, kind: 'method', name: 'recover', parentId: 0, declaration: 'public function recover(): void;' },
    klass('ts-class', 'ErrorException', [{ kind: 'extends', name: 'RuntimeException' }], { input: 1 }),
  ] };
  const api = createApiReference({ input: fixture });
  assert.equal(api.getSymbolKind('child-exception'), 'exception');
  assert.equal(api.getSymbolKind('base-exception'), 'exception');
  assert.equal(api.getSymbolKind('typed-error'), 'exception');
  for (const id of ['ordinary', 'unknown-base', 'cycle-a', 'cycle-b', 'authoritative-target', 'namespaced-name', 'ts-class']) assert.equal(api.getSymbolKind(id), 'class', id);
  assert.equal(api.getSymbolKind('exception-method'), 'method');
  assert.equal(api.getSymbol('child-exception').kind, 'class', 'wire class semantics remain unchanged');
  const source = loader({ baseUrl: api.baseUrl, source: api.toFumadocsSource(), icon: apiReferenceIcon });
  const page = source.getPageByUrl(api.getUrl('child-exception'))!;
  assert.equal(page.data.icon, 'refquill-exception');
  assert.equal(page.url, '/api/PHP/Demo/ProjectFailure');
  assert.ok(renderToString(apiReferenceIcon(page.data.icon)).includes('lucide-octagon-alert'));
  const listing = renderToString(<ApiReference reference={api} inputName="PHP" namespace="Demo" />);
  assert.ok(listing.includes('<h2>Exceptions</h2>'));
  const html = renderToString(<ApiReference reference={api} symbolId="child-exception" renderCode={code => <pre>{code}</pre>} />);
  assert.ok(html.includes('data-kind="exception">exception</span>'));
  const CustomException = (props: React.SVGProps<SVGSVGElement>) => <svg {...props} data-exception-override="true" />;
  assert.ok(renderToString(apiReferenceIcon('refquill-exception', { exception: CustomException })).includes('data-exception-override="true"'));
  assert.ok(renderToString(<ApiReference reference={api} inputName="PHP" namespace="Demo" icons={{ exception: CustomException }} />).includes('data-exception-override="true"'));
});


test('promoted properties remain members but share their constructor definition lines', () => {
  const members = reference.getMembers(person.id);
  const constructor = members.find(member => member.kind === 'constructor')!;
  const property = members.find(member => member.name === '$label')!;
  assert.equal(property.promoted, true);
  const outline = declarationOutline(person, members);
  assert.equal(outline.code.split('$label').length - 1, 1);
  assert.ok(outline.code.includes('public readonly string $label'));
  assert.ok(outline.code.includes('public \\DateTimeImmutable $created;'), 'explicit properties stay in the definition');
  const line = outline.code.split('\n').findIndex(line => line.includes('__construct')) + 1;
  assert.deepEqual(outline.memberLines[line].split(' '), [memberAnchor(constructor.id), memberAnchor(property.id)]);
  const html = renderToString(<ApiReference reference={reference} symbolId={person.id} />);
  assert.ok(html.includes(`id="${memberAnchor(property.id)}"`), 'promoted property retains its disclosure and deep link');
  assert.ok(declarationOwners(html).some(owners => outline.memberLines[line].split(' ').every(owner => owners.has(owner))));
});

test('multiline constructor promotion maps each property to its own parameter line', () => {
  const symbol = reference.document.symbols.find(symbol => symbol.qualifiedName === 'Demo\\Promotions')!;
  const members = reference.getMembers(symbol.id);
  const constructor = members.find(member => member.kind === 'constructor')!;
  const outline = declarationOutline(symbol, members);
  for (const name of ['$first', '$second']) {
    const property = members.find(member => member.name === name)!;
    const entries = Object.entries(outline.memberLines).filter(([, owners]) => owners.split(' ').includes(memberAnchor(property.id)));
    assert.equal(entries.length, 1);
    const [line, owners] = entries[0];
    assert.ok(outline.code.split('\n')[Number(line) - 1].includes(name));
    assert.ok(owners.split(' ').includes(memberAnchor(constructor.id)));
    assert.equal(outline.code.split(name).length - 1, 1);
  }
  assert.ok(outline.code.includes('public string $explicit;'), 'a regular constructor argument does not hide an explicit property');
  const explicit = members.find(member => member.name === '$explicit')!;
  const owned = Object.entries(outline.memberLines).find(([, owner]) => owner === memberAnchor(explicit.id))!;
  assert.ok(outline.code.split('\n')[Number(owned[0]) - 1].includes('public string $explicit;'));
  const noConstructor = declarationOutline(symbol, members.filter(member => member !== constructor));
  assert.ok(noConstructor.code.includes('public readonly string $first;'), 'properties stay visible if the constructor is unavailable');
});
