import DocsPage from '@/pages/docs/[...slugs]';

export default function DocsIndex() {
    return <DocsPage slugs={[]} path="/docs/" query="" />;
}

export async function getConfig() {
    return { render: 'static' } as const;
}
