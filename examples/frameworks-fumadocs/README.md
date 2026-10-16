# Frameworks and Fumadocs example

One API reference for React, SolidJS, Vue, Svelte, TypeScript, PHP, and Rust. Browse component props, defaults, callbacks, events, and slots alongside ordinary language APIs.

Run from the repository root with Rust 1.99 or newer and Node 22.18 or newer:

```sh
pnpm install --frozen-lockfile
pnpm --filter refquill-frameworks-example dev
```

Open [localhost:4175](http://127.0.0.1:4175). Set `PORT` to use another port.

`refquill.json` selects the inputs. React and SolidJS use separate tsconfigs for their JSX types. The Rust input uses a checked-in rustdoc fixture, so no nightly toolchain is needed.

Restart after changing source files or regenerating the input.
