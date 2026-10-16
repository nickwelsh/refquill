import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import React from 'react';
import { parseReferenceDocument, type ReferenceBlock } from '@nickwelsh/refquill-schema';
import { renderToString } from 'react-dom/server';
import { loader } from 'fumadocs-core/source';
import { createManPageReference } from '../src/index.js';
import { ManPageReference } from '../src/components.js';

const manual = readFileSync(new URL('../../cli/man/refquill.1', import.meta.url), 'utf8');
const curl = String.raw`.TH curl 1 "October 15, 2026" "curl" "curl Manual"
.SH NAME
curl \- transfer a URL
.SH PROTOCOLS
Protocol availability depends on the build.
.IP HTTP
Transfer over HTTP.
.IP FTP
Transfer over FTP.
.SH OPTIONS
.IP "\-o, \-\-output <file>"
Write the response to a file instead of standard output.

The last value wins when this option is repeated.
.nf
 curl --output result.txt https://example.com
.fi
.IP "\-\-retry <count>"
Retry transient failures.
.SH EXIT CODES
.IP 0
Success.
.IP 7
Connection failed.
`;

test('the shipped CLI manpage supplies one routable page, sections, options, examples, search, and Markdown', () => {
  const reference = createManPageReference({ input: manual, baseUrl: '/reference/cli' });
  assert.equal(reference.title, 'REFQUILL(1)');
  const source = loader({ baseUrl: reference.baseUrl, source: reference.toFumadocsSource() });
  const [page] = source.getPages();
  assert.equal(page.url, '/reference/cli');
  assert.equal(page.data.title, reference.title);
  const options = reference.document.sections.flatMap(section => section.blocks.flatMap(block => block.type === 'entries' && block.options ? block.entries : []));
  assert.deepEqual(options.map(entry => entry.term), ['-h, --help', '-V, --version', '--config PATH', '--language LANGUAGE', '--force', '--output DIRECTORY']);
  const force = options.find(entry => entry.term === '--force')!;
  assert.ok(force.content.some(block => block.type === 'code' && block.text.includes('--force')));
  assert.ok(page.data.toc.some(item => item.url === `#${force.id}`));
  assert.ok(page.data.structuredData.contents.some(item => item.heading === force.id && item.content.includes('unmanaged or edited')));
  const text = reference.getPageText();
  for (const value of ['## Synopsis', '### --force', '```text', 'refquill generate refquill.json --force', 'https://docs.nickwelsh.me/refquill/docs/0.x']) assert.ok(text.includes(value), value);
  const html = renderToString(<ManPageReference reference={reference} />);
  assert.ok(html.includes(`<details id="${force.id}"`));
  assert.ok(html.includes('refquill generate refquill.json --force'));
  assert.ok(html.includes('refquill-member'));
  assert.ok(html.includes('REFQUILL_BINARY'));
  assert.ok(!html.includes('<details id="man-environment-refquill-binary"'));
  assert.ok(html.includes('href="https://docs.nickwelsh.me/refquill/docs/0.x"'));
});

test('web section names use sentence case without changing source headings, acronyms, or anchors', () => {
  const reference = createManPageReference({ input: '.TH demo 1\n.SH EXIT STATUS\nSuccess.\n.SH HTTP API\nProtocol details.\n' });
  assert.equal(reference.document.sections[0].title, 'EXIT STATUS');
  const page = reference.toReferenceDocument().children[0];
  assert.equal(page.blocks[0].kind === 'section' && page.blocks[0].title, 'Exit status');
  assert.equal(page.blocks[0].kind === 'section' && page.blocks[0].id, 'man-exit-status');
  assert.equal(page.blocks[1].kind === 'section' && page.blocks[1].title, 'HTTP API');
  const source = reference.toFumadocsSource().files[0];
  if (source.type !== 'page') assert.fail();
  assert.ok(source.data.toc.some(item => item.title === 'Exit status' && item.url === '#man-exit-status'));
  assert.ok(reference.getPageText().includes('## Exit status {#man-exit-status}'));
});

