import type {
  ReferenceBadge, ReferenceBlock, ReferenceCodeLink, ReferenceDefinition, ReferenceDirectory,
  ReferenceDocument, ReferenceEntry, ReferenceHighlight, ReferenceLabel, ReferenceNode,
  ReferenceSection, Symbol, TypeParameter, Parameter, Type, Signature,
} from '@nickwelsh/refquill-schema';
import { highlighter } from './code-highlighter.js';
import { transformerApiReference } from './code.js';
import { declarationOutline, type DeclarationOutline } from './declarations.js';
import { encodeSegment, memberAnchor, type ApiNamespace, type ApiReference, type ApiSymbolKind, type ApiTraitMember } from './index.js';

const label = (value: string) => Object.hasOwn(labels, value) ? labels[value] : value.replaceAll('-', ' ');
const labels: Record<string, string> = { 'react-component': 'React component', 'react-hook': 'React hook', 'vue-component': 'Vue component', 'svelte-component': 'Svelte component', 'solid-component': 'SolidJS component' };
const kindTitles: Record<ApiSymbolKind, string> = {
  'react-component': 'React components', 'react-hook': 'React hooks', 'vue-component': 'Vue components', 'svelte-component': 'Svelte components', 'solid-component': 'SolidJS components',
  namespace: 'Namespaces', module: 'Modules', class: 'Classes', exception: 'Exceptions', interface: 'Interfaces',
  trait: 'Traits', enum: 'Enums', 'type-alias': 'Type aliases', function: 'Functions', constant: 'Constants',
  variable: 'Variables', constructor: 'Constructors', method: 'Methods', property: 'Properties', accessor: 'Accessors',
  'enum-case': 'Enum cases', struct: 'Structs', union: 'Unions', impl: 'Implementations', macro: 'Macros',
  primitive: 'Primitives', 'extern-type': 'Extern types', reexport: 'Re-exports', 'trait-alias': 'Trait aliases',
  field: 'Fields', variant: 'Variants', 'enum-member': 'Enum members',
  'associated-function': 'Associated functions', 'associated-type': 'Associated types', 'associated-constant': 'Associated constants', static: 'Statics',
};
const section = (id: string, title: string, blocks: ReferenceBlock[]): ReferenceSection => ({ kind: 'section', id, title, blocks });
const prose = (value: string): ReferenceBlock[] => value ? [{ kind: 'markdown', value }] : [];

/** Map language facts to presentation once. The shared renderer has no API vocabulary. */
export class ApiDocumentProjection {
  readonly definitions = new Map<string, { symbol: Symbol; outline: DeclarationOutline }>();
  private readonly links = new Map<string, ReferenceCodeLink[]>();

  constructor(readonly reference: ApiReference) {}

  private markdown(value: string, symbol: Symbol): string {
    const links = this.reference.getDocumentationLinks(symbol.id)
      .filter(link => !/[\[\]\r\n]/.test(link.name))
      .map(link => `[${link.name}]: ${link.url}`);
    return value && links.length ? `${value}\n\n${links.join('\n')}` : value;
  }

  /** Reuse the syntax-aware resolver, including its string/comment exclusions.
   * Hidden copy prefixes reconstruct original offsets after shortened labels. */
  private codeLinks(code: string, symbol: Symbol, contextCode?: string): ReferenceCodeLink[] {
    const key = JSON.stringify([symbol.id, code, contextCode]);
    const cached = this.links.get(key);
    if (cached) return cached;
    const tree = highlighter.codeToHast(code, {
      lang: symbol.language, theme: 'github-light', meta: { __raw: 'api' },
      grammarContextCode: contextCode,
      transformers: [transformerApiReference(this.reference.resolveLink, { inputName: symbol.api, group: symbol.group, symbolId: symbol.id }), {
        line(node, line) { node.properties['data-api-line'] = line; },
      }],
    });
    const links: ReferenceCodeLink[] = [];
    let offset = 0;
    const lineOffsets = [0, ...Array.from(code.matchAll(/\r\n|\r|\n/g), match => match.index + match[0].length)];
    type Tree = typeof tree;
    type Element = Extract<Tree['children'][number], { type: 'element' }>;
    const visit = (node: Tree | Tree['children'][number] | Element['children'][number]) => {
      if (node.type === 'element' && typeof node.properties['data-api-line'] === 'number') offset = lineOffsets[node.properties['data-api-line'] - 1] ?? offset;
      const start = offset;
      if (node.type === 'text') offset += node.value.length;
      else if ('children' in node) for (const child of node.children) visit(child);
      if (node.type === 'element' && node.tagName === 'a' && typeof node.properties.href === 'string') {
        links.push({ start, end: offset, url: node.properties.href });
      }
    };
    visit(tree);
    this.links.set(key, links);
    return links;
  }

