import type { Symbol } from '@nickwelsh/refquill-schema';
import { memberAnchor } from './index.js';

/** Line owners are whitespace-separated member anchors; a promoted parameter
 * belongs to both its constructor and its property. */
export interface DeclarationOutline { code: string; memberLines: Record<number, string> }

/** Public API outline, with explicit member ownership for docs/code interaction. */
export function declarationOutline(symbol: Symbol, members: Symbol[]): DeclarationOutline {
  // Rust item declarations already encode tuple/unit structs, enum payloads,
  // where clauses and impl blocks. Combining their members as class bodies
  // would turn valid Rust into an invented declaration.
  if (symbol.language === 'rust') {
    const code = symbol.declaration;
    const memberLines: Record<number, string> = Object.fromEntries(code.split('\n').map((_, i) => [i + 1, memberAnchor(symbol.id)]));
    for (const member of members.filter(member => ['property', 'enum-case'].includes(member.kind))) {
      const declaration = member.declaration.trim().replace(/[,;]$/, '');
      const start = code.indexOf(declaration);
      if (start < 0 || !declaration) continue;
      const first = code.slice(0, start).split('\n').length;
      const last = first + declaration.split('\n').length - 1;
      for (let line = first; line <= last; line++) memberLines[line] += ` ${memberAnchor(member.id)}`;
    }
    return { code, memberLines };
  }
  const traitUses = symbol.relations.filter(relation => relation.kind === 'uses');
  const classLike = ['class', 'interface', 'trait', 'enum'].includes(symbol.kind);
  const shape = symbol.type?.text.trim();
  const shapeOffset = shape && /^\{[\s\S]*\}$/.test(shape) ? symbol.declaration.indexOf(shape) : -1;
  const inlineShape = shapeOffset >= 0 && members.length > 0;
  if ((!classLike && !inlineShape) || (!members.length && !traitUses.length)) return { code: symbol.declaration, memberLines: Object.fromEntries(symbol.declaration.split('\n').map((_, i) => [i + 1, memberAnchor(symbol.id)])) };
  const header = inlineShape ? `${symbol.declaration.slice(0, shapeOffset)}{` : `${symbol.declaration.replace(/[;{]\s*$/, '').trimEnd()} {`;
  const footer = inlineShape ? `}${symbol.declaration.slice(shapeOffset + shape!.length)}` : '}';
  const lines = header.split('\n');
  const memberLines: Record<number, string> = Object.fromEntries(lines.map((_, index) => [index + 1, memberAnchor(symbol.id)]));
  for (const relation of traitUses) {
    lines.push(`    use \\${relation.name.replace(/^\\/, '')};`);
    memberLines[lines.length] = memberAnchor(relation.targetId ?? symbol.id);
  }
  const constructor = symbol.language === 'php' ? members.find(member => member.kind === 'constructor') : undefined;
  const promoted = constructor ? members.filter(member => member.kind === 'property' && member.promoted) : [];
  for (const member of members) {
    if (promoted.includes(member)) continue;
    lines.push('');
    const declarations = member.signatures.length > 1 ? member.signatures.map(s => s.declaration) : [member.declaration];
    for (const declaration of declarations) {
      const terminated = /[;},]\s*$/.test(declaration) ? declaration : `${declaration};`;
      for (const [offset, line] of terminated.split('\n').entries()) {
        lines.push(`    ${line}`);
        const properties = member === constructor ? promoted.filter(property => {
          if (!property.source || !member.source) return true;
          const sourceLine = member.source.line + offset;
          return property.source.file === member.source.file && sourceLine >= property.source.line && sourceLine <= property.source.endLine;
        }) : [];
        memberLines[lines.length] = [member, ...properties].map(owner => memberAnchor(owner.id)).join(' ');
      }
    }
  }
  lines.push(footer);
  return { code: lines.join('\n'), memberLines };
}
