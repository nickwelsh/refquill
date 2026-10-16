import React, { Fragment, type ReactNode } from 'react';
import { jsx, jsxs } from 'react/jsx-runtime';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { Box, Braces, Layers, ListTree, SquareFunction, Variable, CircleDot, FolderCode, FileType, Hash, ChevronRight, OctagonAlert, Component, Webhook } from 'lucide-react';
import { CodeBlock, Pre } from 'fumadocs-ui/components/codeblock';
import type { ReferenceDefinition as DefinitionModel, RelationKind, Symbol } from '@nickwelsh/refquill-schema';
import { transformerApiReference, type ApiReference as ApiReferenceModel, type ApiNamespace, type ApiSymbolKind } from './index.js';
import { ApiDocumentProjection } from './api-document.js';
import { ReferencePage, type ReferenceRenderOptions } from './reference-components.js';
import { referenceHighlightTransformer, type ReferenceHighlights } from './reference-code.js';
import { highlighter } from './code-highlighter.js';
import { ReferenceLink } from './reference-ui.js';
export * from './reference-components.js';
export { JsonSchemaReference, type JsonSchemaReferenceProps, type JsonSchemaReferenceHeaderProps } from './json-schema-components.js';
export { ManPageReference, ManPageOptions, type ManPageReferenceProps } from './manpage-components.js';

export interface ApiReferenceBadge {
  label: string;
  category: 'kind' | 'modifier' | 'deprecated';
}

export interface ApiReferenceHeaderProps {
  reference: ApiReferenceModel;
  title: string;
  description: ReactNode;
  symbol: Symbol | null;
  namespace: ApiNamespace | null;
  sourceUrl: string | null;
  badges: ReactNode;
}

export type ApiReferenceIcons = Partial<Record<ApiSymbolKind | RelationKind | 'parameter' | 'type-parameter' | 'chevron-right' | 'generic' | 'intersection' | 'type-alternative', React.ComponentType<React.SVGProps<SVGSVGElement>>>>;

export interface ApiReferenceProps {
  reference: ApiReferenceModel;
  symbolId?: string | null;
  inputName?: string | null;
  namespace?: string | null;
  /** Override individual Lucide defaults for API kinds and disclosure arrows. */
  icons?: ApiReferenceIcons;
  components?: ReferenceRenderOptions['components'];
  renderHeader?: (props: ApiReferenceHeaderProps) => ReactNode;
  renderBadge?: (badge: ApiReferenceBadge) => ReactNode;
  /** Replace all documentation links, including linked inline types and snippets. */
  renderLink?: (props: React.ComponentProps<'a'>) => ReactNode;
  /** Existing renderers can keep two arguments. Preserve memberLines and use
   * transformerApiReference in custom highlighting for links and interaction.
   * Values are whitespace-separated anchors when a line has multiple owners. */
  renderCode?: (declaration: string, language: Symbol['language'], options: { memberLines: Record<number, string>; symbol: Symbol; definition: DefinitionModel; highlights: ReferenceHighlights }) => ReactNode;
}

export const defaultApiReferenceIcons = { 'react-component': Component, 'react-hook': Webhook, 'vue-component': Component, 'svelte-component': Component, 'solid-component': Component, class: Box, exception: OctagonAlert, interface: Braces, trait: Layers, enum: ListTree, 'enum-case': CircleDot, function: SquareFunction, method: SquareFunction, constructor: SquareFunction, property: Variable, constant: Hash, variable: Variable, 'type-alias': FileType, namespace: FolderCode, module: FolderCode, accessor: Variable, struct: Box, union: Layers, impl: Braces, macro: SquareFunction, primitive: FileType, 'extern-type': FileType, reexport: FileType, 'trait-alias': Layers, field: Variable, variant: CircleDot, 'enum-member': CircleDot, 'associated-function': SquareFunction, 'associated-type': FileType, 'associated-constant': Hash, static: Variable, parameter: Variable, 'type-parameter': FileType, generic: FileType, intersection: Layers, 'type-alternative': CircleDot, extends: Layers, implements: Braces, uses: Layers, 'inherited-from': Layers, overrides: SquareFunction, reexports: FileType, 'chevron-right': ChevronRight } satisfies Required<ApiReferenceIcons>;

function referenceIcon(name: keyof typeof defaultApiReferenceIcons, icons?: ApiReferenceIcons) {
  return (icons && Object.hasOwn(icons, name) ? icons[name] : undefined) ?? defaultApiReferenceIcons[name];
}

export function ApiKindIcon({ kind, icons }: { kind: ApiSymbolKind; icons?: ApiReferenceIcons }) {
  const Icon = referenceIcon(kind, icons);
  return <Icon className="refquill-kind-icon" data-kind={kind} aria-label={kind.replaceAll('-', ' ')} role="img" />;
}

/** Pass directly as the Fumadocs loader's icon resolver, or wrap to supply overrides. */
export function apiReferenceIcon(value: string | undefined, icons?: ApiReferenceIcons) {
  const kind = value?.startsWith('refquill-') ? value.slice('refquill-'.length) : '';
  return kind !== 'chevron-right' && Object.hasOwn(defaultApiReferenceIcons, kind) ? <ApiKindIcon icons={icons} kind={kind as ApiSymbolKind} /> : undefined;
}

/** A complete API reference page, projected through the shared rendering model.
 * The wrapper retains API-specific hook context for existing integrations. */
export function ApiReference({ reference, symbolId, inputName, namespace, renderCode, renderHeader, renderBadge, renderLink, icons, components }: ApiReferenceProps) {
  const projection = new ApiDocumentProjection(reference);
  const selectedNamespace = !symbolId && inputName != null ? reference.getNamespace(inputName, namespace ?? '') : null;
  const symbol = symbolId ? reference.getSymbol(symbolId) : null;
  const page = symbol ? projection.symbol(symbol.id) : selectedNamespace ? projection.namespace(selectedNamespace) : projection.root();
  return <ReferencePage page={page} icons={{ ...defaultApiReferenceIcons, ...icons }} renderLink={renderLink} components={components}
    renderHeader={renderHeader ? props => renderHeader({ reference, title: props.title, description: props.description,
      symbol, namespace: selectedNamespace, sourceUrl: props.sourceUrl, badges: props.badges }) : undefined}
    renderBadge={renderBadge ? badge => renderBadge({ label: badge.label,
      category: badge.category === 'kind' || badge.category === 'deprecated' ? badge.category : 'modifier' }) : undefined}
    renderCode={(code, language, options) => {
      const context = projection.definitions.get(options.definition.id);
      if (!context) return null;
      const custom = renderCode?.(code, context.symbol.language, { memberLines: options.memberLines, symbol: context.symbol, definition: options.definition, highlights: options.highlights });
      if (custom != null) return custom;
      const tree = highlighter.codeToHast(code, {
        lang: language, themes: { light: 'github-light', dark: 'github-dark' }, defaultColor: false,
        meta: { __raw: 'api' }, transformers: [
          transformerApiReference(reference.resolveLink, { inputName: context.symbol.api, group: context.symbol.group, symbolId: context.symbol.id }),
          referenceHighlightTransformer(options.definition.id, options.highlights),
        ],
      });
      return <CodeBlock title="Definition">{toJsxRuntime(tree, { Fragment, jsx, jsxs, components: {
        a: props => <ReferenceLink {...props} renderLink={renderLink} />,
        pre: ({ children, ...props }) => <Pre {...props}>{children}</Pre>,
      } })}</CodeBlock>;
    }} />;
}
