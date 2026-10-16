import { createJsonSchemaReference, createReference } from '@nickwelsh/refquill-fumadocs';
import type { ReferencePageData, JsonSchemaReference, DocumentReference } from '@nickwelsh/refquill-fumadocs';
import type { StaticSource, MetaData } from 'fumadocs-core/source';
import configSchema from '@nickwelsh/refquill-schema/config.json' with { type: 'json' };
import documentSchema from '@nickwelsh/refquill-schema/document.json' with { type: 'json' };
import referenceSchema from '@nickwelsh/refquill-schema/reference.json' with { type: 'json' };
// oxlint-disable-next-line import/no-relative-parent-imports -- The resolved model schema ships without a public package export.
import resolvedSchema from '../../../../packages/schema/resolved.schema.json' with { type: 'json' };
import { getGitHubSourceUrl } from './shared.ts';

const schemas = [
    {
        name: 'config',
        title: 'Configuration schema',
        description: 'The refquill.json configuration read by the CLI.',
        schema: configSchema,
    },
    {
        name: 'document',
        title: 'Document schema',
        description: 'The compact schema-v1 JSON document written by refquill generate.',
        schema: documentSchema,
    },
    {
        name: 'resolved',
        title: 'Resolved document schema',
        description: 'The complete document returned by resolveDocument after expanding tables and defaults.',
        schema: resolvedSchema,
    },
    {
        name: 'reference',
        title: 'Reference document schema',
        description: 'The shared schema-v1 presentation contract for API references, JSON Schema docs, and manpages.',
        schema: referenceSchema,
    },
];

export function createJsonSchemaSource(versions: Array<string>) {
    const files: StaticSource<{
        pageData: ReferencePageData & { reference: JsonSchemaReference; rendering: DocumentReference };
        metaData: MetaData;
    }>['files'] = [];

    for (const version of versions) {
        for (const { name, title, description, schema } of schemas) {
            const prefix = `${version}/schemas/${name}`;
            const reference = createJsonSchemaReference({
                schema,
                title,
                baseUrl: `/docs/${prefix}`,
                sourceUrl: getGitHubSourceUrl(`packages/schema/${name}.schema.json`),
            });
            const document = reference.toReferenceDocument();
            const [schemaPage] = document.children;
            if (schemaPage === undefined) {
                throw new Error(`Missing schema page: ${name}`);
            }
            schemaPage.description = [description, schemaPage.description].filter(Boolean).join('\n\n');
            const rendering = createReference({ input: document, baseUrl: reference.baseUrl });
            for (const file of rendering.toFumadocsSource().files) {
                if (file.type === 'page') {
                    files.push({
                        ...file,
                        path: `${prefix}.mdx`,
                        slugs: prefix.split('/'),
                        data: { ...file.data, description, reference, rendering },
                    });
                }
            }
        }
    }

    return { files };
}
