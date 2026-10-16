'use client';

import { Link } from '@/components/ui/link';
import ArrowUpRight from '~icons/carbon/arrow-up-right';

export function ApiSourceLink({ href }: { href: string }) {
    return (
        <Link href={href} target="_blank" rel="noreferrer" className="api-source-link">
            View source
            <ArrowUpRight />
        </Link>
    );
}
