# Rust and Fumadocs example

A Fumadocs site for the checked-in Rust compiler fixture, with API pages, navigation, search, and themes. It uses existing rustdoc JSON, so no nightly toolchain is needed.

Run from the repository root with Rust 1.99 or newer and Node 22.18 or newer:

```sh
pnpm install --frozen-lockfile
pnpm --filter refquill-rust-example dev
```

Open [localhost:4174](http://127.0.0.1:4174). Set `PORT` to use another port.

`source.ts` connects the generated JSON to Fumadocs. `App.tsx` defines the layout. Replace the JSON input to document another crate.

Restart after changing source files or regenerating the input. The demo bundles its fixture and highlighter in the browser; production sites can keep them on the server.
