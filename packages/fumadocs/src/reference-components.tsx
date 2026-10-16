import React, { Fragment, type ReactNode } from 'react';
import { jsx, jsxs } from 'react/jsx-runtime';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { Box, FolderCode, ChevronRight } from 'lucide-react';
import { CodeBlock, Pre } from 'fumadocs-ui/components/codeblock';
import type { ShikiTransformer } from 'shiki';
import type { ReferenceBadge as BadgeModel, ReferenceBlock, ReferenceDefinition as DefinitionModel, ReferenceDirectory as DirectoryModel, ReferenceDocument, ReferenceEntry as EntryModel, ReferenceLabel, ReferenceNode, ReferenceSection as SectionModel } from '@nickwelsh/refquill-schema';
import { highlighter } from './code-highlighter.js';
import { markdown, ReferenceLink } from './reference-ui.js';
import { referenceHighlightTransformer, referenceLinkTransformer, referenceMemberLines, type ReferenceHighlights } from './reference-code.js';
import { MemberHighlight } from './member-highlight.js';

export interface ReferenceHeaderProps { page: ReferenceNode; title: string; description: ReactNode; badges: ReactNode; sourceUrl: string | null }
type Icon = React.ComponentType<React.SVGProps<SVGSVGElement>>;
export interface ReferenceRenderOptions {
  document?: ReferenceDocument;
  renderHeader?: (props: ReferenceHeaderProps) => ReactNode;
  renderBadge?: (badge: BadgeModel & { category: string }) => ReactNode;
  renderLink?: (props: React.ComponentProps<'a'>) => ReactNode;
  renderCode?: (code: string, language: string, options: { definition: DefinitionModel; highlights: ReferenceHighlights; memberLines: Record<number, string> }) => ReactNode;
  icons?: Partial<Record<string, Icon>>;
  components?: {
    Header?: React.ComponentType<ReferenceHeaderProps>;
    Entry?: React.ComponentType<ReferenceEntryProps>;
    Section?: React.ComponentType<ReferenceSectionProps>;
    Definition?: React.ComponentType<ReferenceDefinitionProps>;
  };
}
interface ContextOptions extends ReferenceRenderOptions { highlights?: ReferenceHighlights; depth?: number; urls?: ReadonlyMap<string, string> }
export interface ReferenceEntryProps extends ContextOptions { entry: EntryModel }
export interface ReferenceSectionProps extends ContextOptions { section: SectionModel; children?: ReactNode }
export interface ReferenceDefinitionProps extends ContextOptions { definition: DefinitionModel }

function icon(key: string, options: ReferenceRenderOptions, fallback: Icon = ['directory', 'namespace', 'module'].includes(key) ? FolderCode : Box) {
  const Component = options.icons && Object.hasOwn(options.icons, key) ? options.icons[key] ?? fallback : fallback;
  return <Component className={key === 'chevron-right' ? 'refquill-disclosure-icon' : 'refquill-kind-icon'} aria-hidden="true" />;
}

export function ReferenceBadge({ badge, ...options }: { badge: BadgeModel } & ReferenceRenderOptions) {
  const category = badge.type ?? 'modifier';
  return <span className="refquill-badge-slot" data-reference-badge-visibility={badge.visibility ?? 'both'}>{options.renderBadge?.({ ...badge, category }) ?? <span data-kind={category === 'kind' ? badge.label : undefined} data-deprecated={category === 'deprecated' || undefined}>{badge.label}</span>}</span>;
}

function badges(values: BadgeModel[] | undefined, options: ReferenceRenderOptions) {
  return values?.length ? <div className="refquill-badges">{values.map((badge, index) => <ReferenceBadge key={index} badge={badge} {...options} />)}</div> : null;
}

function syntax(code: string, language: string, options: ContextOptions, transformers: ShikiTransformer[] = [], contextCode?: string) {
  const lang = highlighter.getLoadedLanguages().includes(language) ? language : 'text';
  return highlighter.codeToHast(code, { lang, themes: { light: 'github-light', dark: 'github-dark' }, defaultColor: false, transformers, grammarContextCode: contextCode });
}

