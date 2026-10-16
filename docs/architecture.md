# Architecture

`refquill generate` loads one JSON config, runs each language analyzer, combines symbols, validates the shared graph and JSON Schema, and atomically writes one document. No PHP runtime or Composer package is involved. The Rust binary owns configuration, PHP/rustdoc extraction, identity, validation, and output. A bundled Node worker uses TypeDoc and the TypeScript compiler for TypeScript semantics without executing source modules or loading project TypeDoc plugins. Rust inputs either import rustdoc JSON or explicitly invoke Cargo to generate it; Cargo mode executes build scripts/procedural macros and uses the compiler for macro expansion, cfg, and type resolution.

The Rust adapter accepts rustdoc format 61. Its compiler-native graph is retained
once per input in the optional `rustdoc` table; shared symbols point to native
items with `rustdocId`. This boundary keeps Rust's type and implementation model
available without forcing it into a lossy universal type grammar. The wire
encoder leaves this upstream payload opaque, while the common projection
provides stable Refquill IDs, declarations, types, relationships, and source
paths for existing frontends. Rustdoc IDs are snapshot-local and compiler-version
dependent. Source paths are sanitized and exclusions apply to the snapshot too.

The document is independent of Fumadocs: it contains no routes, React data, compressed frontend caches, or theme settings. Every symbol has a stable opaque ID. Schema version 1 stores configured input names/languages and complete types in shared tables. Members, types, and inheritance use numeric table indexes; unresolved names are retained. Exact defaults and parent/signature metadata matches are omitted. The shared `resolveDocument` helper exposes the complete semantic model, including each input name (`symbol.api`) and public reference IDs. See [output-format.md](output-format.md) for the wire rules. Type syntax remains language-native rather than being forced into an incomplete universal grammar. Documentation is Markdown; tags retain language-specific information.

The Rust wire model owns the version 1 contract; analyzers retain a complete semantic model. `pnpm schema` generates JSON Schema (2020-12) and TypeScript declarations. Runtime validators reject unknown fields, unsupported versions, duplicate IDs, missing references, and cyclic parents or parents from different inputs. `pnpm schema:check` detects drift. Breaking contract changes require a new schema version.

Generation is deterministic: sorted symbols, relative source paths, no timestamps, and a SHA-256 fingerprint over canonical wire JSON with an empty fingerprint field. Integrity checks hash the original wire content before resolving tables/defaults. Existing output must be an intact Refquill artifact unless the caller explicitly passes `--force`. A sidecar lock prevents simultaneous writers; a temporary file in the destination directory is synced and atomically renamed. Failed analysis preserves previous output. Symlink outputs are always refused. Remove a stale `.json.lock` only after confirming its process is no longer running.

Mago syntax, names, allocator, and unified PHPDoc syntax crates are pinned together at 1.56.3 and require Rust 1.99. The unified PHPDoc parser owns type/prose boundaries and structured parameter, return, and template annotations. TypeDoc is chosen over a Rust TypeScript syntax parser because inferred types, overloads, and re-exports require compiler semantics.

Frontend framework semantics extend TypeScript symbols through optional
`framework` metadata. React and SolidJS extraction uses compiler types and JSX
settings; Vue and Svelte single-file components use `vue-component-meta` and
`svelte2tsx`. Framework props, events, slots, and exposed members reuse the shared
parameter/type/signature model. Original symbol kinds and identities remain
unchanged. The Fumadocs projection owns component labels and sections in the
separate `ReferenceDocument` presentation contract; the shared renderer owns
layout, links, and interactions.
