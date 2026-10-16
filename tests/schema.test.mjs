import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseDocument, resolveDocument } from '../packages/schema/index.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/schema-v1.json', import.meta.url)));

test('v1 resolves index zero and inheritance while retaining every explicit override', () => {
  const before = structuredClone(fixture);
  assert.equal(parseDocument(fixture), fixture);
  const d = resolveDocument(fixture);
  const method = d.symbols[1];
  assert.equal(method.parentId, 'class:A');
  assert.equal(method.qualifiedName, 'Example\\A::greet');
  assert.deepEqual(method.source, { file: 'src/A.php', line: 5, endLine: 5 });
  assert.equal(method.signatures[0].declaration, method.declaration);
  assert.equal(method.signatures[0].description, 'Method');
  assert.deepEqual(method.signatures[0].typeParameters, method.typeParameters);
  assert.equal(method.signatures[1].declaration, '');
  assert.equal(method.signatures[1].description, '');
  assert.deepEqual(method.signatures[1].typeParameters, []);
  assert.equal(method.signatures[1].parameters[0].default, '');
  assert.equal(method.type, method.signatures[0].returns);
  assert.notEqual(method.type, method.signatures[1].returns);
  assert.equal(method.type.references[0].targetId, 'class:A');
  assert.equal(method.signatures[1].returns.references[0].targetId, 'class:B');
  assert.equal(d.symbols[3].group, '');
  assert.equal(d.symbols[3].qualifiedName, 'SpecialName');
  assert.equal(d.symbols[3].source.file, 'src/Other.php');
  assert.deepEqual(method.tags, [{ name: 'custom', text: '' }]);
  assert.deepEqual(fixture, before);
});

test('Rust and JavaScript reject malformed v1 documents consistently', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'refquill-v1-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const binary = process.env.REFQUILL_BINARY ?? resolve(`target/debug/refquill${process.platform === 'win32' ? '.exe' : ''}`);
  const cases = [
    d => { d.schemaVersion = 2; },
    d => { d.symbols[0].unknown = true; },
    d => { d.symbols.push(d.symbols[0]); },
    d => { d.inputs.push(d.inputs[0]); },
    d => { d.symbols[1].parentId = 100; },
    d => { d.symbols[0].parentId = 1; },
    d => { d.inputs.push({ name: 'frontend', language: 'typescript' }); d.symbols[1].input = 1; },
    d => { d.symbols[0].input = 100; },
    d => { d.symbols[1].type = 100; },
    d => { d.symbols[1].type = -1; },
    d => { d.symbols[1].type = 0.5; },
    d => { d.types.push({ text: 'unused', references: [{ name: 'Missing', targetId: 100 }] }); },
    d => { d.types.push({ text: 'unused', structure: { kind: 'union', types: [{ text: 'Missing', references: [{ name: 'Missing', targetId: 100 }] }] } }); },
    d => { d.symbols[1].relations[0].targetId = 100; },
    d => { d.symbols[1].typeParameters[0].default = 100; },
    d => { d.symbols[1].signatures[1].parameters[0].type = 100; },
    d => { d.symbols[1].signatures[1].parameters[0].properties = [{ name: 'nested', type: 100 }]; },
    d => { d.symbols[1].signatures[1].parameters[0].signatures = [{ parameters: [{ name: 'nested', type: 100 }] }]; },
    d => { d.symbols[1].signatures[0].returns = 100; },
    d => { d.symbols[0].framework = { name: 'react', role: 'component' }; },
    d => { d.inputs[0].language = 'typescript'; d.symbols[0].framework = { name: 'react', role: 'component', props: [{ name: 'invalid', type: 100 }] }; },
    d => { d.inputs[0].language = 'typescript'; d.symbols[0].framework = { name: 'vue', role: 'component', exposed: [{ name: 'invalid', signatures: [{ returns: 100 }] }] }; },
    d => { d.symbols[1].group = null; },
    d => { d.symbols[1].signatures[0].typeParameters = null; },
    d => { delete d.symbols[0].source.file; },
    d => { d.symbols[0].source.file = '../private.php'; },
    d => { d.symbols[0].source.endLine = 0; },
    d => { d.symbols[0].source.endLine = 1; d.symbols[0].source.line = 2; },
    d => { delete d.diagnostics[0].source.file; },
    d => { d.diagnostics[0].source.file = '../private.php'; },
  ];
  for (const [index, mutate] of cases.entries()) {
    const d = structuredClone(fixture);
    mutate(d);
    assert.throws(() => parseDocument(d), undefined, `JS accepted mutation ${index}`);
    const file = join(dir, `${index}.json`);
    await writeFile(file, JSON.stringify(d));
    const result = spawnSync(binary, ['validate', file], { encoding: 'utf8' });
    assert.notEqual(result.status, 0, `Rust accepted mutation ${index}`);
    assert.ok(!result.stderr.includes('panicked'), result.stderr);
    assert.ok(!result.stderr.includes('fingerprint does not match'), `Rust missed graph mutation ${index}: ${result.stderr}`);
  }
});

test('deep parent chains resolve iteratively', () => {
  const d = structuredClone(fixture);
  d.symbols = Array.from({ length: 3000 }, (_, index) => ({
    id: `${index}`, input: 0, kind: 'namespace', name: 'n', qualifiedName: `${index}`,
    declaration: '', ...(index ? { parentId: index - 1 } : {}),
  }));
  d.types = [];
  assert.equal(resolveDocument(d).symbols.at(-1).parentId, '2998');
});

