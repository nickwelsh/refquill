import Ajv2020 from 'ajv/dist/2020.js';
import { checkJson } from './json.js';
import schema from './document.schema.json' with { type: 'json' };
export { parseReferenceDocument } from './reference.js';

const ajv = new Ajv2020({ allErrors: false, strict: false });
const limits = { depth: 64, containers: 500_000, values: 2_000_000, text: 64 * 1024 * 1024 };
const fail = message => { throw new Error(`Invalid Refquill document: ${message}`); };
ajv.addFormat('uint32', { type: 'number', validate: value => Number.isInteger(value) && value >= 0 && value <= 0xffffffff });
const validate = ajv.compile(schema);

/** Validate the v1 wire shape and graph at a frontend's trust boundary. */
export function parseDocument(input) {
  readDocument(input);
  return input;
}

/** Resolve defaults, inheritance, and pointers. Complete type objects are shared
 * within the returned document; the input is never mutated. */
export function resolveDocument(input) {
  return readDocument(input);
}

function readDocument(input) {
  checkJson(input, limits, fail);
  if (!validate(input)) throw new Error(`Invalid Refquill document: ${validate.errors.map(e => `${e.instancePath || '/'} ${e.message}`).join('; ')}`);
  const { symbols, inputs } = input;
  const ids = new Set();
  for (const symbol of symbols) {
    if (ids.has(symbol.id)) throw new Error(`Duplicate symbol ID: ${symbol.id}`);
    ids.add(symbol.id);
  }
  const inputKeys = new Set();
  for (const entry of inputs) {
    const key = JSON.stringify([entry.name, entry.language]);
    if (inputKeys.has(key)) throw new Error('Duplicate input');
    inputKeys.add(key);
  }
  const rustInputs = new Set();
  for (const symbol of symbols) {
    const entry = inputs[symbol.input];
    if (entry?.language === 'rust') rustInputs.add(entry.name);
  }
  const rustdoc = new Map();
  for (const snapshot of input.rustdoc ?? []) {
    if (rustdoc.has(snapshot.api)) throw new Error(`Duplicate rustdoc input: ${snapshot.api}`);
    if (!rustInputs.has(snapshot.api)) throw new Error(`Missing Rust input for rustdoc: ${snapshot.api}`);
    if (!Number.isInteger(snapshot.data.format_version) || snapshot.data.format_version < 1 || snapshot.data.format_version > 0xffffffff) throw new Error(`Invalid rustdoc format_version: ${snapshot.api}`);
    if (snapshot.data.index == null || typeof snapshot.data.index !== 'object' || Array.isArray(snapshot.data.index)) throw new Error(`Missing rustdoc index: ${snapshot.api}`);
    rustdoc.set(snapshot.api, snapshot.data);
  }
  const at = (values, index, label) => {
    if (!Number.isInteger(index) || index < 0 || index >= values.length) throw new Error(`Invalid ${label} index: ${index}`);
    return values[index];
  };
  const target = index => index == null ? null : at(symbols, index, 'reference target').id;
  // Validate even unused table entries. Type identity includes resolved targets.
  const expandType = type => ({
    text: type.text,
    references: (type.references ?? []).map(ref => ({ name: ref.name, targetId: target(ref.targetId), ...(ref.package ? { package: ref.package } : {}), ...(ref.qualifiedName ? { qualifiedName: ref.qualifiedName } : {}) })),
    ...(type.structure ? { structure: type.structure.kind === 'generic'
      ? { kind: 'generic', name: type.structure.name, ...(type.structure.argumentParameters?.length ? { argumentParameters: type.structure.argumentParameters.map(p => ({ name: p.name, description: p.description ?? '' })) } : {}), arguments: type.structure.arguments.map(expandType) }
      : { kind: type.structure.kind, types: type.structure.types.map(expandType) } } : {}),
  });
  const types = input.types.map(expandType);
  const type = index => index == null ? null : at(types, index, 'type');
  const templates = values => (values ?? []).map(p => ({ name: p.name, constraint: type(p.constraint), default: type(p.default), description: p.description ?? '' }));
  const source = (value, parentFile) => {
    if (value == null) return null;
    const file = value.file ?? parentFile;
    if (file == null) throw new Error('Missing inherited source file');
    const result = { file, line: value.line, endLine: value.endLine ?? value.line };
    checkSource(result);
    return result;
  };
  const states = new Uint8Array(symbols.length);
  const parameter = p => ({
    name: p.name, type: type(p.type), description: p.description ?? '',
    optional: p.optional ?? false, variadic: p.variadic ?? false,
    byReference: p.byReference ?? false, default: p.default ?? null,
    ...(p.properties?.length ? { properties: p.properties.map(parameter) } : {}),
    ...(p.signatures?.length ? { signatures: p.signatures.map(sig => signature(sig)) } : {}),
  });
  const signature = (sig, owner = {}) => ({
    declaration: sig.declaration ?? owner.declaration ?? '',
    description: sig.description ?? owner.description ?? '',
    parameters: (sig.parameters ?? []).map(parameter),
    returns: type(sig.returns), returnsDescription: sig.returnsDescription ?? '',
    typeParameters: sig.typeParameters == null ? owner.typeParameters ?? [] : templates(sig.typeParameters),
  });
  const resolved = new Array(symbols.length);
  for (let start = 0; start < symbols.length; start++) {
    const chain = [];
    let current = start;
    while (current != null) {
      if (states[current] === 2) break;
      if (states[current] === 1) throw new Error(`Cyclic parent: ${symbols[current].id}`);
      states[current] = 1;
      chain.push(current);
      const symbol = symbols[current];
      at(inputs, symbol.input, 'input');
      if (symbol.parentId != null) {
        const parent = at(symbols, symbol.parentId, 'parent');
        if (parent.input !== symbol.input) throw new Error(`Cross-input parent: ${parent.id}`);
      }
      current = symbol.parentId;
    }
    for (const index of chain.reverse()) {
      const s = symbols[index];
      const entry = inputs[s.input];
      const parent = s.parentId == null ? null : resolved[s.parentId];
      if (s.rustdocId != null) {
        if (entry.language !== 'rust') throw new Error(`rustdocId requires a Rust symbol: ${s.id}`);
        if (!Object.hasOwn(rustdoc.get(entry.name)?.index ?? {}, s.rustdocId)) throw new Error(`Missing rustdoc item: ${s.rustdocId}`);
      }
      if (s.framework && entry.language !== 'typescript') throw new Error(`Framework metadata requires a TypeScript symbol: ${s.id}`);
      const group = s.group ?? parent?.group ?? '';
      const qualifiedName = s.qualifiedName ?? (parent ? `${parent.qualifiedName}${entry.language === 'php' || entry.language === 'rust' ? '::' : '.'}${s.name}` : `${entry.language === 'php' && group ? `${group}\\` : ''}${s.name}`);
      const description = s.description ?? '';
      const typeParameters = templates(s.typeParameters);
      resolved[index] = {
        id: s.id, language: entry.language, kind: s.kind, name: s.name,
        qualifiedName, api: entry.name, group, parentId: parent?.id ?? null,
        declaration: s.declaration, description, deprecated: s.deprecated ?? false, promoted: s.promoted ?? false,
        modifiers: [...(s.modifiers ?? [])], source: source(s.source, parent?.source?.file),
        type: type(s.type), typeParameters,
        signatures: (s.signatures ?? []).map(sig => signature(sig, { declaration: s.declaration, description, typeParameters })),
        relations: (s.relations ?? []).map(r => ({ kind: r.kind, name: r.name, targetId: target(r.targetId) })),
        tags: (s.tags ?? []).map(t => ({ name: t.name, text: t.text ?? '' })),
        ...(s.rustdocId == null ? {} : { rustdocId: s.rustdocId }),
        ...(s.framework ? { framework: { name: s.framework.name, role: s.framework.role,
          props: (s.framework.props ?? []).map(parameter), events: (s.framework.events ?? []).map(parameter), slots: (s.framework.slots ?? []).map(parameter), exposed: (s.framework.exposed ?? []).map(parameter) } } : {}),
      };
      states[index] = 2;
    }
  }
  return {
    schemaVersion: 1, generator: { ...input.generator }, title: input.title,
    fingerprint: input.fingerprint, symbols: resolved,
    diagnostics: (input.diagnostics ?? []).map(d => ({ message: d.message, source: source(d.source) })),
    ...(input.rustdoc?.length ? { rustdoc: structuredClone(input.rustdoc) } : {}),
  };
}

function checkSource(source) {
  if (source.line < 1 || source.endLine < source.line || /[\\:]/.test(source.file) || source.file.split('/').some(s => !s || s === '.' || s === '..')) throw new Error(`Invalid source path or range: ${source.file}`);
}
