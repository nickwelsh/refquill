import { parseReferenceDocument, type ReferenceBlock, type ReferenceDocument, type ReferenceLabel, type ReferenceNode } from '@nickwelsh/refquill-schema';
import type { MetaData, StaticSource } from 'fumadocs-core/source';
import type { TOCItemType } from 'fumadocs-core/toc';
import { encodeSegment, referenceBaseUrl } from './paths.js';
import { markdownText } from './markdown-text.js';

export const referenceLabelText = (label: ReferenceLabel): string => typeof label === 'string' ? label : label.code;
const fence = (code: string, language: string, meta?: string) => {
  let length = 3;
  for (const match of code.matchAll(/`+/g)) length = Math.max(length, match[0].length + 1);
  const marker = '`'.repeat(length);
  return `${marker}${language.replace(/[\r\n`]/g, '')}${meta ? ` ${meta.replace(/[\r\n`]/g, '')}` : ''}\n${code}\n${marker}`;
};

/** A single traversal supplies exports, search, and headings, including bodies
 * hidden inside disclosures. Presentation state never filters this content. */
export function collectReferencePage(page: ReferenceNode, { codeMeta }: { codeMeta?: string } = {}) {
  const toc: TOCItemType[] = [];
  const headings: { id: string; content: string }[] = [];
  const contents: { heading: string | undefined; content: string }[] = [];
  const text = [`# ${page.title}`, page.type?.label ?? '', ...(page.badges ?? []).map(badge => badge.label), page.description ?? '', page.definition ? fence(page.definition.code, page.definition.language, codeMeta) : ''];
  const addText = (value: string, heading?: string, markdown = false) => { if (value) contents.push({ heading, content: markdown ? markdownText(value) : value }); };
  addText(page.title); addText(page.type?.label ?? ''); addText(page.description ?? '', undefined, true);
  for (const badge of page.badges ?? []) addText(badge.label);
  if (page.definition) addText(page.definition.code);
  const visit = (blocks: ReferenceBlock[], depth: number, parent?: string) => {
    for (const block of blocks) {
      if (block.kind === 'markdown') { text.push(block.value); addText(block.value, parent, true); }
      else if (block.kind === 'code') { text.push(fence(block.definition.code, block.definition.language, codeMeta)); addText(block.definition.code, parent); }
      else {
        const title = block.kind === 'entry' ? referenceLabelText(block.title) : block.title;
        const anchor = block.anchor ?? block.id;
        headings.push({ id: anchor, content: title });
        toc.push({ title, url: `#${encodeURIComponent(anchor)}`, depth: Math.min(depth, 6) });
        text.push(`${'#'.repeat(Math.min(depth, 6))} ${title} {#${anchor}}`, block.description ?? '');
        addText(title, anchor); addText(block.description ?? '', anchor, true);
        if (block.kind === 'entry') {
          addText(block.type?.label ?? '', anchor);
          if (block.type) text.push(block.type.label);
          for (const badge of block.badges ?? []) { addText(badge.label, anchor); text.push(badge.label); }
          if (block.url) text.push(`[${title}](${block.url})`);
        }
        visit(block.blocks ?? [], depth + 1, anchor);
      }
    }
  };
  visit(page.blocks, 2);
  if (page.kind === 'directory') for (const child of page.children) {
    if (!page.blocks.length) text.push(child.url ? `- [${child.title}](${child.url})` : `- ${child.title}`);
    addText(`${child.title} ${child.description ?? ''}`);
  }
  return { toc, structuredData: { headings, contents }, text: text.filter(Boolean).join('\n\n') };
}

export interface ReferencePageData {
  title: string;
  description: string;
  nodeId: string;
  icon?: string;
  toc: TOCItemType[];
  structuredData: ReturnType<typeof collectReferencePage>['structuredData'];
}

export interface DocumentReference {
  document: ReferenceDocument;
  baseUrl: string;
  getNode(id: string): ReferenceNode;
  getUrl(id: string): string;
  getPageText(id: string): string;
  toFumadocsSource(): Pick<StaticSource<{ pageData: ReferencePageData; metaData: MetaData }>, 'files'>;
}

