import React, { type ReactNode } from 'react';
import { manPageEntry, type ManPageEntry, type ManPageReference as Reference } from './manpage.js';
import { ReferenceBlocks, ReferenceEntry, ReferencePage, ReferenceSection, type ReferenceSectionProps, type ReferenceRenderOptions } from './reference-components.js';

export interface ManPageReferenceProps extends Omit<ReferenceRenderOptions, 'document' | 'renderCode'> {
  reference: Reference;
  renderCode?: (text: string, language: 'text') => ReactNode;
}

const definitionSections = new Set(['FILES', 'ENVIRONMENT', 'EXIT STATUS', 'EXIT CODES']);

function ManPageSection({ section, ...options }: ReferenceSectionProps) {
  if (!definitionSections.has(section.title.toUpperCase())) return <ReferenceSection section={section} {...options} />;
  const content: ReactNode[] = [];
  for (let index = 0; index < section.blocks.length;) {
    const block = section.blocks[index];
    if (block.kind !== 'entry' || block.display !== 'static' || block.type?.key !== 'term') {
      content.push(<ReferenceBlocks key={index} blocks={[block]} {...options} depth={(options.depth ?? 2) + 1} />);
      index++;
      continue;
    }
    const entries = [];
    while (index < section.blocks.length) {
      const entry = section.blocks[index];
      if (entry.kind !== 'entry' || entry.display !== 'static' || entry.type?.key !== 'term') break;
      entries.push(<div key={entry.id} id={entry.anchor ?? entry.id}>
        <dt><code>{typeof entry.title === 'string' ? entry.title : entry.title.code}</code></dt>
        <dd><ReferenceBlocks blocks={entry.blocks ?? []} {...options} depth={(options.depth ?? 2) + 2} /></dd>
      </div>);
      index++;
    }
    content.push(<dl key={block.id} className="refquill-man-definitions">{entries}</dl>);
  }
  return <ReferenceSection section={section} {...options}>{content}</ReferenceSection>;
}

/** The standalone options component shares the page entry renderer. */
export function ManPageOptions({ entries, renderCode, ...options }: { entries: ManPageEntry[] } & Pick<ManPageReferenceProps, 'renderLink' | 'renderBadge' | 'renderCode' | 'icons' | 'components'>) {
  return <div className="refquill-members refquill-man-options">
    {entries.map(entry => <ReferenceEntry key={entry.id} entry={manPageEntry(entry, true)} {...options}
      renderCode={renderCode ? text => renderCode(text, 'text') : undefined} />)}
  </div>;
}

/** Manual sections, terms, options, and examples use the common document renderer. */
export function ManPageReference({ reference, renderCode, components, ...options }: ManPageReferenceProps) {
  const document = reference.toReferenceDocument();
  return <ReferencePage document={document} page={document.children[0]} {...options} components={{ Section: ManPageSection, ...components }}
    renderCode={renderCode ? text => renderCode(text, 'text') : undefined} />;
}
