import React, { type ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { safeUrl, type CodeLink } from './code.js';
export { highlighter } from './code-highlighter.js';

export type LinkRenderer = (props: React.ComponentProps<'a'>) => ReactNode;
export interface ReferenceBadge {
  label: string;
  category: 'kind' | 'modifier' | 'deprecated';
}
export type BadgeRenderer = (badge: ReferenceBadge) => ReactNode;

export const markdown = (value: string, renderLink?: LinkRenderer, links: readonly Pick<CodeLink, 'name' | 'url'>[] = []) => {
  if (!value) return null;
  const definitions = links.filter(link => !/[\[\]\r\n]/.test(link.name)).map(link => `[${link.name}]: ${link.url}`).join('\n');
  return <div className="refquill-prose"><Markdown components={renderLink ? { a: ({ node, ...props }) => <ReferenceLink {...props} renderLink={renderLink} /> } : undefined} remarkPlugins={[remarkGfm]} skipHtml urlTransform={url => {
    const target = links.find(link => link.name === url)?.url ?? url;
    return safeUrl(target) ? target : '';
  }}>{definitions ? `${value}\n\n${definitions}` : value}</Markdown></div>;
};

export function ReferenceLink({ renderLink, ...props }: React.ComponentProps<'a'> & { renderLink?: LinkRenderer }) {
  return renderLink?.(props) ?? <a {...props} />;
}

export function Badge({ badge, renderBadge }: { badge: ReferenceBadge; renderBadge?: BadgeRenderer }) {
  return renderBadge?.(badge) ?? <span data-kind={badge.category === 'kind' ? badge.label : undefined} data-deprecated={badge.category === 'deprecated' || undefined}>{badge.label}</span>;
}