  private codeLabel(code: string, symbol: Symbol, contextCode?: string): ReferenceLabel {
    const links = this.codeLinks(code, symbol, contextCode);
    return { code, language: symbol.language, ...(contextCode ? { contextCode } : {}), ...(links.length ? { links } : {}) };
  }

  private typeLabel(code: string, symbol: Symbol): ReferenceLabel {
    return this.codeLabel(code, symbol, symbol.language === 'typescript' ? 'type __Refquill = ' : undefined);
  }

  private typeEntry(type: Type, symbol: Symbol, id: string, alternative = false): ReferenceEntry {
    const structure = type.structure;
    if (!structure) return { kind: 'entry', id, title: this.typeLabel(type.text, symbol), display: 'static', ...(alternative ? { type: { key: 'type-alternative', label: 'Alternative' } } : {}) };
    if (structure.kind === 'generic') return {
      kind: 'entry', id, type: { key: 'generic', label: 'Generic type' }, title: this.typeLabel(structure.name, symbol), display: 'disclosure',
      blocks: structure.arguments.map((argument, index) => {
        const parameter = structure.argumentParameters?.[index];
        const origin = type.references.find(reference => reference.name === structure.name)?.package;
        const name = structure.name.split('.').at(-1)!;
        const known: Record<string, string[]> = origin === 'typescript'
          ? { Partial: ['Object type'], Required: ['Object type'], Readonly: ['Object type'], Record: ['Keys', 'Value type'], Pick: ['Object type', 'Keys'], Omit: ['Object type', 'Keys'] }
          : origin === '@types/react' ? { ComponentType: ['Props'], SVGProps: ['SVG element'] } : {};
        const title = known[name]?.[index] ?? parameter?.name ?? `Type argument ${index + 1}`;
        return section(`${id}-argument-${index}`, title, [...prose(parameter?.description ? this.markdown(parameter.description, symbol) : ''), this.typeEntry(argument, symbol, `${id}-argument-${index}-value`)]);
      }),
    };
    return {
      kind: 'entry', id, type: { key: structure.kind, label: structure.kind }, title: structure.kind === 'union' ? 'One of' : 'All of', display: 'disclosure',
      blocks: structure.types.map((type, index) => this.typeEntry(type, symbol, `${id}-alternative-${index}`, true)),
    };
  }

  private typeSection(type: Type, symbol: Symbol, scope: string): ReferenceSection {
    const structure = symbol.kind === 'type-alias' ? type.structure : undefined;
    if (structure && structure.kind !== 'generic') return section(`${scope}-type`, structure.kind === 'union' ? 'One of' : 'All of', structure.types.map((type, index) => this.typeEntry(type, symbol, `${scope}-type-${index}`, true)));
    return section(`${scope}-type`, 'Type', [symbol.kind === 'type-alias' ? this.typeEntry(type, symbol, `${scope}-type-value`) : { kind: 'entry', id: `${scope}-type-value`, title: this.typeLabel(type.text, symbol), display: 'static' }]);
  }

  private definition(symbol: Symbol, scope: string, outline: DeclarationOutline = { code: symbol.declaration, memberLines: {} }): ReferenceDefinition {
    const id = `${scope}-definition`;
    this.definitions.set(id, { symbol, outline });
    const links = this.codeLinks(outline.code, symbol);
    return { id, language: symbol.language, code: outline.code, ...(links.length ? { links } : {}) };
  }