test('the Name summary appears once in the header while extra Name content is preserved', () => {
  const reference = createManPageReference({ input: manual });
  const page = reference.toReferenceDocument().children[0];
  assert.equal(page.description, 'refquill - generate portable PHP, TypeScript, and Rust API references');
  assert.ok(!page.blocks.some(block => block.kind === 'section' && block.id === 'man-name'));
  const source = reference.toFumadocsSource().files[0];
  if (source.type !== 'page') assert.fail();
  assert.ok(!source.data.toc.some(item => item.url === '#man-name'));
  const options = page.blocks.find(block => block.kind === 'section' && block.id === 'man-options');
  assert.ok(options?.kind === 'section');
  assert.ok(options.blocks.some(block => block.kind === 'section' && block.title === 'Common options'));
  const html = renderToString(<ManPageReference reference={reference} />);
  assert.equal(html.split(page.description!).length - 1, 1);
  const extra = createManPageReference({ input: '.TH demo 1\n.SH NAME\ndemo - example\n.PP\nAdditional name details.\n.SH DESCRIPTION\nMore details.\n' });
  assert.ok(extra.getPageText().includes('Additional name details.'));
  assert.equal(extra.getPageText().split('demo - example').length - 1, 1);
});

test('files, environment variables, and exit codes render as definition lists with stable term anchors', () => {
  const reference = createManPageReference({ input: manual });
  const html = renderToString(<ManPageReference reference={reference} />);
  assert.equal(html.match(/<dl class="refquill-man-definitions">/g)?.length, 3);
  assert.match(html, /id="man-files-refquill-json"><dt><code>refquill\.json<\/code><\/dt><dd>/);
  assert.match(html, /id="man-environment-refquill-binary"><dt><code>REFQUILL_BINARY<\/code><\/dt><dd>/);
  assert.match(html, /id="man-exit-status-0"><dt><code>0<\/code><\/dt><dd>/);
  assert.ok(html.includes('Override the native executable'));
  assert.match(html, /<details id="man-generate-options-force"/);
  const mixed = createManPageReference({ input: '.TH demo 1\n.SH ENVIRONMENT\nIntroductory text.\n.TP\n.B DEMO\nValue description.\n.EX\necho demo\n.EE\n.SS Details\nAdditional information.\n' });
  const mixedHtml = renderToString(<ManPageReference reference={mixed} renderCode={code => <pre data-host="code">{code}</pre>} />);
  for (const value of ['Introductory text.', '<dt><code>DEMO</code></dt>', 'Value description.', 'data-host="code"', 'Additional information.']) assert.ok(mixedHtml.includes(value), value);
});

test('curl-style IP lists become static protocol entries and option disclosures with intact paragraphs and examples', () => {
  const reference = createManPageReference({ input: curl });
  assert.equal(reference.title, 'curl(1)');
  const protocols = reference.document.sections.find(section => section.title === 'PROTOCOLS')!;
  assert.equal(protocols.blocks[1].type, 'entries');
  const options = reference.document.sections.find(section => section.title === 'OPTIONS')!.blocks[0];
  assert.equal(options.type, 'entries');
  if (options.type !== 'entries') return;
  assert.ok(options.options);
  assert.equal(options.entries[0].term, '-o, --output <file>');
  assert.equal(options.entries[0].content.length, 3);
  assert.equal(options.entries[0].content[2].type, 'code');
  const html = renderToString(<ManPageReference reference={reference} />);
  assert.ok(html.includes('HTTP'));
  assert.ok(!html.includes('<details id="man-protocols-http"'));
  assert.ok(html.includes('man-exit-codes-0'));
  assert.ok(html.includes('-o, --output &lt;file&gt;'));
  assert.ok(html.includes('curl --output result.txt https://example.com'));
  const source = reference.toFumadocsSource().files[0];
  if (source.type !== 'page') assert.fail();
  assert.ok(source.data.structuredData.contents.every(content => content.heading === undefined || source.data.structuredData.headings.some(heading => heading.id === content.heading)));
});

test('tags, aliases, repeated headings, font macros, escapes, and long code fences retain content and unique anchors', () => {
  const input = String.raw`.TH demo 1
.SH
OPTIONS
.TP
.BR "\-o" ", \-\-output <file>"
.TQ
.B --out
Use a \(lqfile\(rq.
.PP
.B "A bold paragraph."
.EX
example with ${'````'} and <file>
.EE
.TP
.B
--out
Another entry.
.SH OPTIONS
Another section.
`;
  const reference = createManPageReference({ input });
  const first = reference.document.sections[0].blocks[0];
  if (first.type !== 'entries') assert.fail();
  assert.equal(first.entries[0].term, '-o, --output <file>, --out');
  assert.ok(reference.getPageText().includes('**A bold paragraph.**'));
  assert.ok(reference.getPageText().includes('`````text'));
  assert.ok(reference.getPageText().includes('“file”'));
  const toc = reference.toFumadocsSource().files[0];
  if (toc.type !== 'page') assert.fail();
  const ids = toc.data.toc.map(item => item.url);
  assert.equal(ids.length, new Set(ids).size);
});

