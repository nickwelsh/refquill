# @nickwelsh/refquill

Generate JSON API references from PHP, TypeScript, and Rust with one CLI. TypeScript inputs also support React, SolidJS, Vue, and Svelte components. PHP analysis needs no PHP runtime or Composer dependency.

## Install

Requires Node 22.18 or newer. Prebuilt binaries support macOS on Apple Silicon, Linux arm64/x64, and Windows x64.

```sh
npm install --save-dev @nickwelsh/refquill
npx refquill init --language php
# Edit refquill.json to select your sources.
npx refquill generate
npx refquill validate docs/api.generated.json
```

Use `--language typescript` or `--language rust` for other projects, or combine languages in one configuration.

Rust analysis accepts rustdoc JSON format 61. Cargo generation requires a compatible nightly and runs project build scripts and procedural macros. You can also import existing rustdoc JSON.

Generation preserves the previous output if analysis fails. Replacing an edited output requires `--force`.

## Documentation

Read the [configuration guide](https://docs.nickwelsh.me/refquill/docs/0.x/configuration) and [language guides](https://docs.nickwelsh.me/refquill/docs/0.x). The package also includes a terminal manual:

```sh
man ./node_modules/@nickwelsh/refquill/man/refquill.1
```

Use [@nickwelsh/refquill-schema](https://www.npmjs.com/package/@nickwelsh/refquill-schema) to validate documents in JavaScript and [@nickwelsh/refquill-fumadocs](https://www.npmjs.com/package/@nickwelsh/refquill-fumadocs) to render them.

[Report an issue](https://github.com/nickwelsh/refquill/issues). MIT licensed.
