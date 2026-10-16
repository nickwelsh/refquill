/** Portable rendering contract, independent of the semantic analyzer schema. */
export interface ReferenceTypeLabel { key: string; label: string }
export type ReferenceCodeLink = { start: number; end: number } & (
  | { targetId: string; url?: never }
  | { url: string; targetId?: never }
);
/** contextCode supplies preceding syntax for highlighting a fragment. It is not
 * displayed and does not count toward link offsets. */
export type ReferenceLabel = string | { code: string; language: string; contextCode?: string; links?: ReferenceCodeLink[] };
export interface ReferenceBadge { label: string; type?: string; visibility?: 'open' | 'closed' | 'both' }
export interface ReferenceDefinition { id: string; language: string; code: string; links?: ReferenceCodeLink[] }
/** One-based lines and UTF-16 columns. Omit both columns for inclusive whole lines.
 * With columns, the end position is exclusive, and length + 1 is a valid column. */
export interface ReferenceHighlight {
  definitionId: string;
  range: { start: ReferencePosition; end: ReferencePosition };
}
export interface ReferencePosition { line: number; column?: number }
export interface ReferencePageContent {
  id: string;
  title: string;
  type?: ReferenceTypeLabel;
  description?: string;
  badges?: ReferenceBadge[];
  definition?: ReferenceDefinition;
  blocks: ReferenceBlock[];
  url?: string;
  sourceUrl?: string;
}
export type ReferenceNode = ReferenceDirectory | ReferencePage;
export interface ReferenceDirectory extends ReferencePageContent { kind: 'directory'; children: ReferenceNode[] }
export interface ReferencePage extends ReferencePageContent { kind: 'page' }
export interface ReferenceSection { kind: 'section'; id: string; anchor?: string; title: string; description?: string; blocks: ReferenceBlock[] }
export interface ReferenceEntry {
  kind: 'entry';
  id: string;
  anchor?: string;
  type?: ReferenceTypeLabel;
  title: ReferenceLabel;
  description?: string;
  badges?: ReferenceBadge[];
  display: 'static' | 'disclosure';
  defaultOpen?: boolean;
  highlights?: ReferenceHighlight[];
  blocks?: ReferenceBlock[];
  url?: string;
  sourceUrl?: string;
}
export interface ReferenceMarkdown { kind: 'markdown'; value: string }
export interface ReferenceCode { kind: 'code'; definition: ReferenceDefinition }
export type ReferenceBlock = ReferenceSection | ReferenceEntry | ReferenceMarkdown | ReferenceCode;
export interface ReferenceDocument { schemaVersion: 1; title: string; children: ReferenceNode[] }
/** Validate untrusted JSON shape, bounds, identities, links, and code ranges. */
export declare function parseReferenceDocument(input: unknown): ReferenceDocument;
