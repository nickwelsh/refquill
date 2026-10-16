// oxlint-disable-next-line import/no-nodejs-modules -- The server loader reads the CLI package's shipped manpage.
import { readFileSync } from 'node:fs';
import { createManPageReference } from '@nickwelsh/refquill-fumadocs';
import type { ManPagePageData, ManPageReference } from '@nickwelsh/refquill-fumadocs';
import type { StaticSource, MetaData } from 'fumadocs-core/source';
import { getGitHubSourceUrl } from './shared.ts';

const input = readFileSync(new URL(import.meta.resolve('@nickwelsh/refquill/manpage')), 'utf8');

export function createManPageSource(versions: Array<string>) {
    const files: StaticSource<{
        pageData: ManPagePageData & { reference: ManPageReference; icon: string };
        metaData: MetaData;
    }>['files'] = [];

    for (const version of versions) {
        const prefix = `${version}/manpage`;
        const reference = createManPageReference({
            input,
            title: 'refquill(1)',
            baseUrl: `/docs/${prefix}`,
            sourceUrl: getGitHubSourceUrl('packages/cli/man/refquill.1'),
        });
        for (const file of reference.toFumadocsSource().files) {
            if (file.type === 'page') {
                files.push({
                    ...file,
                    path: `${prefix}.mdx`,
                    slugs: prefix.split('/'),
                    data: { ...file.data, title: 'CLI manual', icon: 'terminal', reference },
                });
            }
        }
    }

    return { files };
}
