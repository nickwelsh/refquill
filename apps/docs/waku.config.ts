import { defineConfig } from 'waku/config';
import { fumadocsMdx } from 'fumadocs-mdx/vite';
import tailwindcss from '@tailwindcss/vite';
import icons from 'unplugin-icons/vite';
import { carbonIcons } from './tooling/carbon-icons';

export default defineConfig({
    basePath: '/refquill/',
    unstable_adapter: 'waku/adapters/cloudflare',
    vite: {
        resolve: {
            tsconfigPaths: true,
            dedupe: ['waku'],
        },

        plugins: [carbonIcons(), icons({ compiler: 'jsx', jsx: 'react' }), tailwindcss(), fumadocsMdx()],
    },
});