  private badges(symbol: Symbol, visibility?: ReferenceBadge['visibility']): ReferenceBadge[] {
    const modifiers = [...new Set(symbol.modifiers)];
    if (symbol.language !== 'rust' && ['method', 'constructor', 'property', 'constant', 'accessor'].includes(symbol.kind)
      && !modifiers.some(modifier => ['public', 'protected', 'private'].includes(modifier))) modifiers.unshift('public');
    return [
      ...modifiers.map(modifier => ({ label: modifier, type: 'modifier', ...(visibility ? { visibility } : {}) })),
      ...(symbol.deprecated ? [{ label: 'deprecated', type: 'deprecated', visibility: 'both' as const }] : []),
    ];
  }

  private typeParameters(parameters: TypeParameter[], symbol: Symbol, scope: string): ReferenceBlock[] {
    if (!parameters.length) return [];
    return [section(`${scope}-type-parameters`, 'Type parameters', parameters.map((parameter, index): ReferenceEntry => ({
      kind: 'entry', id: `${scope}-type-parameter-${index}`, title: this.codeLabel(parameter.name, symbol),
      type: { key: 'type-parameter', label: 'type parameter' }, display: 'static', description: this.markdown(parameter.description, symbol),
      blocks: [
        ...(parameter.constraint ? [section(`${scope}-type-parameter-${index}-constraint`, 'Extends', [{ kind: 'entry' as const, id: `${scope}-type-parameter-${index}-constraint-value`, title: this.typeLabel(parameter.constraint.text, symbol), display: 'static' as const }])] : []),
        ...(parameter.default ? [section(`${scope}-type-parameter-${index}-default`, 'Default', [{ kind: 'entry' as const, id: `${scope}-type-parameter-${index}-default-value`, title: this.typeLabel(parameter.default.text, symbol), display: 'static' as const }])] : []),
      ],
    })))];
  }

  private parameter(parameter: Parameter, symbol: Symbol, id: string, definitionId?: string): ReferenceEntry {
    const children = parameter.properties ?? [];
    const callbacks = parameter.signatures ?? [];
    const structured = children.length > 0 || callbacks.length > 0;
    const code = `${parameter.variadic ? '...' : ''}${parameter.name}${parameter.optional ? '?' : ''}${parameter.type ? `: ${parameter.type.text}` : ''}`;
    const definition = definitionId ? this.definitions.get(definitionId) : undefined;
    const start = definition?.outline.code.indexOf(code) ?? -1;
    const position = (offset: number) => {
      const lines = definition!.outline.code.slice(0, offset).split('\n');
      return { line: lines.length, column: lines.at(-1)!.length + 1 };
    };
    return {
      kind: 'entry', id, type: { key: 'parameter', label: 'parameter' },
      title: this.codeLabel(structured ? `${parameter.variadic ? '...' : ''}${parameter.name}${parameter.optional ? '?' : ''}` : code, symbol, symbol.language === 'typescript' && !structured ? 'interface __Refquill {\n' : undefined),
      description: this.markdown(parameter.description, symbol), display: structured ? 'disclosure' : 'static',
      ...(start >= 0 && definitionId ? { highlights: [{ definitionId, range: { start: position(start), end: position(start + code.length) } }] } : {}),
      badges: [{ label: parameter.optional ? 'optional' : 'required', type: 'requirement' }, ...(parameter.byReference ? [{ label: 'by reference', type: 'modifier' }] : [])],
      blocks: [
        ...this.signatures(callbacks, symbol, id, definitionId, parameter.description),
        ...(parameter.default == null ? [] : [section(`${id}-default`, 'Default', [{ kind: 'entry' as const, id: `${id}-default-value`, title: this.codeLabel(parameter.default, symbol), display: 'static' as const }])]),
        ...(children.length ? [section(`${id}-properties`, 'Properties', children.map((child, index) => this.parameter(child, symbol, `${id}-property-${index}`, definitionId)))] : []),
      ],
    };
  }

