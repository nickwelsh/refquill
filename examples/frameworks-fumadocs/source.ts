import { loader } from 'fumadocs-core/source';
import { createApiReference } from '@nickwelsh/refquill-fumadocs';
import { apiReferenceIcon } from '@nickwelsh/refquill-fumadocs/components';
import input from './generated/api.json' with { type: 'json' };

export const reference = createApiReference({ input, baseUrl: '/api' });
export const source = loader({
  baseUrl: reference.baseUrl,
  source: reference.toFumadocsSource(),
  icon: apiReferenceIcon,
});

export const pageTree = source.pageTree;

export function symbolUrl(name: string): string {
  const symbol = reference.document.symbols.find(s => s.name === name);
  if (!symbol) throw new Error(`Missing example symbol: ${name}`);
  return reference.getUrl(symbol.id);
}
