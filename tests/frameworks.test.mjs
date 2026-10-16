import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { analyze } from '../packages/cli/src/typescript.mjs';
import { resolveDocument, parseDocument } from '../packages/schema/index.js';
import { fileSnapshot } from '../scripts/file-snapshot.mjs';

const root = path.resolve('.');
const example = path.resolve('examples/frameworks-fumadocs');
const binary = path.resolve('target/debug/refquill');
const options = (tsconfig, entryPoints, name = 'test') => ({ name, sourceRoot: root,
  tsconfig: path.resolve(example, tsconfig), entryPoints: entryPoints.map(file => path.resolve(example, file)), exclude: ['**/node_modules/**'], includeProtected: false });

async function fixture(t) {
  const directory = await mkdtemp(path.join(example, '.test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const file of ['src', 'tsconfig.json', 'tsconfig.react.json', 'tsconfig.solid.json', 'tsconfig.components.json']) await cp(path.join(example, file), path.join(directory, file), { recursive: true });
  return directory;
}

test('React components retain compiler props, defaults, callbacks, wrappers and hook identity', async () => {
  const { symbols } = await analyze(options('tsconfig.react.json', ['src/react.tsx']));
  const find = name => symbols.find(symbol => symbol.name === name && !symbol.parentId);
  for (const name of ['Badge', 'MemoBadge', 'SearchInput', 'ClassBadge']) {
    const symbol = find(name);
    assert.equal(symbol.framework.name, 'react', name);
    assert.equal(symbol.framework.role, 'component', name);
    assert.ok(symbol.framework.props.some(prop => prop.name === 'label' && !prop.optional));
  }
  assert.equal(find('Badge').framework.props.find(prop => prop.name === 'tone').default, "'neutral'");
  assert.equal(find('MemoBadge').framework.props.find(prop => prop.name === 'tone').default, "'neutral'");
  const callback = find('Badge').framework.props.find(prop => prop.name === 'onSelect');
  assert.equal(callback.description, 'Called when the badge is selected.');
  assert.equal(callback.signatures[0].parameters[0].name, 'label');
  assert.equal(callback.signatures[0].parameters[0].type.text, 'string');
  assert.equal(find('SearchInput').framework.props.find(prop => prop.name === 'ref').optional, true);
  assert.equal(find('useCounter').framework.role, 'hook');
  assert.equal(find('useCounter').signatures[0].parameters[0].name, 'initial');
  assert.equal(find('useIdentifier').framework, undefined);
  assert.equal(find('Capitalize').framework, undefined);
  assert.ok(!JSON.stringify(find('Badge').framework).includes('toString'));
});

test('the real ApiKindIcon documents kind and icons directly as React props', async () => {
  const { symbols } = await analyze({ ...options('../../packages/fumadocs/tsconfig.json', []),
    entryPoints: [path.resolve('packages/fumadocs/src/components.tsx'), path.resolve('packages/fumadocs/src/index.ts')] });
  const symbol = symbols.find(symbol => symbol.name === 'ApiKindIcon');
  assert.equal(symbol.kind, 'function');
  assert.equal(symbol.framework.name, 'react');
  assert.deepEqual(symbol.framework.props.map(prop => prop.name), ['kind', 'icons']);
  assert.equal(symbol.framework.props[0].optional, false);
  assert.equal(symbol.framework.props[1].optional, true);
  assert.ok(symbol.framework.props[0].type.references.some(ref => ref.targetId === symbols.find(symbol => symbol.name === 'ApiSymbolKind').id));
});

test('SolidJS JSX uses its own framework and compiler props', async () => {
  const { symbols } = await analyze(options('tsconfig.solid.json', ['src/solid.tsx']));
  const component = symbols.find(symbol => symbol.name === 'SolidBadge');
  assert.equal(component.framework.name, 'solid');
  assert.deepEqual(component.framework.props.map(prop => prop.name), ['label', 'children', 'onSelect']);
});

test('Vue and Svelte compilers expose native props, events, slots, defaults and exported members', async () => {
  const { symbols } = await analyze(options('tsconfig.components.json', ['src/VueCard.vue', 'src/SvelteCard.svelte']));
  const vue = symbols.find(symbol => symbol.name === 'VueCard').framework;
  const svelte = symbols.find(symbol => symbol.name === 'SvelteCard').framework;
  for (const framework of [vue, svelte]) {
    assert.equal(framework.props.find(prop => prop.name === 'title').description, 'Card heading.');
    assert.equal(framework.props.find(prop => prop.name === 'title').optional, false);
    assert.equal(framework.props.find(prop => prop.name === 'bordered').default, 'true');
    assert.ok(framework.exposed.some(member => member.name === 'focus'));
  }
  assert.equal(vue.events[0].name, 'select');
  assert.equal(vue.slots[0].name, 'default');
  assert.ok(svelte.props.find(prop => prop.name === 'children').type.text.includes('Snippet'));
  assert.ok(svelte.props.find(prop => prop.name === 'onselect').signatures.length);
});

test('mixed seven-input artifacts round trip, validate and retain stable output', async t => {
  const directory = await fixture(t);
  const configuration = JSON.parse(await readFile(path.join(example, 'refquill.json'), 'utf8'));
  configuration.sourceRoot = root;
  configuration.output = 'api.json';
  configuration.inputs.find(input => input.language === 'rust').rustdoc = path.resolve('tests/fixtures/rust/rustdoc.json');
  const config = path.join(directory, 'refquill.json');
  await writeFile(config, JSON.stringify(configuration));
  const run = (...args) => spawnSync(binary, args, { encoding: 'utf8' });
  const result = run('generate', config);
  assert.equal(result.status, 0, result.stderr);
  const output = path.join(directory, 'api.json');
  const before = await fileSnapshot(output);
  const wire = JSON.parse(before.bytes.toString('utf8'));
  const document = resolveDocument(wire);
  assert.equal(wire.inputs.length, 7);
  assert.deepEqual(new Set(document.symbols.map(symbol => symbol.framework?.name).filter(Boolean)), new Set(['react', 'solid', 'vue', 'svelte']));
  assert.equal(run('validate', output).status, 0);
  assert.equal(run('generate', config).status, 0);
  const after = await fileSnapshot(output);
  assert.deepEqual(after.bytes, before.bytes);
  assert.equal(after.mtimeMs, before.mtimeMs);
  const component = wire.symbols.find(symbol => symbol.framework?.props?.length);
  component.framework.props[0].type = wire.types.length;
  assert.throws(() => parseDocument(wire), /Invalid type/);
  await writeFile(output, JSON.stringify(wire));
  const invalid = run('validate', output);
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /Invalid type/);
});

test('Svelte legacy props, slots and events survive compiler extraction', async t => {
  const directory = await fixture(t);
  const file = path.join(directory, 'src/Legacy.svelte');
  await writeFile(file, `<script lang="ts">import {createEventDispatcher} from 'svelte';
    /** Required title. */ export let title: string;
    /** Counter. */ export let count = 1;
    const dispatch = createEventDispatcher<{ select: string }>();
    </script><slot title={title} />`);
  const { symbols } = await analyze({ ...options('tsconfig.components.json', []), tsconfig: path.join(directory, 'tsconfig.components.json'), entryPoints: [file] });
  const metadata = symbols[0].framework;
  assert.equal(metadata.props.find(prop => prop.name === 'title').optional, false);
  assert.equal(metadata.props.find(prop => prop.name === 'count').optional, true);
  assert.equal(metadata.props.find(prop => prop.name === 'count').default, '1');
  assert.equal(metadata.slots[0].name, 'default');
  assert.equal(metadata.events[0].name, 'select');
});

test('invalid component source fails rather than returning incomplete props', async t => {
  const directory = await fixture(t);
  for (const extension of ['svelte', 'vue']) {
    const file = path.join(directory, `src/Invalid.${extension}`);
    await writeFile(file, `<script ${extension === 'vue' ? 'setup ' : ''}lang="ts">const value: string = 123;</script><p>{value}</p>`);
    await assert.rejects(analyze({ ...options('tsconfig.components.json', []), tsconfig: path.join(directory, 'tsconfig.components.json'), entryPoints: [file] }), /not assignable|Cannot analyze/);
  }
});

test('component props preserve inheritance, generics, required defaults and anonymous default exports', async t => {
  const directory = await fixture(t);
  const file = path.join(directory, 'src/edges.tsx');
  await writeFile(file, `import {type FC, useState} from 'react';
    interface Base {
      /** Inherited label. */
      label: string
    }
    export interface Props extends Base { required: string; optional?: boolean }
    export type ComponentAlias = FC<Props>;
    export function Named(props: Props) { return <span>{props.label}</span> }
    export function Required({required = 'fallback'}: Props) { return <span>{required}</span> }
    export function Generic<T>({item}: { item: T }) { return <span>{String(item)}</span> }
    export function Factory() { return () => <span /> }
    export function useFactory() { return () => useState(0) }
    export default ({label}: Props) => <span>{label}</span>;
  `);
  const tsconfig = path.join(directory, 'tsconfig.react.json');
  await writeFile(tsconfig, JSON.stringify({ extends: './tsconfig.json', include: ['src/edges.tsx'] }));
  const { symbols } = await analyze({ ...options('tsconfig.react.json', []), tsconfig, entryPoints: [file] });
  const find = name => symbols.find(symbol => symbol.name === name && !symbol.parentId);
  assert.equal(find('Named').framework.props.find(prop => prop.name === 'label').description, 'Inherited label.');
  assert.equal(find('Required').framework.props.find(prop => prop.name === 'required').optional, false);
  assert.equal(find('Generic').framework.props[0].type.text, 'T');
  assert.equal(find('Generic').signatures[0].typeParameters[0].name, 'T');
  assert.equal(find('default').framework.name, 'react');
  for (const name of ['ComponentAlias', 'Factory', 'useFactory']) assert.equal(find(name).framework, undefined, name);
});

test('native component directories respect exclusions and Svelte component imports resolve', async t => {
  const directory = await fixture(t);
  for (const file of ['react.tsx', 'solid.tsx', 'typescript.ts', 'Greeter.php']) await rm(path.join(directory, 'src', file));
  const card = path.join(directory, 'src/SvelteCard.svelte');
  await writeFile(card, (await readFile(card, 'utf8')).replace("import type { Snippet }", "import Child from './Child.svelte';\n  import type { Snippet }").replace('<article class:bordered>', '<article class:bordered><Child title={title} />'));
  await writeFile(path.join(directory, 'src/Child.svelte'), '<script lang="ts">let {title}: {title: string} = $props();</script><p>{title}</p>');
  const { symbols } = await analyze({ ...options('tsconfig.components.json', []), tsconfig: path.join(directory, 'tsconfig.components.json'), entryPoints: [path.join(directory, 'src')], exclude: ['**/VueCard.vue'] });
  assert.deepEqual(symbols.map(symbol => symbol.name).sort(), ['Child', 'SvelteCard']);
});

test('Vue language plugins in inherited tsconfigs are rejected before any project code executes', async t => {
  const directory = await fixture(t);
  const marker = path.join(directory, 'plugin-ran');
  await writeFile(path.join(directory, 'plugin.cjs'), `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed'); module.exports = () => ({});`);
  const base = JSON.parse(await readFile(path.join(directory, 'tsconfig.json'), 'utf8'));
  base.vueCompilerOptions = { plugins: ['./plugin.cjs'] };
  await writeFile(path.join(directory, 'tsconfig.json'), JSON.stringify(base));
  const tsconfig = path.join(directory, 'tsconfig.components.json');
  await writeFile(tsconfig, JSON.stringify({ extends: './tsconfig.json', vueCompilerOptions: { plugins: [] }, include: ['src/*.vue'] }));
  await assert.rejects(analyze({ ...options('tsconfig.components.json', []), tsconfig, entryPoints: [path.join(directory, 'src/VueCard.vue')] }), /Vue language plugins are not executed/);
  await assert.rejects(stat(marker), { code: 'ENOENT' });
});
