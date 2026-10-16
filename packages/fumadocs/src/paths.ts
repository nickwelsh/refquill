/** Encode a name as a case-preserved URL segment using hexadecimal escapes. */
export const encodeSegment = (value: string): string => [...value].map(c => /^[A-Za-z0-9_-]$/.test(c) ? c : `~${c.codePointAt(0)!.toString(16)}~`).join('');

export function referenceBaseUrl(value: string): string {
  if (!/^\/(?!\/)[A-Za-z0-9/_.-]*$/.test(value) || value.includes('//') || value.split('/').some(s => s === '.' || s === '..')) throw new Error('baseUrl must be a local absolute path');
  return value.replace(/\/$/, '');
}
