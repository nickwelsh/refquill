// Generated from the Rust model. Run pnpm schema; do not edit.

export type Language = "php" | "typescript" | "rust";
export type SharedTypeStructure =
  | {
      kind: "union";
      types: SharedType[];
    }
  | {
      kind: "intersection";
      types: SharedType[];
    }
  | {
      kind: "generic";
      name: string;
      arguments: SharedType[];
      argumentParameters?: TypeArgumentParameter[];
    };
export type Kind =
  | "class"
  | "interface"
  | "trait"
  | "enum"
  | "enum-case"
  | "function"
  | "method"
  | "constructor"
  | "property"
  | "constant"
  | "variable"
  | "type-alias"
  | "namespace"
  | "module"
  | "accessor"
  | "struct"
  | "union"
  | "impl"
  | "macro"
  | "primitive"
  | "extern-type"
  | "reexport"
  | "trait-alias";
export type RelationKind = "extends" | "implements" | "uses" | "inherited-from" | "overrides" | "reexports";
export type Framework = "react" | "vue" | "svelte" | "solid";
export type FrameworkRole = "component" | "hook";

export interface Document {
  schemaVersion: number;
  generator: Generator;
  title: string;
  fingerprint: string;
  inputs: DocumentInput[];
  types: SharedType[];
  symbols: CompactSymbol[];
  diagnostics?: CompactDiagnostic[];
  rustdoc?: RustdocCrate[];
}
export interface Generator {
  name: string;
  version: string;
}
export interface DocumentInput {
  name: string;
  language: Language;
}
export interface SharedType {
  text: string;
  references?: CompactReference[];
  structure?: SharedTypeStructure | null;
}
export interface CompactReference {
  name: string;
  /**
   * Index into symbols. Omitted/null: unresolved external declaration.
   */
  targetId?: number | null;
  /**
   * Compiler-identified origin for an external reference.
   */
  package?: string | null;
  qualifiedName?: string | null;
}
/**
 * Formal parameter names and documentation from the generic declaration.
 */
export interface TypeArgumentParameter {
  name: string;
  description?: string;
}
export interface CompactSymbol {
  id: string;
  input: number;
  kind: Kind;
  name: string;
  /**
   * Omitted: derive from parent/name, or PHP group/name for roots.
   */
  qualifiedName?: string;
  /**
   * Omitted: inherit parent group; roots default to an empty group.
   */
  group?: string;
  /**
   * Index into symbols. Omitted/null: no parent. Zero is a valid index.
   */
  parentId?: number | null;
  declaration: string;
  description?: string;
  deprecated?: boolean;
  /**
   * PHP property declared by constructor parameter promotion. Omitted: false.
   */
  promoted?: boolean;
  modifiers?: string[];
  source?: CompactSource | null;
  /**
   * Index into types. Omitted/null: no type.
   */
  type?: number | null;
  signatures?: CompactSignature[];
  typeParameters?: CompactTypeParameter[];
  relations?: CompactRelation[];
  tags?: CompactTag[];
  /**
   * Item key in this input's preserved rustdoc index.
   */
  rustdocId?: string | null;
  framework?: CompactFrameworkMetadata | null;
}
export interface CompactSource {
  /**
   * Omitted: inherit the parent's source file. Diagnostics and roots require a file.
   */
  file?: string;
  line: number;
  /**
   * Omitted: equal to line.
   */
  endLine?: number;
}
export interface CompactSignature {
  /**
   * Omitted: inherit the owning symbol's declaration. Explicit empty string overrides it.
   */
  declaration?: string;
  /**
   * Omitted: inherit the owning symbol's description.
   */
  description?: string;
  parameters?: CompactParameter[];
  returns?: number | null;
  returnsDescription?: string;
  /**
   * Omitted: inherit owner templates. An explicit empty list overrides them.
   */
  typeParameters?: CompactTypeParameter[];
}
export interface CompactParameter {
  name: string;
  type?: number | null;
  description?: string;
  optional?: boolean;
  variadic?: boolean;
  byReference?: boolean;
  default?: string | null;
  /**
   * Compiler-provided object properties. Omitted when the shape is unavailable.
   */
  properties?: CompactParameter[];
  /**
   * Callback call signatures. Missing signature fields default to empty values.
   */
  signatures?: CompactSignature[];
}
export interface CompactTypeParameter {
  name: string;
  constraint?: number | null;
  default?: number | null;
  description?: string;
}
export interface CompactRelation {
  kind: RelationKind;
  name: string;
  targetId?: number | null;
}
export interface CompactTag {
  name: string;
  text?: string;
}
export interface CompactFrameworkMetadata {
  name: Framework;
  role: FrameworkRole;
  props?: CompactParameter[];
  events?: CompactParameter[];
  slots?: CompactParameter[];
  exposed?: CompactParameter[];
}
export interface CompactDiagnostic {
  message: string;
  source?: CompactSource | null;
}
export interface RustdocCrate {
  /**
   * The configured Rust input name.
   */
  api: string;
  /**
   * Original rustdoc JSON, with portable source paths and excluded items removed.
   * Its format_version identifies the upstream unstable rustdoc format.
   */
  data: {
    [k: string]: unknown;
  };
}
