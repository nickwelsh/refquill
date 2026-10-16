import type { Kind, Symbol } from '@nickwelsh/refquill-schema';

/** Language-specific presentation categories for the shared schema kinds. */
export type ApiSymbolKind = Kind | 'exception' | 'field' | 'variant' | 'enum-member' | 'associated-function' | 'associated-type' | 'associated-constant' | 'static' | 'react-component' | 'react-hook' | 'vue-component' | 'svelte-component' | 'solid-component';

// PHP core/SPL and standard extension throwable bases can be external to the
// documented source. Qualified names are deliberate: suffixes are not evidence.
const nativeThrowables = new Set([
  'Exception', 'ErrorException', 'LogicException', 'BadFunctionCallException',
  'BadMethodCallException', 'DomainException', 'InvalidArgumentException',
  'LengthException', 'OutOfRangeException', 'RuntimeException',
  'OutOfBoundsException', 'OverflowException', 'RangeException',
  'UnderflowException', 'UnexpectedValueException', 'ClosedGeneratorException',
  'Error', 'ArithmeticError', 'AssertionError', 'ArgumentCountError', 'CompileError',
  'DivisionByZeroError', 'ParseError', 'TypeError', 'ValueError',
  'UnhandledMatchError', 'FiberError', 'JsonException', 'ReflectionException',
  'RequestParseBodyException', 'Random\\RandomException', 'Random\\BrokenRandomEngineError',
  'DateError', 'DateObjectError', 'DateRangeError', 'DateException',
  'DateInvalidOperationException', 'DateInvalidTimeZoneException',
  'DateMalformedIntervalStringException', 'DateMalformedPeriodStringException',
  'DateMalformedStringException', 'PDOException', 'mysqli_sql_exception',
  'SQLite3Exception', 'PharException', 'DOMException', 'IntlException',
  'SodiumException', 'SoapFault', 'FFI\\Exception',
].map(name => name.toLowerCase()));
const isNativeThrowable = (name: string) => nativeThrowables.has(name.replace(/^\\/, '').toLowerCase());

export function createSymbolKindResolver(getSymbol: (id: string) => Symbol): (id: string) => ApiSymbolKind {
  const exceptions = new Map<string, boolean>();
  return id => {
    const symbol = getSymbol(id);
    if (symbol.framework?.role === 'component') return `${symbol.framework.name}-component`;
    if (symbol.framework?.name === 'react' && symbol.framework.role === 'hook') return 'react-hook';
    if (symbol.language === 'typescript' && symbol.kind === 'enum-case') return 'enum-member';
    if (symbol.language === 'rust') {
      if (symbol.kind === 'property') return 'field';
      if (symbol.kind === 'enum-case') return 'variant';
      if (symbol.kind === 'variable') return 'static';
      if (symbol.kind === 'method') return symbol.signatures.some(signature => signature.parameters.some(parameter => parameter.name === 'self')) ? 'method' : 'associated-function';
      const parent = symbol.parentId ? getSymbol(symbol.parentId) : null;
      if (parent && ['trait', 'impl'].includes(parent.kind)) {
        if (symbol.kind === 'type-alias') return 'associated-type';
        if (symbol.kind === 'constant') return 'associated-constant';
      }
    }
    if (symbol.language !== 'php' || symbol.kind !== 'class') return symbol.kind;
    const path = new Set<string>();
    let current = symbol;
    let exception = false;
    while (current.language === 'php' && current.kind === 'class' && !path.has(current.id)) {
      const known = exceptions.get(current.id);
      if (known !== undefined) { exception = known; break; }
      path.add(current.id);
      if (isNativeThrowable(current.qualifiedName)) { exception = true; break; }
      const parent = current.relations.find(relation => relation.kind === 'extends');
      if (!parent) break;
      if (!parent.targetId) { exception = isNativeThrowable(parent.name); break; }
      current = getSymbol(parent.targetId);
    }
    for (const ancestor of path) exceptions.set(ancestor, exception);
    return exception ? 'exception' : 'class';
  };
}
