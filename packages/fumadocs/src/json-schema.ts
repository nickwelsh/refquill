import type { ReferenceBlock, ReferenceDocument, ReferenceEntry } from '@nickwelsh/refquill-schema';
import type { MetaData, StaticSource } from 'fumadocs-core/source';
import type { TOCItemType } from 'fumadocs-core/toc';
import { collectReferencePage } from './reference.js';
import { safeUrl } from './code.js';
import { encodeSegment, referenceBaseUrl } from './paths.js';

/** JSON Schema is retained as supplied, including vocabulary extensions. */
export type JsonSchema = boolean | { [keyword: string]: unknown };
export interface JsonSchemaNode {
  pointer: string;
  name: string;
  keyword: string;
  schema: JsonSchema;
  required: boolean;
  children: JsonSchemaNode[];
}
export interface JsonSchemaPageData {
  title: string;
  description: string;
  toc: TOCItemType[];
  structuredData: {
    headings: { id: string; content: string }[];
    contents: { heading: string | undefined; content: string }[];
  };
}
export interface JsonSchemaReference {
  schema: JsonSchema;
  title: string;
  baseUrl: string;
  sourceUrl: string | null;
  root: JsonSchemaNode;
  /** Original JSON, formatted for the source panel and copying. */
  code: string;
  memberLines: Record<number, string>;
  resolveRef(ref: string, pointer?: string): string | null;
  toReferenceDocument(): ReferenceDocument;
  getPageText(): string;
  toFumadocsSource(): Pick<StaticSource<{ pageData: JsonSchemaPageData; metaData: MetaData }>, 'files'>;
}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const isSchema = (value: unknown): value is JsonSchema => typeof value === 'boolean' || object(value);
export const schemaText = (schema: JsonSchema, keyword: string): string => typeof schema === 'object' && typeof schema[keyword] === 'string' ? schema[keyword] as string : '';
const segment = (value: string) => value.replaceAll('~', '~0').replaceAll('/', '~1');
export const jsonSchemaAnchor = (pointer: string): string => `schema-${encodeSegment(pointer) || 'root'}`;
const mapKeywords = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas', 'dependencies']);
const arrayKeywords = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);
const singleKeywords = new Set(['additionalProperties', 'unevaluatedProperties', 'propertyNames', 'items', 'additionalItems', 'contains', 'unevaluatedItems', 'not', 'if', 'then', 'else', 'contentSchema']);

/** Values not already represented by child disclosures. Legacy dependencies can
 * mix schemas with property-name arrays; keep those arrays visible and searchable. */
export function schemaKeywords(node: JsonSchemaNode): [string, unknown][] {
  if (typeof node.schema === 'boolean') return [];
  const handled = new Set(node.children.map(child => child.keyword));
  return Object.entries(node.schema).flatMap(([key, value]) => {
    if (!handled.has(key)) return [[key, value] as [string, unknown]];
    if (key === 'dependencies' && object(value)) {
      const remaining = Object.fromEntries(Object.entries(value).filter(([, child]) => !isSchema(child)));
      if (Object.keys(remaining).length) return [[key, remaining] as [string, unknown]];
    }
    return [];
  });
}

const schemaGroupTitles: Record<string, string> = {
  properties: 'Properties', patternProperties: 'Pattern properties', definitions: 'Definitions', $defs: 'Definitions',
  allOf: 'All of', anyOf: 'Any of', oneOf: 'One of', prefixItems: 'Prefix items', items: 'Items',
  additionalProperties: 'Additional properties', unevaluatedProperties: 'Unevaluated properties',
  dependentSchemas: 'Dependent schemas', dependencies: 'Dependencies', propertyNames: 'Property names',
  additionalItems: 'Additional items', unevaluatedItems: 'Unevaluated items', contains: 'Contains',
  not: 'Not', if: 'If', then: 'Then', else: 'Else', contentSchema: 'Content schema',
};
function propertyPolicy(node: JsonSchemaNode): string | null {
  if (typeof node.schema !== 'boolean') return null;
  if (node.keyword === 'additionalProperties') return node.schema
    ? 'Properties not covered by properties or patternProperties may have any value.'
    : 'Properties not covered by properties or patternProperties are not allowed.';
  if (node.keyword === 'unevaluatedProperties') return node.schema
    ? 'Properties not evaluated by other applicable schemas may have any value.'
    : 'Properties not evaluated by other applicable schemas are not allowed.';
  return null;
}
function schemaTypes(schema: JsonSchema): string {
  if (typeof schema === 'boolean') return schema ? 'any value' : 'no value';
  if (Array.isArray(schema.type)) return schema.type.filter(type => typeof type === 'string').join(' | ');
  return schemaText(schema, 'type') || (schema.properties ? 'object' : schema.items ? 'array' : '');
}

