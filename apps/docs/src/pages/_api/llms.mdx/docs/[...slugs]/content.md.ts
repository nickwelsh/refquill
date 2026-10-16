import { docsLlms, source } from '@/lib/source';
import type { ApiContext } from 'waku/router';
import { publicMarkdownLinks } from '@/lib/shared';

export async function GET(_: Request, { params }: ApiContext<'/llms.mdx/docs/[...slugs]/content.md'>) {
    const { slugs } = params;
    const page = source.getPage(slugs);
    if (!page) {
        return new Response('Page not found', { status: 404 });
    }

    return new Response(publicMarkdownLinks(await docsLlms.page(page)), {
        headers: {
            'Content-Type': 'text/markdown',
        },
    });
}

export async function getConfig() {
    return { render: 'static', staticPaths: source.getPages().map((page) => page.slugs) } as const;
}
