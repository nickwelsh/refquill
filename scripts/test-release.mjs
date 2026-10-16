import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileSnapshot } from './file-snapshot.mjs';

// Exercise the archives exactly as an npm consumer would, outside the workspace.
const packages = resolve(process.argv[2] ?? '.release/packages');
const version = JSON.parse(await readFile('packages/cli/package.json', 'utf8')).version;
const platforms = ['darwin-arm64', 'linux-arm64', 'linux-x64', 'win32-x64'];
const host = `${process.platform}-${process.arch}`;
assert.ok(platforms.includes(host), `Unsupported consumer test host: ${host}`);
const names = ['refquill', 'refquill-schema', 'refquill-fumadocs', ...platforms.map(platform => `refquill-${platform}`)];
const expected = names.map(name => `nickwelsh-${name}-${version}.tgz`).sort();
assert.deepEqual((await readdir(packages)).filter(name => name.endsWith('.tgz')).sort(), expected, 'Release must contain exactly the expected package archives');
const archives = Object.fromEntries(names.map(name => [`@nickwelsh/${name}`, `file:${join(packages, `nickwelsh-${name}-${version}.tgz`)}`]));
const workspace = JSON.parse(await readFile('package.json', 'utf8'));
const fumadocs = JSON.parse(await readFile('packages/fumadocs/package.json', 'utf8'));
const frameworks = JSON.parse(await readFile('examples/frameworks-fumadocs/package.json', 'utf8'));
const consumer = await mkdtemp(join(tmpdir(), 'refquill-consumer-'));
const env = { ...process.env };
for (const key of ['REFQUILL_BINARY', 'REFQUILL_TYPESCRIPT_WORKER', 'REFQUILL_NODE', 'NODE_PATH']) delete env[key];

