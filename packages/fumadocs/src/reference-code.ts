import type { ShikiTransformer } from 'shiki';
import type { ReferenceHighlight, ReferenceDefinition } from '@nickwelsh/refquill-schema';

export type ReferenceHighlights = Record<string, ReferenceHighlight[]>;

/** Split highlighted syntax tokens at ownership boundaries, retaining their
 * syntax styles, links and exact source text. Columns are UTF-16 and one-based. */
export function referenceHighlightTransformer(definitionId: string, highlights: ReferenceHighlights): ShikiTransformer {
  const ranges: ({ owner: string } & ReferenceHighlight['range'])[] = [];
  let references = 0;
  for (const [owner, values] of Object.entries(highlights)) for (const value of values) {
    if (++references > 1_000_000) throw new Error('Reference highlight ownership limit exceeded');
    if (value.definitionId === definitionId) ranges.push({ owner, ...value.range });
  }
  const starts = [...ranges].sort((a, b) => a.start.line - b.start.line);
  const ends = [...ranges].sort((a, b) => a.end.line - b.end.line);
  const active = new Set<typeof ranges[number]>();
  let from = 0, to = 0, previous = 0, assignments = 0;
  return {
    name: 'refquill-reference-ranges',
    line(node, line) {
      if (line <= previous) { from = 0; to = 0; assignments = 0; active.clear(); }
      previous = line;
      while (from < starts.length && starts[from].start.line <= line) active.add(starts[from++]);
      while (to < ends.length && ends[to].end.line < line) active.delete(ends[to++]);
      const intervals: { start: number; end: number; owner: string; whole: boolean }[] = [];
      for (const { owner, start, end } of active) {
        if (++assignments > 1_000_000) throw new Error('Reference highlight ownership limit exceeded');
        const a = line === start.line && start.column != null ? start.column - 1 : 0;
        const b = line === end.line && end.column != null ? end.column - 1 : Infinity;
        if (a < b) intervals.push({ start: a, end: b, owner, whole: start.column == null });
      }
      const whole = [...new Set(intervals.filter(range => range.whole).map(range => range.owner))];
      if (whole.length) node.properties['data-reference-declaration'] = whole.join(' ');
      if (!intervals.some(range => !range.whole)) return;
      let offset = 0;
      const split = (parent: any) => {
        parent.children = parent.children.flatMap((child: any) => {
          if (child.type !== 'text') { if (child.children) split(child); return [child]; }
          const from = offset, to = offset += child.value.length;
          const partial = intervals.filter(range => !range.whole && range.start < to && range.end > from);
          const boundaries = [...new Set([from, to, ...partial.flatMap(range => [Math.max(from, range.start), Math.min(to, range.end)])])].sort((a, b) => a - b);
          return boundaries.slice(0, -1).map((a, index) => {
            const b = boundaries[index + 1];
            const value = { type: 'text', value: child.value.slice(a - from, b - from) };
            const owners = [...new Set(partial.filter(range => range.start < b && range.end > a).map(range => range.owner))];
            return owners.length ? { type: 'element', tagName: 'span', properties: { 'data-reference-declaration': owners.join(' '), 'data-reference-range': '' }, children: [value] } : value;
          });
        });
      };
      split(node);
    },
  };
}
export function referenceMemberLines(definitionId: string, highlights: ReferenceHighlights): Record<number, string> {
  const result: Record<number, string> = {};
  let assignments = 0;
  for (const [owner, ranges] of Object.entries(highlights)) for (const range of ranges) {
    if (range.definitionId !== definitionId) continue;
    for (let line = range.range.start.line; line <= range.range.end.line; line++) {
      if (++assignments > 1_000_000) throw new Error('Reference highlight ownership limit exceeded');
      if (range.range.end.column === 1 && range.range.start.column != null && line === range.range.end.line) continue;
      result[line] = [...new Set([...(result[line]?.split(' ') ?? []), owner])].join(' ');
    }
  }
  return result;
}

export function referenceLinkTransformer(code: string, links: ReferenceDefinition['links'], urls?: ReadonlyMap<string, string>): ShikiTransformer {
  const ordered = [...(links ?? [])].sort((a, b) => a.start - b.start);
  let linkIndex = 0, previousLine = 0;
  const lines = code.split(/\r\n|\r|\n/);
  const starts: number[] = [];
  let offset = 0;
  for (const line of code.split(/(?<=\n)|(?<=\r)(?!\n)/)) { starts.push(offset); offset += line.length; }
  return {
    name: 'refquill-document-code-links',
    line(node, number) {
      if (number <= previousLine) linkIndex = 0;
      previousLine = number;
      let cursor = starts[number - 1] ?? 0;
      const end = cursor + (lines[number - 1]?.length ?? 0);
      while (linkIndex < ordered.length && ordered[linkIndex].end <= cursor) linkIndex++;
      const matches: typeof ordered = [];
      for (let index = linkIndex; index < ordered.length && ordered[index].start < end; index++) matches.push(ordered[index]);
      if (!matches.length) return;
      type Piece = { link: (NonNullable<ReferenceDefinition['links']>)[number] | undefined; node: any };
      const group = (pieces: Piece[]) => {
        const groups: { link: Piece['link']; children: any[] }[] = [];
        for (const piece of pieces) {
          const previous = groups.at(-1);
          if (previous && previous.link === piece.link) previous.children.push(piece.node);
          else groups.push({ link: piece.link, children: [piece.node] });
        }
        return groups;
      };
      const split = (child: any): Piece[] => {
          if (child.type !== 'text') {
            if (!child.children) return [{ node: child, link: undefined }];
            return group(child.children.flatMap(split)).map(part => ({ link: part.link, node: { ...child, children: part.children } }));
          }
          const start = cursor, finish = cursor += child.value.length;
          const cuts = [...new Set([start, finish, ...matches.flatMap(link => [Math.max(start, Math.min(finish, link.start)), Math.max(start, Math.min(finish, link.end))])])].sort((a, b) => a - b);
          return cuts.slice(0, -1).map((a, index) => {
            const b = cuts[index + 1];
            const text = { type: 'text', value: child.value.slice(a - start, b - start) };
            const link = matches.find(link => link.start <= a && link.end >= b);
            return { link, node: text };
          });
      };
      node.children = group(node.children.flatMap(split)).flatMap(part => {
        const link = part.link;
        const href = link && (link.url ?? (link.targetId ? urls?.get(link.targetId) : undefined));
        return href ? [{ type: 'element', tagName: 'a', properties: { href, className: ['refquill-code-link'], 'data-reference-name': code.slice(link!.start, link!.end) }, children: part.children }] : part.children;
      });
    },
  };
}
