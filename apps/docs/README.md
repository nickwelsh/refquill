# Refquill docs

The [Refquill documentation site](https://docs.nickwelsh.me/refquill/), built with [docs-base](https://github.com/nickwelsh/docs-base) on Waku and Fumadocs. It contains guides, generated API references, JSON Schemas, and the CLI manual.

## Development

Run commands from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm docs:dev
```

Open the URL printed by Waku. The site uses the `/refquill/` base path.

## Editing content

Write guides in `content/docs/0.x` and set their order in `meta.json`. The repository's `refquill.json` configures API generation into `generated/api.json`.

Development startup and production builds regenerate the API reference, portable JSON Schema references, and CLI manual. During a running dev session, run `pnpm docs:generate` after changing package APIs or comments. Commit `generated/api.json` without formatting it. The portable `*.reference.json` inputs are ignored and regenerated from the workspace schemas and packaged manpage.

Build and check the site:

```sh
pnpm docs:build
pnpm docs:check
pnpm docs:smoke
pnpm docs:deploy:check
```

Preview the production build with `pnpm --filter @refquill/docs start`.

## Shared application

`waku.config.ts` configures the identity, public base path, repository, authored content, and Refquill inputs. docs-base owns the layout, navigation, components, styles, MDX compilation, routes, search, and Markdown exports. The homepage opens the latest documentation directly.

`tooling/generate-references.mjs` converts the workspace JSON Schemas and packaged CLI manual into portable Refquill documents. The shared application renders them alongside the generated API. Keep site-specific generation here and shared presentation in docs-base.

Upgrade `@nickwelsh/docs-base` and rebuild to receive shared changes. Keep its framework peers aligned with the package's declared versions. The root workspace applies the starter's Waku rc.3 request-handler patch.

A small docs-base patch adds `githubContentPath` so authored source links include this monorepo's `apps/docs` prefix. API source paths already start at the repository root. Remove the patch when docs-base supports this setting upstream.

## Deployment

The release workflow updates the `0.x` docs on each version tag, after verification and package tests pass. Branch pushes run checks without deploying. `wrangler.jsonc` defines the Cloudflare Worker and its routes.

## Artwork

Code file icons use VS Code Icons artwork under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The filename mapping package and this repository's code use the MIT license.
