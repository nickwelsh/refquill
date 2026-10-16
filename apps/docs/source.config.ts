import { defineConfig } from 'fumadocs-mdx/config';
import { transformerTwoslash } from 'fumadocs-twoslash';
import { rehypeCodeDefaultOptions } from 'fumadocs-core/mdx-plugins';
import { transformerFileIcons } from './tooling/code-file-icons';

export default defineConfig({
    mdxOptions: {
        remarkCodeTabOptions: {
            parseMdx: true,
        },
        rehypeCodeOptions: {
            icon: false,
            themes: {
                light: 'github-light',
                dark: 'github-dark',
            },
            transformers: [
                ...(rehypeCodeDefaultOptions.transformers ?? []),
                transformerTwoslash(),
                transformerFileIcons(),
            ],
            langs: ['js', 'jsx', 'ts', 'tsx', 'php', 'rust'],
        },
    },
});