  private signatures(signatures: Signature[], symbol: Symbol, scope: string, definitionId?: string, headerDescription?: string): ReferenceBlock[] {
    const blocks: ReferenceBlock[] = [];
    signatures.forEach((signature, index) => {
      const signatureScope = `${scope}-signature-${index}`;
      const signatureBlocks: ReferenceBlock[] = [];
      if (signature.description !== symbol.description && signature.description !== headerDescription) signatureBlocks.push(...prose(this.markdown(signature.description, symbol)));
      if (signatures.length > 1) {
        signatureBlocks.push({ kind: 'code', definition: this.definition(symbol, signatureScope, { code: signature.declaration || symbol.declaration, memberLines: {} }) });
      }
      if (signatures.length > 1 || signatures !== symbol.signatures || !symbol.typeParameters.length) signatureBlocks.push(...this.typeParameters(signature.typeParameters, symbol, signatureScope));
      if (signature.parameters.length) signatureBlocks.push(section(`${signatureScope}-parameters`, 'Parameters', signature.parameters.map((parameter, parameterIndex) => this.parameter(parameter, symbol, `${signatureScope}-param-${parameterIndex}`, definitionId))));
      if (signature.returns) signatureBlocks.push(section(`${signatureScope}-returns`, 'Returns', [{
        kind: 'entry', id: `${signatureScope}-returns-value`, title: this.typeLabel(signature.returns.text, symbol), description: this.markdown(signature.returnsDescription, symbol), display: 'static',
      }]));
      if (signatures.length > 1) blocks.push(section(signatureScope, `Signature ${index + 1}`, signatureBlocks));
      else blocks.push(...signatureBlocks);
    });
    return blocks;
  }

  private details(symbol: Symbol, scope: string, headerDescription?: string, definitionId?: string): ReferenceBlock[] {
    const blocks: ReferenceBlock[] = [];
    const component = symbol.framework?.role === 'component' ? symbol.framework : null;
    if (component) {
      for (const [key, title] of [['props', 'Props'], ['events', 'Events'], ['slots', 'Slots'], ['exposed', 'Exposed members']] as const) {
        const values = component[key] ?? [];
        if (key === 'props' || values.length) blocks.push(section(`${scope}-${key}`, title, values.map((value, index) => ({
          ...this.parameter(value, symbol, `${scope}-${key}-${index}`, definitionId), type: { key: 'property', label: key === 'props' ? 'prop' : key === 'events' ? 'event' : key === 'slots' ? 'slot' : 'exposed member' },
          ...(key === 'props' ? {} : { badges: [] }),
        }))));
      }
    }
    if (!component && symbol.type && !symbol.signatures.length && !this.reference.getMembers(symbol.id).length) blocks.push(this.typeSection(symbol.type, symbol, scope));
    blocks.push(...this.typeParameters(symbol.typeParameters, symbol, scope));
    if (component && !symbol.typeParameters.length) blocks.push(...this.typeParameters(symbol.signatures[0]?.typeParameters ?? [], symbol, scope));
    const relations = symbol.language === 'rust' && symbol.kind === 'impl' ? symbol.relations.filter(relation => relation.kind !== 'implements') : symbol.relations;
    if (relations.length) blocks.push(section(`${scope}-relationships`, 'Relationships', relations.map((relation, index): ReferenceEntry => {
      const target = relation.targetId ? this.reference.getSymbol(relation.targetId) : undefined;
      const link = target ? { url: this.reference.getUrl(target.id), label: target.name } : this.reference.resolveLink(relation.name, { language: symbol.language, inputName: symbol.api, group: symbol.group });
      return { kind: 'entry', id: `${scope}-relationship-${index}`, title: link?.label ?? relation.name.split(/::|[\\.]/).at(-1)!, display: 'static', type: { key: relation.kind, label: label(relation.kind) }, ...(link ? { url: link.url } : {}) };
    })));
    if (!component) blocks.push(...this.signatures(symbol.signatures, symbol, scope, definitionId, headerDescription));
    const tags = symbol.tags.filter(tag => !['param', 'return', 'returns', 'var', 'template', 'remarks'].includes(tag.name));
    if (tags.length) blocks.push({ kind: 'entry', id: `${scope}-tags`, title: 'Documentation tags', display: 'disclosure', blocks: tags.map((tag, index) => ({ kind: 'entry', id: `${scope}-tag-${index}`, title: `@${tag.name}`, description: this.markdown(tag.text, symbol), display: 'static' })) });
    return blocks;
  }

