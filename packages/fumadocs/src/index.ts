import { resolveDocument, type ReferenceDocument, type ReferenceNode, type ResolvedDocument, type Symbol, type Source } from '@nickwelsh/refquill-schema';
import { apiReferenceDocument } from './api-document.js';
import { collectReferencePage } from './reference.js';
import type { MetaData, StaticSource } from 'fumadocs-core/source';
import type { TOCItemType } from 'fumadocs-core/toc';
import { safeUrl, type CodeLink, type LinkContext } from './code.js';
import { createSymbolKindResolver, type ApiSymbolKind } from './symbol-kind.js';
import { encodeSegment, referenceBaseUrl } from './paths.js';
import { createRustdocLinks } from './rust-links.js';
import { markdownText } from './markdown-text.js';
export { encodeSegment } from './paths.js';
export type { ApiSymbolKind } from './symbol-kind.js';
export { transformerApiReference, safeUrl, type CodeLink, type LinkContext } from './code.js';

export * from '@nickwelsh/refquill-schema';
export { createReference, collectReferencePage, referenceLabelText, type DocumentReference, type ReferencePageData } from './reference.js';
export { referenceHighlightTransformer, referenceLinkTransformer, referenceMemberLines, type ReferenceHighlights } from './reference-code.js';
export { createJsonSchemaReference, jsonSchemaAnchor, type JsonSchema, type JsonSchemaNode, type JsonSchemaPageData, type JsonSchemaReference } from './json-schema.js';
export { createManPageReference, type ManPageContent, type ManPageEntry, type ManPageBlock, type ManPageSection, type ManPageDocument, type ManPagePageData, type ManPageReference } from './manpage.js';

/** Metadata for a virtual reference root, input, namespace, or declaration page. */
export interface ApiReferencePageData {
  title: string;
  description: string;
  /** The declaration ID, or null for an index page. */
  symbolId: string | null;
  /** The namespace name, or null outside a namespace index. */
  namespace: string | null;
  icon?: string;
  inputName: string | null;
  toc: TOCItemType[];
  structuredData: {
    headings: { id: string; content: string }[];
    contents: { heading: string | undefined; content: string }[];
  };
}

/** A namespace index with its immediate child namespaces and declarations. */
export interface ApiNamespace {
  inputName: string;
  name: string;
  title: string;
  segments: string[];
  children: ApiNamespace[];
  symbols: Symbol[];
  /** A Rust module whose declaration and docs belong to this index. */
  symbolId: string | null;
}

/** A rustdoc implementation category displayed on its owning type. */
export interface ApiImplementationGroup {
  id: string;
  title: string;
  symbols: Symbol[];
}

/** A PHP trait member with its canonical declaring trait and direct use origin. */
export interface ApiTraitMember {
  member: Symbol;
  declaringTrait: Symbol;
  usedTrait: Symbol;
}

/** A validated document with routes, namespace indexes, links, and Fumadocs pages. */
export interface ApiReference {
  /** The complete semantic model after resolving the compact wire document. */
  document: ResolvedDocument;
  baseUrl: string;
  /** Look up a public ID. Throws if the document does not contain it. */
  getSymbol(id: string): Symbol;
  /** Return the presentation kind, including PHP exceptions with known ancestry. */
  getSymbolKind(id: string): ApiSymbolKind;
  /** Read a namespace's direct children. Omit name to read the input's root. */
  getNamespace(inputName: string, name?: string): ApiNamespace;
  /** Return the canonical input or namespace landing-page URL. */
  getNamespaceUrl(inputName: string, name?: string): string;
  /** Resolve an internal or configured external name. Ambiguous names return null. */
  resolveLink(name: string, context: LinkContext): CodeLink | null;
  /** Compiler-resolved intra-document links for a symbol's Markdown. */
  getDocumentationLinks(id: string): CodeLink[];
  /** Return declared children without flattening inherited or PHP trait members. */
  getMembers(id: string): Symbol[];
  /** Inherent, trait, auto trait, and blanket implementations of a Rust type. */
  getImplementationGroups(id: string): ApiImplementationGroup[];
  /** Declared members of documented traits used directly or transitively. */
  getTraitMembers(id: string): ApiTraitMember[];
  /** Return a declaration URL or a member anchor on its owning declaration page. */
  getUrl(id: string): string;
  /** Apply the configured source URL callback, or return null when absent. */
  getSourceUrl(source: Source): string | null;
  /** Render a virtual page as Markdown for text endpoints and LLM exports. */
  getPageText(page: Pick<ApiReferencePageData, 'symbolId' | 'inputName'> & { namespace?: string | null }): string;
  /** Shared rendering model; language facts stay in the semantic document. */
  toReferenceDocument(): ReferenceDocument;
  toFumadocsSource(): Pick<StaticSource<{ pageData: ApiReferencePageData; metaData: MetaData }>, 'files'>;
}

