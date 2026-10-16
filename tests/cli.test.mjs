import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { parseDocument, resolveDocument } from '../packages/schema/index.js';
import { fileSnapshot } from '../scripts/file-snapshot.mjs';

const binary = process.env.REFQUILL_BINARY ?? resolve(`target/debug/refquill${process.platform === 'win32' ? '.exe' : ''}`);
const wrapper = resolve('packages/cli/bin/refquill.mjs');
const worker = resolve('packages/cli/src/typescript.mjs');
const env = { ...process.env, REFQUILL_BINARY: binary, REFQUILL_TYPESCRIPT_WORKER: worker, REFQUILL_NODE: process.execPath };
const run = (...args) => spawnSync(process.execPath, [wrapper, ...args], { env, cwd: tmpdir(), encoding: 'utf8' });
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'refquill-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await cp(resolve('tests/fixtures'), join(dir, 'fixtures'), { recursive: true });
  return { dir, config: join(dir, 'fixtures/refquill.json'), output: join(dir, 'output/mixed.json') };
}

test('one CLI analyzes both languages with compiler semantics and stable output', async t => {
  const { config, output } = await fixture(t);
  const result = run('generate', config);
  assert.equal(result.status, 0, result.stderr);
  const document = resolveDocument(JSON.parse(await readFile(output, 'utf8')));
  const wire = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(wire.schemaVersion, 1);
  assert.ok(wire.inputs.length > 0);
  assert.ok(wire.types.length > 0);
  assert.ok(wire.symbols.every(symbol => !('language' in symbol) && !('api' in symbol)));
  const find = name => document.symbols.find(symbol => symbol.language === 'typescript' && symbol.qualifiedName === name);
  assert.equal(find('identifier').signatures.length, 2);
  assert.equal(find('identifier').signatures[0].parameters[0].type.text, 'Account');
  assert.ok(!find('identifier').declaration.includes("import('./models.js')"));
  assert.equal(find('defaults').type.text, '{ active: boolean; count: number }');
  assert.equal(find('Mode').type.structure.kind, 'union');
  assert.equal(find('Mode').type.structure.types.length, 2);
  assert.equal(find('AccountsByMode').type.structure.name, 'Partial');
  const record = find('AccountsByMode').type.structure.arguments[0];
  assert.equal(record.structure.name, 'Record');
  assert.deepEqual(record.structure.argumentParameters.map(p => p.name), ['K', 'T']);
  assert.equal(find('AccountBox').type.structure.argumentParameters[0].description, 'The stored value.');
  const callback = find('RenderOptions.render').signatures[0];
  assert.equal(callback.parameters[0].description, 'Text to render.');
  assert.equal(callback.returnsDescription, 'Rendered text.');
  assert.equal(callback.parameters[1].properties[0].name, 'compact');
  const nestedCallback = find('renderWith').signatures[0].parameters[0].properties.find(p => p.name === 'render');
  assert.equal(nestedCallback.signatures[0].parameters[0].name, 'value');
  assert.equal(record.structure.arguments[1].references[0].targetId, find('Account').id);
  assert.equal(find('Collection.first').signatures[0].returns.text, 'T');
  assert.equal(find('Accounts').kind, 'class');
  assert.equal(find('Accounts').source.file, 'typescript/index.ts');
  assert.equal(find('format').signatures[0].parameters[0].name, '{ name }');
  const parameter = find('configure').signatures[0].parameters[0];
  assert.equal(parameter.properties.find(property => property.name === 'retry').optional, true);
  assert.equal(parameter.properties.find(property => property.name === 'retry').description, 'Number of retry attempts.');
  const connection = parameter.properties.find(property => property.name === 'connection');
  assert.deepEqual(connection.properties.map(property => property.name), ['host', 'port']);
  assert.equal(connection.properties[0].description, 'Destination hostname.');
  assert.ok(find('format').signatures[0].parameters[0].type.references.some(ref => ref.targetId === find('Account').id));
  assert.ok(find('Collection').typeParameters[0].constraint.references.some(ref => ref.targetId === find('Account').id));
  assert.ok(find('legacy').deprecated);
  assert.ok(!find('internal'));
  assert.ok(!find('Collection.secret'));
  assert.ok(!find('Collection.helper'));
  assert.ok(document.symbols.some(s => s.qualifiedName === 'Demo\\Person'));
  const before = await fileSnapshot(output);
  assert.equal(run('generate', config).status, 0);
  const after = await fileSnapshot(output);
  assert.deepEqual(after.bytes, before.bytes);
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.equal(run('validate', output).status, 0);
});

