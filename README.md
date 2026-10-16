# Refquill

Generate a portable JSON API reference from PHP, TypeScript, and Rust. Refquill uses Mago, TypeDoc, and rustdoc to read declarations, comments, types, and relationships. Render the output with Fumadocs or use it in your own frontend.

## Install

Requires Node 22.18 or newer. Prebuilt binaries support macOS on Apple Silicon, Linux arm64/x64, and Windows x64. PHP analysis needs no PHP runtime or Composer dependency.

```sh
npm install --save-dev @nickwelsh/refquill
npx refquill init --language typescript
# Edit refquill.json to select your sources.
npx refquill generate
```

Use `--language php` or `--language rust` for other projects. One configuration can combine multiple languages, including React, SolidJS, Vue, and Svelte components.

Rust analysis accepts rustdoc JSON format 61. Generating it through Cargo requires a compatible nightly and runs the project's build scripts and procedural macros. Importing existing rustdoc JSON needs no compiler.

Generation preserves the previous output if analysis fails. Replacing an edited output requires `--force`.

Read the [getting started guide](https://docs.nickwelsh.me/refquill/docs/0.x) for configuration and language support.

## Packages

| Package                                                     | Purpose                                                        |
| ----------------------------------------------------------- | -------------------------------------------------------------- |
| [@nickwelsh/refquill](packages/cli/README.md)               | Generate and validate API documents                            |
| [@nickwelsh/refquill-schema](packages/schema/README.md)     | JSON Schemas, TypeScript types, and JavaScript validators      |
| [@nickwelsh/refquill-fumadocs](packages/fumadocs/README.md) | Render API documents, JSON Schemas, and manpages with Fumadocs |

## Development

Requires Rust 1.99 or newer, Node 22.18 or newer, and pnpm 11.24.0.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm check
pnpm schema:check
```

Run `pnpm schema` after changing the Rust document model to regenerate schemas and types.

Start the [documentation site](apps/docs/README.md) with `pnpm docs:dev`. The [Rust example](examples/rust-fumadocs/README.md) and [framework example](examples/frameworks-fumadocs/README.md) show Fumadocs integration.

See the [engineering docs](docs/README.md) for architecture, document formats, and releases, or the [development guide](https://docs.nickwelsh.me/refquill/docs/0.x/development) for the full verification workflow.

MIT licensed.