test('conventional rendered text accepts terminal overstrikes and preserves option examples and protocol rows', () => {
  const input = 'CURL(1)                       User Commands                       CURL(1)\n\nNAME\n       curl - transfer a URL\n\nPROTOCOLS\n       HTTP\n              Transfer over HTTP.\n       FTP\n              Transfer over FTP.\n\nOPTIONS\n       --output <file>\n              Write to a file.\n\n              curl --output result.txt https://example.com\n\n       --retry <count>\n              Retry failures.\n';
  const reference = createManPageReference({ input: input.replace('Write', 'W\bWrite') });
  assert.equal(reference.title, 'CURL(1)');
  const html = renderToString(<ManPageReference reference={reference} />);
  assert.ok(html.includes('HTTP'));
  assert.ok(!html.includes('<details id="man-protocols-http"'));
  assert.ok(html.includes('--output &lt;file&gt;'));
  assert.ok(html.includes('curl --output result.txt https://example.com'));
  assert.ok(!html.includes('\b'));
});

test('untrusted manuals stay data, links are validated, unsupported roff fails explicitly, and work is bounded', () => {
  const reference = createManPageReference({ input: '.TH demo 1\n.SH DESCRIPTION\n<script>alert(1)</script> {danger()} [link](javascript:alert)\n.nf\n<script>code</script>\n.fi\n', sourceUrl: 'https://example.com/manual' });
  const html = renderToString(<ManPageReference reference={reference} renderCode={(text, language) => { assert.equal(language, 'text'); return <pre data-host="code">{text}</pre>; }} renderLink={props => <a {...props} data-host="link" />} />);
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(html.includes('{danger()}'));
  assert.ok(html.includes('data-host="code"'));
  assert.ok(html.includes('data-host="link"'));
  for (const macro of ['so /etc/passwd', 'sy touch /tmp/unsafe', 'de custom', 'if 1 dangerous', 'TS']) assert.throws(() => createManPageReference({ input: `.TH demo 1\n.SH DESCRIPTION\n.${macro}` }), /Unsupported manpage request/);
  assert.throws(() => createManPageReference({ input: '.TH demo 1\n.SH DESCRIPTION\n.UR javascript:alert\nBad\n.UE' }), /Unsafe manpage link/);
  assert.throws(() => createManPageReference({ input: '.TH demo 1\n.SH DESCRIPTION\n.nf\nunclosed' }), /Unclosed/);
  assert.throws(() => createManPageReference({ input: '.TH demo 1\n.SH OPTIONS\n.TP' }), /Unclosed/);
  assert.throws(() => createManPageReference({ input: 'no headings' }), /section headings/);
  assert.throws(() => createManPageReference({ input: 'x'.repeat(2_000_001) }), /limits/);
  assert.throws(() => createManPageReference({ input: '\n'.repeat(50_001) }), /limits/);
  assert.throws(() => createManPageReference({ input: manual, baseUrl: '//unsafe' }), /baseUrl/);
  assert.throws(() => createManPageReference({ input: manual, sourceUrl: 'javascript:alert' }), /sourceUrl/);
});


test('manual projections share section, static entry, disclosure, and code primitives without losing hidden bodies', () => {
  const reference = createManPageReference({ input: `${curl}.SS Advanced\nAdditional options.\n.IP --advanced\nHidden advanced details.\n` });
  const document = parseReferenceDocument(JSON.parse(JSON.stringify(reference.toReferenceDocument())));
  const blocks: ReferenceBlock[] = [];
  const visit = (children: ReferenceBlock[]) => { for (const block of children) { blocks.push(block); if (block.kind === 'section' || block.kind === 'entry') visit(block.blocks ?? []); } };
  visit(document.children[0].blocks);
  const protocols = blocks.filter(block => block.kind === 'entry' && block.type?.key === 'term');
  assert.ok(protocols.length);
  assert.ok(protocols.every(block => block.kind === 'entry' && block.display === 'static'));
  assert.ok(blocks.some(block => block.kind === 'entry' && block.type?.key === 'option' && block.display === 'disclosure'));
  assert.ok(blocks.some(block => block.kind === 'code' && block.definition.code.includes('curl --output')));
  assert.ok(blocks.some(block => block.kind === 'section' && block.title === 'Advanced'));
  assert.ok(reference.getPageText().includes('Hidden advanced details.'));
  const source = reference.toFumadocsSource().files[0];
  if (source.type !== 'page') assert.fail();
  assert.ok(source.data.structuredData.contents.some(content => content.content.includes('Hidden advanced details.')));
});
