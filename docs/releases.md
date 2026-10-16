# Release packaging

The npm command package is [@nickwelsh/refquill](https://www.npmjs.com/package/@nickwelsh/refquill); the frontend is [@nickwelsh/refquill-fumadocs](https://www.npmjs.com/package/@nickwelsh/refquill-fumadocs). [@nickwelsh/refquill-schema](https://www.npmjs.com/package/@nickwelsh/refquill-schema) publishes the shared contract. All packages use the same release version. The analyzer and reference document contracts both start at `schemaVersion: 1`; their versions change independently of the npm release when a contract breaks. Public documentation is at [docs.nickwelsh.me/refquill](https://docs.nickwelsh.me/refquill/).

Four small optional packages contain prebuilt executables: `@nickwelsh/refquill-{darwin-arm64,linux-arm64,linux-x64,win32-x64}`. These support macOS on Apple Silicon (arm64), Linux arm64/x64, and Windows x64. npm selects the package matching its OS/CPU fields. The wrapper starts the binary and supplies the bundled TypeScript worker and Node executable. There is no network download or compilation during installation and no postinstall script. Linux executables target musl for distribution across libc variants. The release script adds these dependencies to the packed command manifest; the development workspace does not depend on unpublished binary packages.

## GitHub Actions release flow

The repository is [nickwelsh/refquill](https://github.com/nickwelsh/refquill). `Verify` runs Rust formatting and Clippy, model and compiler tests, schema regeneration checks, frontend type checks and tests, generation and type checks for both examples, and the complete generated docs build, validation, type checks, tests, and HTTP smoke checks. `Package native CLI` builds all four native targets, executes each binary on a matching architecture, and checks the actual release tarballs in isolated consumers. The consumers typecheck the public schema and Fumadocs APIs, render API, generic reference, JSON Schema, and manpage content, and run the installed CLI against PHP, TypeScript, Rust snapshots, React, SolidJS, Vue, and Svelte. Repeated generation must preserve the artifact and its modification time. Packaging produces the `npm-packages` workflow artifact.

All four platforms run installed-consumer checks on Node 24; Linux x64 also runs on the minimum supported Node 22.18.0. Rust build, test, analyzer generation, and Clippy commands use `--locked`; dependency installation uses the frozen pnpm lockfile. Schema drift and release metadata tests fail before staging if generated contracts, package identities, Cargo/npm versions, or the release tag disagree.

`Stage npm release` lives in `.github/workflows/publish.yml`. Push a `v<version>` tag, or dispatch that workflow against an existing release tag. The tag must match the Rust and all npm package versions. The workflow requires verification, packaging, and installed-consumer checks on all four platforms to succeed, then uses GitHub OIDC in the `npm` environment to stage all seven tarballs. Stable versions use the `latest` distribution tag; prereleases use `next`. It also prepares a draft GitHub release with the tarballs and their checksums for review.

The publishing job uses **only `npm stage publish`** to submit packages to npm. It does not finalize publication. Approve the staged packages on npm to make them available in the registry; GitHub environment approval and npm staged-package approval are separate controls. No npm publishing token belongs in repository secrets. Protect the `npm` GitHub environment with the desired release reviewers before enabling releases.

If staging fails after some packages succeed, inspect those staged versions before rerunning. npm reserves staged versions, so blindly rerunning the staging job fails on the versions already submitted. A maintainer can reject the partial staged set with 2FA before rerunning the same release; the GitHub identity is intentionally unable to approve or reject packages.

## Package names

The coordinated release contains these seven packages:

- `@nickwelsh/refquill`
- `@nickwelsh/refquill-schema`
- `@nickwelsh/refquill-fumadocs`
- `@nickwelsh/refquill-darwin-arm64`
- `@nickwelsh/refquill-linux-arm64`
- `@nickwelsh/refquill-linux-x64`
- `@nickwelsh/refquill-win32-x64`

Each version tag also updates the `0.x` docs from that tag, after verification and package tests pass. The docs deployment uses the exact tested build, independently of npm approval and GitHub release publication. Branch pushes run checks without deploying.

## Add npm trusted publishers

For **each package**, open its npm settings and add a GitHub Actions trusted publisher with these exact fields:

| Field | Value |
| --- | --- |
| Provider | GitHub Actions |
| Organization or user | `nickwelsh` |
| Repository | `refquill` |
| Workflow filename | `publish.yml` |
| Environment | `npm` |
| Allowed publishing operation | Stage publishing only |

Use the filename alone, without `.github/workflows/`. The environment must match the workflow's `environment: npm`. There is no npm token or secret to fill in: GitHub supplies a short-lived OIDC identity. With a current npm CLI, the equivalent per-package setup is:

```sh
npm trust github @nickwelsh/refquill \
  --file publish.yml \
  --repo nickwelsh/refquill \
  --env npm \
  --allow-stage-publish \
  --yes
```

Repeat with each package name above. Leave direct publishing disabled for this trusted publisher. Keep npm account recovery and 2FA configured so staged releases can be approved.

New connections show **Pending validation** and a deadline in npm settings. Complete the first release within that window to validate the connection; check each package's status before staging a later release.

## Build tarballs locally

To assemble packages locally, build `packages/fumadocs/dist` and arrange executables as:

```text
.release/binaries/
  darwin-arm64/refquill
  linux-arm64/refquill
  linux-x64/refquill
  win32-x64/refquill.exe
```

```sh
node scripts/package-release.mjs
```

The script requires all four binaries, verifies package-version alignment, rejects archives from another release in the output directory, replaces workspace dependency ranges, includes the license, excludes the locally staged executable from the command package, and uses `npm pack --ignore-scripts`. Tarballs are in `.release/packages`. Run `pnpm release:test` to verify an isolated consumer of the packed archives on the current host. The release workflow checks each supported host and stages these exact tarballs after consumer verification. Approve the native executable packages and schema first, then the command and frontend packages, so their dependencies are available when users install them.

For a local command-package development build only:

```sh
cargo build --release --locked
node scripts/stage-native.mjs target/release/refquill
node packages/cli/bin/refquill.mjs --version
```

On Windows use `refquill.exe`. `pnpm build` stages the debug executable for everyday development. `REFQUILL_BINARY` can explicitly select a development executable. Direct invocation of the Rust binary supports PHP without Node; for TypeScript it needs the worker (`REFQUILL_TYPESCRIPT_WORKER`) and Node (`REFQUILL_NODE`, default `node`).

## Test local frontend changes in another project

Published consumers install ordinary package names with `pnpm add @nickwelsh/refquill-fumadocs`. To test a local change, build the workspace, then pack the schema and frontend:

```sh
pnpm --filter @nickwelsh/refquill-schema pack --out /tmp/refquill-schema.tgz
pnpm --filter @nickwelsh/refquill-fumadocs pack --out /tmp/refquill-fumadocs.tgz
```

In the consuming project's `pnpm-workspace.yaml`, add a local override for the schema dependency (preserving existing settings):

```yaml
overrides:
  '@nickwelsh/refquill-schema': file:/tmp/refquill-schema.tgz
```

```sh
pnpm add /tmp/refquill-schema.tgz /tmp/refquill-fumadocs.tgz
```

The override makes the packed frontend use the local schema changes instead of the published release. Remove it when returning to registry packages. Run the development CLI from the Refquill checkout against the consuming project's config:

```sh
node /path/to/refquill/packages/cli/bin/refquill.mjs generate /path/to/project/refquill.json
```
