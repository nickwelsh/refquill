import type { ReactNode } from 'react';
import { getDocsVersions } from '@/lib/source';
import { DocsShell } from '@/components/docs/shell';

export default function Layout({ children }: { children: ReactNode }) {
    return <DocsShell versions={getDocsVersions()}>{children}</DocsShell>;
}