/** Adapt a standard schema directly, retaining unknown vocabulary and finite reference links. */
export function createJsonSchemaReference({ schema, title, baseUrl = '/schema', sourceUrl }: {
  schema: unknown;
  title?: string;
  baseUrl?: string;
  /** Retrieval URL, also used as the base for relative references. No network requests are made. */
  sourceUrl?: string;
}): JsonSchemaReference {
  if (!isSchema(schema)) throw new Error('JSON Schema must be an object or boolean');
  baseUrl = referenceBaseUrl(baseUrl);
  if (sourceUrl != null) {
    if (!/^https?:\/\//.test(sourceUrl) || !safeUrl(sourceUrl) || !URL.canParse(sourceUrl)) throw new Error('sourceUrl must be an HTTP(S) URL');
  }
  title ??= schemaText(schema, 'title') || 'JSON Schema';
  // Check the JSON boundary, not schema validity. Bound nesting and work before
  // recursive rendering; reject cycles and values JSON would silently discard.
  let count = 0;
  const active = new Set<object>();
  function check(value: unknown, depth = 0): void {
    if (++count > 100_000 || depth > 64) throw new Error('JSON Schema exceeds rendering limits');
    if (value === null || typeof value === 'boolean' || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return;
    if (typeof value !== 'object' || active.has(value!)) throw new Error('JSON Schema must contain only acyclic JSON values');
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error('JSON Schema must contain only plain JSON objects');
    active.add(value!);
    for (const child of Array.isArray(value) ? value : Object.values(value!)) check(child, depth + 1);
    active.delete(value!);
  }
  check(schema);
  const code = JSON.stringify(schema, null, 2);
  if (code.length > 2_000_000) throw new Error('JSON Schema exceeds rendering limits');
  const nodes = new Map<string, JsonSchemaNode>();
  const bases = new Map<string, string>();
  const targets = new Map<string, string>();
  const resources = new Map<string, string>();
  const resourceUris = new Set<string>();
  const retrieval = sourceUrl ?? 'https://refquill.invalid/schema';
  function absolute(value: string, base: string): string | null {
    try { return new URL(value, base).href; } catch { return null; }
  }
  function visit(value: JsonSchema, pointer: string, name: string, keyword: string, required: boolean, parentBase: string): JsonSchemaNode {
    const node: JsonSchemaNode = { pointer, name, keyword, schema: value, required, children: [] };
    nodes.set(pointer, node);
    const id = schemaText(value, '$id') || schemaText(value, 'id');
    const base = (id && absolute(id, parentBase)) || parentBase;
    bases.set(pointer, base);
    if (!pointer || id) {
      targets.set(base, pointer);
      if (!new URL(base).hash) {
        resources.set(pointer, base.split('#')[0]);
        resourceUris.add(base.split('#')[0]);
      }
    }
    for (const anchor of ['$anchor', '$dynamicAnchor']) {
      const name = schemaText(value, anchor);
      if (name) targets.set(`${base.split('#')[0]}#${name}`, pointer);
    }
    if (typeof value === 'boolean') return node;
    const add = (child: unknown, parts: string[], childName: string, key: string) => {
      if (isSchema(child)) node.children.push(visit(child, `${pointer}/${parts.map(segment).join('/')}`, childName, key, key === 'properties' && Array.isArray(value.required) && value.required.includes(childName), base));
    };
    for (const [key, child] of Object.entries(value)) {
      if (mapKeywords.has(key) && object(child)) for (const [name, entry] of Object.entries(child)) add(entry, [key, name], name, key);
      else if ((arrayKeywords.has(key) || key === 'items') && Array.isArray(child)) child.forEach((entry, i) => add(entry, [key, String(i)], `${key} ${i + 1}`, key));
      else if (singleKeywords.has(key)) add(child, [key], key, key);
    }
    return node;
  }
  const root = visit(schema, '', title, '', false, retrieval);
  // Register JSON Pointers relative to each resource's own root. $ref is never
  // followed while walking, so recursive definitions remain finite links.
  for (const pointer of nodes.keys()) {
    let parent = pointer;
    for (;;) {
      const uri = resources.get(parent);
      if (uri) targets.set(`${uri}#${pointer.slice(parent.length)}`, pointer);
      if (!parent) break;
      parent = parent.slice(0, parent.lastIndexOf('/'));
    }
  }
  // Retrieval URLs remain valid aliases even when the root declares its own $id.
  for (const pointer of nodes.keys()) targets.set(`${retrieval.split('#')[0]}#${pointer}`, pointer);
  const memberLines: Record<number, string> = {};
  let line = 1;
  const valueLines = new Map<string, number>();
  const sourceRanges = new Map<string, [number, number]>();
  function sourceLines(value: unknown, pointer: string, owner: string): void {
    if (nodes.has(pointer)) owner = jsonSchemaAnchor(pointer);
    memberLines[line] = owner;
    valueLines.set(pointer, line);
    const start = line;
    const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : object(value) ? Object.entries(value) : [];
    if (!entries.length) { sourceRanges.set(pointer, [start, line]); return; }
    for (const [key, child] of entries) {
      line++;
      sourceLines(child, `${pointer}/${segment(key)}`, owner);
    }
    memberLines[++line] = owner;
    sourceRanges.set(pointer, [start, line]);
  }
  sourceLines(schema, '', jsonSchemaAnchor(''));
  const description = schemaText(schema, 'description');
  const reference: JsonSchemaReference = {
    schema, title, baseUrl, sourceUrl: sourceUrl ?? null, root, code, memberLines,
    resolveRef(ref, pointer = '') {
      const url = absolute(ref, bases.get(pointer) ?? retrieval);
      if (!url) return null;
      // URL percent encoding is allowed in JSON Pointer fragments.
      let normalized: string;
      try { const [document, fragment = ''] = url.split('#'); normalized = `${document}#${decodeURIComponent(fragment)}`; } catch { return null; }
      const target = targets.get(url) ?? targets.get(normalized) ?? (url.endsWith('#') ? targets.get(url.slice(0, -1)) : undefined);
      if (target !== undefined) return `#${jsonSchemaAnchor(target)}`;
      const document = url.split('#')[0];
      if (document === retrieval.split('#')[0] || resourceUris.has(document)) return null;
      return /^https?:\/\//i.test(url) && safeUrl(url) ? url : null;
    },
    toReferenceDocument() {
      const definitionId = 'schema-source';
      function badges(node: JsonSchemaNode): ReferenceEntry['badges'] {
        return [
          ...(schemaTypes(node.schema) ? [{ label: schemaTypes(node.schema), type: 'modifier' }] : []),
          ...(node.keyword === 'properties' ? [{ label: node.required ? 'required' : 'optional', type: 'requirement' }] : []),
          ...(typeof node.schema === 'object' && node.schema.deprecated === true ? [{ label: 'deprecated', type: 'deprecated' }] : []),
        ];
      }
      function blocks(node: JsonSchemaNode): ReferenceBlock[] {
        if (typeof node.schema === 'boolean') return [{ kind: 'markdown', value: node.schema ? 'Accepts any value.' : 'Does not accept any value.' }];
        const anchor = jsonSchemaAnchor(node.pointer);
        const result: ReferenceBlock[] = [];
        for (const [key, value] of schemaKeywords(node)) {
          if (['title', 'description', 'type', 'deprecated'].includes(key)) continue;
          const id = `json-keyword:${anchor}:${encodeSegment(key)}`;
          const [start, end] = sourceRanges.get(`${node.pointer}/${segment(key)}`)!;
          const prefix = `${JSON.stringify(key)}: `;
          const code = prefix + JSON.stringify(value, null, 2);
          const ref = ['$ref', '$dynamicRef', '$recursiveRef'].includes(key) && typeof value === 'string';
          const url = ref ? reference.resolveRef(value, node.pointer) : null;
          result.push({ kind: 'entry', id,
            title: { code, language: 'json', contextCode: '{\n', ...(url ? { links: [{ start: prefix.length, end: code.length, url }] } : {}) },
            display: 'static', ...(ref && !url ? { description: '(unresolved reference)' } : {}),
            highlights: [{ definitionId, range: { start: { line: start }, end: { line: end } } }],
          });
        }
        for (const keyword of new Set(node.children.map(child => child.keyword))) {
          result.push({ kind: 'section', id: `json-group:${anchor}:${encodeSegment(keyword)}`, title: schemaGroupTitles[keyword] ?? keyword,
            blocks: node.children.filter(child => child.keyword === keyword).map(child => {
              const [start, end] = sourceRanges.get(child.pointer)!;
              const title = schemaText(child.schema, 'title');
              const policy = propertyPolicy(child);
              const content = policy === null ? blocks(child) : [];
              if (title) content.unshift({ kind: 'markdown', value: title.replace(/[\\`*_[\]{}<>#|]/g, '\\$&') });
              return { kind: 'entry', id: jsonSchemaAnchor(child.pointer), type: { key: 'schema', label: 'Schema' },
                title: { code: JSON.stringify(child.name) + (policy === null ? '' : `: ${child.schema}`), language: 'json', contextCode: '{\n' }, description: policy ?? schemaText(child.schema, 'description'),
                badges: policy === null ? badges(child) : [], display: content.length ? 'disclosure' : 'static', blocks: content,
                highlights: [{ definitionId, range: { start: { line: start }, end: { line: end } } }],
              };
            }),
          });
        }
        return result;
      }
      const lines = code.split('\n');
      const offsets: number[] = [];
      let offset = 0;
      for (const line of lines) { offsets.push(offset); offset += line.length + 1; }
      const links = [...nodes.values()].flatMap(node => {
        if (typeof node.schema === 'boolean') return [];
        return ['$ref', '$dynamicRef', '$recursiveRef'].flatMap(key => {
          const value = schemaText(node.schema, key);
          if (typeof node.schema !== 'object' || typeof node.schema[key] !== 'string') return [];
          const url = reference.resolveRef(value, node.pointer);
          const line = valueLines.get(`${node.pointer}/${segment(key)}`);
          if (!url || line == null) return [];
          const text = JSON.stringify(value);
          const start = offsets[line - 1] + lines[line - 1].lastIndexOf(text);
          return [{ start, end: start + text.length, url }];
        });
      });
      return { schemaVersion: 1, title: reference.title, children: [{ kind: 'page', id: jsonSchemaAnchor(''),
        title: reference.title, type: { key: 'json-schema', label: 'JSON Schema' }, description,
        badges: badges(root), url: baseUrl, ...(sourceUrl ? { sourceUrl } : {}),
        definition: { id: definitionId, language: 'json', code, ...(links.length ? { links } : {}) }, blocks: blocks(root),
      }] };
    },
    getPageText() { return collectReferencePage(reference.toReferenceDocument().children[0]).text; },
    toFumadocsSource() {
      const { text: _, ...data } = collectReferencePage(reference.toReferenceDocument().children[0]);
      return { files: [{ type: 'page', path: 'index.mdx', slugs: [], data: { title: reference.title, description, ...data } }] };
    },
  };
  return reference;
}