  private highlights(outline: DeclarationOutline, definitionId: string, owner: string): ReferenceHighlight[] {
    return Object.entries(outline.memberLines).flatMap(([line, owners]) => owners.split(' ').includes(owner)
      ? [{ definitionId, range: { start: { line: Number(line) }, end: { line: Number(line) } } }]
      : []);
  }

  private member(member: Symbol, ownerScope: string, outline: DeclarationOutline, definitionId: string, origin?: ApiTraitMember): ReferenceEntry {
    const anchor = memberAnchor(member.id);
    const id = origin ? `${ownerScope}-trait-${anchor}` : anchor;
    const implementation = member.language === 'rust' && (member.kind === 'impl' || (member.parentId != null && this.reference.getSymbol(member.parentId).kind === 'impl'));
    const sourceUrl = member.source ? this.reference.getSourceUrl(member.source) : null;
    const blocks: ReferenceBlock[] = [
      ...(!implementation ? [{ kind: 'code' as const, definition: this.definition(member, `${ownerScope}-${id}`) }] : []),
      ...(origin ? prose(`From trait [${origin.declaringTrait.name}](${this.reference.getUrl(member.id)})`) : []),
      ...this.details(member, id, undefined, definitionId),
    ];
    {
      const ownerUrl = this.reference.getUrl(member.id).split('#')[0];
      const children = this.reference.getMembers(member.id).filter(child => this.reference.getUrl(child.id).split('#')[0] === ownerUrl);
      blocks.push(...(member.kind === 'impl'
        ? children.map(child => this.member(child, ownerScope, outline, definitionId))
        : this.memberGroups(children, id, outline, definitionId)));
    }
    return {
      kind: 'entry', id, ...(origin ? { anchor } : {}), type: { key: this.reference.getSymbolKind(member.id), label: label(this.reference.getSymbolKind(member.id)) },
      title: origin ? `${member.name} (from ${origin.declaringTrait.name})` : this.codeLabel(implementation && member.kind !== 'impl' ? member.declaration : member.name, member), description: this.markdown(member.description, member),
      ...(sourceUrl ? { sourceUrl } : {}),
      badges: this.badges(member, 'open'), display: blocks.length || member.description ? 'disclosure' : 'static',
      highlights: this.highlights(outline, definitionId, memberAnchor(origin?.usedTrait.id ?? member.id)), blocks,
    };
  }

  private memberGroups(members: Symbol[], scope: string, outline: DeclarationOutline, definitionId: string): ReferenceBlock[] {
    return (Object.keys(kindTitles) as ApiSymbolKind[]).flatMap(kind => {
      const group = members.filter(member => this.reference.getSymbolKind(member.id) === kind);
      return group.length ? [section(`${scope}-${kind}`, kindTitles[kind], group.map(member => this.member(member, scope, outline, definitionId)))] : [];
    });
  }

  private listings(symbols: Symbol[], scope: string): ReferenceBlock[] {
    return (Object.keys(kindTitles) as ApiSymbolKind[]).flatMap(kind => {
      const members = symbols.filter(symbol => this.reference.getSymbolKind(symbol.id) === kind);
      return members.length ? [section(`${scope}-${kind}`, kindTitles[kind], members.map(symbol => ({
        kind: 'entry' as const, id: `${scope}-link-${memberAnchor(symbol.id)}`, title: symbol.name,
        type: { key: kind, label: label(kind) }, display: 'static' as const, url: this.reference.getUrl(symbol.id),
        description: this.markdown(symbol.description.split(/\n\s*\n/)[0], symbol),
      })))] : [];
    });
  }

