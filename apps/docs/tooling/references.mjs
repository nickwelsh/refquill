import { createJsonSchemaReference, createManPageReference } from '@nickwelsh/refquill-fumadocs';

const schemas = [
    ['config', 'Configuration schema', 'The refquill.json configuration read by the CLI.'],
    ['document', 'Document schema', 'The compact schema-v1 JSON document written by refquill generate.'],
    [
        'resolved',
        'Resolved document schema',
        'The complete document returned by resolveDocument after expanding tables and defaults.',
    ],
    [
        'reference',
        'Reference document schema',
        'The shared schema-v1 presentation contract for API references, JSON Schema docs, and manpages.',
    ],
];

/** Project-specific inputs become portable data; docs-base owns their presentation. */
export function createDocsReferences({ schemaInputs, manpage, ref = 'main' }) {
    const sourceUrl = (file) => `https://github.com/nickwelsh/refquill/blob/${encodeURIComponent(ref)}/${file}`;
    const references = schemas.map(([name, title, description]) => {
        const document = createJsonSchemaReference({
            schema: schemaInputs[name],
            title,
            baseUrl: `/docs/0.x/schemas/${name}`,
            sourceUrl: sourceUrl(`packages/schema/${name}.schema.json`),
        }).toReferenceDocument();
        document.children[0].description = [description, document.children[0].description].filter(Boolean).join('\n\n');
        return [name, document];
    });
    references.push([
        'manpage',
        createManPageReference({
            input: manpage,
            title: 'CLI manual',
            baseUrl: '/docs/0.x/manpage',
            sourceUrl: sourceUrl('packages/cli/man/refquill.1'),
        }).toReferenceDocument(),
    ]);
    return new Map(references);
}