function run(command, args) {
  const result = spawnSync(command, args, { cwd: consumer, env, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed`);
}

try {
  await writeFile(join(consumer, 'package.json'), JSON.stringify({
    name: 'refquill-release-consumer', private: true, type: 'module',
    dependencies: {
      '@nickwelsh/refquill': archives['@nickwelsh/refquill'],
      '@nickwelsh/refquill-schema': archives['@nickwelsh/refquill-schema'],
      '@nickwelsh/refquill-fumadocs': archives['@nickwelsh/refquill-fumadocs'],
      ...fumadocs.peerDependencies,
      'react-dom': fumadocs.devDependencies['react-dom'],
      '@types/react': fumadocs.devDependencies['@types/react'],
      '@types/react-dom': fumadocs.devDependencies['@types/react-dom'],
      '@types/node': fumadocs.devDependencies['@types/node'],
      typescript: workspace.devDependencies.typescript,
      vue: frameworks.devDependencies.vue,
      svelte: frameworks.devDependencies.svelte,
      'solid-js': frameworks.devDependencies['solid-js'],
    },
    // Optional native packages and the schema dependency must resolve locally,
    // including the first release before any internal packages exist on npm.
    overrides: archives,
  }, null, 2));
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--cache', join(consumer, '.npm-cache')]);
  await cp(resolve('tests/fixtures'), join(consumer, 'fixtures'), { recursive: true });
  const cli = join(consumer, 'node_modules/@nickwelsh/refquill/bin/refquill.mjs');
  run(process.execPath, [cli, 'generate', 'fixtures/refquill.json']);
  run(process.execPath, [cli, 'validate', 'output/mixed.json']);
  // Keep the real framework consumer outside the checkout so the packed worker
  // cannot silently resolve a compiler or package from workspace node_modules.
  for (const file of ['src', 'tsconfig.json', 'tsconfig.react.json', 'tsconfig.solid.json', 'tsconfig.components.json']) {
    await cp(resolve('examples/frameworks-fumadocs', file), join(consumer, 'frameworks', file), { recursive: true });
  }
  const configuration = JSON.parse(await readFile('examples/frameworks-fumadocs/refquill.json', 'utf8'));
  delete configuration.$schema;
  configuration.sourceRoot = consumer;
  configuration.output = '../output/frameworks.json';
  configuration.inputs.find(input => input.language === 'rust').rustdoc = '../fixtures/rust/rustdoc.json';
  await writeFile(join(consumer, 'frameworks/refquill.json'), JSON.stringify(configuration));
  run(process.execPath, [cli, 'generate', 'frameworks/refquill.json']);
  run(process.execPath, [cli, 'validate', 'output/frameworks.json']);
  const generated = join(consumer, 'output/frameworks.json');
  const original = await fileSnapshot(generated);
  run(process.execPath, [cli, 'generate', 'frameworks/refquill.json']);
  const regenerated = await fileSnapshot(generated);
  assert.deepEqual(regenerated.bytes, original.bytes, 'Installed CLI output must be deterministic');
  assert.equal(regenerated.mtimeMs, original.mtimeMs, 'Unchanged generation must preserve the artifact');
  await writeFile(join(consumer, 'consumer.tsx'), `
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseDocument, resolveDocument, parseReferenceDocument, type Document, type ReferenceDocument, type ResolvedDocument, type Symbol } from '@nickwelsh/refquill-schema';
import { parseReferenceDocument as parseReferenceSubpath } from '@nickwelsh/refquill-schema/reference';
import referenceSchema from '@nickwelsh/refquill-schema/reference.json' with { type: 'json' };
import { createApiReference, createJsonSchemaReference, createManPageReference, createReference, transformerApiReference, type ApiReference as ReferenceModel } from '@nickwelsh/refquill-fumadocs';
import { ApiReference, JsonSchemaReference, ManPageReference, ReferencePage, type ApiReferenceProps } from '@nickwelsh/refquill-fumadocs/components';

const wire: Document = parseDocument(JSON.parse(readFileSync('output/mixed.json', 'utf8')));
const document: ResolvedDocument = resolveDocument(wire);
const php: Symbol | undefined = document.symbols.find(symbol => symbol.qualifiedName === 'Demo\\\\Person');
const ts: Symbol | undefined = document.symbols.find(symbol => symbol.language === 'typescript' && symbol.qualifiedName === 'identifier');
assert.ok(php, 'Installed native CLI must analyze PHP');
assert.ok(ts && ts.signatures.length === 2, 'Installed TypeScript worker must preserve overloads');
const reference: ReferenceModel = createApiReference({ input: wire });
assert.ok(reference.toFumadocsSource().files.length > 0);
assert.ok(reference.getUrl(php.id).startsWith('/api/'));
assert.equal(typeof transformerApiReference, 'function');
const props: ApiReferenceProps = { reference };
assert.match(renderToStaticMarkup(createElement(ApiReference, props)), /Mixed API reference/);
assert.ok(import.meta.resolve('@nickwelsh/refquill-schema/document.json').endsWith('document.schema.json'));
assert.ok(import.meta.resolve('@nickwelsh/refquill-schema/config.json').endsWith('config.schema.json'));
assert.ok(import.meta.resolve('@nickwelsh/refquill-schema/reference.json').endsWith('reference.schema.json'));
assert.equal(referenceSchema.$defs.page.properties.kind.const, 'page');
assert.equal(parseReferenceSubpath, parseReferenceDocument);
const rendered: ReferenceDocument = parseReferenceDocument(reference.toReferenceDocument());
const generic = createReference({ input: rendered, baseUrl: reference.baseUrl });
const first = generic.document.children[0];
assert.ok(generic.getUrl(first.id).startsWith('/api/'));
assert.ok(renderToStaticMarkup(createElement(ReferencePage, { page: first, document: generic.document })).includes(first.title));
assert.throws(() => parseReferenceDocument({ schemaVersion: 1, title: 'Invalid', children: [{ kind: 'page', id: 'broken', title: 'Broken', blocks: [{ kind: 'entry', id: 'entry', title: 'Entry', display: 'static', highlights: [{ definitionId: 'missing', range: { start: { line: 1 }, end: { line: 1 } } }] }] }] }), /missing page-local definition/);
assert.ok(import.meta.resolve('@nickwelsh/refquill-fumadocs/style.css').endsWith('style.css'));
const manual = readFileSync(new URL(import.meta.resolve('@nickwelsh/refquill/manpage')), 'utf8');
const manpage = createManPageReference({ input: manual });
assert.ok(manpage.getPageText().includes('refquill generate'));
assert.ok(manpage.toFumadocsSource().files.length === 1);
assert.match(renderToStaticMarkup(createElement(ManPageReference, { reference: manpage })), /--force/);
const schemaReference = createJsonSchemaReference({ schema: referenceSchema });
assert.equal(schemaReference.toFumadocsSource().files.length, 1);
assert.ok(renderToStaticMarkup(createElement(JsonSchemaReference, { reference: schemaReference })).includes('schemaVersion'));
const frameworkWire = parseDocument(JSON.parse(readFileSync('output/frameworks.json', 'utf8')));
assert.equal(frameworkWire.inputs.length, 7);
const frameworkDocument = resolveDocument(frameworkWire);
assert.deepEqual(new Set(frameworkDocument.symbols.map(symbol => symbol.framework?.name).filter(Boolean)), new Set(['react', 'solid', 'vue', 'svelte']));
assert.ok(frameworkDocument.symbols.some(symbol => symbol.language === 'rust'));
const frameworkReference = createApiReference({ input: frameworkWire });
assert.ok(frameworkReference.toFumadocsSource().files.length > 0);
assert.ok(renderToStaticMarkup(createElement(ApiReference, { reference: frameworkReference })).includes('Frameworks and languages'));
`);
  await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ES2022', lib: ['ES2022', 'DOM', 'ESNext.Disposable'], types: ['node', 'react', 'react-dom'], module: 'NodeNext', moduleResolution: 'NodeNext', jsx: 'react-jsx', strict: true, skipLibCheck: false, resolveJsonModule: true, outDir: 'dist' },
    include: ['consumer.tsx'],
  }));
  run(process.execPath, [join(consumer, 'node_modules/typescript/bin/tsc')]);
  run(process.execPath, ['dist/consumer.js']);
  console.log('Release tarballs passed isolated install, public API type checks, all reference renderers, PHP/TypeScript/Rust and React/Solid/Vue/Svelte CLI checks, and deterministic generation.');
} finally {
  await rm(consumer, { recursive: true, force: true });
}
