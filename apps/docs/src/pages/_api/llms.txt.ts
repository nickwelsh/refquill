import { docsLlms } from '@/lib/source';
import { publicMarkdownLinks } from '@/lib/shared';

export async function GET() {
    return new Response(publicMarkdownLinks(docsLlms.index()), {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
}

export async function getConfig() {
    return {
        render: 'static' as const,
    } as const;
}
