import { Application, Converter, ReflectionKind, TSConfigReader, makeRecursiveVisitor } from 'typedoc';
import ts from 'typescript';
import path from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { compilerModel, frameworkMetadata } from './frameworks.mjs';
import { analyzeSingleFileComponents, componentFiles } from './single-file-components.mjs';

// TypeDoc treats entry points as globs, so Windows namespaces and separators
// must be converted before paths cross the compiler boundary.
export function compilerPath(file, platform = process.platform) {
  return platform === 'win32'
    ? file.replace(/^\\\\\?\\UNC\\/i, '//').replace(/^\\\\\?\\/, '').replaceAll('\\', '/')
    : file;
}

const within = (root, file) => {
  const relative = path.relative(root, file);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
const resolve = reflection => reflection?.variant === 'reference' ? reflection.tryGetTargetReflectionDeep() : reflection;
const commentText = parts => (parts ?? []).map(part => part.kind === 'inline-tag' ? (part.tsLinkText ?? part.text) : part.text).join('');
const description = reflection => [commentText(reflection?.comment?.summary), ...(reflection?.comment?.blockTags ?? []).filter(tag => ['@remarks', '@example'].includes(tag.tag)).map(tag => commentText(tag.content))].filter(Boolean).join('\n\n');

/** Compiler-backed extraction. No project code or TypeDoc plugins are executed. */
export async function analyze(config) {
  config = { ...config, sourceRoot: compilerPath(config.sourceRoot),
    tsconfig: compilerPath(config.tsconfig), entryPoints: config.entryPoints.map(file => compilerPath(file)) };
  const files = await componentFiles(config);
  const componentSymbols = await analyzeSingleFileComponents(config, files);
  const entryPoints = [];
  for (const entry of config.entryPoints) {
    if (/\.(vue|svelte)$/.test(entry)) continue;
    if (files.length && (await stat(entry)).isDirectory()) entryPoints.push(...ts.sys.readDirectory(entry, ['.ts', '.tsx', '.mts', '.cts'], config.exclude.map(pattern => path.resolve(config.sourceRoot, pattern))));
    else entryPoints.push(entry);
  }
  if (!entryPoints.length) {
    if (!componentSymbols.length) throw new Error(`No public TypeScript exports selected for ${config.name}`);
    return { symbols: componentSymbols, diagnostics: [] };
  }
  const app = await Application.bootstrap({
    tsconfig: config.tsconfig,
    entryPoints: entryPoints.map(file => compilerPath(file)),
    entryPointStrategy: 'expand',
    alwaysCreateEntryPointModule: true,
    excludePrivate: true,
    excludeProtected: !config.includeProtected,
    excludeInternal: true,
    excludeExternals: true,
    exclude: config.exclude.map(pattern => compilerPath(path.resolve(config.sourceRoot, pattern))),
    disableGit: true,
    readme: 'none',
    logLevel: 'Error',
    sourceLinkTemplate: '#L{line}',
  }, [new TSConfigReader()]);
  const annotations = new Map();
  const programs = new Set();
  const parameterNames = new Map();
  const variableKinds = new Map();
  const compilerDeclarations = new Map();
  app.converter.on(Converter.EVENT_CREATE_DECLARATION, (context, reflection) => {
    for (const program of context.programs) programs.add(program);
    const node = context.getSymbolFromReflection(reflection)?.declarations?.[0];
    if (node) compilerDeclarations.set(reflection.id, { node, context });
    if (node?.type) annotations.set(reflection.id, { node: node.type, context: context.withScope(reflection) });
    if (node && ts.isVariableDeclaration(node)) variableKinds.set(reflection.id, node.parent.flags & ts.NodeFlags.Const ? 'const' : node.parent.flags & ts.NodeFlags.Let ? 'let' : 'var');
  });
  app.converter.on(Converter.EVENT_CREATE_PARAMETER, (context, reflection, node) => {
    node ??= context.getSymbolFromReflection(reflection)?.declarations?.find(ts.isParameter);
    if (!node) return;
    if (node.type) annotations.set(reflection.id, { node: node.type, context });
    if (!ts.isIdentifier(node.name)) parameterNames.set(reflection.id, node.name.getText());
  });
  app.converter.on(Converter.EVENT_CREATE_SIGNATURE, (context, reflection, node) => {
    if (node?.type) annotations.set(reflection.id, { node: node.type, context });
  });
  const project = await app.convert();
  if (!project || app.logger.hasErrors()) throw new Error('TypeScript analysis failed; previous output is preserved.');
  const records = [];
  const ids = new Set();
  const targets = new Map();
  const kinds = new Map([
    [ReflectionKind.Class, 'class'], [ReflectionKind.Interface, 'interface'], [ReflectionKind.Enum, 'enum'],
    [ReflectionKind.EnumMember, 'enum-case'], [ReflectionKind.Function, 'function'], [ReflectionKind.Method, 'method'],
    [ReflectionKind.Constructor, 'constructor'], [ReflectionKind.Property, 'property'], [ReflectionKind.Variable, 'variable'],
    [ReflectionKind.TypeAlias, 'type-alias'], [ReflectionKind.Namespace, 'namespace'], [ReflectionKind.Module, 'module'],
    [ReflectionKind.Accessor, 'accessor'],
  ]);
  function add(reflection, group, segments, parentId = null, ancestors = new Set()) {
    const target = resolve(reflection);
    if (!target) throw new Error(`Unresolved export: ${reflection.name}`);
    if (ancestors.has(target.id)) throw new Error(`Cyclic exported namespace: ${reflection.name}`);
    const nextAncestors = new Set(ancestors).add(target.id);
    const kind = kinds.get(target.kind);
    if (!kind) throw new Error(`Unsupported public TypeDoc kind: ${ReflectionKind[target.kind]}`);
    const id = `typescript:${config.name}:${JSON.stringify([group, ...segments])}`;
    if (ids.has(id)) throw new Error(`Duplicate TypeScript symbol: ${id}`);
    ids.add(id);
    if (!targets.has(reflection.id)) targets.set(reflection.id, id);
    if (!targets.has(target.id)) targets.set(target.id, id);
    records.push({ id, reflection, target, group, segments, parentId, kind });
    for (const member of target.children ?? []) add(member, group, [...segments, member.name], id, nextAncestors);
    // Object aliases and variables expose a shape through an inline reflection.
    for (const member of target.type?.type === 'reflection' ? (target.type.declaration.children ?? []) : []) add(member, group, [...segments, member.name], id, nextAncestors);
  }
  for (const module of project.children ?? []) {
    const filename = module.sources?.[0]?.fullFileName;
    if (!filename || !config.entryPoints.some(entry => within(entry, filename))) throw new Error(`Cannot identify entry point for ${module.name}`);
    const canonical = compilerPath(await realpath(filename));
    if (!within(config.sourceRoot, canonical)) throw new Error('TypeScript source escaped sourceRoot');
    const group = path.relative(config.sourceRoot, canonical).split(path.sep).join('/').replace(/\.[cm]?tsx?$/, '');
    for (const child of module.children ?? []) add(child, group, [child.name]);
  }
  if (!records.length && !componentSymbols.length) throw new Error(`No public TypeScript exports selected for ${config.name}`);
  const targetId = reflection => targets.get(reflection?.id) ?? targets.get(resolve(reflection)?.id) ?? null;
  const qualifiedNames = new Map(records.map(record => [record.id, record.segments.join('.')]));
  const qualified = id => qualifiedNames.get(id);
  // Resolve names in compiler-provided type positions, never string literals or
  // property keys. Source annotations also preserve import-type resolution.
  const qualifyAnnotation = annotation => {
    const text = annotation.node.getText();
    const base = annotation.node.getStart();
    const replacements = [];
    const visit = node => {
      let name;
      let start;
      let end;
      if (ts.isTypeReferenceNode(node) || ts.isTypeQueryNode(node)) {
        const identifier = ts.isTypeReferenceNode(node) ? node.typeName : node.exprName;
        let symbol = annotation.context.checker.getSymbolAtLocation(identifier);
        if (symbol?.flags & ts.SymbolFlags.Alias) symbol = annotation.context.checker.getAliasedSymbol(symbol);
        if (symbol && !(symbol.flags & ts.SymbolFlags.TypeParameter)) {
          name = qualified(targetId(annotation.context.getReflectionFromSymbol(symbol)));
          start = identifier.getStart(); end = identifier.end;
        }
      } else if (ts.isImportTypeNode(node)) {
        const symbol = annotation.context.checker.getTypeFromTypeNode(node).symbol;
        name = qualified(targetId(annotation.context.getReflectionFromSymbol(symbol)));
        start = node.getStart(); end = node.qualifier?.end;
      }
      if (name && end != null) replacements.push({ start: start - base, end: end - base, name });
      ts.forEachChild(node, visit);
    };
    visit(annotation.node);
    let result = text;
    for (const r of replacements.sort((a, b) => b.start - a.start)) result = result.slice(0, r.start) + r.name + result.slice(r.end);
    return result;
  };
  const genericParameterCache = new Map();
  const genericParameters = type => {
    const reflection = resolve(type.reflection);
    if (reflection?.typeParameters) return reflection.typeParameters.map(p => ({ name: p.name, description: description(p) }));
    const symbol = type.symbolId;
    if (!symbol) return [];
    const key = `${symbol.fileName}:${symbol.pos}`;
    if (genericParameterCache.has(key)) return genericParameterCache.get(key);
    let parameters = [];
    for (const program of programs) {
      const source = program.getSourceFile(symbol.fileName);
      if (!source) continue;
      const visit = node => {
        if (node.pos > symbol.pos || node.end <= symbol.pos) return;
        if (node.typeParameters) parameters = node.typeParameters.map(p => ({
          name: p.name.text,
          description: ts.displayPartsToString(program.getTypeChecker().getSymbolAtLocation(p.name)?.getDocumentationComment(program.getTypeChecker()) ?? []),
        }));
        ts.forEachChild(node, visit);
      };
      visit(source);
      if (parameters.length) break;
    }
    genericParameterCache.set(key, parameters);
    return parameters;
  };
  const typeOf = (type, annotationId, depth = 0) => {
    const annotation = annotations.get(annotationId);
    if (!type && !annotation) return null;
    const references = new Map();
    const visited = new Set();
    const collect = type => {
      if (!type || visited.has(type)) return;
      visited.add(type);
      type.visit(makeRecursiveVisitor({
        reference(reference) {
          if (reference.refersToTypeParameter) return;
          const id = targetId(reference.reflection);
          references.set(`${reference.name}:${id ?? ''}`, {
            name: reference.name, targetId: id,
            ...(!id && reference.package ? { package: reference.package, qualifiedName: reference.qualifiedName } : {}),
          });
        },
        reflection(value) {
          for (const child of value.declaration.children ?? []) collect(child.type);
          for (const signature of value.declaration.signatures ?? []) {
            collect(signature.type);
            for (const parameter of signature.parameters ?? []) collect(parameter.type);
          }
        },
      }));
    };
    if (annotation) {
      // Explicit source annotations preserve aliases and source-level intent.
      const visit = node => {
        if (ts.isTypeReferenceNode(node) || ts.isTypeQueryNode(node)) {
          const name = ts.isTypeReferenceNode(node) ? node.typeName : node.exprName;
          let symbol = annotation.context.checker.getSymbolAtLocation(name);
          if (symbol?.flags & ts.SymbolFlags.Alias) symbol = annotation.context.checker.getAliasedSymbol(symbol);
          if (symbol && !(symbol.flags & ts.SymbolFlags.TypeParameter)) {
            const id = targetId(annotation.context.getReflectionFromSymbol(symbol));
            references.set(`${name.getText()}:${id ?? ''}`, { name: name.getText(), targetId: id });
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(annotation.node);
    }
    collect(type);
    let structure;
    if (type && depth < 16) {
      if (type.type === 'union' || type.type === 'intersection') structure = { kind: type.type, types: type.types.map(child => typeOf(child, undefined, depth + 1)) };
      else if (type.type === 'reference' && type.typeArguments?.length) structure = { kind: 'generic', name: type.name, arguments: type.typeArguments.map(child => typeOf(child, undefined, depth + 1)), argumentParameters: genericParameters(type) };
    }
    return { text: annotation ? qualifyAnnotation(annotation) : type.toString(), references: [...references.values()].sort((a, b) => a.name.localeCompare(b.name)), ...(structure ? { structure } : {}) };
  };
  const templates = values => (values ?? []).map(value => ({ name: value.name, constraint: typeOf(value.type), default: typeOf(value.default), description: description(value) }));
  const templateText = values => values?.length ? `<${values.map(value => `${value.name}${value.type ? ` extends ${value.type.toString()}` : ''}${value.default ? ` = ${value.default.toString()}` : ''}`).join(', ')}>` : '';
  const parameters = (values, ancestors = new Set()) => (values ?? []).map(parameter => {
    const declaration = parameter.type?.type === 'reflection' ? parameter.type.declaration
      : parameterNames.has(parameter.id) && parameter.type?.type === 'reference' ? resolve(parameter.type.reflection) : undefined;
    const expand = declaration && !ancestors.has(declaration.id) && ancestors.size < 16;
    const next = expand ? new Set(ancestors).add(declaration.id) : ancestors;
    const children = expand ? parameters(declaration.children ?? [], next) : [];
    const callbacks = expand ? signatures(declaration, parameter.name, next) : [];
    return {
      name: parameterNames.get(parameter.id) ?? parameter.name,
      type: typeOf(parameter.type, parameter.id), description: description(parameter),
      optional: Boolean(parameter.flags.isOptional || parameter.defaultValue !== undefined), variadic: Boolean(parameter.flags.isRest),
      byReference: false, default: parameter.defaultValue ?? null,
      ...(children.length ? { properties: children } : {}),
      ...(callbacks.length ? { signatures: callbacks } : {}),
    };
  });
  const signatures = (reflection, name, ancestors = new Set()) => {
    const values = [...(reflection.signatures ?? (reflection.type?.type === 'reflection' ? reflection.type.declaration.signatures : undefined) ?? []), ...(reflection.getSignature ? [reflection.getSignature] : []), ...(reflection.setSignature ? [reflection.setSignature] : [])];
    return values.map(signature => {
      const params = parameters(signature.parameters, ancestors);
      const returns = typeOf(signature.type, signature.id);
      const prefix = signature.kind === ReflectionKind.GetSignature ? 'get ' : signature.kind === ReflectionKind.SetSignature ? 'set ' : '';
      const declaration = `${prefix}${name}${reflection.kind === ReflectionKind.Constructor ? '' : templateText(signature.typeParameters)}(${params.map(p => `${p.variadic ? '...' : ''}${p.name}${p.optional ? '?' : ''}: ${p.type?.text ?? 'unknown'}`).join(', ')})${reflection.kind === ReflectionKind.Constructor || signature.kind === ReflectionKind.SetSignature ? '' : `: ${returns?.text ?? 'unknown'}`}`;
      return { declaration, description: description(signature), parameters: params, returns, returnsDescription: commentText(signature.comment?.blockTags.find(tag => tag.tag === '@returns')?.content), typeParameters: templates(signature.typeParameters) };
    });
  };
  const symbols = [];
  for (const record of records) {
    const { target, reflection, kind, group, id, segments, parentId } = record;
    const source = reflection.sources?.[0] ?? target.sources?.[0];
    let location = null;
    if (source) {
      const canonical = compilerPath(await realpath(source.fullFileName));
      if (within(config.sourceRoot, canonical)) location = { file: path.relative(config.sourceRoot, canonical).split(path.sep).join('/'), line: source.line, endLine: source.line };
    }
    const sigs = signatures(target, reflection.name);
    const compiler = compilerDeclarations.get(target.id);
    const framework = compiler && ['function', 'class', 'variable'].includes(kind) ? frameworkMetadata(compiler.node, compiler.context.checker, compiler.context.program.getCompilerOptions(),
      compilerModel(compiler.context.checker, symbol => targetId(compiler.context.getReflectionFromSymbol(symbol))), reflection.name) : null;
    const type = typeOf(target.type, target.id);
    const modifiers = ['static', 'readonly', 'abstract', 'protected'].filter(modifier => target.flags[`is${modifier[0].toUpperCase()}${modifier.slice(1)}`]);
    const relations = [
      ...(target.extendedTypes ?? []).map(type => ({ kind: 'extends', name: type.toString(), targetId: targetId(type.reflection) })),
      ...(target.implementedTypes ?? []).map(type => ({ kind: 'implements', name: type.toString(), targetId: targetId(type.reflection) })),
      ...(target.inheritedFrom ? [{ kind: 'inherited-from', name: target.inheritedFrom.toString(), targetId: targetId(target.inheritedFrom.reflection) }] : []),
      ...(target.overwrites ? [{ kind: 'overrides', name: target.overwrites.toString(), targetId: targetId(target.overwrites.reflection) }] : []),
    ];
    let declaration;
    if (sigs.length && !['property', 'variable', 'type-alias'].includes(kind)) declaration = sigs.map(signature => `${['function'].includes(kind) ? 'function ' : ''}${signature.declaration};`).join('\n');
    else if (['class', 'interface', 'enum', 'namespace', 'module'].includes(kind)) declaration = `${kind} ${reflection.name}${templateText(target.typeParameters)}${relations.filter(r => ['extends', 'implements'].includes(r.kind)).map(r => ` ${r.kind} ${r.name}`).join('')}`;
    else if (kind === 'type-alias') declaration = `type ${reflection.name}${templateText(target.typeParameters)} = ${type?.text ?? 'unknown'};`;
    else if (kind === 'enum-case') declaration = `${reflection.name}${target.defaultValue != null ? ` = ${target.defaultValue}` : ''}`;
    else declaration = `${modifiers.length ? modifiers.join(' ') + ' ' : ''}${kind === 'variable' ? `${variableKinds.get(target.id) ?? 'const'} ` : ''}${reflection.name}${target.flags.isOptional ? '?' : ''}: ${type?.text ?? 'unknown'};`;
    symbols.push({
      id, language: 'typescript', kind, name: reflection.name, qualifiedName: segments.join('.'), api: config.name, group, parentId,
      declaration, description: description(reflection) || description(target), deprecated: Boolean(target.comment?.hasModifier('@deprecated') || target.comment?.blockTags.some(t => t.tag === '@deprecated')),
      modifiers, source: location, type, signatures: sigs, typeParameters: templates(target.typeParameters), relations,
      ...(framework ? { framework } : {}),
      tags: [...(target.comment?.blockTags ?? []).map(tag => ({ name: tag.tag.replace(/^@/, ''), text: commentText(tag.content) })), ...(target.comment?.modifierTags ?? [])].map(tag => typeof tag === 'string' ? { name: tag.replace(/^@/, ''), text: '' } : tag),
    });
  }
  return { symbols: [...symbols, ...componentSymbols], diagnostics: [] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // TypeDoc's console logger must not contaminate the worker's JSON protocol.
  console.log = (...args) => console.error(...args);
  try {
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    process.stdout.write(JSON.stringify(await analyze(JSON.parse(input))));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