export function createReference({ input, baseUrl = '/reference' }: { input: unknown; baseUrl?: string }): DocumentReference {
  const document = structuredClone(parseReferenceDocument(input));
  baseUrl = referenceBaseUrl(baseUrl);
  const rootUrl = baseUrl || '/';
  const nodes = new Map<string, ReferenceNode>();
  const urls = new Map<string, string>();
  const paths = new Map<string, string[]>();
  const claimed = new Set<string>();
  const explicitUrls = new Set<string>();
  const allIds = new Set<string>();
  let rootPage: ReferenceNode | undefined;
  const routeSegments = (url: string) => {
    if (url === rootUrl) return [];
    if (!url.startsWith(`${baseUrl}/`) || /[?#]/.test(url) || url.includes('//')) throw new Error(`Reference page URL must be beneath baseUrl: ${url}`);
    const segments = url.slice(baseUrl.length + 1).split('/');
    for (const segment of segments) {
      let decoded: string;
      try { decoded = decodeURIComponent(segment); } catch { throw new Error(`Invalid reference page URL: ${url}`); }
      if (!decoded || decoded === '.' || decoded === '..' || /[\\/\u0000-\u001f\u007f]/u.test(decoded)) throw new Error(`Invalid reference page URL segment: ${url}`);
    }
    return segments;
  };
  const routeKey = (url: string) => `${baseUrl}/${routeSegments(url).map(segment => decodeURIComponent(segment).toLowerCase()).join('/')}`;
  const reserveIds = (blocks: ReferenceBlock[]) => {
    for (const block of blocks) {
      if (block.kind === 'code') allIds.add(block.definition.id);
      if (block.kind === 'entry' || block.kind === 'section') { allIds.add(block.id); reserveIds(block.blocks ?? []); }
    }
  };
  const reserve = (children: ReferenceNode[]) => {
    for (const node of children) {
      allIds.add(node.id);
      if (node.definition) allIds.add(node.definition.id);
      reserveIds(node.blocks);
      if (node.url) {
        routeSegments(node.url);
        const key = routeKey(node.url);
        if (explicitUrls.has(key)) throw new Error(`Duplicate reference page URL: ${node.url}`);
        explicitUrls.add(key);
        if (node.url === rootUrl) {
          if (document.children.length !== 1 || document.children[0] !== node) throw new Error('Only a sole top-level reference node can use baseUrl');
          rootPage = node;
        }
      }
      if (node.kind === 'directory') reserve(node.children);
    }
  };
  reserve(document.children);
  claimed.add(routeKey(rootUrl));
  const recordBlocks = (blocks: ReferenceBlock[], pageUrl: string) => {
    for (const block of blocks) {
      if (block.kind === 'code') urls.set(block.definition.id, `${pageUrl}#${encodeURIComponent(block.definition.id)}`);
      if (block.kind === 'entry' || block.kind === 'section') {
        urls.set(block.id, `${pageUrl}#${encodeURIComponent(block.anchor ?? block.id)}`);
        recordBlocks(block.blocks ?? [], pageUrl);
      }
    }
  };
  const visit = (children: ReferenceNode[], parent: string[]) => {
    const natural = new Set(children.map(child => encodeSegment(child.title).toLowerCase()));
    for (const node of [...children].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
      let slug = encodeSegment(node.title) || 'item';
      const route = () => `${baseUrl}/${[...parent, slug].join('/')}`;
      if (!node.url) {
        if (claimed.has(routeKey(route())) || explicitUrls.has(routeKey(route()))) {
          const stem = `${slug}--${encodeSegment(node.id)}`;
          slug = stem;
          let suffix = 2;
          while (claimed.has(routeKey(route())) || explicitUrls.has(routeKey(route())) || natural.has(slug.toLowerCase())) slug = `${stem}-${suffix++}`;
        }
        node.url = route();
      }
      const segments = routeSegments(node.url);
      const key = routeKey(node.url);
      if (claimed.has(key) && node !== rootPage) throw new Error(`Duplicate reference page URL: ${node.url}`);
      claimed.add(key);
      paths.set(node.id, segments); nodes.set(node.id, node); urls.set(node.id, node.url);
      if (node.definition) urls.set(node.definition.id, `${node.url}#${encodeURIComponent(node.definition.id)}`);
      recordBlocks(node.blocks, node.url);
      if (node.kind === 'directory') visit(node.children, segments);
    }
  };
  visit(document.children, []);
  if (!rootPage) {
    let id = '$reference-root';
    while (allIds.has(id)) id += '$';
    rootPage = { kind: 'directory', id, title: document.title, blocks: [], children: document.children, url: rootUrl };
    nodes.set(id, rootPage); urls.set(id, rootUrl); paths.set(id, []);
  }
  const landingPage = rootPage;
  const getNode = (id: string) => { const node = nodes.get(id); if (!node) throw new Error(`Unknown reference page: ${id}`); return node; };
  return {
    document, baseUrl, getNode,
    getUrl(id) { const url = urls.get(id); if (!url) throw new Error(`Unknown reference target: ${id}`); return url; },
    getPageText: id => collectReferencePage(getNode(id)).text,
    toFumadocsSource() {
      const files: ReturnType<DocumentReference['toFumadocsSource']>['files'] = [];
      const page = (node: ReferenceNode) => {
        const segments = paths.get(node.id)!;
        // Source paths describe the tree independently of route slugs. Encode
        // segments so custom URLs cannot collide with meta.json or $index.mdx.
        const folder = segments.length ? `${segments.map(encodeSegment).join('/')}/` : '';
        const { text: _, ...data } = collectReferencePage(node);
        const path = node.kind === 'directory' || !segments.length
          ? `${folder}$index.mdx`
          : `${segments.slice(0, -1).map(encodeSegment).map(segment => `${segment}/`).join('')}page-${encodeSegment(node.id)}.mdx`;
        files.push({ type: 'page', path, slugs: segments, data: { ...data, title: node.title, description: markdownText(node.description ?? ''), nodeId: node.id, icon: node.type ? `refquill-${node.type.key}` : undefined } });
        if (node.kind === 'directory') files.push({ type: 'meta', path: `${folder}meta.json`, data: { title: node.title, icon: node.type ? `refquill-${node.type.key}` : undefined, pagesIndex: '$index', pages: ['...'] } });
      };
      page(landingPage);
      for (const node of nodes.values()) if (node !== landingPage) page(node);
      return { files };
    },
  };
}
