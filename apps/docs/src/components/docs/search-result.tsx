'use client';
import { Fragment, useMemo, isValidElement } from 'react';
import type { ReactNode } from 'react';
import { jsx, jsxs } from 'react/jsx-runtime';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { useHighlightQuery } from 'fumadocs-core/search/client';
import type { SearchResultRecord } from 'fumadocs-core/search/client';
import ChevronRight from '~icons/carbon/chevron-right';
import Hash from '~icons/carbon/hashtag';
import { searchExcerpt } from '@/lib/search';

function Children({ children }: { children?: ReactNode }): ReactNode {
    return children;
}

const renderOptions = {
    Fragment,
    jsx,
    jsxs,
    components: {
        a: 'span',
        custom: ({ title, tagName, children }: { title?: string; tagName?: string; children?: ReactNode }) => (
            <span>
                {title ?? tagName}
                {children}
            </span>
        ),
        table: Children,
        thead: () => null,
        tbody: Children,
        tr: Children,
        th: 'span',
        td: 'span',
    },
} as const;

export function SearchResultContent({ item, query }: { item: SearchResultRecord; query: string }) {
    const highlight = useHighlightQuery(query);
    const content = useMemo(() => {
        const excerpt = item.type === 'text' ? searchExcerpt(item.content, query) : undefined;
        if (excerpt !== undefined) {
            return excerpt;
        }
        const rendered: unknown = toJsxRuntime(item.hastContent, renderOptions);
        return isValidElement(rendered) ? rendered : null;
    }, [item.hastContent, item.type, item.content, query]);
    return (
        <>
            {Boolean(item.breadcrumbs?.length) && (
                <div className="search-breadcrumbs" data-highlight-ignore>
                    {item.breadcrumbs?.map((crumb, index) => (
                        <Fragment key={crumb}>
                            {index > 0 && <ChevronRight />}
                            <span>{crumb}</span>
                        </Fragment>
                    ))}
                </div>
            )}
            <div ref={highlight} className={`search-result-content search-result-${item.type}`}>
                {item.type === 'heading' && <Hash aria-hidden="true" />}
                {content}
            </div>
        </>
    );
}
