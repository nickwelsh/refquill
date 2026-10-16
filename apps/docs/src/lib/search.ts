import type { StructuredData } from 'fumadocs-core/mdx-plugins/remark-structure';
import type { TOCItemType } from 'fumadocs-core/toc';

export interface SearchSection {
    id: string;
    name: string;
    pages: Array<string>;
}

/** Keep full text at its owning top-level section instead of indexing every nested row separately. */
export function sectionSearchData(data: StructuredData, toc: Array<TOCItemType>): StructuredData {
    const owners = new Map<string, string>();
    let section: string | undefined = undefined;
    for (const item of toc) {
        const id = decodeURIComponent(item.url.slice(1));
        if (item.depth <= 2) {
            section = id;
        }
        owners.set(id, section ?? id);
    }
    const groups = new Map<string | undefined, Set<string>>();
    function add(content: string, heading?: string) {
        const owner = heading === undefined ? undefined : (owners.get(heading) ?? heading);
        const values = groups.get(owner) ?? new Set<string>();
        values.add(content);
        groups.set(owner, values);
    }
    for (const heading of data.headings) {
        add(heading.content, heading.id);
    }
    for (const content of data.contents) {
        add(content.content, content.heading);
    }
    return {
        headings: [],
        contents: [...groups].map(([heading, values]) => ({ heading, content: [...values].join('\n') })),
    };
}

/** Bound long search rows around the first phrase or token match. Short rows retain their rich rendering. */
export function searchExcerpt(content: string, query: string): string | undefined {
    if (content.length <= 240) {
        return undefined;
    }
    const text = content.toLowerCase();
    const phrase = query.trim().toLowerCase();
    let match = phrase ? text.indexOf(phrase) : -1;
    if (match === -1 && phrase) {
        const positions = phrase
            .split(/\s+/u)
            .map((token) => text.indexOf(token))
            .filter((index) => index >= 0);
        match = positions.length > 0 ? Math.min(...positions) : -1;
    }
    const start = Math.max(0, match - 80);
    const end = Math.min(content.length, start + 238);
    return `${start > 0 ? '…' : ''}${content.slice(start, end).trim()}${end < content.length ? '…' : ''}`;
}
