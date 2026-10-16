import { flattenTree } from 'fumadocs-core/page-tree';
import type { Folder } from 'fumadocs-core/page-tree';
import { llms, loader } from 'fumadocs-core/source';
import { createElement } from 'react';
import { Icon } from '@/components/icon';
import { absoluteUrl, docsRoute } from './shared';
import { defineDocs } from 'fumadocs-mdx/macro';
import { pageSchema } from 'fumadocs-core/source/schema';
import { docsMetaSchema } from './docs-metadata';
import { getDocsSections } from './docs-navigation';
import { createApiSource } from './api-reference';
import { createJsonSchemaSource } from './json-schema-reference';
import { createManPageSource } from './manpage-reference';
import apiDocument from '@/generated/api.json';
import Api from '~icons/carbon/api';
import { apiReferenceIcon } from '@nickwelsh/refquill-fumadocs/components';
import { apiReferenceIcons } from './api-reference-icons';

const docs = defineDocs({
    dir: 'content/docs',
    docs: {
        schema: pageSchema,
        postprocess: {
            includeProcessedMarkdown: true,
        },
    },
    meta: {
        schema: docsMetaSchema,
    },
});

const authoredSource = docs.toFumadocsSource();
const versionPaths = ['0.x'];

export const source = loader({
    source: {
        docs: authoredSource,
        api: createApiSource(apiDocument, versionPaths),
        schemas: createJsonSchemaSource(versionPaths),
        manpage: createManPageSource(versionPaths),
    },
    baseUrl: docsRoute,
    icon: (name) => {
        if (name === 'api') {
            return createElement(Api);
        }
        if (name?.startsWith('refquill-') === true) {
            return apiReferenceIcon(name, apiReferenceIcons);
        }
        return name === undefined ? undefined : createElement(Icon, { name });
    },
});

export const docsLlms = llms(source, {
    renderPage: async (page) => {
        const heading = `# ${page.data.title} (${absoluteUrl(page.url)})`;
        if (page.type === 'docs') {
            return `${heading}\n\n${await page.data.getText('processed')}`;
        }
        if (page.type === 'api' || page.type === 'schemas') {
            return `${heading}\n\n${page.data.rendering.getPageText(page.data.nodeId)}`;
        }
        return `${heading}\n\n${page.data.description}\n\n${page.data.reference.getPageText()}`;
    },
});

export function getDocsVersions() {
    const tree = source.getPageTree();
    const roots = tree.children.filter((node): node is Folder => node.type === 'folder' && node.root === 'version');
    const versions =
        roots.length > 0
            ? roots.map((node) => {
                  const pages = flattenTree([node]).map((page) => page.url);
                  const url = node.index?.url ?? pages[0] ?? '/docs';
                  const meta = source.getNodeMeta(node);
                  const metadata = meta?.type === 'docs' ? meta.data.version : undefined;
                  return {
                      name: typeof node.name === 'string' ? node.name : 'Version',
                      url,
                      pages,
                      tree: { name: node.name, children: node.children },
                      status: metadata?.status ?? 'stable',
                      badges: metadata?.badges ?? [],
                  };
              })
            : [
                  {
                      name: 'Latest',
                      url: '/docs',
                      tree,
                      pages: source.getPages().map((page) => page.url),
                      status: 'latest' as const,
                      badges: [],
                  },
              ];
    return versions.map((version) => {
        const { tree: versionTree, ...metadata } = version;
        const sections = getDocsSections(versionTree, version.url);
        return Object.assign(metadata, {
            sections,
            searchSections: sections.map(({ id, name, pages }) => ({ id, name, pages })),
        });
    });
}