/** Return the stable fragment identifier for a member's public ID, without #. */
export const memberAnchor = (id: string): string => `member-${encodeSegment(id)}`;
const namespaceSegments = (name: string): string[] => name.split(/::|[\\/]/).filter(Boolean);

function createSymbolSlugs(symbols: Symbol[], namespaces: Iterable<ApiNamespace>, namespaceSlugs: (namespace: ApiNamespace) => string[], getNamespace: (input: string, name: string) => ApiNamespace): Map<string, string[]> {
  const namespaceRoutes = new Set([...namespaces].map(namespace => namespaceSlugs(namespace).join('/').toLowerCase()));
  const candidates = new Map(symbols.map(symbol => [symbol.id, [...namespaceSlugs(getNamespace(symbol.api, symbol.group)), encodeSegment(symbol.name)]]));
  const counts = new Map<string, number>();
  for (const segments of candidates.values()) {
    const route = segments.join('/').toLowerCase();
    counts.set(route, (counts.get(route) ?? 0) + 1);
  }
  // Reserve natural names before allocating suffixes so a disambiguated symbol
  // cannot steal another declaration's readable URL. Fold case for portability.
  const reserved = new Set([...namespaceRoutes, ...counts.keys()]);
  const result = new Map<string, string[]>();
  for (const symbol of [...symbols].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    const segments = [...candidates.get(symbol.id)!];
    const route = segments.join('/').toLowerCase();
    if (namespaceRoutes.has(route) || counts.get(route)! > 1) {
      const name = `${segments.at(-1)}--${symbol.kind}`;
      segments[segments.length - 1] = name;
      let suffix = 2;
      while (reserved.has(segments.join('/').toLowerCase())) segments[segments.length - 1] = `${name}--${suffix++}`;
      reserved.add(segments.join('/').toLowerCase());
    }
    result.set(symbol.id, segments);
  }
  return result;
}