  symbol(id: string): ReferenceNode {
    const symbol = this.reference.getSymbol(id);
    if (symbol.language === 'rust' && symbol.kind === 'module') return this.namespace(this.reference.getNamespace(symbol.api, symbol.qualifiedName));
    const scope = memberAnchor(symbol.id);
    const members = this.reference.getMembers(symbol.id);
    const isDirectory = ['namespace', 'module'].includes(symbol.kind);
    const implementations = members.filter(member => member.language === 'rust' && member.kind === 'impl');
    const inlineMembers = members.filter(member => !implementations.includes(member));
    const outline = declarationOutline(symbol, members);
    const definition = this.definition(symbol, scope, outline);
    const summary = symbol.description || symbol.signatures.find(signature => signature.description)?.description || '';
    const traits = this.reference.getTraitMembers(symbol.id);
    const details = this.details(symbol, scope, summary, definition.id);
    const blocks: ReferenceBlock[] = isDirectory ? this.listings(members, scope) : [
      ...details,
      ...this.memberGroups(inlineMembers, scope, outline, definition.id),
      ...this.reference.getImplementationGroups(symbol.id).map(group => ({ ...section(`${scope}-${group.id}`, group.title, group.symbols.map(member => this.member(member, scope, outline, definition.id))), anchor: group.id })),
      ...(traits.length ? [section(`${scope}-trait-members`, 'Trait members', traits.map(origin => this.member(origin.member, scope, outline, definition.id, origin)))] : []),
    ];
    const sourceUrl = symbol.source ? this.reference.getSourceUrl(symbol.source) : null;
    const node = {
      id: `api-${encodeSegment(symbol.id)}`, title: symbol.name, type: { key: this.reference.getSymbolKind(id), label: label(this.reference.getSymbolKind(id)) },
      description: this.markdown(summary, symbol), badges: this.badges(symbol), url: this.reference.getUrl(id),
      ...(sourceUrl ? { sourceUrl } : {}),
      ...(!isDirectory ? { definition } : {}), blocks,
    };
    return isDirectory ? { ...node, kind: 'directory', children: [] } : { ...node, kind: 'page' };
  }

  namespace(namespace: ApiNamespace): ReferenceDirectory {
    const id = `namespace-${encodeSegment(JSON.stringify([namespace.inputName, namespace.segments]))}`;
    const children = [...namespace.children.map(child => this.namespace(child)), ...namespace.symbols.map(symbol => this.symbol(symbol.id))];
    const module = namespace.symbolId ? this.reference.getSymbol(namespace.symbolId) : null;
    const rust = module?.language === 'rust';
    const blocks: ReferenceBlock[] = [
      ...(namespace.children.length ? [section(`${id}-namespaces`, rust ? 'Modules' : 'Namespaces', namespace.children.map(child => ({
        kind: 'entry' as const, id: `${id}-namespace-${encodeSegment(child.name)}`, title: child.title,
        type: { key: rust ? 'module' : 'namespace', label: rust ? 'module' : 'namespace' }, display: 'static' as const,
        url: this.reference.getNamespaceUrl(child.inputName, child.name),
        description: child.symbolId ? this.markdown(this.reference.getSymbol(child.symbolId).description.split(/\n\s*\n/)[0], this.reference.getSymbol(child.symbolId)) : `${child.children.length} namespaces · ${child.symbols.length} declarations`,
      })))] : []),
      ...this.listings(namespace.symbols, id),
    ];
    const sourceUrl = module?.source ? this.reference.getSourceUrl(module.source) : null;
    return { kind: 'directory', id, title: namespace.title, type: { key: rust ? 'module' : 'namespace', label: rust ? 'module' : 'namespace' },
      ...(module ? { description: this.markdown(module.description, module), badges: this.badges(module) } : {}),
      ...(sourceUrl ? { sourceUrl } : {}),
      url: this.reference.getNamespaceUrl(namespace.inputName, namespace.name), blocks, children };
  }

  document(): ReferenceDocument {
    return { schemaVersion: 1, title: this.reference.document.title, children: [...new Set(this.reference.document.symbols.map(symbol => symbol.api))].sort()
      .map(name => this.namespace(this.reference.getNamespace(name))) };
  }

  root(): ReferenceDirectory {
    return { kind: 'directory', id: 'reference-root', title: this.reference.document.title, url: this.reference.baseUrl, blocks: [], children: this.document().children };
  }
}

export function apiReferenceDocument(reference: ApiReference): ReferenceDocument {
  return new ApiDocumentProjection(reference).document();
}
