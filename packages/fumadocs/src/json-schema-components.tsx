import React, { type ReactNode } from 'react';
import type { JsonSchemaReference as Reference } from './json-schema.js';
import { ReferencePage, type ReferenceRenderOptions } from './reference-components.js';
import type { BadgeRenderer } from './reference-ui.js';

export interface JsonSchemaReferenceHeaderProps {
  reference: Reference;
  title: string;
  description: ReactNode;
  sourceUrl: string | null;
  badges: ReactNode;
}
export interface JsonSchemaReferenceProps extends Omit<ReferenceRenderOptions, 'document' | 'renderHeader' | 'renderBadge' | 'renderCode'> {
  reference: Reference;
  renderHeader?: (props: JsonSchemaReferenceHeaderProps) => ReactNode;
  renderBadge?: BadgeRenderer;
  renderCode?: (code: string, language: 'json', options: { memberLines: Record<number, string> }) => ReactNode;
}

/** JSON Schema contributes content; shared primitives own its layout and interactions. */
export function JsonSchemaReference({ reference, renderHeader, renderBadge, renderCode, ...options }: JsonSchemaReferenceProps) {
  const document = reference.toReferenceDocument();
  return <ReferencePage document={document} page={document.children[0]} {...options}
    renderHeader={renderHeader ? props => renderHeader({ reference, title: props.title, description: props.description, sourceUrl: props.sourceUrl, badges: props.badges }) : undefined}
    renderBadge={renderBadge ? badge => renderBadge({ label: badge.label, category: badge.category === 'kind' || badge.category === 'deprecated' ? badge.category : 'modifier' }) : undefined}
    renderCode={renderCode ? (code, language, options) => options.definition.id === 'schema-source'
      ? renderCode(code, 'json', { memberLines: reference.memberLines }) : undefined : undefined}
  />;
}
