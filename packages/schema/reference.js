import Ajv2020 from 'ajv/dist/2020.js';
import { checkJson } from './json.js';
import schema from './reference.schema.json' with { type: 'json' };

const validate = new Ajv2020({ allErrors: false, strict: false }).compile(schema);
const limits = { depth: 64, containers: 200_000, values: 1_000_000, text: 10 * 1024 * 1024 };
const fail = message => { throw new Error(`Invalid Refquill reference document: ${message}`); };

/** Validate the rendering document at a frontend's trust boundary. The input is
 * returned unchanged; callers should treat the validated result as immutable. */
export function parseReferenceDocument(input) {
  checkJson(input, limits, fail);
  if (!validate(input)) fail(validate.errors.map(error => `${error.instancePath || '/'} ${error.message}`).join('; '));
  const ids = new Set();
  const links = [];
  const addId = id => {
    if (ids.has(id)) fail(`duplicate ID: ${id}`);
    ids.add(id);
  };
  const checkLinks = (value, code) => {
    const intervals = [];
    for (const link of value ?? []) {
      if (link.start >= link.end || link.end > code.length || splitsSurrogate(code, link.start) || splitsSurrogate(code, link.end)) fail('invalid code link offsets');
      if (link.url != null) checkUrl(link.url);
      if (link.targetId != null) links.push(link.targetId);
      intervals.push(link);
    }
    intervals.sort((left, right) => left.start - right.start);
    for (let index = 1; index < intervals.length; index++) if (intervals[index].start < intervals[index - 1].end) fail('overlapping code links');
  };
  const pages = [...input.children];
  while (pages.length) {
    const page = pages.pop();
    addId(page.id);
    if (page.url != null) checkUrl(page.url);
    if (page.sourceUrl != null) checkUrl(page.sourceUrl);
    const definitions = new Map();
    const highlights = [];
    const anchors = new Set([page.id]);
    const addAnchor = anchor => {
      if (anchors.has(anchor)) fail(`duplicate page anchor: ${anchor}`);
      anchors.add(anchor);
    };
    const addDefinition = definition => {
      addId(definition.id);
      addAnchor(definition.id);
      definitions.set(definition.id, definition.code.split(/\r\n|\r|\n/));
      checkLinks(definition.links, definition.code);
    };
    if (page.definition) addDefinition(page.definition);
    const blocks = [...page.blocks];
    while (blocks.length) {
      const block = blocks.pop();
      if (block.id != null) addId(block.id);
      if (block.id != null) addAnchor(block.anchor ?? block.id);
      if (block.kind === 'code') addDefinition(block.definition);
      if (block.kind === 'entry') {
        if (block.url != null) checkUrl(block.url);
        if (block.sourceUrl != null) checkUrl(block.sourceUrl);
        if (typeof block.title !== 'string') checkLinks(block.title.links, block.title.code);
        if (block.display === 'disclosure' && !block.blocks?.length && !block.description?.trim()) fail(`disclosure has no body: ${block.id}`);
        if (block.display === 'static' && block.defaultOpen != null) fail(`defaultOpen requires a disclosure: ${block.id}`);
        highlights.push(...(block.highlights ?? []));
      }
      blocks.push(...(block.blocks ?? []));
    }
    for (const highlight of highlights) checkHighlight(highlight, definitions);
    if (page.kind === 'directory') pages.push(...page.children);
  }
  for (const target of links) if (!ids.has(target)) fail(`missing code link target: ${target}`);
  return input;
}

function checkHighlight({ definitionId, range: { start, end } }, definitions) {
  const lines = definitions.get(definitionId);
  if (!lines) fail(`missing page-local definition: ${definitionId}`);
  if (start.line > end.line || end.line > lines.length) fail(`invalid highlight lines: ${definitionId}`);
  if ((start.column == null) !== (end.column == null)) fail('highlight columns must both be present or omitted');
  if (start.column == null) return;
  for (const position of [start, end]) {
    const line = lines[position.line - 1];
    if (position.column > line.length + 1 || splitsSurrogate(line, position.column - 1)) fail(`invalid highlight column: ${definitionId}`);
  }
  if (start.line === end.line && start.column >= end.column) fail(`empty or reversed highlight: ${definitionId}`);
}

function splitsSurrogate(text, offset) {
  return offset > 0 && offset < text.length
    && text.charCodeAt(offset - 1) >= 0xd800 && text.charCodeAt(offset - 1) <= 0xdbff
    && text.charCodeAt(offset) >= 0xdc00 && text.charCodeAt(offset) <= 0xdfff;
}

function checkUrl(value) {
  // Browsers normalize controls and backslashes before interpreting schemes.
  if (!value || /[\s\u0000-\u001f\u007f\\]/u.test(value) || value.startsWith('//')) fail(`unsafe URL: ${value}`);
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value);
  if (scheme && !['http', 'https', 'mailto'].includes(scheme[1].toLowerCase())) fail(`unsafe URL scheme: ${scheme[1]}`);
  if (scheme && scheme[1].toLowerCase() !== 'mailto') {
    try { if (!new URL(value).hostname) fail('URL requires a host'); } catch { fail(`invalid URL: ${value}`); }
  }
}
