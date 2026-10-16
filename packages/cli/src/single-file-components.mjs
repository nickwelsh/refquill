import ts from 'typescript';
import path from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { compilerModel, defaults } from './frameworks.mjs';

const require = createRequire(import.meta.url);
const within = (root, file) => { const relative = path.relative(root, file); return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };

export async function componentFiles(config) {
  const selected = new Set();
  for (const entry of config.entryPoints) {
    const candidates = (await stat(entry)).isDirectory()
      ? ts.sys.readDirectory(entry, ['.vue', '.svelte'], config.exclude.map(pattern => path.resolve(config.sourceRoot, pattern)))
      : /\.(vue|svelte)$/.test(entry) ? [entry] : [];
    for (const file of candidates) {
      const canonical = await realpath(file);
      if (!within(config.sourceRoot, canonical)) throw new Error('Component source escaped sourceRoot');
      const relative = path.relative(config.sourceRoot, canonical).replaceAll(path.sep, '/');
      if (ts.sys.readDirectory(config.sourceRoot, [path.extname(file)], config.exclude, [relative]).length) selected.add(canonical);
    }
  }
  return [...selected].sort();
}

/** Use framework compilers, never execute user configs, preprocessors or plugins. */
export async function analyzeSingleFileComponents(config, files) {
  if (!files.length) return [];
  const output = [];
  let vue;
  let svelte;
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const name = path.basename(file, path.extname(file));
    const group = path.relative(config.sourceRoot, file).replaceAll(path.sep, '/').replace(/\.(vue|svelte)$/, '');
    const id = `typescript:${config.name}:${JSON.stringify([group, name])}`;
    let framework;
    let description = '';
    if (file.endsWith('.vue')) {
      const { createChecker } = await import('vue-component-meta');
      if (!vue) {
        rejectVuePlugins(config.tsconfig);
        vue = createChecker(config.tsconfig, { schema: false });
      }
      const meta = vue.getComponentMeta(file);
      if (!meta.type) throw new Error(`Cannot analyze Vue component: ${file}`);
      const program = vue.getProgram();
      const diagnostics = program ? [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()] : [];
      if (diagnostics.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, diagnosticHost));
      const checker = program.getTypeChecker();
      const model = compilerModel(checker);
      const param = value => {
        const type = value.getTypeObject();
        const signatures = type ? checker.getNonNullableType(type).getCallSignatures() : [];
        return { name: value.name, type: { ...(model.type(type) ?? { references: [] }), text: value.type },
          description: value.description ?? '', optional: value.required === false, default: value.default ?? null, variadic: false, byReference: false,
          ...(signatures.length ? { signatures: signatures.map(signature => model.signature(signature, program.getSourceFile(file))) } : {}) };
      };
      const visible = values => values.filter(value => !value.tags.some(tag => tag.name === 'internal'));
      framework = { name: 'vue', role: 'component', props: visible(meta.props).filter(prop => !prop.global).map(param), events: visible(meta.events).map(param), slots: visible(meta.slots).map(param), exposed: visible(meta.exposed).filter(member => !member.name.startsWith('$')).map(param) };
      description = meta.description ?? '';
    } else {
      svelte ??= await svelteProgram(config, files.filter(file => file.endsWith('.svelte')));
      const { program, checker } = svelte;
      const node = program.getSourceFile(`${file}.ts`);
      const render = node.statements.find(value => ts.isFunctionDeclaration(value) && value.name?.text === '$$render');
      if (!render) throw new Error(`Cannot analyze Svelte component: ${file}`);
      const result = checker.getSignatureFromDeclaration(render).getReturnType();
      const model = compilerModel(checker);
      const fields = key => {
        const symbol = result.getProperty(key);
        return symbol ? model.props(checker.getTypeOfSymbolAtLocation(symbol, render), render) : [];
      };
      const initializers = defaults(render, checker, true);
      framework = { name: 'svelte', role: 'component', props: fields('props').map(prop => initializers.has(prop.name) ? { ...prop, default: initializers.get(prop.name) } : prop), events: fields('events'), slots: fields('slots'), exposed: fields('exports') };
      // Component-level documentation is represented by Svelte's @component comment.
      description = source.match(/<!--\s*@component\s*([\s\S]*?)-->/)?.[1]?.trim() ?? '';
    }
    output.push({ id, language: 'typescript', kind: 'variable', name, qualifiedName: name, api: config.name, group, parentId: null,
      declaration: `declare const ${ts.isIdentifierText(name, ts.ScriptTarget.Latest) ? name : 'component'}: ${framework.name === 'vue' ? 'DefineComponent' : 'Component'}<{\n${framework.props.map(prop => `  ${JSON.stringify(prop.name)}${prop.optional ? '?' : ''}: ${prop.type.text};`).join('\n')}\n}>;`,
      description, deprecated: false, modifiers: [], source: { file: path.relative(config.sourceRoot, file).replaceAll(path.sep, '/'), line: 1, endLine: source.split('\n').length },
      type: null, signatures: [], typeParameters: [], relations: [], tags: [], framework });
  }
  return output;
}

