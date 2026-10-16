'use client';
import { useRef } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { CopyButton } from './copy-button';
import { SchemaCopyActions } from './schema-copy-actions';

export function CodeBlock({
    children,
    title,
    'data-file-icon': fileIcon,
    'data-file-icon-light': fileIconLight,
    allowCopy = true,
    copyMode = 'code',
    className,
    ...props
}: Omit<ComponentProps<'pre'>, 'title'> & {
    title?: ReactNode;
    'data-file-icon'?: string;
    'data-file-icon-light'?: string;
    allowCopy?: boolean | 'true' | 'false';
    copyMode?: 'code' | 'json-schema';
}) {
    const ref = useRef<HTMLPreElement>(null);
    const copying = allowCopy !== false && allowCopy !== 'false';
    const getText = () => ref.current?.textContent ?? '';
    return (
        <figure className="docs-code-block not-typeset">
            {Boolean(title) && (
                <figcaption>
                    {fileIcon !== undefined && (
                        <span className="code-file-icon" aria-hidden="true">
                            <img
                                src={fileIcon}
                                alt=""
                                width={16}
                                height={16}
                                className={fileIconLight === undefined ? undefined : 'code-file-icon-dark'}
                            />
                            {fileIconLight !== undefined && (
                                <img
                                    src={fileIconLight}
                                    alt=""
                                    width={16}
                                    height={16}
                                    className="code-file-icon-light"
                                />
                            )}
                        </span>
                    )}
                    <span>{title}</span>
                    {copying && copyMode === 'json-schema' && <SchemaCopyActions getText={getText} />}
                </figcaption>
            )}
            <div className="docs-code-inner">
                <pre {...props} ref={ref} className={className}>
                    {children}
                </pre>
                {copying && copyMode === 'code' && (
                    <CopyButton label="Copy code" className="code-copy" getText={getText} />
                )}
            </div>
        </figure>
    );
}
