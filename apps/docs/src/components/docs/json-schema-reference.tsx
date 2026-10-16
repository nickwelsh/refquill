import type { DocumentReference } from '@nickwelsh/refquill-fumadocs';
import { ReferenceContent, ReferenceFooter } from './reference';

export function JsonSchemaReferenceContent({ rendering, nodeId }: { rendering: DocumentReference; nodeId: string }) {
    return (
        <>
            <ReferenceContent rendering={rendering} nodeId={nodeId} />
            <ReferenceFooter sourceUrl={rendering.getNode(nodeId).sourceUrl} />
        </>
    );
}
