import { createFromSource } from 'fumadocs-core/search/server';
import { source, getDocsVersions } from '@/lib/source';
import { sectionSearchData } from '@/lib/search';

const versions = getDocsVersions();
export const { staticGET: GET } = createFromSource(source, {
    sort: { enabled: false },
    buildIndex: (page) => {
        const version = versions.find((item) => item.pages.includes(page.url));
        const section = version?.searchSections.find((item) => item.pages.includes(page.url));
        return {
            id: page.url,
            title: page.data.title,
            ...(page.data.description === undefined ? {} : { description: page.data.description }),
            url: page.url,
            structuredData: sectionSearchData(page.data.structuredData, page.data.toc),
            tag: [version?.url, section?.id].filter((tag): tag is string => tag !== undefined),
        };
    },
});

export async function getConfig() {
    return { render: 'static' } as const;
}
