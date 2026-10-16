import type { ShikiTransformer, ThemedToken } from 'shiki';
import type { Reference } from '@nickwelsh/refquill-schema';

/** A resolved type name, its displayed label, and its safe destination. */
export interface CodeLink { name: string; label: string; url: string }
/** Language and optional input/group scope used to disambiguate a name. */
export interface LinkContext { language: 'php' | 'typescript' | 'rust'; inputName?: string; group?: string; symbolId?: string; reference?: Reference }
export type ResolveCodeLink = (name: string, context: LinkContext) => CodeLink | null;

/** Accept HTTP and HTTPS URLs, local absolute paths, or fragments without whitespace or backslashes. */
export function safeUrl(url: string): boolean {
  return /^(?:https?:\/\/|\/(?!\/)|#)/.test(url) && !/[\s\\\u0000-\u001f\u007f]/.test(url);
}

interface LinkedToken extends ThemedToken { referenceLink?: CodeLink; referencePrefix?: string }

/** Only api-marked snippets participate. Shiki scopes protect strings and
 * comments; exact qualified lookup prevents linking unknown namespace suffixes. */
export function transformerApiReference(resolve: ResolveCodeLink, context: Omit<LinkContext, 'language'> = {}): ShikiTransformer {
  const enabled = (options: { lang?: string; meta?: { __raw?: string } }) =>
    ['php', 'php-html', 'typescript', 'ts', 'tsx', 'rust', 'rs'].includes(options.lang ?? '') && /(?:^|\s)api(?:\s|$)/.test(options.meta?.__raw ?? '');
  return {
    name: 'refquill-api-reference',
    preprocess(_code, options) { if (enabled(options)) options.includeExplanation = true; },
    tokens(lines) {
      if (!enabled(this.options)) return;
      const language = this.options.lang.startsWith('php') ? 'php' : ['rust', 'rs'].includes(this.options.lang) ? 'rust' : 'typescript';
      const matches = lines.map(tokens => {
        let cursor = 0;
        const forbidden: [number, number][] = [];
        const rustKeywords: [number, number][] = [];
        const text = tokens.map(token => {
          let at = cursor;
          for (const explanation of token.explanation ?? []) {
            if (explanation.scopes.some(({ scopeName }) => /^(string|comment)(?:\.|$)/.test(scopeName) || scopeName.includes('heredoc') || (language === 'typescript' && scopeName.startsWith('variable.')))) forbidden.push([at, at + explanation.content.length]);
            if (language === 'rust' && explanation.scopes.some(({ scopeName }) => /^(?:keyword\.|storage\.modifier\.)/.test(scopeName))) rustKeywords.push([at, at + explanation.content.length]);
            at += explanation.content.length;
          }
          cursor += token.content.length;
          return token.content;
        }).join('');
        const references: { start: number; end: number; link: CodeLink }[] = [];
        const names = language === 'php'
          ? /\\?[\p{L}_][\p{L}\p{N}_]*(?:-[\p{L}_][\p{L}\p{N}_]*)*(?:\\[\p{L}_][\p{L}\p{N}_]*)*(?:::\$?[\p{L}_][\p{L}\p{N}_]*)?/gu
          : language === 'rust'
          ? /(?:\$crate|(?:r#)?[\p{L}_][\p{L}\p{N}_]*)(?:::(?:r#)?[\p{L}_][\p{L}\p{N}_]*)*!?/gu
          : /[\p{L}_$][\p{L}\p{N}_$]*(?:\.[\p{L}_$][\p{L}\p{N}_$]*)*/gu;
        for (const match of text.matchAll(names)) {
          const start = match.index;
          const end = start + match[0].length;
          if (start && /[$\p{L}\p{N}_\\.]/u.test(text[start - 1])) continue;
          if (language === 'rust' && start && /[':]/.test(text[start - 1])) continue;
          if (forbidden.some(([a, b]) => a < end && b > start)) continue;
          // A raw identifier can share a keyword's spelling. Qualified paths
          // may begin with crate/self/super, so retain those as complete names.
          if (language === 'rust' && !match[0].includes('::') && rustKeywords.some(([a, b]) => a < end && b > start)) continue;
          // PHP project names must be qualified. TypeScript lookup uses exact
          // exported paths; a supplied input/group disambiguates entry points.
          if (language === 'php' && !match[0].startsWith('\\') && !match[0].includes('\\')) continue;
          const link = resolve(match[0].replace(/^\\/, ''), { language, ...context });
          if (!link) continue;
          if (!safeUrl(link.url)) throw new Error(`Unsafe reference URL: ${link.url}`);
          references.push({ start, end, link });
        }
        return { tokens, references, text };
      });
      const labels = new Map<string, Set<string>>();
      for (const { references } of matches) for (const { link } of references) {
        const set = labels.get(link.label) ?? new Set();
        set.add(link.name); labels.set(link.label, set);
      }
      return matches.map(({ tokens, references, text }) => {
        const spans: { start: number; end: number; token: ThemedToken }[] = [];
        let offset = 0;
        for (const token of tokens) { spans.push({ start: offset, end: offset + token.content.length, token }); offset += token.content.length; }
        const output: LinkedToken[] = [];
        const append = (start: number, end: number) => {
          for (const span of spans) {
            const a = Math.max(start, span.start), b = Math.min(end, span.end);
            if (a < b) output.push({ ...span.token, content: span.token.content.slice(a - span.start, b - span.start) });
          }
        };
        let cursor = 0;
        for (const { start, end, link } of references) {
          append(cursor, start);
          const token = spans.find(span => span.start <= start && span.end > start)!.token;
          const original = text.slice(start, end);
          // Shortening must retain exact textContent for native copy buttons.
          const label = labels.get(link.label)!.size > 1 || !original.endsWith(link.label) ? original.replace(/^\\/, '') : link.label;
          output.push({ ...token, content: label, referenceLink: link, referencePrefix: original.slice(0, original.length - label.length) });
          cursor = end;
        }
        append(cursor, offset);
        return output;
      });
    },
    span(node, _line, _column, _lineElement, token) {
      const { referenceLink: link, referencePrefix: prefix } = token as LinkedToken;
      if (!link) return;
      node.tagName = 'a'; node.properties.href = link.url; node.properties.title = link.name;
      node.properties['data-reference-name'] = link.name;
      this.addClassToHast(node, 'refquill-code-link');
      if (/^https?:/.test(link.url)) node.properties.rel = ['noreferrer'];
      if (prefix) node.children.unshift({ type: 'element', tagName: 'span', properties: { className: ['refquill-copy-prefix'], ariaHidden: 'true' }, children: [{ type: 'text', value: prefix }] });
    },
    pre(node) { if (enabled(this.options)) node.properties['data-reference-source'] = this.source; },
  };
}