const diagnosticHost = { getCanonicalFileName: file => file, getCurrentDirectory: ts.sys.getCurrentDirectory, getNewLine: () => '\n' };

function rejectVuePlugins(tsconfig) {
  // Vue loads plugins while resolving each ancestor, even when a child clears
  // the list. Check the entire config chain before handing it to Vue's checker.
  let hasPlugins = false;
  const read = file => {
    const text = ts.sys.readFile(file);
    if (text != null) {
      const plugins = ts.parseConfigFileTextToJson(file, text).config?.vueCompilerOptions?.plugins;
      if (plugins != null && (!Array.isArray(plugins) || plugins.length)) hasPlugins = true;
    }
    return text;
  };
  const raw = ts.readConfigFile(tsconfig, read);
  if (raw.error) throw new Error(ts.flattenDiagnosticMessageText(raw.error.messageText, '\n'));
  ts.parseJsonConfigFileContent(raw.config, { ...ts.sys, readFile: read }, path.dirname(tsconfig));
  if (hasPlugins) throw new Error('Vue language plugins are not executed. Use a documentation tsconfig without vueCompilerOptions.plugins, including inherited configs.');
}


async function svelteProgram(config, files) {
  const { svelte2tsx } = await import('svelte2tsx');
  const raw = ts.readConfigFile(config.tsconfig, ts.sys.readFile);
  if (raw.error) throw new Error(ts.flattenDiagnosticMessageText(raw.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(raw.config, ts.sys, path.dirname(config.tsconfig));
  // Native components become virtual roots, so the lack of .ts roots is expected.
  const errors = parsed.errors.filter(diagnostic => diagnostic.code !== 18003);
  if (errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, diagnosticHost));
  const options = { ...parsed.options, configFilePath: config.tsconfig, noEmit: true, allowImportingTsExtensions: true };
  const generated = new Map();
  const virtualSource = file => {
    if (!file.endsWith('.svelte.ts') || !ts.sys.fileExists(file.slice(0, -3))) return;
    if (!generated.has(file)) generated.set(file, svelte2tsx(ts.sys.readFile(file.slice(0, -3)), {
      filename: file.slice(0, -3), isTsFile: true, mode: 'ts', emitOnTemplateError: false,
    }).code);
    return generated.get(file);
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  host.fileExists = file => (file.endsWith('.svelte.ts') && ts.sys.fileExists(file.slice(0, -3))) || fileExists(file);
  host.getSourceFile = (file, ...args) => {
    const code = virtualSource(file);
    return code == null ? getSourceFile(file, ...args) : ts.createSourceFile(file, code, options.target ?? ts.ScriptTarget.Latest, true);
  };
  const program = ts.createProgram([...files.map(file => `${file}.ts`), require.resolve('svelte2tsx/svelte-shims-v4.d.ts'), require.resolve('svelte2tsx/svelte-jsx-v4.d.ts')], options, host);
  const ignored = new Map([...generated].map(([file, code]) => [file,
    [...code.matchAll(/\/\*Ωignore_startΩ\*\/[\s\S]*?\/\*Ωignore_endΩ\*\//g)].map(match => [match.index, match.index + match[0].length]),
  ]));
  // Ignore only compiler-marked scaffolding with no source position.
  const diagnostics = ts.getPreEmitDiagnostics(program).filter(diagnostic =>
    !(ignored.get(diagnostic.file?.fileName) ?? []).some(([start, end]) => diagnostic.start >= start && diagnostic.start < end));
  if (diagnostics.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, diagnosticHost));
  return { program, checker: program.getTypeChecker() };
}
