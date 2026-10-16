# Refquill docs

The [Refquill documentation site](https://docs.nickwelsh.me/refquill/), built with Waku and Fumadocs. It contains guides, generated API references, JSON Schemas, and the CLI manual.

## Development

Run commands from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm docs:dev
```

Open the URL printed by Waku. The site uses the `/refquill/` base path.

## Editing content

Write guides in `content/docs/0.x` and set their order in `meta.json`. The repository's `refquill.json` configures API generation into `src/generated/api.json`.

Development startup and production builds regenerate the API reference. During a running dev session, run `pnpm docs:generate` after changing package APIs or comments. Commit the generated JSON without formatting it.

Build and check the site:

```sh
pnpm docs:build
pnpm docs:check
pnpm docs:smoke
pnpm docs:deploy:check
```

Preview the production build with `pnpm --filter @refquill/docs start`.

## Deployment

The release workflow updates the `0.x` docs on each version tag, after verification and package tests pass. Branch pushes run checks without deploying. `wrangler.jsonc` defines the Cloudflare Worker and its routes.

## Artwork

Code file icons use VS Code Icons artwork under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The filename mapping package and this repository's code use the MIT license.
