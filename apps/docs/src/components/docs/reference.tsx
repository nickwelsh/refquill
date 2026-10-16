import { ReferencePage } from '@nickwelsh/refquill-fumadocs/components';
import type { ReferenceHeaderProps, ReferenceRenderOptions } from '@nickwelsh/refquill-fumadocs/components';
import { referenceHighlightTransformer, referenceLinkTransformer } from '@nickwelsh/refquill-fumadocs';
import type { DocumentReference } from '@nickwelsh/refquill-fumadocs';
import type { ComponentProps, ReactNode } from 'react';
import { CodeBlock } from './code-block';
import { HighlightedCode } from './highlighted-code';
import { Badge } from '@/components/ui/badge';
import type { BadgeProps } from '@/components/ui/badge';
import { ApiReferenceDescription } from './api-reference-description';
import { ApiSourceLink } from './api-source-link';
import { ApiLink } from './api-link';
import { apiReferenceIcons } from '@/lib/api-reference-icons';

const icons = {
    ...apiReferenceIcons,
    schema: apiReferenceIcons.property,
    'json-schema': apiReferenceIcons['type-alias'],
};

function DefinitionCode(props: ComponentProps<typeof CodeBlock>) {
    return <CodeBlock {...props} title="Definition" allowCopy={props.allowCopy ?? false} />;
}

function SchemaDefinitionCode(props: ComponentProps<typeof CodeBlock>) {
    return <DefinitionCode {...props} allowCopy copyMode="json-schema" />;
}

export function ApiBadge({ label, category }: { label: string; category: string }) {
    let intent: BadgeProps['intent'] = 'secondary';
    if (category === 'kind') {
        intent = label === 'exception' ? 'danger' : 'primary';
    } else if (category === 'deprecated' || label === 'protected') {
        intent = 'warning';
    } else if (label === 'public') {
        intent = 'success';
    } else if (label === 'private') {
        intent = 'danger';
    }
    return (
        <Badge data-slot="badge" intent={intent} isCircle={false}>
            {label}
        </Badge>
    );
}

export function ReferenceHeader({
    title,
    description,
    badges,
    children,
}: Pick<ReferenceHeaderProps, 'title' | 'description' | 'badges'> & { children?: ReactNode }) {
    return (
        <header className="refquill-header api-reference-header">
            <div className="api-reference-header-content">
                {children}
                {badges}
                <h1>{title}</h1>
                {description !== null && <ApiReferenceDescription>{description}</ApiReferenceDescription>}
            </div>
        </header>
    );
}

export function ReferenceFooter({ sourceUrl }: { sourceUrl: string | null | undefined }) {
    return sourceUrl !== null && sourceUrl !== undefined ? (
        <div className="api-reference-footer">
            <ApiSourceLink href={sourceUrl} />
        </div>
    ) : null;
}

export function ReferenceContent({
    rendering,
    nodeId,
    renderHeader,
    renderLink,
}: {
    rendering: DocumentReference;
    nodeId: string;
    renderHeader?: ReferenceRenderOptions['renderHeader'];
    renderLink?: ReferenceRenderOptions['renderLink'];
}) {
    const page = rendering.getNode(nodeId);
    return (
        <ReferencePage
            page={page}
            document={rendering.document}
            icons={icons}
            renderHeader={renderHeader ?? ((props) => <ReferenceHeader {...props} />)}
            renderLink={renderLink ?? ((props) => <ApiLink {...props} />)}
            renderBadge={(badge) => <ApiBadge {...badge} />}
            renderCode={(code, language, { definition, highlights }) => (
                <div data-reference-definition={definition.id}>
                    <HighlightedCode
                        code={code}
                        language={language}
                        transformers={[
                            referenceLinkTransformer(code, definition.links),
                            referenceHighlightTransformer(definition.id, highlights),
                        ]}
                        components={{ pre: language === 'json' ? SchemaDefinitionCode : DefinitionCode, a: ApiLink }}
                    />
                </div>
            )}
        />
    );
}
