import type { Document } from './document.js';
import type { ResolvedDocument } from './resolved.js';
export * from './reference.js';
export * from './document.js';
export type { ResolvedDocument, Symbol, Source, Type, TypeStructure, TypeArgumentParameter, Reference, Signature, Parameter, TypeParameter, Relation, Tag, Diagnostic, FrameworkMetadata } from './resolved.js';
/**
 * Validate a schema-v1 wire document and its graph, then return the input.
 * Throws when the shape, indexes, parent graph, or source paths are invalid.
 * Use the CLI's validate command to check the fingerprint too.
 */
export declare function parseDocument(input: unknown): Document;
/**
 * Validate a schema-v1 document and expand its tables, defaults, and inherited fields.
 * Does not mutate the input. Resolved type objects can be shared between symbols.
 * Treat the returned types as immutable or clone them before editing.
 */
export declare function resolveDocument(input: unknown): ResolvedDocument;
