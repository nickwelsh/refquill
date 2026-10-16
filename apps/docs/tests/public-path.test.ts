import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Link, RouterProvider } from 'react-aria-components';
import { absoluteUrl, publicPath } from '../src/lib/shared.ts';

void test('browser links include the deployment path while external and local references retain their destinations', () => {
    assert.equal(publicPath('/docs/0.x?query=api#install'), '/refquill/docs/0.x?query=api#install');
    assert.equal(publicPath('/'), '/refquill/');
    assert.equal(publicPath('/refquill/docs/0.x'), '/refquill/docs/0.x');
    assert.equal(publicPath('/refquill'), '/refquill');
    for (const href of [
        '#install',
        '?query=api',
        './content.md',
        'https://docs.nickwelsh.me/refquill/llms.txt',
        '//example.com/docs',
        'mailto:docs@example.com',
        '',
    ]) {
        assert.equal(publicPath(href), href);
    }
    assert.equal(absoluteUrl('/docs/0.x'), 'https://docs.nickwelsh.me/refquill/docs/0.x');
});

void test('React Aria emits a prefixed native href for browser link actions', () => {
    const docs = createElement(Link, { key: 'docs', href: '/docs/0.x' }, 'Docs');
    const markdown = createElement(
        Link,
        { key: 'markdown', href: absoluteUrl('/llms.txt'), target: '_blank' },
        'Markdown',
    );
    const provider = createElement(RouterProvider, {
        navigate: (href) => assert.fail(`Static rendering must not navigate to ${href}`),
        useHref: publicPath,
        // The native TypeScript runner cannot parse JSX; createElement's props require children here.
        // oxlint-disable-next-line react/no-children-prop
        children: [docs, markdown],
    });
    const html = renderToStaticMarkup(provider);
    assert.ok(html.includes('href="/refquill/docs/0.x"'));
    assert.ok(html.includes('href="https://docs.nickwelsh.me/refquill/llms.txt"'));
});
