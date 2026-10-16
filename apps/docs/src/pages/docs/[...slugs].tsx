import { source, getDocsVersions } from '@/lib/source';
import type { ComponentProps } from 'react';
import type { PageProps } from 'waku/router';
import { ApiLink as Link, ApiLinkProvider } from '@/components/docs/api-link';
import { createRelativeLink } from 'fumadocs-ui/mdx';
import { findNeighbour } from 'fumadocs-core/page-tree';
import { unstable_notFound } from 'waku/router/server';
import { Card, getMDXComponents } from '@/components/mdx';
import { PageActions } from '@/components/docs/page-actions';
import { TableOfContentsNav } from '@/components/docs/toc';
import { ApiReferenceContent, ApiReferenceFooter } from '@/components/docs/api-reference';
import { JsonSchemaReferenceContent } from '@/components/docs/json-schema-reference';
import { ManPageReference } from '@nickwelsh/refquill-fumadocs/components';
import { HighlightedCode } from '@/components/docs/highlighted-code';
import { absoluteUrl, getGitHubSourceUrl, getPageImageUrl, getPageMarkdownUrl } from '@/lib/shared';
import ChevronRight from '~icons/carbon/chevron-right';
import ChevronLeft from '~icons/carbon/chevron-left';
import { getApiLinkPreviews } from '@/components/docs/api-link-previews';

function pageComponents(page: Extract<typeof source.$inferPage, { type: 'docs' }>) {
    return getMDXComponents({
        a: createRelativeLink(source, page, Link),
        Card: (props: ComponentProps<typeof Card>) => <Card {...props} href={source.resolveHref(props.href, page)} />,
    });
}

function PageBody({ page }: { page: typeof source.$inferPage }) {
    if (page.type === 'api') {
        return <ApiReferenceContent {...page.data} />;
    }
    if (page.type === 'schemas') {
        return <JsonSchemaReferenceContent {...page.data} />;
    }
    if (page.type === 'manpage') {
        return (
            <ManPageReference
                reference={page.data.reference}
                renderHeader={() => false}
                renderCode={(text) => <HighlightedCode code={text} language="shellscript" />}
            />
        );
    }
    const Mdx = page.data.body;
    return <Mdx components={pageComponents(page)} />;
}

function StandardPageHeader({ page }: { page: typeof source.$inferPage }) {
    if (page.type !== 'docs' && page.type !== 'manpage') {
        return null;
    }
    const githubUrl =
        page.type === 'manpage'
            ? page.data.reference.sourceUrl
            : getGitHubSourceUrl(`apps/docs/content/docs/${page.path}`);
    return (
        <>
            <div className="docs-title-row">
                <h1>{page.data.title}</h1>
                {githubUrl !== null && <PageActions markdownUrl={getPageMarkdownUrl(page).url} githubUrl={githubUrl} />}
            </div>
            {page.data.description !== undefined && <p className="docs-description">{page.data.description}</p>}
        </>
    );
}

export default async function Page({ slugs }: PageProps<'/docs/[...slugs]'>) {
    const defaultUrl = getDocsVersions()[0]?.url;
    const defaultPage = defaultUrl === undefined ? undefined : source.getPageByHref(defaultUrl)?.page;
    const page =
        source.getPage(slugs) ??
        (slugs.length === 0 ? defaultPage : source.getPage([...(defaultPage?.slugs ?? []), ...slugs]));
    if (!page) {
        unstable_notFound();
    }
    const neighbours = findNeighbour(source.getPageTree(), page.url);
    const referenceLayout = page.type === 'api' || page.type === 'schemas';
    const standardLayout = !referenceLayout;
    return (
        <ApiLinkProvider previews={await getApiLinkPreviews(page)}>
            <div className={referenceLayout ? 'docs-page-grid docs-page-grid-api' : 'docs-page-grid'}>
                <main id="docs-content" className="docs-main">
                    <title>{page.data.title} | Refquill</title>
                    <meta name="description" content={page.data.description} />
                    <link rel="canonical" href={absoluteUrl(page.url)} />
                    <meta property="og:image" content={absoluteUrl(getPageImageUrl(page).url)} />
                    <StandardPageHeader page={page} />
                    <article
                        className={`docs-article${standardLayout ? ' typeset' : ''}${page.type === 'manpage' ? ' docs-manpage' : ''}`}
                    >
                        <PageBody page={page} />
                    </article>
                    {page.type === 'api' && <ApiReferenceFooter {...page.data} />}
                    <nav className="docs-pagination" aria-label="Previous and next page">
                        {neighbours.previous ? (
                            <Link href={neighbours.previous.url}>
                                <ChevronLeft />
                                {neighbours.previous.name}
                            </Link>
                        ) : (
                            <span />
                        )}
                        {neighbours.next && (
                            <Link href={neighbours.next.url}>
                                {neighbours.next.name}
                                <ChevronRight />
                            </Link>
                        )}
                    </nav>
                </main>
                {!referenceLayout && (
                    <>
                        <div className="docs-cutter cutter-right" aria-hidden="true" />
                        <aside className="docs-toc">
                            <TableOfContentsNav toc={page.data.toc} />
                        </aside>
                    </>
                )}
            </div>
        </ApiLinkProvider>
    );
}

export async function getConfig() {
    return { render: 'static', staticPaths: source.getPages().map((page) => page.slugs) } as const;
}
