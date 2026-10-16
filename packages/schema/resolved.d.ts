// Generated from the Rust model. Run pnpm schema; do not edit.

export type Language = "php" | "typescript" | "rust";
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
export type TypeStructure =
  | {
      kind: "union";
      types: Type[];
    }
  | {
      kind: "intersection";
      types: Type[];
    }
  | {
      kind: "generic";
      name: string;
      arguments: Type[];
      argumentParameters?: TypeArgumentParameter[];
    };
export type RelationKind = "extends" | "implements" | "uses" | "inherited-from" | "overrides" | "reexports";
export type Framework = "react" | "vue" | "svelte" | "solid";
export type FrameworkRole = "component" | "hook";

/**
 * Complete semantic model for analyzers and the resolved frontend projection.
 * The compact public JSON contract is owned by `wire`.
 */
export interface ResolvedDocument {
  schemaVersion: number;
  generator: Generator;
  title: string;
  fingerprint: string;
  symbols: Symbol[];
  diagnostics: Diagnostic[];
  /**
   * Compiler-native Rust documentation, retained once per configured input.
   */
  rustdoc?: RustdocCrate[];
}
export interface Generator {
  name: string;
  version: string;
}
export interface Symbol {
  id: string;
  language: Language;
  kind: Kind;
  name: string;
  qualifiedName: string;
  /**
   * The configured input name (for example, backend or frontend); scopes symbols in the API reference and prevents identity collisions.
   */
  api: string;
  group: string;
  parentId?: string | null;
  /**
   * Declaration only, never an implementation body.
   */
  declaration: string;
  /**
   * Markdown, with raw HTML treated as text by renderers.
   */
  description: string;
  deprecated: boolean;
  /**
   * PHP property declared by constructor parameter promotion.
   */
  promoted?: boolean;
  modifiers: string[];
  source?: Source | null;
  type?: Type | null;
  signatures: Signature[];
  typeParameters: TypeParameter[];
  relations: Relation[];
  /**
   * Unrecognized language-specific tags are retained, not silently discarded.
   */
  tags: Tag[];
  /**
   * Item key in this input's preserved rustdoc index.
   */
  rustdocId?: string | null;
  /**
   * Compiler-derived frontend framework semantics, independent of language kind.
   */
  framework?: FrameworkMetadata | null;
}
export interface Source {
  /**
   * Portable path relative to the config's sourceRoot; never an absolute path.
   */
  file: string;
  line: number;
  endLine: number;
}
export interface Type {
  /**
   * Original or compiler-rendered syntax. No lossy cross-language type grammar.
   */
  text: string;
  references: Reference[];
  /**
   * Optional compiler-provided composition for readable type documentation.
   */
  structure?: TypeStructure | null;
}
export interface Reference {
  name: string;
  /**
   * Null means an external, excluded, or otherwise undocumented declaration.
   */
  targetId?: string | null;
  /**
   * Compiler-identified external package, such as @types/react.
   */
  package?: string | null;
  /**
   * Name within the external package, such as React.JSX.Element.
   */
  qualifiedName?: string | null;
}
/**
 * Formal parameter names and documentation from the generic declaration.
 */
export interface TypeArgumentParameter {
  name: string;
  description?: string;
}
export interface Signature {
  declaration: string;
  description: string;
  parameters: Parameter[];
  returns?: Type | null;
  returnsDescription: string;
  typeParameters: TypeParameter[];
}
export interface Parameter {
  name: string;
  type?: Type | null;
  description: string;
  optional: boolean;
  variadic: boolean;
  byReference: boolean;
  default?: string | null;
  /**
   * Compiler-provided object properties, including nested parameter shapes.
   */
  properties?: Parameter[];
  /**
   * Call signatures of a callback-valued parameter or property.
   */
  signatures?: Signature[];
}
export interface TypeParameter {
  name: string;
  constraint?: Type | null;
  default?: Type | null;
  description: string;
}
export interface Relation {
  kind: RelationKind;
  name: string;
  targetId?: string | null;
}
export interface Tag {
  name: string;
  text: string;
}
export interface FrameworkMetadata {
  name: Framework;
  role: FrameworkRole;
  props?: Parameter[];
  events?: Parameter[];
  slots?: Parameter[];
  exposed?: Parameter[];
}
export interface Diagnostic {
  message: string;
  source?: Source | null;
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
