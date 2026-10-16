import { Fragment } from 'react';
import { jsx, jsxs } from 'react/jsx-runtime';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { createHighlighter } from 'shiki';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { safeUrl } from '@nickwelsh/refquill-fumadocs';
import type { ApiReference } from '@nickwelsh/refquill-fumadocs';
import { source } from '@/lib/source';
import { getApiPreviewTargets } from '@/lib/api-reference';
import type { ApiLinkPreview } from './api-link';
import { ApiLink } from './api-link';

const highlighter = createHighlighter({
    themes: ['github-light', 'github-dark'],
    langs: ['php', 'typescript', 'rust'],
});

export async function getApiLinkPreviews(currentPage: typeof source.$inferPage) {
    const shiki = await highlighter;
    const previews: Record<string, ApiLinkPreview> = {};
    const targets =
        currentPage.type === 'api'
            ? getApiPreviewTargets(currentPage.data.reference, currentPage.data)
            : new Set<string>();
    const visited = new Set<ApiReference>();
    for (const page of source.getPages().filter((candidate) => candidate.type === 'api')) {
        const { reference, symbolId, inputName, namespace } = page.data;
        if (!visited.has(reference)) {
            visited.add(reference);
            for (const symbol of reference.document.symbols.filter((candidate) =>
                targets.has(reference.getUrl(candidate.id)),
            )) {
                const description =
                    symbol.description.length > 0
                        ? symbol.description
                        : (symbol.signatures.find((signature) => signature.description.length > 0)?.description ?? '');
                previews[reference.getUrl(symbol.id)] = {
                    title: symbol.name,
                    kind: reference.getSymbolKind(symbol.id),
                    qualifiedName: symbol.qualifiedName,
                    description: (
                        <Markdown
                            components={{ a: ({ node: _node, ...props }) => <ApiLink {...props} /> }}
                            remarkPlugins={[remarkGfm]}
                            skipHtml
                            urlTransform={(url) => (safeUrl(url) ? url : '')}
                        >
                            {[
                                description,
                                ...reference
                                    .getDocumentationLinks(symbol.id)
                                    .filter(
                                        (link) =>
                                            !link.name.includes('[') &&
                                            !link.name.includes(']') &&
                                            !/[\r\n]/u.test(link.name),
                                    )
                                    .map((link) => `[${link.name}]: ${link.url}`),
                            ].join('\n\n')}
                        </Markdown>
                    ),
                    declaration: (
                        <>
                            {toJsxRuntime(
                                shiki.codeToHast(symbol.declaration, {
                                    lang: symbol.language,
                                    themes: { light: 'github-light', dark: 'github-dark' },
                                    defaultColor: false,
                                }),
                                { Fragment, jsx, jsxs },
                            )}
                        </>
                    ),
                };
            }
        }
        if (symbolId === null) {
            const scope = inputName === null ? null : reference.getNamespace(inputName, namespace ?? '');
            previews[page.url] = {
                title: page.data.title,
                kind: 'namespace',
                qualifiedName:
                    scope !== null && scope.name.length > 0 ? scope.name : (inputName ?? reference.document.title),
                description:
                    scope === null ? (
                        <p>Generated Refquill package API documentation.</p>
                    ) : (
                        <p>
                            {scope.symbols.length} declarations · {scope.children.length} namespaces
                        </p>
                    ),
                declaration: null,
            };
        }
    }
    return previews;
}
