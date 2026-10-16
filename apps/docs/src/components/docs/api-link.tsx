'use client';

import { createContext, useContext, useMemo } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { PreviewCard } from '@base-ui/react/preview-card';
import { Link } from 'fumadocs-core/link';
import { useRouter } from 'waku/router/client';
import { Badge } from '@/components/ui/badge';
import { publicPath } from '@/lib/shared';

export interface ApiLinkPreview {
    title: string;
    kind: string;
    qualifiedName: string;
    description: ReactNode;
    declaration: ReactNode;
}

const ApiLinkContext = createContext<{
    previews: Record<string, ApiLinkPreview>;
    path: string;
} | null>(null);

export function ApiLinkProvider({
    previews,
    children,
}: {
    previews: Record<string, ApiLinkPreview>;
    children: ReactNode;
}) {
    const { path } = useRouter();
    const value = useMemo(() => ({ previews, path }), [previews, path]);
    return <ApiLinkContext value={value}>{children}</ApiLinkContext>;
}

export function ApiLink({ href, children, ...props }: ComponentProps<'a'>) {
    const context = useContext(ApiLinkContext);
    if (href === undefined) {
        return <a {...props}>{children}</a>;
    }
    if (href.startsWith('#') || (context !== null && href.startsWith(`${context.path}#`))) {
        return (
            <a {...props} href={href.startsWith('/') ? publicPath(href) : href}>
                {children}
            </a>
        );
    }
    const key = href.startsWith('#') ? `${context?.path ?? ''}${href}` : href;
    const preview = context !== null && Object.hasOwn(context.previews, key) ? context.previews[key] : undefined;
    if (preview === undefined) {
        return (
            <Link {...props} href={href}>
                {children}
            </Link>
        );
    }
    return (
        <PreviewCard.Root>
            <PreviewCard.Trigger
                delay={200}
                closeDelay={100}
                data-api-preview=""
                render={
                    <Link {...props} href={href} title={undefined}>
                        {children}
                    </Link>
                }
            />
            <PreviewCard.Portal>
                <PreviewCard.Positioner
                    side="bottom"
                    align="start"
                    sideOffset={8}
                    className="fd-twoslash-popover-positioner"
                >
                    <PreviewCard.Popup
                        className="fd-twoslash-popover api-link-preview"
                        aria-label={`${preview.title} API documentation`}
                    >
                        <div className="api-link-preview-title">
                            <Badge intent="secondary">{preview.kind.replaceAll('-', ' ')}</Badge>
                            <strong>{preview.title}</strong>
                        </div>
                        <p className="api-link-preview-name">{preview.qualifiedName}</p>
                        {preview.declaration}
                        <div className="api-link-preview-description">{preview.description}</div>
                    </PreviewCard.Popup>
                </PreviewCard.Positioner>
            </PreviewCard.Portal>
        </PreviewCard.Root>
    );
}
