import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

const parser = unified().use(remarkParse).use(remarkGfm);
const inlineContainers = new Set(['paragraph', 'heading', 'emphasis', 'strong', 'delete', 'link', 'linkReference', 'tableCell']);

interface MarkdownNode {
  type: string;
  value?: string;
  alt?: string | null;
  children?: MarkdownNode[];
}

/** Search and metadata text, using the renderer's GFM and skipHtml policy.
 * The result is plain text, not sanitized HTML; consumers must escape it. */
export function markdownText(value: string): string {
  const text = (node: MarkdownNode): string => {
    if (node.type === 'html') return '';
    if (node.type === 'break') return '\n';
    if (node.value !== undefined) return node.value;
    if (node.alt != null) return node.alt;
    return (node.children ?? []).map(text).join(inlineContainers.has(node.type) ? '' : '\n');
  };
  return text(parser.parse(value)).trim();
}
