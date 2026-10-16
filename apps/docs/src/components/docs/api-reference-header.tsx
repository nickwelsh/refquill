import { Fragment } from 'react';
import { ApiLink as Link } from './api-link';
import type { ApiReferenceHeaderProps } from '@nickwelsh/refquill-fumadocs/components';
import { ReferenceHeader } from './reference';

export function ApiReferenceHeader({
    reference,
    title,
    description,
    symbol,
    namespace,
    badges,
}: ApiReferenceHeaderProps) {
    const input = symbol?.api ?? namespace?.inputName;
    const group = symbol?.group ?? namespace?.name ?? '';
    const segments = group.split(/::|[\\/]/u).filter(Boolean);
    const language = symbol?.language ?? reference.document.symbols.find((item) => item.api === input)?.language;
    const php = language === 'php' && segments.length > 0;
    const separator = language === 'rust' ? '::' : '/';
    const rootUrl = input === undefined ? undefined : reference.getNamespaceUrl(input);
    const breadcrumbs =
        input === undefined
            ? []
            : segments
                  .map((segment, index) => ({
                      label: segment,
                      url: reference.getNamespaceUrl(
                          input,
                          segments.slice(0, index + 1).join(language === 'php' ? '\\' : separator),
                      ),
                  }))
                  .filter((item) => item.url !== rootUrl);
    return (
        <ReferenceHeader title={title} description={description} badges={badges}>
            {input !== undefined && (
                <nav className="api-namespace" aria-label="Namespace breadcrumbs">
                    {php && <span className="api-namespace-keyword">namespace </span>}
                    {!php && <Link href={reference.getNamespaceUrl(input)}>{input}</Link>}
                    {breadcrumbs.map((item, index) => (
                        <Fragment key={item.url}>
                            {(index > 0 || !php) && <span aria-hidden="true">{php ? '\\' : ` ${separator} `}</span>}
                            <Link href={item.url}>{item.label}</Link>
                        </Fragment>
                    ))}
                    {php && <span aria-hidden="true">;</span>}
                </nav>
            )}
        </ReferenceHeader>
    );
}
