import type { ReferenceBlock, ReferenceDocument, ReferenceEntry, ReferenceSection } from '@nickwelsh/refquill-schema';
import type { MetaData, StaticSource } from 'fumadocs-core/source';
import type { TOCItemType } from 'fumadocs-core/toc';
import { collectReferencePage } from './reference.js';
import { safeUrl } from './code.js';
import { referenceBaseUrl } from './paths.js';

export type ManPageContent = { type: 'paragraph'; text: string } | { type: 'code'; text: string };
export interface ManPageEntry {
  id: string;
  term: string;
  content: ManPageContent[];
}
export type ManPageBlock = ManPageContent | { type: 'entries'; options: boolean; entries: ManPageEntry[] };
export interface ManPageSection {
  id: string;
  title: string;
  depth: 2 | 3;
  blocks: ManPageBlock[];
}
export interface ManPageDocument {
  name: string;
  manualSection: string;
  date: string;
  source: string;
  manual: string;
  sections: ManPageSection[];
}
export interface ManPagePageData {
  title: string;
  description: string;
  toc: TOCItemType[];
  structuredData: {
    headings: { id: string; content: string }[];
    contents: { heading: string | undefined; content: string }[];
  };
}
export interface ManPageReference {
  document: ManPageDocument;
  title: string;
  baseUrl: string;
  sourceUrl: string | null;
  /** The original text, without executing roff requests or compiling MDX. */
  input: string;
  toReferenceDocument(): ReferenceDocument;
  getPageText(): string;
  toFumadocsSource(): Pick<StaticSource<{ pageData: ManPagePageData; metaData: MetaData }>, 'files'>;
}

