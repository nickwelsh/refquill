import type { ResolvedDocument, Symbol } from '@nickwelsh/refquill-schema';
import { safeUrl, type CodeLink, type LinkContext } from './code.js';

const record = (value: unknown): Record<string, unknown> => value != null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const pageKinds: Record<string, string> = {
  struct: 'struct', enum: 'enum', union: 'union', trait: 'trait', trait_alias: 'traitalias',
  type_alias: 'type', function: 'fn', constant: 'constant', static: 'static',
  macro: 'macro', proc_attribute: 'attr', proc_derive: 'derive', primitive: 'primitive', foreign_type: 'foreigntype',
};

/** Resolve compiler IDs and paths using the documentation roots rustdoc recorded. */
export function createRustdocLinks(document: ResolvedDocument, getMembers: (id: string) => Symbol[], getUrl: (id: string) => string) {
  const snapshots = new Map((document.rustdoc ?? []).map(snapshot => [snapshot.api, record(snapshot.data)]));
  const targets = new Map(document.symbols.filter(symbol => symbol.rustdocId != null).map(symbol => [JSON.stringify([symbol.api, symbol.rustdocId]), symbol]));
  const contexts = new Map<string, Map<string, Set<string>>>();
  const paths = new Map<string, Map<string, string[]>>();
  for (const [api, snapshot] of snapshots) {
    const names = new Map<string, string[]>();
    for (const [id, value] of Object.entries(record(snapshot.paths))) {
      const path = record(value);
      if (!Array.isArray(path.path) || !path.path.every(part => typeof part === 'string')) continue;
      for (const name of [path.path.join('::'), ...(path.kind === 'primitive' ? [path.path.at(-1)!] : [])]) {
        const ids = names.get(name) ?? [];
        ids.push(id);
        names.set(name, ids);
      }
    }
    paths.set(api, names);
  }
  const byId = (api: string, id: string): CodeLink | null => {
    const local = targets.get(JSON.stringify([api, id]));
    if (local) return { name: local.qualifiedName, label: local.name, url: getUrl(local.id) };
    const snapshot = snapshots.get(api);
    const path = record(record(snapshot?.paths)[id]);
    const segments = Array.isArray(path.path) && path.path.every(part => typeof part === 'string') ? path.path as string[] : [];
    const root = record(record(snapshot?.external_crates)[String(path.crate_id)]).html_root_url;
    if (!segments.length || typeof root !== 'string' || !/^https?:\/\//.test(root) || !safeUrl(root)) return null;
    const kind = String(path.kind);
    const parentIds = paths.get(api)?.get(segments.slice(0, -1).join('::')) ?? [];
    const parentId = parentIds.find(id => ['trait', 'struct', 'enum', 'union', 'primitive'].includes(String(record(record(snapshot?.paths)[id]).kind)));
    if (parentId) {
      const parent = byId(api, parentId);
      if (!parent) return null;
      const parentKind = record(record(snapshot?.paths)[parentId]).kind;
      const body = record(record(record(snapshot?.index)[id]).inner).function;
      const hasBody = record(body).has_body;
      const anchor = kind === 'function' ? (parentKind !== 'trait' || hasBody === true ? 'method' : hasBody === false ? 'tymethod' : null) : ({ assoc_type: 'associatedtype', assoc_const: 'associatedconstant', variant: 'variant', struct_field: 'structfield' } as Record<string, string>)[kind];
      return { name: segments.join('::'), label: segments.at(-1)!, url: anchor ? `${parent.url}#${anchor}.${encodeURIComponent(segments.at(-1)!)}` : parent.url };
    }
    const prefix = pageKinds[kind];
    if (kind !== 'module' && !prefix) return null;
    const parts = segments.map(encodeURIComponent);
    const name = parts.pop()!;
    const relative = kind === 'module' ? [...parts, name, 'index.html'] : [...parts, `${prefix}.${name}.html`];
    let url: string;
    try { url = new URL(relative.join('/'), root.endsWith('/') ? root : `${root}/`).href; } catch { return null; }
    return safeUrl(url) ? { name: segments.join('::'), label: segments.at(-1)!, url } : null;
  };
  const documentationLinks = (symbol: Symbol): CodeLink[] => {
    const index = record(snapshots.get(symbol.api)?.index);
    let item = record(index[symbol.rustdocId ?? '']);
    if (!item.docs && symbol.parentId) {
      // Implementation descriptions may inherit the trait's Markdown. Its
      // compiler links still belong to the declaration on the original trait.
      const owner = document.symbols.find(candidate => candidate.id === symbol.parentId);
      const implementation = record(record(record(index[owner?.rustdocId ?? '']).inner).impl);
      const trait = record(index[String(record(implementation.trait).id)]);
      const ids = record(record(trait.inner).trait).items;
      if (Array.isArray(ids)) item = ids.map(id => record(index[String(id)])).find(candidate => candidate.name === symbol.name) ?? item;
    }
    return Object.entries(record(item.links)).flatMap(([name, id]) => {
      const target = byId(symbol.api, String(id));
      return target ? [{ ...target, name, label: name }] : [];
    });
  };
  const references = (symbol: Symbol): Map<string, Set<string>> => {
    const cached = contexts.get(symbol.id);
    if (cached) return cached;
    const result = new Map<string, Set<string>>();
    const walk = (value: unknown) => {
      if (value === null || typeof value !== 'object') return;
      const item = record(value);
      if (typeof item.path === 'string' && item.path && (typeof item.id === 'string' || typeof item.id === 'number')) {
        const ids = result.get(item.path) ?? new Set<string>();
        ids.add(String(item.id));
        result.set(item.path, ids);
      }
      for (const child of Object.values(value)) walk(child);
    };
    const visit = (current: Symbol) => {
      walk(record(record(snapshots.get(current.api)?.index)[current.rustdocId ?? '']).inner);
      for (const child of getMembers(current.id)) {
        if (['property', 'enum-case'].includes(child.kind)) visit(child);
      }
    };
    visit(symbol);
    contexts.set(symbol.id, result);
    return result;
  };
  const resolve = (name: string, context: LinkContext, symbol?: Symbol): CodeLink | null | undefined => {
    const found = new Map<string, CodeLink>();
    if (symbol) {
      const ids = references(symbol).get(name) ?? new Set<string>();
      if (ids.size > 1) return null;
      for (const id of ids) {
        const link = byId(symbol.api, id);
        if (link) found.set(link.url, link);
      }
      if (found.size) return found.size === 1 ? [...found.values()][0] : null;
    }
    for (const [api, names] of paths) {
      if (context.inputName != null && api !== context.inputName) continue;
      for (const id of names.get(name) ?? []) {
        const link = byId(api, id);
        if (link) found.set(link.url, link);
      }
    }
    return found.size === 1 ? [...found.values()][0] : found.size > 1 ? null : undefined;
  };
  return { resolve, documentationLinks };
}
