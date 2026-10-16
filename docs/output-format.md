# JSON document version 1

`document.schema.json` is the current wire contract, generated from the Rust
`wire` module. The CLI emits minified JSON with a trailing newline. Frontends
consume the same document regardless of language or UI framework.

The required top-level fields are `schemaVersion: 1`, `generator`, `title`,
`fingerprint`, `inputs`, `types`, and `symbols`. `diagnostics` and `rustdoc` default to `[]`.
Unknown fields and other schema versions are rejected. Public symbol IDs remain
opaque, stable strings. Numeric pointers are local to one artifact and must never
be used as persistent identities, URLs, or cross-artifact references.

## Tables and defaults

| Field | Meaning when present | Meaning when omitted |
| --- | --- | --- |
| `symbol.input` | Index into `inputs` (`name`, `language`) | Required |
| `symbol.parentId` | Index into `symbols` | No parent |
| `reference.targetId`, `relation.targetId` | Index into `symbols` | Unresolved/external |
| `symbol.type`, `parameter.type`, `signature.returns` | Index into `types` | No type |
| `typeParameter.constraint`, `typeParameter.default` | Index into `types` | No constraint/default |
| `symbol.group` | Explicit group, including `""` | Parent group; `""` for roots |
| `symbol.qualifiedName` | Explicit name | Derived from group/parent and name |
| `source.file` | Explicit relative file path | Parent's source file; required for roots/diagnostics |
| `source.endLine` | Explicit inclusive end line | Same as `line` |
| `signature.declaration`, `signature.description` | Explicit string, including `""` | Owning symbol's value |
| `signature.typeParameters` | Explicit templates, including `[]` | Owning symbol's templates |
| `symbol.framework` | Compiler-derived frontend framework metadata | No framework classification |

Indexes are nonnegative integers; **zero is valid**. Nullable pointer fields may
also explicitly contain `null`. Contextual string/list overrides must use their
actual type; `null` is rejected. A PHP root qualified name is `group\name` when its
group is nonempty, otherwise `name`. Members use `parent::name` for PHP and
`parent.name` for TypeScript. Rust members use `parent::name`; Rust and TypeScript roots use `name`. Nonmatching names remain
explicit, including re-exports and language-specific cases.

Other optional lists default to `[]`: modifiers, signatures, symbol templates,
relations, tags, type references, and signature parameters. Descriptions,
`returnsDescription`, and tag text default to `""`. `deprecated`, `optional`,
`variadic`, and `byReference` default to `false`. Missing sources are `null`;
missing parameter default expressions are `null`. Parameter defaults are source
strings, not type pointers, and an explicit empty string remains an empty string.
Required IDs, names, declarations, source lines, and type text are never inferred
from defaults.

Parameters may include `properties`, an optional array of parameter records for
compiler-provided object shapes. Each property retains its type pointer,
description, optional flag, and nested properties. TypeScript emits these for
inline object types and destructured named types. An omitted array means no
expanded shape is available. This field preserves the original parameter type text.

Parameters and nested properties may also carry `signatures` for callback-valued
APIs. These use the ordinary signature contract, with type pointers into `types`
and public targets represented by symbol indexes. Omitted callback signature
declarations and descriptions default to `""`; omitted callback type parameters
and parameters default to `[]`. They do not inherit the owning symbol's signature
fields. The inheritance rules in the table apply only to `symbol.signatures`.

### Framework metadata

`symbol.framework` is optional and only valid on TypeScript inputs. Its required
`name` is `react`, `solid`, `vue`, or `svelte`, and its required `role` is
`component` or `hook`. It retains the original symbol `kind`, public ID,
declaration, signatures, and relationships.

The optional `props`, `events`, `slots`, and `exposed` arrays contain parameter
records and default to `[]`. Their types use the shared `types` table, including
nested properties and callback parameters/returns. Descriptions, optional flags,
and default expressions follow the parameter rules above. Runtime validation
checks these nested pointers and references just like ordinary API signatures.
`resolveDocument` expands them into complete framework metadata.