/** Validate an API reference document, then adapt it for any Fumadocs framework. */
export function createApiReference({ input, baseUrl = '/api', sourceUrl, resolveExternal }: {
  input: unknown;
  /** A local absolute route prefix. Defaults to /api. */
  baseUrl?: string;
  /** Build a source link from a portable repository path and line range. */
  sourceUrl?: (source: Source) => string;
  /** Resolve an undocumented qualified name to external documentation or source. */
  resolveExternal?: (name: string, context: LinkContext) => string | null | undefined;
}): ApiReference {
  baseUrl = referenceBaseUrl(baseUrl);
  const document = resolveDocument(input);
  const symbols = new Map(document.symbols.map(symbol => [symbol.id, symbol]));
  const getSymbol = (id: string): Symbol => {
    const symbol = symbols.get(id);
    if (!symbol) throw new Error(`Unknown Refquill symbol: ${id}`);
    return symbol;
  };
  const getSymbolKind = createSymbolKindResolver(getSymbol);
  const members = new Map<string, Symbol[]>();
  for (const symbol of document.symbols) {
    if (!symbol.parentId) continue;
    const values = members.get(symbol.parentId) ?? [];
    values.push(symbol);
    members.set(symbol.parentId, values);
  }
  const getMembers = (id: string): Symbol[] => {
    getSymbol(id);
    return members.get(id) ?? [];
  };
  const getImplementationGroups = (id: string): ApiImplementationGroup[] => {
    const groups: ApiImplementationGroup[] = [
      { id: 'implementations', title: 'Implementations', symbols: [] },
      { id: 'trait-implementations', title: 'Trait implementations', symbols: [] },
      { id: 'auto-trait-implementations', title: 'Auto trait implementations', symbols: [] },
      { id: 'blanket-implementations', title: 'Blanket implementations', symbols: [] },
    ];
    for (const symbol of getMembers(id)) {
      if (symbol.language !== 'rust' || symbol.kind !== 'impl') continue;
      const category = symbol.modifiers.includes('blanket') ? 3 : symbol.modifiers.includes('synthetic') ? 2 : symbol.relations.some(relation => relation.kind === 'implements') ? 1 : 0;
      groups[category].symbols.push(symbol);
    }
    return groups.filter(group => group.symbols.length > 0);
  };
  const getTraitMembers = (id: string): ApiTraitMember[] => {
    const symbol = getSymbol(id);
    if (symbol.language !== 'php' || !['class', 'trait', 'enum'].includes(symbol.kind)) return [];
    const result: ApiTraitMember[] = [];
    const visited = new Set([id]);
    const pending: { id: string; usedTrait?: Symbol }[] = [];
    const enqueue = (owner: Symbol, usedTrait?: Symbol) => {
      for (const relation of [...owner.relations].reverse()) {
        if (relation.kind === 'uses' && relation.targetId) pending.push({ id: relation.targetId, usedTrait });
      }
    };
    enqueue(symbol);
    while (pending.length) {
      const entry = pending.pop()!;
      if (visited.has(entry.id)) continue;
      const trait = getSymbol(entry.id);
      if (trait.language !== 'php' || trait.kind !== 'trait') continue;
      visited.add(trait.id);
      const through = entry.usedTrait ?? trait;
      for (const member of getMembers(trait.id)) result.push({ member, declaringTrait: trait, usedTrait: through });
      enqueue(trait, through);
    }
    return result;
  };
  const isPage = (symbol: Symbol): boolean => !symbol.parentId || (!(symbol.language === 'rust' && symbol.kind === 'impl') && ['namespace', 'module'].includes(getSymbol(symbol.parentId).kind));
  const pageSymbols = document.symbols.filter(isPage);
  const getUrl = (id: string): string => {
    const original = getSymbol(id);
    let page = original;
    while (!isPage(page)) page = getSymbol(page.parentId!);
    return `${baseUrl}/${symbolSlugs.get(page.id)!.join('/')}${original.id === page.id ? '' : `#${memberAnchor(id)}`}`;
  };
  const namespaces = new Map<string, ApiNamespace>();
  const rustModules = pageSymbols.filter(symbol => symbol.language === 'rust' && symbol.kind === 'module');
  const rustRoots = new Map(rustModules.filter(symbol => !symbol.parentId).map(symbol => [symbol.api, symbol.qualifiedName]));
  const key = (input: string, name: string) => JSON.stringify([input, namespaceSegments(name)]);
  const ensureNamespace = (inputName: string, segments: string[], language: Symbol['language']): ApiNamespace => {
    const name = segments.join(language === 'php' ? '\\' : language === 'rust' ? '::' : '/');
    const identity = key(inputName, name);
    const existing = namespaces.get(identity);
    if (existing) return existing;
    if (language === 'rust' && name === rustRoots.get(inputName)) {
      const root = ensureNamespace(inputName, [], language);
      namespaces.set(identity, root);
      return root;
    }
    const namespace: ApiNamespace = { inputName, name, title: segments.at(-1) ?? inputName, segments, children: [], symbols: [], symbolId: null };
    namespaces.set(identity, namespace);
    if (segments.length) ensureNamespace(inputName, segments.slice(0, -1), language).children.push(namespace);
    return namespace;
  };
  for (const symbol of pageSymbols) {
    const namespace = ensureNamespace(symbol.api, namespaceSegments(symbol.group), symbol.language);
    if (rustModules.includes(symbol)) {
      const moduleNamespace = ensureNamespace(symbol.api, namespaceSegments(symbol.qualifiedName), symbol.language);
      moduleNamespace.symbolId = symbol.id;
      moduleNamespace.title = symbol.name;
    } else if (symbol.kind !== 'impl' || symbol.language !== 'rust') namespace.symbols.push(symbol);
  }
  const namespaceValues = [...new Set(namespaces.values())];
  for (const namespace of namespaceValues) {
    namespace.children.sort((a, b) => a.title.localeCompare(b.title));
    namespace.symbols.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }
  const getNamespace = (inputName: string, name = ''): ApiNamespace => {
    const namespace = namespaces.get(key(inputName, name));
    if (!namespace) throw new Error(`Unknown API reference namespace: ${inputName}/${name}`);
    return namespace;
  };
  const namespaceSlugs = (namespace: ApiNamespace): string[] => {
    const segments = namespace.segments[0] === rustRoots.get(namespace.inputName) ? namespace.segments.slice(1) : namespace.segments;
    return [encodeSegment(namespace.inputName), ...segments.map(encodeSegment)];
  };
  const symbolSlugs = createSymbolSlugs(pageSymbols.filter(symbol => !rustModules.includes(symbol)), namespaceValues, namespaceSlugs, getNamespace);
  for (const symbol of rustModules) symbolSlugs.set(symbol.id, namespaceSlugs(getNamespace(symbol.api, symbol.qualifiedName)));
  const getNamespaceUrl = (inputName: string, name = ''): string => `${baseUrl}/${namespaceSlugs(getNamespace(inputName, name)).join('/')}`;
  const links = new Map<string, Symbol[]>();
  const addLink = (name: string, symbol: Symbol) => {
    const identity = `${symbol.language}:${symbol.language === 'php' ? name.toLowerCase() : name}`;
    const candidates = links.get(identity) ?? [];
    if (!candidates.includes(symbol)) candidates.push(symbol);
    links.set(identity, candidates);
  };
  for (const symbol of document.symbols) {
    addLink(symbol.qualifiedName, symbol);
    if (symbol.language === 'rust' && symbol.parentId) {
      const parent = getSymbol(symbol.parentId);
      if (parent.kind === 'impl' && parent.parentId) addLink(`${getSymbol(parent.parentId).qualifiedName}::${symbol.name}`, symbol);
    }
  }
  const symbolTypeLinks = new Map(document.symbols.map(symbol => {
    const templates = [...symbol.typeParameters];
    const types = [symbol.type];
    const signatures = [...symbol.signatures];
    const parameters = symbol.framework ? [...(symbol.framework.props ?? []), ...(symbol.framework.events ?? []), ...(symbol.framework.slots ?? []), ...(symbol.framework.exposed ?? [])] : [];
    while (signatures.length || parameters.length) {
      const signature = signatures.pop();
      if (signature) { types.push(signature.returns); templates.push(...signature.typeParameters); parameters.push(...signature.parameters); }
      const parameter = parameters.pop();
      if (parameter) { types.push(parameter.type); parameters.push(...(parameter.properties ?? [])); signatures.push(...(parameter.signatures ?? [])); }
    }
    types.push(...templates.flatMap(parameter => [parameter.constraint, parameter.default]));
    return [symbol.id, types.flatMap(type => type?.references ?? [])];
  }));
  const rustdocLinks = createRustdocLinks(document, getMembers, getUrl);
  const getDocumentationLinks = (id: string): CodeLink[] => rustdocLinks.documentationLinks(getSymbol(id));
  const resolveLink = (name: string, context: LinkContext): CodeLink | null => {
    name = name.replace(/^\\/, '');
    if (context.symbolId) {
      const documented = getDocumentationLinks(context.symbolId).find(link => link.name === name);
      if (documented) return documented;
      const references = symbolTypeLinks.get(context.symbolId)?.filter(reference => reference.name === name || reference.qualifiedName === name) ?? [];
      const targets = new Set(references.flatMap(reference => reference.targetId ? [reference.targetId] : []));
      if (targets.size === 1) {
        const symbol = getSymbol([...targets][0]);
        return { name: symbol.qualifiedName, label: symbol.name, url: getUrl(symbol.id) };
      }
      if (targets.size > 1) return null;
      const external = references.filter(reference => reference.package && reference.targetId == null);
      if (external.length) {
        const identities = new Set(external.map(reference => JSON.stringify([reference.package, reference.qualifiedName])));
        if (identities.size > 1) return null;
        const url = resolveExternal?.(name, { ...context, reference: external[0] });
        if (url && !safeUrl(url)) throw new Error(`Unsafe external reference URL: ${url}`);
        return url ? { name: external[0].qualifiedName ?? name, label: name.split('.').at(-1)!, url } : null;
      }
      if (context.language === 'rust') {
        const native = rustdocLinks.resolve(name, context, getSymbol(context.symbolId));
        if (native !== undefined) return native;
      }
    }
    const names = [name];
    if (context.language === 'rust') {
      const path = name.replace(/!$/, '').replace(/\br#/g, '');
      const group = namespaceSegments(context.group ?? '');
      if (path.startsWith('crate::') && group.length) names.unshift([group[0], path.slice(7)].join('::'));
      else if (path.startsWith('self::')) names.unshift([...group, path.slice(6)].join('::'));
      else if (path.startsWith('super::')) {
        let relative = path;
        while (relative.startsWith('super::')) { group.pop(); relative = relative.slice(7); }
        names.unshift([...group, relative].join('::'));
      } else if (context.group) names.unshift(`${context.group}::${path}`);
      if (!names.includes(path)) names.push(path);
    }
    let candidates: Symbol[] = [];
    for (const candidate of names) {
      candidates = links.get(`${context.language}:${context.language === 'php' ? candidate.toLowerCase() : candidate}`) ?? [];
      if (context.inputName != null) candidates = candidates.filter(s => s.api === context.inputName);
      if (candidates.length) break;
    }
    if (context.group != null) {
      const local = candidates.filter(s => s.group === context.group);
      if (local.length) candidates = local;
    }
    if (candidates.length === 1) {
      const symbol = candidates[0];
      const label = context.language === 'php' ? symbol.qualifiedName.split('\\').at(-1)! : symbol.name;
      return { name: symbol.qualifiedName, label, url: getUrl(symbol.id) };
    }
    if (candidates.length > 1) return null;
    if (context.language === 'rust') {
      const native = rustdocLinks.resolve(name, context);
      if (native !== undefined) return native;
    }
    const external = resolveExternal?.(name, context);
    if (!external) return null;
    const url = external;
    if (!safeUrl(url)) throw new Error(`Unsafe external reference URL: ${url}`);
    return { name, url, label: name.split(/::|[\\.]/).at(-1)! };
  };
  const getSourceUrl = (source: Source): string | null => {
    const url = sourceUrl?.(source);
    if (url != null && !safeUrl(url)) throw new Error(`Unsafe source URL: ${url}`);
    return url ?? null;
  };
  let projected: ReferenceDocument | undefined;
  let projectedNodes: Map<string, ReferenceNode> | undefined;
  const projectedPage = (page: Pick<ApiReferencePageData, 'symbolId' | 'inputName'> & { namespace?: string | null }): ReferenceNode => {
    const document = reference.toReferenceDocument();
    if (!page.symbolId && page.inputName == null) return { kind: 'directory', id: 'reference-root', title: document.title, url: baseUrl, blocks: [], children: document.children };
    if (!projectedNodes) {
      projectedNodes = new Map();
      const visit = (nodes: ReferenceNode[]) => { for (const node of nodes) {
        projectedNodes!.set(node.id, node);
        if (node.url) projectedNodes!.set(node.url, node);
        if (node.kind === 'directory') visit(node.children);
      } };
      visit(document.children);
    }
    const key = page.symbolId ? getUrl(page.symbolId) : getNamespaceUrl(page.inputName!, page.namespace ?? '');
    const node = projectedNodes.get(key);
    if (!node) throw new Error(`Unknown API reference page: ${key}`);
    return node;
  };
  const reference: ApiReference = {
    document, baseUrl, getSymbol, getSymbolKind, getMembers, getImplementationGroups, getTraitMembers, getUrl, getSourceUrl, getNamespace, getNamespaceUrl, resolveLink, getDocumentationLinks,
    toReferenceDocument() { return projected ??= apiReferenceDocument(reference); },
    getPageText(page) { return collectReferencePage(projectedPage(page), { codeMeta: 'api' }).text; },
    toFumadocsSource() {
      const files: ReturnType<ApiReference['toFumadocsSource']>['files'] = [];
      // Listing $index in pages would take it away from the folder's pagesIndex.
      files.push({ type: 'meta', path: 'meta.json', data: { title: document.title, pagesIndex: '$index', pages: ['...'] } });
      files.push({ type: 'page', path: '$index.mdx', slugs: [], data: { title: document.title, description: 'Browse the API reference.', symbolId: null, inputName: null, namespace: null, toc: [], structuredData: collectReferencePage(projectedPage({ symbolId: null, inputName: null })).structuredData } });
      for (const namespace of namespaceValues) {
        const segments = namespaceSlugs(namespace);
        const path = segments.join('/');
        const module = namespace.symbolId ? getSymbol(namespace.symbolId) : null;
        const icon = module ? 'refquill-module' : 'refquill-namespace';
        const { toc, structuredData } = collectReferencePage(projectedPage({ symbolId: null, inputName: namespace.inputName, namespace: namespace.name }));
        files.push({ type: 'meta', path: `${path}/meta.json`, data: { title: namespace.title, icon, pagesIndex: '$index', pages: ['...'] } });
        files.push({ type: 'page', path: `${path}/$index.mdx`, slugs: segments, data: { title: namespace.title, description: module ? markdownText(module.description.split(/\n\s*\n/)[0]) : `Browse ${namespace.name || namespace.inputName} declarations.`, icon, symbolId: namespace.symbolId, inputName: namespace.inputName, namespace: namespace.name, toc, structuredData } });
      }
      for (const symbol of pageSymbols.filter(symbol => !rustModules.includes(symbol))) {
        const segments = symbolSlugs.get(symbol.id)!;
        const { toc, structuredData } = collectReferencePage(projectedPage({ symbolId: symbol.id, inputName: symbol.api }));
        files.push({ type: 'page', path: `${segments.slice(0, -1).join('/')}/symbol-${encodeSegment(symbol.id)}.mdx`, slugs: segments, data: {
          title: symbol.name, description: markdownText(symbol.description.split(/\n\s*\n/)[0]), symbolId: symbol.id, inputName: symbol.api, namespace: null, icon: `refquill-${getSymbolKind(symbol.id)}`, toc,
          structuredData,
        } });
      }
      const paths = new Set<string>();
      const routes = new Set<string>();
      for (const file of files) {
        if (paths.has(file.path)) throw new Error(`Duplicate API reference virtual path: ${file.path}`);
        paths.add(file.path);
        if (file.type === 'page') {
          const route = file.slugs!.join('/');
          if (routes.has(route)) throw new Error(`Duplicate API reference route: ${route}`);
          routes.add(route);
        }
      }
      return { files };
    },
  };
  return reference;
}
