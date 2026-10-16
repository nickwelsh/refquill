import { createApiReference, createReference, memberAnchor } from '@nickwelsh/refquill-fumadocs';
import type { ApiReference, ApiReferencePageData, DocumentReference } from '@nickwelsh/refquill-fumadocs';
import type { StaticSource, MetaData } from 'fumadocs-core/source';
import { getGitHubSourceUrl } from './shared.ts';

export function getApiPreviewTargets(reference: ApiReference, page: ApiReferencePageData) {
    const urls = new Set<string>();
    const includeReferences = (value: unknown) => {
        if (value === null || typeof value !== 'object') {
            return;
        }
        for (const [key, child] of Object.entries(value)) {
            if ((key === 'targetId' || key === 'parentId') && typeof child === 'string') {
                urls.add(reference.getUrl(child));
            } else {
                includeReferences(child);
            }
        }
    };
    const include = (id: string) => {
        const symbol = reference.getSymbol(id);
        urls.add(reference.getUrl(id));
        includeReferences(symbol);
        for (const link of reference.getDocumentationLinks(id)) {
            urls.add(link.url);
        }
    };
    if (page.symbolId === null) {
        const inputs = [...new Set(reference.document.symbols.map((symbol) => symbol.api))];
        const scopes =
            page.inputName === null
                ? inputs.map((input) => reference.getNamespace(input))
                : [reference.getNamespace(page.inputName, page.namespace ?? '')];
        for (const scope of scopes) {
            for (const symbol of scope.symbols) {
                include(symbol.id);
            }
        }
    } else {
        include(page.symbolId);
        const anchors = new Set(page.toc.map((item) => item.url));
        for (const symbol of reference.document.symbols) {
            if (anchors.has(`#${memberAnchor(symbol.id)}`) || symbol.parentId === page.symbolId) {
                include(symbol.id);
            }
        }
    }
    return urls;
}

export function createApiSource(input: unknown, versions: Array<string>) {
    const files: StaticSource<{
        pageData: ApiReferencePageData & { reference: ApiReference; rendering: DocumentReference; nodeId: string };
        metaData: MetaData;
    }>['files'] = [];

    for (const version of versions) {
        const prefix = `${version}/api`;
        const reference = createApiReference({
            input,
            baseUrl: `/docs/${prefix}`,
            sourceUrl: ({ file, line }) => getGitHubSourceUrl(file, line),
            resolveExternal: (_name, { reference: typeReference }) => {
                if (typeReference?.package !== '@types/react') {
                    return null;
                }
                return typeReference.qualifiedName === 'React.JSX.Element' ||
                    typeReference.qualifiedName === 'React.ReactElement'
                    ? 'https://react.dev/reference/react/createElement#returns'
                    : 'https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/types/react/index.d.ts';
            },
        });
        const rendering = createReference({ input: reference.toReferenceDocument(), baseUrl: reference.baseUrl });
        const semanticPages = new Map(
            reference
                .toFumadocsSource()
                .files.flatMap((file) =>
                    file.type === 'page' ? [[(file.slugs ?? []).join('/'), file.data] as const] : [],
                ),
        );
        for (const file of rendering.toFumadocsSource().files) {
            if (file.type === 'page') {
                const semantic = semanticPages.get((file.slugs ?? []).join('/'));
                if (semantic === undefined) {
                    throw new Error(`Missing API metadata for ${file.path}`);
                }
                files.push({
                    ...file,
                    path: `${prefix}/${file.path}`,
                    slugs: [...prefix.split('/'), ...(file.slugs ?? [])],
                    data: { ...semantic, ...file.data, reference, rendering },
                });
            } else {
                files.push({
                    ...file,
                    path: `${prefix}/${file.path}`,
                    data:
                        file.path === 'meta.json'
                            ? {
                                  ...file.data,
                                  title: 'API reference',
                                  description: 'Generated Rust crate, Fumadocs, and schema package references',
                                  icon: 'api',
                                  root: 'section',
                              }
                            : file.data,
                });
            }
        }
    }

    return { files };
}