The Fumadocs projection derives presentation keys such as `react-component`,
`react-hook`, `solid-component`, `vue-component`, and `svelte-component` from this
metadata. These are not wire symbol kinds. Component pages show props directly;
React hooks retain their normal parameter and return sections. See the
[TypeScript guide](../apps/docs/content/docs/0.x/typescript.mdx#frontend-components)
for supported declarations and compiler setup.

### Types and references

Types are interned using the complete object, including reference names and
targets. Identical text with different resolution targets denotes distinct table
entries. Raw tags, Markdown, overload overrides, and diagnostics are retained.

Types may include an optional `structure` from the compiler. Its `kind` is
`union` or `intersection` with a `types` array, or `generic` with a `name` and
`arguments` array. These arrays contain nested type records rather than table
indexes. They preserve each part's syntax and references while allowing
frontends to present alternatives and type arguments separately. The original
`text` always remains available.

Generic structures can also include `argumentParameters`, an ordered list of
`{ name, description? }` labels for the corresponding type arguments. This list
defaults to `[]`; descriptions default to `""`.

References may include `package` and `qualifiedName` for compiler-identified
external declarations. For example, `Element` from `@types/react` records
`React.JSX.Element`. Frontends can use this origin when choosing external links
without confusing it with a local or DOM declaration named `Element`. Both
additions are optional schema-v1 metadata.

Rust uses `language: "rust"` and kinds `struct`, `union`, `impl`, `macro`,
`primitive`, `extern-type`, `trait-alias`, and `reexport`. The `reexports`
relationship points to a documented target when available. Optional `rustdoc` entries contain `{ api, data }`:
the configured Rust input name and the compiler-native rustdoc JSON object.
`data.format_version` versions that upstream format independently of schema v1.
Optional `symbol.rustdocId` points to a key in the matching `data.index`.
Both validators require unique snapshots, a matching Rust input, a positive
format version, and valid provenance pointers. Native IDs and structured types
inside `data` are preserved rather than rewritten as shared symbol/type indexes.
The payload is retained once per input and is covered by the fingerprint.
PHP and TypeScript inputs omit these fields.

## Frontend consumption

```ts
import {
  parseDocument,
  resolveDocument,
  type Document,
  type ResolvedDocument,
} from '@nickwelsh/refquill-schema';

const wire: Document = parseDocument(JSON.parse(json));
// Alternatively, validate and resolve in one call:
const reference: ResolvedDocument = resolveDocument(JSON.parse(json));
```

The JavaScript helpers first require plain, acyclic JSON with structural depth
at most 64, at most 500,000 containers and 2,000,000 values, and at most 64 Mi
UTF-16 code units of combined keys and strings. Preserved rustdoc snapshots count
toward those limits. These frontend parser limits are separate from the wire
schema; flat parent edges do not contribute to JSON nesting depth.

`parseDocument` validates JSON Schema and graph invariants and returns the wire
document. `resolveDocument` also validates, then returns a complete semantic model:
input metadata is present on symbols, references contain public IDs, sources are
complete, and types are objects. Neither helper changes the input. Resolved type
objects are shared; treat them as immutable or clone before editing one. These
helpers validate shape and graph; `refquill validate` additionally checks the
fingerprint.

`createApiReference` uses the resolver, and its `document` is a `ResolvedDocument`.
Its public IDs, routes, source links, member anchors, search content, and rendering
remain based on the full semantic values. `resolved.schema.json`/`resolved.d.ts`
are generated from the internal Rust model for this projection; they are not a
second CLI output format.

JSON Schema specifies shape, optional fields, and contextual rules in descriptions.
Runtime validators check pointer bounds (including unused type entries), unique
IDs and input entries, parent cycles, cross-input parents, and portable source
paths/ranges. Parent resolution is iterative. Both Rust and JavaScript enforce
these invariants.

## Determinism and integrity

Generation sorts symbols by public ID, then assigns input/type indexes in
deterministic first-encounter order. Only exact defaults or inherited matches are
omitted. Object property order and whitespace do not affect the fingerprint:
SHA-256 hashes the serialized wire JSON with recursively sorted object keys and
an empty `fingerprint` field. Array order remains significant. Integrity checks
hash the original wire content before resolution, so edits to unused entries or
explicit defaults are covered too.

The writer only replaces an intact Refquill artifact. Replacing edited or unmanaged
regular files requires explicit `refquill generate refquill.json --force`.
Sidecar locks prevent concurrent writers, and writes use an atomic rename.
Symlink outputs are always refused. Identical output is left untouched.

Frontends should use `resolveDocument` or implement these table/default rules. Consumers of the wire
types use `Document`/`CompactSymbol`; consumers of resolved values use
`ResolvedDocument`/`Symbol`.
