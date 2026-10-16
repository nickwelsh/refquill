import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { createApiReference, parseReferenceDocument } from '../src/index.js';
import { ApiDocumentProjection } from '../src/api-document.js';
import { ApiKindIcon, ApiReference, apiReferenceIcon } from '../src/components.js';

const input = {
  schemaVersion: 1, generator: { name: 'refquill', version: 'test' }, title: 'Components', fingerprint: 'a'.repeat(64),
  inputs: [{ name: 'ui', language: 'typescript' }], types: [
    { text: 'Props', references: [{ name: 'Props', targetId: 0 }] },
    { text: 'string' }, { text: 'void' }, { text: 'Element' },
  ], symbols: [
    { id: 'props', input: 0, kind: 'interface', name: 'Props', declaration: 'interface Props { label: string }' },
    ...['react', 'vue', 'svelte', 'solid'].map(name => ({
      id: name, input: 0, kind: 'function', name: `${name}Card`, declaration: `function ${name}Card(props: Props): Element;`,
      signatures: [{ parameters: [{ name: 'props', type: 0 }], returns: 3 }],
      framework: { name, role: 'component', props: [
        { name: 'label', type: 1, description: 'Card title.' },
        { name: 'tone', type: 1, optional: true, default: "'neutral'" },
        { name: 'onSelect', optional: true, signatures: [{ parameters: [{ name: 'value', type: 0 }], returns: 2 }] },
      ], events: name === 'vue' ? [{ name: 'select', type: 1 }] : [], slots: name === 'vue' ? [{ name: 'default', type: 0 }] : [], exposed: [{ name: 'focus', signatures: [{ returns: 2 }] }] },
    })),
    { id: 'hook', input: 0, kind: 'function', name: 'useCounter', declaration: 'function useCounter(initial: string): string;', framework: { name: 'react', role: 'hook' }, signatures: [{ parameters: [{ name: 'initial', type: 1 }], returns: 1 }] },
    { id: 'ordinary', input: 0, kind: 'function', name: 'Capitalize', declaration: 'function Capitalize(): string;', signatures: [{ returns: 1 }] },
  ],
};

test('framework components project direct props and distinct framework labels, icons, search and Markdown', () => {
  const api = createApiReference({ input });
  const projection = new ApiDocumentProjection(api);
  parseReferenceDocument(api.toReferenceDocument());
  for (const name of ['react', 'vue', 'svelte', 'solid']) {
    const page = projection.symbol(name);
    assert.equal(page.type?.key, `${name}-component`);
    assert.ok(page.blocks.some(block => block.kind === 'section' && block.title === 'Props'));
    assert.ok(!page.blocks.some(block => block.kind === 'section' && ['Parameters', 'Returns'].includes(block.title)));
    assert.ok(page.blocks.some(block => block.kind === 'section' && block.title === 'Exposed members'));
    const markdown = api.getPageText({ symbolId: name });
    assert.ok(markdown.includes('Props'));
    assert.ok(markdown.includes('Card title.'));
    const source = api.toFumadocsSource().files.find(file => file.type === 'page' && file.data.symbolId === name);
    assert.ok(source && source.type === 'page');
    assert.equal(source.data.icon, `refquill-${name}-component`);
    const html = renderToString(<ApiReference reference={api} symbolId={name} />);
    assert.ok(html.includes('Card title.'));
    assert.ok(html.includes('optional'));
    assert.ok(html.includes('neutral'));
    assert.ok(apiReferenceIcon(source.data.icon));
  }
  const react = renderToString(<ApiKindIcon kind="react-component" />);
  assert.ok(react.includes('lucide-component'));
  assert.ok(renderToString(<ApiKindIcon kind="react-component" icons={{ 'react-component': () => <svg data-custom="react" /> }} />).includes('data-custom="react"'));
  const vue = projection.symbol('vue');
  assert.ok(vue.blocks.some(block => block.kind === 'section' && block.title === 'Events'));
  assert.ok(vue.blocks.some(block => block.kind === 'section' && block.title === 'Slots'));
});

test('hooks keep normal signatures while ordinary functions keep their original category', () => {
  const api = createApiReference({ input });
  const page = new ApiDocumentProjection(api).symbol('hook');
  assert.equal(page.type?.label, 'React hook');
  assert.ok(page.blocks.some(block => block.kind === 'section' && block.title === 'Parameters'));
  assert.ok(page.blocks.some(block => block.kind === 'section' && block.title === 'Returns'));
  assert.equal(api.getSymbolKind('ordinary'), 'function');
  assert.equal(api.resolveLink('Props', { language: 'typescript', symbolId: 'vue' })?.url, api.getUrl('props'));
});