function renderTree(tree: Parameters<typeof toJsxRuntime>[0], options: ReferenceRenderOptions) {
  return toJsxRuntime(tree, { Fragment, jsx, jsxs, components: { a: props => <ReferenceLink {...props} renderLink={options.renderLink} />, pre: ({ children, ...props }) => <Pre {...props}>{children}</Pre> } });
}

function label(value: ReferenceLabel, options: ContextOptions): ReactNode {
  if (typeof value === 'string') return value;
  const tree = syntax(value.code, value.language, options, [referenceLinkTransformer(value.code, value.links, options.urls)], value.contextCode);
  const pre = tree.children.find(node => node.type === 'element' && node.tagName === 'pre');
  const code = pre?.type === 'element' ? pre.children.find(node => node.type === 'element' && node.tagName === 'code') : undefined;
  return <code className="refquill-label-code shiki">{code?.type === 'element' ? renderTree({ type: 'root', children: code.children }, options) : value.code}</code>;
}

export function ReferenceDefinition({ definition, ...options }: ReferenceDefinitionProps) {
  const highlights = options.highlights ?? {};
  const custom = options.renderCode?.(definition.code, definition.language, { definition, highlights, memberLines: referenceMemberLines(definition.id, highlights) });
  if (custom != null) return custom;
  return <div data-reference-definition={definition.id}><CodeBlock title="Definition">{renderTree(syntax(definition.code, definition.language, options, [referenceLinkTransformer(definition.code, definition.links, options.urls), referenceHighlightTransformer(definition.id, highlights)]), options)}</CodeBlock></div>;
}

export function ReferenceBlocks({ blocks: values, ...options }: { blocks: ReferenceBlock[] } & ContextOptions): ReactNode {
  return values.map((block, index) => {
    if (block.kind === 'markdown') return <Fragment key={index}>{markdown(block.value, options.renderLink)}</Fragment>;
    if (block.kind === 'code') {
      const Component = options.components?.Definition ?? ReferenceDefinition;
      return <div id={block.definition.id} key={block.definition.id} className="refquill-block-definition"><Component definition={block.definition} {...options} /></div>;
    }
    if (block.kind === 'section') {
      const Component = options.components?.Section ?? ReferenceSection;
      return <Component key={block.id} section={block} {...options} />;
    }
    const Component = options.components?.Entry ?? ReferenceEntry;
    return <Component key={block.id} entry={block} {...options} />;
  });
}

export function ReferenceSection({ section, children, ...options }: ReferenceSectionProps) {
  const depth = options.depth ?? 2;
  const Heading = `h${Math.min(depth, 6)}` as 'h2';
  return <section id={section.anchor ?? section.id} className="refquill-detail"><Heading>{section.title}</Heading>{markdown(section.description ?? '', options.renderLink)}{children ?? <ReferenceBlocks blocks={section.blocks} {...options} depth={depth + 1} />}</section>;
}

export function ReferenceEntry({ entry, ...options }: ReferenceEntryProps) {
  // An entry destination owns its complete label. Suppress embedded code links
  // in that case so content cannot produce invalid nested anchors.
  const title = entry.url && typeof entry.title !== 'string' ? { ...entry.title, links: undefined } : entry.title;
  const summary = <>{entry.display === 'disclosure' && icon('chevron-right', options, ChevronRight)}{entry.type && icon(entry.type.key, options)}{entry.url ? <ReferenceLink renderLink={options.renderLink} href={entry.url}>{label(title, options)}</ReferenceLink> : label(title, options)}{entry.type && <span className="refquill-entry-type">{entry.type.label}</span>}{badges(entry.badges, options)}{entry.sourceUrl && <ReferenceLink renderLink={options.renderLink} className="refquill-source" href={entry.sourceUrl}>Source</ReferenceLink>}</>;
  const body = <>{markdown(entry.description ?? '', options.renderLink)}<ReferenceBlocks blocks={entry.blocks ?? []} {...options} depth={(options.depth ?? 2) + 1} /></>;
  const anchor = entry.anchor ?? entry.id;
  if (entry.display === 'static') return <div id={anchor} className="refquill-entry refquill-static-entry" data-reference-type={entry.type?.key} data-reference-row={entry.id} tabIndex={0}><div className="refquill-entry-label">{summary}</div>{body}</div>;
  return <details id={anchor} className="refquill-entry refquill-member" data-reference-type={entry.type?.key} data-reference-row={entry.id} open={entry.defaultOpen || undefined}><summary>{summary}</summary><div className="refquill-member-body">{body}</div></details>;
}

