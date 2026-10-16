import type {
    ApiReference as ApiReferenceModel,
    ApiReferencePageData,
    DocumentReference,
} from '@nickwelsh/refquill-fumadocs';
import { Link } from 'fumadocs-core/link';
import { ApiReferenceHeader } from './api-reference-header';
import { ReferenceContent, ReferenceFooter } from './reference';
import { ApiLink } from './api-link';

export function ApiReferenceFooter({
    reference,
    symbolId,
}: Pick<ApiReferencePageData, 'symbolId'> & { reference: ApiReferenceModel }) {
    if (symbolId === null) {
        return null;
    }
    const symbol = reference.getSymbol(symbolId);
    return <ReferenceFooter sourceUrl={symbol.source ? reference.getSourceUrl(symbol.source) : null} />;
}

export function ApiReferenceContent({
    reference,
    symbolId,
    inputName,
    namespace,
    rendering,
    nodeId,
}: Pick<ApiReferencePageData, 'symbolId' | 'inputName' | 'namespace'> & {
    reference: ApiReferenceModel;
    rendering: DocumentReference;
    nodeId: string;
}) {
    const symbol = symbolId === null ? null : reference.getSymbol(symbolId);
    const selectedNamespace = inputName === null ? null : reference.getNamespace(inputName, namespace ?? '');
    return (
        <ReferenceContent
            rendering={rendering}
            nodeId={nodeId}
            renderHeader={(props) => (
                <ApiReferenceHeader {...props} reference={reference} symbol={symbol} namespace={selectedNamespace} />
            )}
            renderLink={symbolId === null ? (props) => <Link {...props} /> : (props) => <ApiLink {...props} />}
        />
    );
}
