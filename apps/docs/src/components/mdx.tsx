import type { MDXComponents } from 'mdx/types';
import type { ComponentProps, ReactNode } from 'react';
import { ApiLink as Link } from './docs/api-link';
import { Icon } from './icon';
import { CodeBlock } from './docs/code-block';
import { CodeBlockTabs, CodeBlockTabsList, CodeBlockTabsTrigger, CodeBlockTab } from './docs/code-tabs';
import { Note } from './ui/note';
import ChevronRight from '~icons/carbon/chevron-right';
// oxlint-disable-next-line import/no-namespace
import * as Twoslash from './docs/twoslash';

function Heading({
    as: Tag,
    children,
    className,
    ...props
}: ComponentProps<'h2'> & { as: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' }) {
    return (
        <Tag {...props} className={`docs-heading not-typeset ${className ?? ''}`}>
            {props.id === undefined ? (
                children
            ) : (
                <a className="heading-anchor" href={`#${props.id}`}>
                    {children}
                    <span aria-hidden="true">#</span>
                </a>
            )}
        </Tag>
    );
}
export function Card({
    title,
    href,
    children,
    icon,
}: {
    title: string;
    href: string;
    children?: ReactNode;
    icon?: ReactNode;
}) {
    return (
        <Link className="docs-card not-typeset" href={href}>
            {icon}
            <div>
                <strong>{title}</strong>
                {Boolean(children) && <div>{children}</div>}
            </div>
            <ChevronRight />
        </Link>
    );
}

export function getMDXComponents(components?: MDXComponents) {
    return {
        Icon,
        a: Link,
        CodeBlockTabs,
        CodeBlockTabsList,
        CodeBlockTabsTrigger,
        CodeBlockTab,
        pre: CodeBlock,
        h1: (props) => <Heading as="h1" {...props} />,
        h2: (props) => <Heading as="h2" {...props} />,
        h3: (props) => <Heading as="h3" {...props} />,
        h4: (props) => <Heading as="h4" {...props} />,
        h5: (props) => <Heading as="h5" {...props} />,
        h6: (props) => <Heading as="h6" {...props} />,
        Cards: ({ children }: { children: ReactNode }) => <div className="docs-cards">{children}</div>,
        Card,
        Note: (props: ComponentProps<typeof Note>) => (
            <Note {...props} className={`not-typeset my-6 ${props.className ?? ''}`} />
        ),
        table: (props) => (
            <div className="docs-table">
                <table {...props} />
            </div>
        ),
        ...components,
        ...Twoslash,
    } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;
declare global {
    type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