function targets(document: ReferenceDocument | undefined, page: ReferenceNode) {
  const urls = new Map<string, string>();
  const visit = (node: ReferenceNode) => {
    const url = node.id === page.id ? '' : node.url;
    if (url != null) urls.set(node.id, url || `#${encodeURIComponent(node.id)}`);
    if (node.definition && url != null) urls.set(node.definition.id, `${url}#${encodeURIComponent(node.definition.id)}`);
    const walk = (values: ReferenceBlock[]) => { for (const block of values) {
      if (block.kind === 'entry' || block.kind === 'section') {
        if (url != null) urls.set(block.id, `${url}#${encodeURIComponent(block.anchor ?? block.id)}`);
        walk(block.blocks ?? []);
      } else if (block.kind === 'code' && url != null) urls.set(block.definition.id, `${url}#${encodeURIComponent(block.definition.id)}`);
    } };
    walk(node.blocks);
    if (node.kind === 'directory') node.children.forEach(visit);
  };
  if (document) document.children.forEach(visit); else visit(page);
  return urls;
}

export function ReferenceDirectory({ directory, ...options }: { directory: DirectoryModel } & ReferenceRenderOptions) {
  return <ReferencePage page={directory} {...options} />;
}

export function ReferencePage({ page, ...options }: { page: ReferenceNode } & ReferenceRenderOptions) {
  const highlights: ReferenceHighlights = Object.create(null);
  const walk = (values: ReferenceBlock[], inherited: ReferenceHighlights[string] = []) => { for (const block of values) {
    if (block.kind === 'entry') {
      const own = block.highlights?.length ? block.highlights : inherited;
      if (own.length) highlights[block.id] = own;
      walk(block.blocks ?? [], own);
    } else if (block.kind === 'section') walk(block.blocks, inherited);
  } };
  walk(page.blocks);
  const context: ContextOptions = { ...options, highlights, urls: targets(options.document, page), depth: 2 };
  const kindBadge: BadgeModel[] = page.type ? [{ label: page.type.label, type: 'kind' }] : [];
  const headerProps: ReferenceHeaderProps = { page, title: page.title, description: markdown(page.description ?? '', options.renderLink), badges: badges([...kindBadge, ...(page.badges ?? [])], options), sourceUrl: page.sourceUrl ?? null };
  const Header = options.components?.Header;
  const customHeader = Header ? <Header {...headerProps} /> : options.renderHeader?.(headerProps);
  const header = customHeader ?? <header className="refquill-header">{headerProps.badges}<h1>{page.title}</h1>{headerProps.description}{page.sourceUrl && <ReferenceLink renderLink={options.renderLink} className="refquill-source" href={page.sourceUrl}>View source ↗</ReferenceLink>}</header>;
  const Definition = options.components?.Definition ?? ReferenceDefinition;
  const source = page.definition ? (options.components?.Definition ? <Definition definition={page.definition} {...context} /> : ReferenceDefinition({ definition: page.definition, ...context })) : null;
  const values: ReferenceBlock[] = page.kind === 'directory' && !page.blocks.length ? page.children.map(child => ({
    kind: 'entry', id: child.id, title: child.title, display: 'static',
    type: child.type ?? { key: child.kind, label: child.kind },
    url: child.url ?? context.urls?.get(child.id),
    description: child.description?.split(/\n\s*\n/)[0],
  })) : page.blocks;
  const content = <ReferenceBlocks blocks={values} {...context} />;
  // Only this tiny interaction boundary is a client component. Documents and
  // host callbacks remain server-side.
  return <MemberHighlight key={page.id} id={page.id}>{header}{page.definition ? <><span id={page.definition.id} /><div className="refquill-layout"><div className="refquill-docs"><div className="refquill-inline-definition"><details className="refquill-tags"><summary>{icon('chevron-right', options, ChevronRight)}Definition</summary>{source}</details></div>{content}</div><aside className="refquill-outline" aria-label="Definition"><div className="refquill-sticky"><div data-reference-viewport>{source}</div></div></aside></div></> : content}</MemberHighlight>;
}