test('one npm CLI combines PHP, TypeScript, and compiler-generated Rust JSON', async t => {
  const { dir, config, output } = await fixture(t);
  const configuration = JSON.parse(await readFile(config, 'utf8'));
  configuration.inputs.push({ language: 'rust', name: 'rust', rustdoc: 'rust/rustdoc.json' });
  await writeFile(config, JSON.stringify(configuration));
  const rawPath = join(dir, 'fixtures/rust/rustdoc.json');
  const raw = JSON.parse(await readFile(rawPath, 'utf8'));
  // This copied fixture uses the fixtures directory as sourceRoot.
  for (const item of Object.values(raw.index)) if (item.span) item.span.filename = item.span.filename.replace(/^tests\/fixtures\//, '');
  await writeFile(rawPath, JSON.stringify(raw));
  const result = run('generate', config);
  assert.equal(result.status, 0, result.stderr);
  const document = resolveDocument(JSON.parse(await readFile(output, 'utf8')));
  assert.deepEqual(new Set(document.symbols.map(symbol => symbol.language)), new Set(['php', 'typescript', 'rust']));
  const record = document.symbols.find(symbol => symbol.language === 'rust' && symbol.name === 'Record');
  assert.equal(record.kind, 'struct');
  assert.equal(record.source.file, 'rust/lib.rs');
  assert.ok(Object.hasOwn(document.rustdoc[0].data.index, record.rustdocId));
  assert.equal(run('validate', output).status, 0);
});

test('compiler or parser failures preserve the last artifact', async t => {
  const { dir, config, output } = await fixture(t);
  assert.equal(run('generate', config).status, 0);
  const bytes = await readFile(output, 'utf8');
  const tsfile = join(dir, 'fixtures/typescript/index.ts');
  const source = await readFile(tsfile, 'utf8');
  await writeFile(tsfile, `${source}\nexport const invalid: string = 123;`);
  assert.notEqual(run('generate', config).status, 0);
  assert.equal(await readFile(output, 'utf8'), bytes);
  await writeFile(tsfile, source);
  const phpfile = join(dir, 'fixtures/php/Api.php');
  const phpsource = await readFile(phpfile, 'utf8');
  await writeFile(phpfile, `${phpsource}\nclass Person {}`);
  const duplicate = run('generate', config);
  assert.notEqual(duplicate.status, 0);
  assert.match(duplicate.stderr, /Duplicate symbol:.*Api.php/);
  assert.equal(await readFile(output, 'utf8'), bytes);
  await writeFile(phpfile, '<?php class {');
  assert.notEqual(run('generate', config).status, 0);
  assert.equal(await readFile(output, 'utf8'), bytes);
});

test('configuration rejects typos and duplicate input names', async t => {
  const { config } = await fixture(t);
  const original = JSON.parse(await readFile(config, 'utf8'));
  await writeFile(config, JSON.stringify({ ...original, ouput: 'oops.json' }));
  assert.notEqual(run('generate', config).status, 0);
  original.inputs[1].name = original.inputs[0].name;
  await writeFile(config, JSON.stringify(original));
  assert.notEqual(run('generate', config).status, 0);
});

test('unsupported schema versions require explicit replacement', async t => {
  const { config, output } = await fixture(t);
  assert.equal(run('generate', config).status, 0);
  const d = JSON.parse(await readFile(output, 'utf8'));
  d.schemaVersion = 2;
  const previous = JSON.stringify(d);
  await writeFile(output, previous);
  assert.notEqual(run('validate', output).status, 0);
  assert.notEqual(run('generate', config).status, 0);
  assert.equal(await readFile(output, 'utf8'), previous);
  assert.equal(run('generate', config, '--force').status, 0);
  assert.equal(JSON.parse(await readFile(output, 'utf8')).schemaVersion, 1);
  assert.equal(run('validate', output).status, 0);
});

test('init is convenient and refuses to overwrite a config', async t => {
  const { dir } = await fixture(t);
  const config = join(dir, 'new.json');
  assert.equal(run('init', '--config', config, '--language', 'typescript').status, 0);
  assert.equal(JSON.parse(await readFile(config, 'utf8')).inputs[0].language, 'typescript');
  assert.notEqual(run('init', '--config', config).status, 0);
  const rust = join(dir, 'rust.json');
  assert.equal(run('init', '--config', rust, '--language', 'rust').status, 0);
  const input = JSON.parse(await readFile(rust, 'utf8')).inputs[0];
  assert.equal(input.language, 'rust');
  assert.equal(input.manifestPath, 'Cargo.toml');
  assert.equal(input.toolchain, 'nightly');
});

test('the shipped manpage documents every command and help option', async () => {
  const manual = await readFile(resolve('packages/cli/man/refquill.1'), 'utf8');
  const help = run('--help');
  const commands = help.stdout.split('Commands:\n')[1].split('\nOptions:')[0];
  for (const [, command] of commands.matchAll(/^\s+(\w+)/gm)) assert.ok(manual.includes(`refquill ${command}`), `Undocumented command: ${command}`);
  for (const command of ['', 'init', 'generate', 'validate', 'schema']) {
    const result = run(...(command ? [command] : []), '--help');
    assert.equal(result.status, 0, result.stderr);
    if (command) assert.ok(manual.includes(`refquill ${command}`), command);
    for (const [, option] of result.stdout.matchAll(/^\s+(?:-\w,\s+)?(--[\w-]+)/gm)) {
      assert.ok(manual.includes(option), `Undocumented ${command || 'CLI'} option: ${option}`);
    }
  }
});

test('frontend validators enforce graph invariants beyond JSON Schema', async t => {
  const { config, output } = await fixture(t);
  assert.equal(run('generate', config).status, 0);
  const document = JSON.parse(await readFile(output, 'utf8'));
  const mutated = fn => { const copy = structuredClone(document); fn(copy); return copy; };
  assert.throws(() => parseDocument(mutated(d => d.schemaVersion = 2)), /Invalid Refquill/);
  assert.throws(() => parseDocument(mutated(d => d.symbols.push(d.symbols[0]))), /Duplicate/);
  assert.throws(() => parseDocument(mutated(d => d.symbols[0].parentId = d.symbols.length)), /Invalid parent/);
  assert.throws(() => parseDocument(mutated(d => d.symbols[0].parentId = 0)), /Cyclic/);
  assert.throws(() => parseDocument(mutated(d => d.symbols[0].source.file = '../private.ts')), /Invalid source/);
  assert.throws(() => parseDocument(mutated(d => (d.diagnostics ??= []).push({message:'Warning', source:{file:'../private.ts',line:1,endLine:1}}))), /Invalid source/);
  assert.throws(() => parseDocument(mutated(d => (d.symbols[0].relations ??= []).push({ kind: 'extends', name: 'Missing', targetId: d.symbols.length }))), /Invalid reference/);
});