const escapeMarkdown = (text: string): string => text.replace(/[\\`*_[\]{}<>#|]/g, '\\$&');
const plain = (text: string): string => text.replace(/\\([\\`*_[\]{}<>#|])/g, '$1').replace(/\*\*|\*/g, '');

/** Decode the common man(7) text escapes, never evaluate strings or requests. */
function roffText(text: string, markdown = true): string {
  const characters: Record<string, string> = { em: '—', en: '–', hy: '-', mi: '−', dq: '"', aq: "'", lq: '“', rq: '”', oq: '‘', cq: '’', bu: '•', co: '©', rg: '®', tm: '™', rs: '\\', ti: '~', ua: '↑', ra: '→', la: '←', le: '≤', ge: '≥' };
  text = text.replace(/\\".*$/, '').replace(/\\\((..)|\\\[([^\]]+)\]/g, (match, short: string, long: string) => characters[short ?? long] ?? match)
    .replace(/\\f(?:\[[^\]]*\]|\(..|.)/g, '').replace(/\\s[+-]?\d+/g, '')
    .replace(/\\[&%]/g, '').replace(/\\-/g, '-').replace(/\\[ ~]/g, ' ').replace(/\\e|\\\\/g, '\\');
  return markdown ? escapeMarkdown(text) : text;
}

function argumentsOf(text: string): string[] {
  return Array.from(text.matchAll(/"([^"]*)"|(\S+)/g), match => match[1] ?? match[2]);
}

function parseManPage(input: string, format: 'roff' | 'text'): ManPageDocument {
  const document: ManPageDocument = { name: '', manualSection: '', date: '', source: '', manual: '', sections: [] };
  const ids = new Set<string>();
  const suffixes = new Map<string, number>();
  function anchor(value: string): string {
    const base = `man-${value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section'}`;
    let id = base;
    let suffix = suffixes.get(base) ?? 2;
    while (ids.has(id)) id = `${base}-${suffix++}`;
    suffixes.set(base, suffix);
    ids.add(id);
    return id;
  }
  let section: ManPageSection | undefined;
  let entry: ManPageEntry | undefined;
  let pending: string[] = [];
  let literal = false;
  let tag = false;
  let alias = false;
  let url: string | undefined;
  function flush() {
    if (!pending.length) return;
    if (!section) throw new Error('Manpage content must follow a section heading');
    const block: ManPageContent = literal ? { type: 'code', text: pending.join('\n') } : { type: 'paragraph', text: pending.join(' ').trim() };
    (entry?.content ?? section.blocks).push(block);
    pending = [];
  }
  function heading(title: string, depth: 2 | 3) {
    if (literal || tag || url) throw new Error('Unclosed manpage literal, tag, or link');
    flush();
    entry = undefined;
    tag = alias = false;
    section = { id: anchor(title), title, depth, blocks: [] };
    document.sections.push(section);
  }
  function term(value: string) {
    if (!section) throw new Error('Manpage entry must follow a section heading');
    flush();
    if (alias && entry) {
      entry.term += `, ${value}`;
    } else {
      entry = { id: anchor(`${section.title}-${value}`), term: value, content: [] };
      const options = /^-{1,2}\S/.test(value);
      const last = section.blocks.at(-1);
      if (last?.type === 'entries' && last.options === options) last.entries.push(entry);
      else section.blocks.push({ type: 'entries', options, entries: [entry] });
    }
    tag = alias = false;
  }
  const lines = input.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length > 50_000) throw new Error('Manpage exceeds rendering limits');
  if (format === 'text') {
    // Accept `MANWIDTH=80 man ... | col -b` output: headings at column zero,
    // terms at seven columns and definitions indented further. No inference
    // is attempted for arbitrary prose or differently formatted terminal output.
    let termIndent: number | undefined;
    for (const raw of lines) {
      const line = raw.replace(/.\x08/g, '').replace(/\x1b\[[0-9;]*m/g, '');
      const header = line.match(/^\s*([\w.+-]+)\((\w+)\).*\1\(\2\)\s*$/);
      if (header) { document.name ||= header[1]; document.manualSection ||= header[2]; continue; }
      if (!line.trim()) { flush(); continue; }
      if (/^[A-Z][A-Z\d /&(),_-]*$/.test(line)) { heading(line.trim(), 2); termIndent = undefined; continue; }
      if (!section) continue;
      const indent = line.length - line.trimStart().length;
      if ((/^-{1,2}\S/.test(line.trim()) || /^(PROTOCOLS|ENVIRONMENT|FILES|EXIT (STATUS|CODES))$/.test(section.title)) && indent === 7) {
        term(line.trim()); termIndent = indent; continue;
      }
      if (termIndent != null && indent > termIndent && /^\s*(?:\$ |refquill |curl )/.test(line)) {
        flush(); literal = true; pending.push(line.trimStart()); flush(); literal = false;
      } else pending.push(escapeMarkdown(line.trim()));
    }
  } else {
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (/^[.']\\"/.test(line)) continue;
      const request = line.match(/^[.'](\S+)(?:\s+(.*))?$/);
      if (!request) {
        if (tag && line.trim()) term(roffText(line, false));
        else if (literal) pending.push(roffText(line, false));
        else if (!line.trim()) flush();
        else pending.push(roffText(line));
        continue;
      }
      const [, macro, args = ''] = request;
      const values = argumentsOf(args);
      const fail = () => { throw new Error(`Unsupported manpage request .${macro} at line ${index + 1}; supply rendered text for other macro packages`); };
      if (!values.length && ['SH', 'SS', 'B', 'I', 'SM', 'SB', 'BR', 'BI', 'IB', 'IR', 'RB', 'RI'].includes(macro)) {
        const next = lines[++index];
        if (!next?.trim() || /^[.']/.test(next)) throw new Error(`Missing text for manpage request .${macro} at line ${index}`);
        values.push(next.trim());
      }
      if (macro === 'TH') {
        [document.name, document.manualSection, document.date, document.source, document.manual] = Array.from({ length: 5 }, (_, i) => roffText(values[i] ?? '', false));
      } else if (macro === 'SH' || macro === 'SS') heading(roffText(values.join(' '), false), macro === 'SH' ? 2 : 3);
      else if (macro === 'TP' || macro === 'TQ') { flush(); tag = true; alias = macro === 'TQ'; }
      else if (macro === 'IP') {
        if (values[0]) term(roffText(values[0], false));
        else flush();
      } else if (['PP', 'P', 'LP', 'sp', 'br'].includes(macro)) flush();
      else if (macro === 'EX' || macro === 'nf') { flush(); literal = true; }
      else if (macro === 'EE' || macro === 'fi') { flush(); literal = false; }
      else if (['B', 'I', 'SM', 'SB', 'BR', 'BI', 'IB', 'IR', 'RB', 'RI'].includes(macro)) {
        const text = roffText(values.join(macro.length === 2 && !['SM', 'SB'].includes(macro) ? '' : ' '), false);
        if (tag) term(text);
        else if (literal) pending.push(text);
        else pending.push(macro === 'B' || macro === 'SB' ? `**${escapeMarkdown(text)}**` : macro === 'I' ? `*${escapeMarkdown(text)}*` : escapeMarkdown(text));
      } else if (macro === 'UR' || macro === 'MT') {
        if (url) fail();
        url = macro === 'MT' ? `mailto:${values[0] ?? ''}` : values[0];
        if (!url || !safeUrl(url)) throw new Error(`Unsafe manpage link at line ${index + 1}`);
        flush();
      } else if (macro === 'UE' || macro === 'ME') {
        if (!url) fail();
        const label = pending.join(' ') || escapeMarkdown(url!);
        pending = [`[${label}](<${url!.replace(/[<>\s\\]/g, c => encodeURIComponent(c))}>)${roffText(args)}`];
        url = undefined;
      } else if (['RS', 'RE', 'PD', 'ad', 'na', 'nh', 'hy', 'ft', 'ne', 'in', 'll'].includes(macro)) {
        // These control terminal layout, not document content.
      } else fail();
    }
  }
  flush();
  if (literal || tag || url) throw new Error('Unclosed manpage literal, tag, or link');
  if (!document.sections.length) throw new Error('Manpage must contain section headings');
  const name = document.sections.find(section => section.title.toUpperCase() === 'NAME');
  if (!document.name && name?.blocks[0]?.type === 'paragraph') document.name = plain(name.blocks[0].text).split(/\s+[−–—-]\s+/)[0];
  document.name ||= 'Manual';
  return document;
}

/** Project parsed manual content into the same primitives used by every reference format. */
function referenceContent(content: ManPageContent[], ownerId: string): ReferenceBlock[] {
  return content.map((block, index) => block.type === 'paragraph'
    ? { kind: 'markdown', value: block.text }
    : { kind: 'code', definition: { id: `man-code:${ownerId}:${index}`, language: 'text', code: block.text } });
}

export function manPageEntry(entry: ManPageEntry, disclosure: boolean): ReferenceEntry {
  return { kind: 'entry', id: entry.id, type: { key: disclosure ? 'option' : 'term', label: disclosure ? 'Option' : 'Term' },
    title: { code: entry.term, language: 'text' }, display: disclosure && entry.content.length ? 'disclosure' : 'static',
    blocks: referenceContent(entry.content, entry.id),
  };
}

// Conventional man(7) section names are uppercase for terminal output. Keep
// parsed source and anchors intact while using sentence case in web references.
const sectionTitles = new Map([
  ['NAME', 'Name'], ['SYNOPSIS', 'Synopsis'], ['DESCRIPTION', 'Description'],
  ['COMMANDS', 'Commands'], ['OPTIONS', 'Options'], ['ARGUMENTS', 'Arguments'],
  ['FILES', 'Files'], ['ENVIRONMENT', 'Environment'], ['EXIT STATUS', 'Exit status'],
  ['EXIT CODES', 'Exit codes'], ['EXAMPLES', 'Examples'], ['SEE ALSO', 'See also'],
  ['AUTHORS', 'Authors'], ['BUGS', 'Bugs'], ['NOTES', 'Notes'],
]);

/** Adapt man(7) roff or conventional rendered man text to a single Fumadocs page. */
export function createManPageReference({ input, format, title, baseUrl = '/cli', sourceUrl }: {
  input: string;
  format?: 'roff' | 'text';
  title?: string;
  baseUrl?: string;
  sourceUrl?: string;
}): ManPageReference {
  if (typeof input !== 'string' || input.length > 2_000_000) throw new Error('Manpage must be text within rendering limits');
  if (format != null && format !== 'roff' && format !== 'text') throw new Error('Unknown manpage format');
  baseUrl = referenceBaseUrl(baseUrl);
  if (sourceUrl != null && (!/^https?:\/\//.test(sourceUrl) || !safeUrl(sourceUrl) || !URL.canParse(sourceUrl))) throw new Error('sourceUrl must be an HTTP(S) URL');
  const document = parseManPage(input, format ?? (/^[.']TH\s/m.test(input) ? 'roff' : 'text'));
  title ??= `${document.name}${document.manualSection ? `(${document.manualSection})` : ''}`;
  const name = document.sections.find(section => section.title.toUpperCase() === 'NAME');
  const description = name?.blocks[0]?.type === 'paragraph' ? plain(name.blocks[0].text) : '';
  const reference: ManPageReference = {
    input, document, title, baseUrl, sourceUrl: sourceUrl ?? null,
    toReferenceDocument() {
      const blocks: ReferenceBlock[] = [];
      let parent: ReferenceSection | undefined;
      for (const section of document.sections) {
        const content = section === name && section.blocks[0]?.type === 'paragraph' ? section.blocks.slice(1) : section.blocks;
        if (section === name && !content.length) continue;
        const block: ReferenceSection = { kind: 'section', id: section.id, title: sectionTitles.get(section.title) ?? section.title,
          blocks: content.flatMap((block, index) => block.type === 'entries'
            ? block.entries.map(entry => manPageEntry(entry, block.options))
            : referenceContent([block], `${section.id}:${index}`)),
        };
        if (section.depth === 3 && parent) parent.blocks.push(block);
        else { blocks.push(block); if (section.depth === 2) parent = block; }
      }
      return { schemaVersion: 1, title: reference.title, children: [{ kind: 'page', id: 'manpage', title: reference.title,
        ...(name?.blocks[0]?.type === 'paragraph' ? { description: name.blocks[0].text } : {}),
        type: { key: 'manpage', label: document.manual || 'Manual' },
        badges: [document.source, document.date].filter(Boolean).map(label => ({ label, type: 'modifier' })),
        url: baseUrl, ...(sourceUrl ? { sourceUrl } : {}), blocks,
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
