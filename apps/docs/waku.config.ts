import { defineConfig } from '@nickwelsh/docs-base';

export default defineConfig({
    name: 'Refquill',
    origin: 'https://docs.nickwelsh.me',
    githubUrl: 'https://github.com/nickwelsh/refquill',
    githubBranch: process.env.VITE_DOCS_REF || 'main',
    basePath: '/refquill',
    content: './content/docs',
    githubContentPath: 'apps/docs/content/docs',
    refquill: [
        {
            input: './generated/api.json',
            baseUrl: '/docs/0.x/api',
            title: 'API reference',
        },
        ...['config', 'document', 'resolved', 'reference'].map((name) => ({
            input: `./generated/${name}.reference.json`,
            baseUrl: `/docs/0.x/schemas/${name}`,
            format: 'reference' as const,
        })),
        {
            input: './generated/manpage.reference.json',
            baseUrl: '/docs/0.x/manpage',
            format: 'reference',
        },
    ],
});
