import { createGetUrl } from 'fumadocs-core/source';
import type { Page } from 'fumadocs-core/source';

export const appName = 'Refquill';
// node:test imports these helpers without Vite's injected environment.
const buildEnvironment = import.meta.env as ImportMetaEnv | undefined;
export const docsRef = buildEnvironment?.VITE_DOCS_REF ?? 'main';
// Router links stay app-relative: Waku adds basePath itself. Fetches and metadata use public URLs.
export const siteBasePath = '/refquill';
export const siteOrigin = 'https://docs.nickwelsh.me';

export function publicPath(path: string) {
    if (
        !path.startsWith('/') ||
        path.startsWith('//') ||
        path === siteBasePath ||
        path.startsWith(`${siteBasePath}/`) ||
        path.startsWith(`${siteBasePath}?`) ||
        path.startsWith(`${siteBasePath}#`)
    ) {
        return path;
    }
    return `${siteBasePath}${path}`;
}

export function absoluteUrl(path: string) {
    return `${siteOrigin}${publicPath(path)}`;
}

export function publicMarkdownLinks(markdown: string) {
    return markdown.replaceAll('](/docs', `](${absoluteUrl('/docs')}`);
}
export const docsRoute = '/docs';
export const docsImageRoute = '/og/docs';
export const docsContentRoute = '/llms.mdx/docs';

export const gitConfig = {
    user: 'nickwelsh',
    repo: 'refquill',
    branch: docsRef,
};

export const githubUrl = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;

export function getGitHubSourceUrl(file: string, line?: number) {
    const path = file
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/');
    return `https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/${path}${line === undefined ? '' : `#L${line}`}`;
}

const getContentUrl = createGetUrl(docsContentRoute);

export function getPageMarkdownUrl(page: Pick<Page, 'slugs' | 'locale'>) {
    const segments = [...page.slugs, 'content.md'];

    return { segments, url: getContentUrl(segments, page.locale) };
}

const getImageUrl = createGetUrl(docsImageRoute);

export function getPageImageUrl(page: Pick<Page, 'slugs' | 'locale'>) {
    const segments = [...page.slugs, 'image.webp'];

    return { segments, url: getImageUrl(segments, page.locale) };
}
