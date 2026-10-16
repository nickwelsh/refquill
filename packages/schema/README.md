# @nickwelsh/refquill-schema

JSON Schemas, TypeScript types, and JavaScript validators for [Refquill](https://github.com/nickwelsh/refquill) documents.

Requires Node 22.18 or newer.

```sh
npm install @nickwelsh/refquill-schema
```

## API documents

```ts
import { readFile } from 'node:fs/promises';
import { resolveDocument } from '@nickwelsh/refquill-schema';

const input: unknown = JSON.parse(await readFile('docs/api.generated.json', 'utf8'));
const document = resolveDocument(input);
```

`resolveDocument` validates and expands the compact document for frontend use. Use `parseDocument` to validate without expanding it. Both check document shape and graph relationships. Use `refquill validate` from [@nickwelsh/refquill](https://www.npmjs.com/package/@nickwelsh/refquill) to verify the fingerprint too.

## Rendering documents

`ReferenceDocument` is a separate contract for pages, sections, entries, and code blocks. Validate it with `parseReferenceDocument`:

```ts
import { parseReferenceDocument } from '@nickwelsh/refquill-schema/reference';

const reference = parseReferenceDocument(input);
```

The API and rendering validators reject non-JSON input and enforce resource limits. See the [format specification](https://github.com/nickwelsh/refquill/blob/main/docs/output-format.md) and [reference document guide](https://docs.nickwelsh.me/refquill/docs/0.x/reference-documents) for the document contracts.

## JSON schemas

| Export                                      | Schema             |
| ------------------------------------------- | ------------------ |
| `@nickwelsh/refquill-schema/config.json`    | CLI configuration  |
| `@nickwelsh/refquill-schema/document.json`  | API document       |
| `@nickwelsh/refquill-schema/reference.json` | Rendering document |

Configuration files can set `$schema` to `./node_modules/@nickwelsh/refquill-schema/config.schema.json`.

The API and rendering documents each use schema version 1. Their versions change independently of package releases.

[Report an issue](https://github.com/nickwelsh/refquill/issues). MIT licensed.
