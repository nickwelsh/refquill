import { appName } from '@/lib/shared';
import { source } from '@/lib/source';
import { generateOGImage } from 'fumadocs-ui/og/takumi';
import type { ApiContext } from 'waku/router';

export async function GET(_: Request, { params }: ApiContext<'/og/docs/[...slugs]/image.webp'>) {
    const page = source.getPage(params.slugs);

    if (!page) {
        return new Response(undefined, { status: 404 });
    }

    return generateOGImage({
        title: page.data.title,
        description: page.data.description,
        site: appName,
        format: 'webp',
    });
}

export async function getConfig() {
    return { render: 'static', staticPaths: source.getPages().map((page) => page.slugs) } as const;
}
