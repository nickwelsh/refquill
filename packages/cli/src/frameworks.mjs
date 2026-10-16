import ts from 'typescript';

const docs = (symbol, checker) => ts.displayPartsToString(symbol?.getDocumentationComment(checker) ?? []);
const origin = symbol => (symbol?.declarations ?? []).map(node => node.getSourceFile().fileName.replaceAll('\\', '/')).join('\n');
const frameworkOf = symbol => /\/(?:@types\/react|react)\//.test(origin(symbol)) ? 'react'
  : /\/solid-js\//.test(origin(symbol)) ? 'solid' : /\/(?:@vue|vue)\//.test(origin(symbol)) ? 'vue' : null;

/** Serialize compiler types using the same parameter contract as ordinary APIs.
 * Expansion stops at cycles and library classes; callback APIs retain signatures. */
export function compilerModel(checker, targetId = () => null) {
  const isPublic = symbol => !symbol.getJsDocTags(checker).some(tag => tag.name === 'internal');
  const type = value => {
    if (!value) return null;
    const references = new Map();
    const seen = new Set();
    const collect = value => {
      if (!value || seen.has(value)) return;
      seen.add(value);
      const symbol = value.aliasSymbol ?? value.symbol;
      if (symbol && !(symbol.flags & ts.SymbolFlags.TypeParameter) && !symbol.name.startsWith('__')) {
        const target = targetId(symbol);
        const packageName = [...origin(symbol).matchAll(/\/node_modules\/(?!\.pnpm\/)((?:@[^/]+\/)?[^/]+)/g)].at(-1)?.[1];
        references.set(symbol.name, { name: symbol.name, targetId: target,
          ...(!target && packageName ? { package: packageName, qualifiedName: checker.getFullyQualifiedName(symbol).replace(/^"[^"]+"\./, '') } : {}) });
      }
      for (const child of value.types ?? value.aliasTypeArguments ?? []) collect(child);
      if (value.objectFlags & ts.ObjectFlags.Reference) for (const child of checker.getTypeArguments(value)) collect(child);
    };
    collect(value);
    return { text: checker.typeToString(value, undefined, ts.TypeFormatFlags.NoTruncation), references: [...references.values()] };
  };
  const parameter = (symbol, location, ancestors = new Set()) => {
    const node = symbol.valueDeclaration ?? symbol.declarations?.[0] ?? location;
    const value = checker.getTypeOfSymbolAtLocation(symbol, node);
    const signatures = checker.getNonNullableType(value).getCallSignatures();
    const expand = ancestors.size < 8 && !ancestors.has(value);
    const next = new Set(ancestors).add(value);
    const shape = checker.getNonNullableType(value);
    const children = expand && Boolean(shape.flags & ts.TypeFlags.Object) && !signatures.length
      && !checker.isArrayType(shape) && !checker.isTupleType(shape)
      && (!shape.symbol || shape.symbol.name.startsWith('__')) ? checker.getPropertiesOfType(shape).filter(isPublic) : [];
    return {
      name: symbol.name, type: type(value), description: docs(symbol, checker),
      optional: Boolean(symbol.flags & ts.SymbolFlags.Optional || node?.questionToken || node?.initializer),
      variadic: Boolean(node?.dotDotDotToken), byReference: false, default: node?.initializer?.getText() ?? null,
      ...(children.length ? { properties: children.map(child => parameter(child, location, next)) } : {}),
      ...(expand && signatures.length ? { signatures: signatures.map(sig => signature(sig, location, next)) } : {}),
    };
  };
  const signature = (sig, location, ancestors = new Set()) => ({
    declaration: checker.signatureToString(sig, location, ts.TypeFormatFlags.NoTruncation),
    description: ts.displayPartsToString(sig.getDocumentationComment(checker)),
    parameters: sig.parameters.map(symbol => parameter(symbol, location, ancestors)),
    returns: type(sig.getReturnType()), returnsDescription: ts.displayPartsToString(sig.getJsDocTags().find(tag => tag.name === 'returns')?.text ?? []),
    typeParameters: (sig.typeParameters ?? []).map(value => ({ name: value.symbol.name,
      constraint: type(value.getConstraint()), default: type(value.getDefault()), description: docs(value.symbol, checker) })),
  });
  return { type, parameter, signature, props: (value, location) => checker.getPropertiesOfType(value)
    .filter(isPublic)
    .map(symbol => parameter(symbol, location)) };
}

function defaults(node, checker, includeLocals = false) {
  const values = new Map();
  const seen = new Set();
  const binding = name => {
    if (!ts.isObjectBindingPattern(name)) return;
    for (const element of name.elements) if (element.initializer) values.set(element.propertyName?.getText() ?? element.name.getText(), element.initializer.getText());
  };
  const visit = current => {
    if (!current || seen.has(current)) return;
    seen.add(current);
    if (ts.isIdentifier(current) && checker) {
      const symbol = checker.getSymbolAtLocation(current);
      if (symbol?.valueDeclaration) visit(symbol.valueDeclaration);
    }
    if (current.parameters) for (const parameter of current.parameters) binding(parameter.name);
    if (ts.isVariableDeclaration(current)) visit(current.initializer);
    if (ts.isExportAssignment(current)) visit(current.expression);
    if (ts.isCallExpression(current)) for (const argument of current.arguments) visit(argument);
    if (includeLocals && current.body) for (const statement of current.body.statements ?? []) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        binding(declaration.name);
        if (ts.isIdentifier(declaration.name) && declaration.initializer) values.set(declaration.name.text, declaration.initializer.getText());
      }
    }
  };
  if (node) visit(node);
  return values;
}

/** Positive compiler evidence is required: names alone never classify APIs. */
export function frameworkMetadata(node, checker, options, model, exportName) {
  if (!node) return null;
  const location = node.name ?? (ts.isExportAssignment(node) ? node.expression : node);
  const value = checker.getTypeAtLocation(location);
  let signatures = value.getCallSignatures();
  let props;
  let framework = frameworkOf(value.aliasSymbol) ?? frameworkOf(value.symbol);
  let componentEvidence = Boolean(framework);
  const bases = value.getBaseTypes?.() ?? [];
  for (const base of bases) {
    const owner = frameworkOf(base.symbol);
    if (owner === 'react' && ['Component', 'PureComponent'].includes(base.symbol?.name)) {
      framework = owner;
      componentEvidence = true;
      props = checker.getTypeArguments(base)[0];
    }
  }
  let jsx = false;
  let hook = false;
  const visit = current => {
    // Nested declarations are independent APIs, not evidence about this one.
    const initializer = ts.isVariableDeclaration(node) ? node.initializer : ts.isExportAssignment(node) ? node.expression : undefined;
    const implementation = current === initializer || (initializer && ts.isCallExpression(initializer) && initializer.arguments.includes(current));
    if (current !== node && ((ts.isFunctionLike(current) && !implementation) || ts.isClassDeclaration(current))) return;
    if (ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current) || ts.isJsxFragment(current)) jsx = true;
    if (ts.isCallExpression(current)) {
      let symbol = checker.getSymbolAtLocation(current.expression);
      if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
      const owner = frameworkOf(symbol);
      if (owner && /^use[A-Z0-9]/.test(symbol.name)) { framework ??= owner; hook = true; }
      if (owner && ['memo', 'forwardRef', 'defineComponent'].includes(symbol.name)) { framework ??= owner; componentEvidence = true; }
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  for (const sig of signatures) {
    const result = sig.getReturnType();
    for (const member of result.types ?? [result]) {
      const owner = frameworkOf(member.aliasSymbol ?? member.symbol);
      if (owner && ['Element', 'ReactElement', 'VNode'].includes((member.aliasSymbol ?? member.symbol)?.name)) { framework ??= owner; componentEvidence = true; }
    }
  }
  const jsxSource = node.getSourceFile().text.match(/^\s*\/\*\*?\s*@jsxImportSource\s+(\S+)/)?.[1] ?? options.jsxImportSource;
  if (jsx) { framework = jsxSource?.startsWith('solid-js') ? 'solid' : framework ?? ((!jsxSource || jsxSource === 'react') && (options.jsx === ts.JsxEmit.ReactJSX || options.jsx === ts.JsxEmit.ReactJSXDev) ? 'react' : null); componentEvidence = true; }
  const name = node.name?.getText() ?? exportName ?? '';
  if (hook && framework === 'react' && /^use[A-Z0-9]/.test(name)) return { name: framework, role: 'hook' };
  if (!framework || !componentEvidence || (!/^[A-Z]/.test(name) && name !== 'default') || (!signatures.length && !props)) return null;
  props ??= signatures[0]?.parameters[0] && checker.getTypeOfSymbolAtLocation(signatures[0].parameters[0], node);
  // Vue defineComponent exposes constructor instances, handled by its native checker.
  if (framework === 'vue') return null;
  const values = defaults(node, checker);
  return { name: framework, role: 'component', props: props ? model.props(props, node).map(prop => values.has(prop.name)
    ? { ...prop, default: values.get(prop.name) } : prop) : [] };
}

export { defaults };
