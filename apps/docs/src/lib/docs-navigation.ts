import { flattenTree } from 'fumadocs-core/page-tree';
import type { Folder, Root } from 'fumadocs-core/page-tree';
import type { ReactNode } from 'react';
import type { SearchSection } from './search';

export interface DocsSection extends SearchSection {
    url: string;
    description?: ReactNode;
    icon?: ReactNode;
    tree: Root;
}

export interface DocsVersion {
    name: string;
    status: 'latest' | 'stable' | 'deprecated';
    badges: Array<string>;
    url: string;
    pages: Array<string>;
    sections: Array<DocsSection>;
    searchSections: Array<SearchSection>;
}

export function getDocsSections(tree: Root, versionUrl: string): Array<DocsSection> {
    const folders = tree.children.filter(
        (node): node is Folder => node.type === 'folder' && (node.root === true || node.root === 'section'),
    );
    const documentation: Root = {
        name: 'Documentation',
        children: tree.children.filter((node) => !folders.some((folder) => folder === node)),
    };
    const sections: Array<DocsSection> = [
        {
            id: `${versionUrl}:${versionUrl}`,
            name: 'Documentation',
            description: 'Installation, generation, and integration',
            url: versionUrl,
            icon: flattenTree(documentation.children)[0]?.icon,
            pages: flattenTree(documentation.children).map((page) => page.url),
            tree: documentation,
        },
    ];
    for (const folder of folders) {
        const children = [...folder.children];
        if (folder.index && !children.some((node) => node.type === 'page' && node.url === folder.index?.url)) {
            children.unshift(folder.index);
        }
        const pages = flattenTree(children).map((page) => page.url);
        const url = folder.index?.url ?? pages[0];
        if (url !== undefined) {
            sections.push({
                id: `${versionUrl}:${url}`,
                name: typeof folder.name === 'string' ? folder.name : 'Section',
                description: folder.description,
                icon: folder.icon,
                url,
                pages,
                tree: { name: folder.name, children },
            });
        }
    }
    return sections.filter((section) => section.pages.length > 0);
}

export function getDocsPageUrl(version: DocsVersion, path: string) {
    if (version.pages.includes(path)) {
        return path;
    }
    const candidate = version.url + (path.startsWith('/docs/') ? path.slice('/docs'.length) : '');
    return version.pages.includes(candidate) ? candidate : version.url;
}

export function getVersionPageUrl(current: DocsVersion, target: DocsVersion, pageUrl: string) {
    const candidate = target.url + pageUrl.slice(current.url.length);
    return target.pages.includes(candidate) ? candidate : target.url;
}
