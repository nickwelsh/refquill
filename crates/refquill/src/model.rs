use anyhow::{Result, ensure};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

/// Complete semantic model for analyzers and the resolved frontend projection.
/// The compact public JSON contract is owned by `wire`.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schemars(rename = "ResolvedDocument")]
pub struct Document {
    #[schemars(range(min = 1, max = 1))]
    pub schema_version: u32,
    pub generator: Generator,
    pub title: String,
    #[schemars(regex(pattern = "^[a-f0-9]{64}$"))]
    pub fingerprint: String,
    pub symbols: Vec<Symbol>,
    pub diagnostics: Vec<Diagnostic>,
    /// Compiler-native Rust documentation, retained once per configured input.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rustdoc: Vec<RustdocCrate>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct RustdocCrate {
    /// The configured Rust input name.
    pub api: String,
    /// Original rustdoc JSON, with portable source paths and excluded items removed.
    /// Its format_version identifies the upstream unstable rustdoc format.
    pub data: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Generator {
    #[schemars(regex(pattern = "^refquill$"))]
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    Php,
    TypeScript,
    Rust,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum Kind {
    Class,
    Interface,
    Trait,
    Enum,
    EnumCase,
    Function,
    Method,
    Constructor,
    Property,
    Constant,
    Variable,
    TypeAlias,
    Namespace,
    Module,
    Accessor,
    Struct,
    Union,
    Impl,
    Macro,
    Primitive,
    ExternType,
    Reexport,
    TraitAlias,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Symbol {
    #[schemars(length(min = 1))]
    pub id: String,
    pub language: Language,
    pub kind: Kind,
    pub name: String,
    pub qualified_name: String,
    /// The configured input name (for example, backend or frontend); scopes symbols in the API reference and prevents identity collisions.
    pub api: String,
    pub group: String,
    pub parent_id: Option<String>,
    /// Declaration only, never an implementation body.
    pub declaration: String,
    /// Markdown, with raw HTML treated as text by renderers.
    pub description: String,
    pub deprecated: bool,
    /// PHP property declared by constructor parameter promotion.
    #[serde(default)]
    pub promoted: bool,
    pub modifiers: Vec<String>,
    pub source: Option<Source>,
    pub r#type: Option<Type>,
    pub signatures: Vec<Signature>,
    pub type_parameters: Vec<TypeParameter>,
    pub relations: Vec<Relation>,
    /// Unrecognized language-specific tags are retained, not silently discarded.
    pub tags: Vec<Tag>,
    /// Item key in this input's preserved rustdoc index.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rustdoc_id: Option<String>,
    /// Compiler-derived frontend framework semantics, independent of language kind.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub framework: Option<FrameworkMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum Framework {
    React,
    Vue,
    Svelte,
    Solid,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum FrameworkRole {
    Component,
    Hook,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct FrameworkMetadata {
    pub name: Framework,
    pub role: FrameworkRole,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub props: Vec<Parameter>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub events: Vec<Parameter>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub slots: Vec<Parameter>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub exposed: Vec<Parameter>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Source {
    /// Portable path relative to the config's sourceRoot; never an absolute path.
    #[schemars(length(min = 1))]
    pub file: String,
    #[schemars(range(min = 1))]
    pub line: u32,
    #[schemars(range(min = 1))]
    pub end_line: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Type {
    /// Original or compiler-rendered syntax. No lossy cross-language type grammar.
    pub text: String,
    pub references: Vec<Reference>,
    /// Optional compiler-provided composition for readable type documentation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub structure: Option<TypeStructure>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum TypeStructure {
    Union {
        types: Vec<Type>,
    },
    Intersection {
        types: Vec<Type>,
    },
    Generic {
        name: String,
        arguments: Vec<Type>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        #[serde(rename = "argumentParameters")]
        argument_parameters: Vec<TypeArgumentParameter>,
    },
}

/// Formal parameter names and documentation from the generic declaration.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct TypeArgumentParameter {
    pub name: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Reference {
    pub name: String,
    /// Null means an external, excluded, or otherwise undocumented declaration.
    pub target_id: Option<String>,
    /// Compiler-identified external package, such as @types/react.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub package: Option<String>,
    /// Name within the external package, such as React.JSX.Element.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub qualified_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Signature {
    pub declaration: String,
    pub description: String,
    pub parameters: Vec<Parameter>,
    pub returns: Option<Type>,
    pub returns_description: String,
    pub type_parameters: Vec<TypeParameter>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Parameter {
    pub name: String,
    pub r#type: Option<Type>,
    pub description: String,
    pub optional: bool,
    pub variadic: bool,
    pub by_reference: bool,
    pub default: Option<String>,
    /// Compiler-provided object properties, including nested parameter shapes.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub properties: Vec<Parameter>,
    /// Call signatures of a callback-valued parameter or property.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub signatures: Vec<Signature>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct TypeParameter {
    pub name: String,
    pub constraint: Option<Type>,
    pub default: Option<Type>,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Relation {
    pub kind: RelationKind,
    pub name: String,
    pub target_id: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum RelationKind {
    Extends,
    Implements,
    Uses,
    InheritedFrom,
    Overrides,
    Reexports,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Tag {
    pub name: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Diagnostic {
    pub message: String,
    pub source: Option<Source>,
}

impl Document {
    pub fn new(title: String) -> Self {
        Self {
            schema_version: 1,
            generator: Generator {
                name: "refquill".into(),
                version: env!("CARGO_PKG_VERSION").into(),
            },
            title,
            fingerprint: String::new(),
            symbols: vec![],
            diagnostics: vec![],
            rustdoc: vec![],
        }
    }

    /// JSON Schema covers shape; the graph also requires unique IDs, existing
    /// reference targets, and an acyclic parent tree within each configured input/language.
    pub fn validate(&self) -> Result<()> {
        ensure!(self.schema_version == 1, "Unsupported schemaVersion");
        let mut rustdoc = BTreeMap::new();
        for snapshot in &self.rustdoc {
            ensure!(
                rustdoc.insert(snapshot.api.as_str(), snapshot).is_none(),
                "Duplicate rustdoc input: {}",
                snapshot.api
            );
            ensure!(
                self.symbols
                    .iter()
                    .any(|s| s.api == snapshot.api && s.language == Language::Rust),
                "Missing Rust input for rustdoc: {}",
                snapshot.api
            );
            ensure!(
                snapshot
                    .data
                    .get("format_version")
                    .and_then(|v| v.as_u64())
                    .is_some_and(|v| v > 0 && v <= u32::MAX.into()),
                "Invalid rustdoc format_version: {}",
                snapshot.api
            );
            ensure!(
                snapshot.data.get("index").is_some_and(|v| v.is_object()),
                "Missing rustdoc index: {}",
                snapshot.api
            );
        }
        let mut symbols = BTreeMap::new();
        for symbol in &self.symbols {
            ensure!(!symbol.id.is_empty(), "Empty symbol ID");
            ensure!(
                symbol.framework.is_none() || symbol.language == Language::TypeScript,
                "Framework metadata requires a TypeScript symbol: {}",
                symbol.id
            );
            if let Some(previous) = symbols.insert(&symbol.id, symbol) {
                let location = |symbol: &Symbol| {
                    symbol
                        .source
                        .as_ref()
                        .map(|s| format!("{}:{}", s.file, s.line))
                        .unwrap_or_else(|| "unknown source".into())
                };
                anyhow::bail!(
                    "Duplicate symbol: {} ({} and {})",
                    symbol.id,
                    location(previous),
                    location(symbol)
                );
            }
            if let Some(id) = &symbol.rustdoc_id {
                ensure!(
                    symbol.language == Language::Rust,
                    "rustdocId requires a Rust symbol: {}",
                    symbol.id
                );
                ensure!(
                    rustdoc
                        .get(symbol.api.as_str())
                        .and_then(|snapshot| snapshot.data["index"].get(id))
                        .is_some(),
                    "Missing rustdoc item: {id}"
                );
            }
            if let Some(source) = &symbol.source {
                source.validate()?;
            }
        }
        for diagnostic in &self.diagnostics {
            if let Some(source) = &diagnostic.source {
                source.validate()?;
            }
        }
        let mut validated_parents = BTreeSet::new();
        for symbol in &self.symbols {
            let mut ancestors = BTreeSet::from([&symbol.id]);
            let mut parent = symbol.parent_id.as_ref();
            while let Some(id) = parent {
                let target = symbols
                    .get(id)
                    .ok_or_else(|| anyhow::anyhow!("Missing parent: {id}"))?;
                ensure!(
                    target.api == symbol.api && target.language == symbol.language,
                    "Cross-input parent: {id}"
                );
                if validated_parents.contains(id) {
                    break;
                }
                ensure!(ancestors.insert(id), "Cyclic parent: {id}");
                parent = target.parent_id.as_ref();
            }
            validated_parents.extend(ancestors);
            let check = |id: &Option<String>| -> Result<()> {
                if let Some(id) = id {
                    ensure!(symbols.contains_key(id), "Missing reference target: {id}");
                }
                Ok(())
            };
            for relation in &symbol.relations {
                check(&relation.target_id)?;
            }
            for ty in symbol.types() {
                for reference in &ty.references {
                    check(&reference.target_id)?;
                }
            }
        }
        Ok(())
    }
}

impl Symbol {
    pub fn types(&self) -> Vec<&Type> {
        let mut types: Vec<_> = self.r#type.iter().collect();
        let mut templates = vec![self.type_parameters.as_slice()];
        let mut signatures: Vec<_> = self.signatures.iter().collect();
        if let Some(framework) = &self.framework {
            let mut parameters: Vec<_> = framework
                .props
                .iter()
                .chain(&framework.events)
                .chain(&framework.slots)
                .chain(&framework.exposed)
                .collect();
            while let Some(parameter) = parameters.pop() {
                types.extend(parameter.r#type.iter());
                parameters.extend(&parameter.properties);
                signatures.extend(&parameter.signatures);
            }
        }
        while let Some(signature) = signatures.pop() {
            types.extend(signature.returns.iter());
            let mut parameters: Vec<_> = signature.parameters.iter().collect();
            while let Some(parameter) = parameters.pop() {
                types.extend(parameter.r#type.iter());
                parameters.extend(&parameter.properties);
                signatures.extend(&parameter.signatures);
            }
            templates.push(&signature.type_parameters);
        }
        for parameters in templates {
            for p in parameters {
                types.extend(p.constraint.iter());
                types.extend(p.default.iter());
            }
        }
        let mut pending = types;
        let mut types = Vec::new();
        while let Some(ty) = pending.pop() {
            types.push(ty);
            match &ty.structure {
                Some(TypeStructure::Union { types } | TypeStructure::Intersection { types }) => {
                    pending.extend(types)
                }
                Some(TypeStructure::Generic { arguments, .. }) => pending.extend(arguments),
                None => {}
            }
        }
        types
    }
}

impl Source {
    pub fn validate(&self) -> Result<()> {
        ensure!(
            self.line > 0 && self.end_line >= self.line,
            "Invalid source range: {}",
            self.file
        );
        ensure!(
            !self.file.contains('\\')
                && !self.file.contains(':')
                && !self
                    .file
                    .split('/')
                    .any(|p| p.is_empty() || p == "." || p == ".."),
            "Invalid source path: {}",
            self.file
        );
        Ok(())
    }
}