function rustFixture() {
  return {
    schemaVersion: 1, generator: fixture.generator, title: 'Rust', fingerprint: fixture.fingerprint,
    inputs: [{ name: 'crate', language: 'rust' }], types: [],
    symbols: [
      { id: 'crate:root', input: 0, kind: 'module', name: 'sample', declaration: 'mod sample', rustdocId: '0' },
      { id: 'crate:type', input: 0, parentId: 0, kind: 'struct', name: 'Widget', declaration: 'pub struct Widget;', rustdocId: '1' },
    ],
    rustdoc: [{ api: 'crate', data: {
      format_version: 57, root: 0,
      index: { '0': { id: 0, inner: { module: { items: [1] } } }, '1': { id: 1, inner: { struct: { fields: [] } } } },
      // Native fields never participate in Refquill's pointers or defaults.
      extension: { targetId: 5000, type: { text: 'preserved', references: [] }, line: 1, default: null },
    } }],
  };
}

test('Rust inherits native qualified names and preserves compiler metadata without mutating it', () => {
  const input = rustFixture();
  const original = structuredClone(input);
  const document = resolveDocument(input);
  assert.equal(document.symbols[1].qualifiedName, 'sample::Widget');
  assert.equal(document.symbols[1].rustdocId, '1');
  assert.deepEqual(document.rustdoc, input.rustdoc);
  document.rustdoc[0].data.index['1'].id = 99;
  assert.deepEqual(input, original);
});

test('many rustdoc snapshots match represented Rust inputs while unused inputs remain invalid', () => {
  const document = rustFixture();
  document.inputs = Array.from({ length: 2000 }, (_, i) => ({ name: `crate-${i}`, language: 'rust' }));
  document.symbols = document.inputs.map((entry, i) => ({ id: entry.name, input: i, kind: 'module', name: entry.name, declaration: '', rustdocId: '0' }));
  document.rustdoc = document.inputs.map(entry => ({ api: entry.name, data: { format_version: 57, index: { '0': { id: 0 } } } })).reverse();
  assert.equal(resolveDocument(document).rustdoc.length, 2000);
  document.inputs.push({ name: 'unused', language: 'rust' });
  document.rustdoc.push({ api: 'unused', data: { format_version: 57, index: {} } });
  assert.throws(() => parseDocument(document), /Missing Rust input for rustdoc: unused/);
});

test('analyzer JSON preflight rejects cycles and accessors without executing input code', () => {
  const cycle = {}; cycle.self = cycle;
  let reads = 0;
  const accessor = Object.defineProperty({}, 'schemaVersion', { enumerable: true, get() { reads++; return 1; } });
  for (const parse of [parseDocument, resolveDocument]) {
    for (const value of [cycle, accessor, new Date(), [undefined], new Array(5), { number: Infinity }, { [Symbol()]: 'x' }]) {
      assert.throws(() => parse(value), /Invalid Refquill document/);
    }
  }
  assert.equal(reads, 0);
});

test('analyzer JSON preflight bounds recursive types, callbacks, breadth and text before schema validation', () => {
  let nestedType = { text: 'string' };
  let nestedParameter = { name: 'callback' };
  for (let i = 0; i < 1000; i++) {
    nestedType = { text: 'Wrapper', structure: { kind: 'generic', name: 'Wrapper', arguments: [nestedType] } };
    nestedParameter = { name: 'callback', signatures: [{ parameters: [nestedParameter] }] };
  }
  const typeDocument = structuredClone(fixture);
  typeDocument.types = [nestedType];
  const callbackDocument = structuredClone(fixture);
  callbackDocument.symbols[0].signatures = [{ parameters: [nestedParameter] }];
  const wide = []; wide.length = 2_000_001;
  const text = { title: 'x'.repeat(64 * 1024 * 1024 + 1) };
  for (const parse of [parseDocument, resolveDocument]) {
    assert.throws(() => parse(typeDocument), /JSON structure limit exceeded/);
    assert.throws(() => parse(callbackDocument), /JSON structure limit exceeded/);
    assert.throws(() => parse(wide), /JSON value limit exceeded/);
    assert.throws(() => parse(text), /text limit exceeded/);
  }
});

test('Rust metadata provenance is validated consistently', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'refquill-rust-schema-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const binary = process.env.REFQUILL_BINARY ?? resolve(`target/debug/refquill${process.platform === 'win32' ? '.exe' : ''}`);
  const cases = [
    d => { d.rustdoc.push(d.rustdoc[0]); },
    d => { d.rustdoc[0].api = 'missing'; },
    d => { d.rustdoc[0].data.format_version = 0; },
    d => { d.rustdoc[0].data.index = []; },
    d => { d.symbols[1].rustdocId = 'missing'; },
    d => { d.inputs[0].language = 'php'; },
    d => { delete d.rustdoc; },
  ];
  for (const [index, mutate] of cases.entries()) {
    const document = rustFixture();
    mutate(document);
    assert.throws(() => parseDocument(document), undefined, `JS accepted Rust mutation ${index}`);
    const file = join(dir, `${index}.json`);
    await writeFile(file, JSON.stringify(document));
    const result = spawnSync(binary, ['validate', file], { encoding: 'utf8' });
    assert.notEqual(result.status, 0, `Rust accepted Rust mutation ${index}`);
    assert.ok(!result.stderr.includes('panicked'), result.stderr);
    assert.ok(!result.stderr.includes('fingerprint does not match'), `Rust missed provenance mutation ${index}: ${result.stderr}`);
  }
});
