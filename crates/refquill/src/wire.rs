//! Version 1 wire contract. Analyzers use the complete semantic model; only this
//! boundary owns omission, inheritance, type interning, and numeric graph edges.
use crate::model;
use anyhow::{Result, ensure};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeMap;

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schemars(rename = "Document")]
pub struct Document {
    #[schemars(range(min = 1, max = 1))]
    pub schema_version: u32,
    pub generator: model::Generator,
    pub title: String,
    #[schemars(regex(pattern = "^[a-f0-9]{64}$"))]
    pub fingerprint: String,
    pub inputs: Vec<DocumentInput>,
    pub types: Vec<SharedType>,
    pub symbols: Vec<CompactSymbol>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub diagnostics: Vec<CompactDiagnostic>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rustdoc: Vec<model::RustdocCrate>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct DocumentInput {
    pub name: String,
    pub language: model::Language,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompactSymbol {
    #[schemars(length(min = 1))]
    pub id: String,
    pub input: u32,
    pub kind: model::Kind,
    pub name: String,
    /// Omitted: derive from parent/name, or PHP group/name for roots.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(with = "String")]
    pub qualified_name: Option<String>,
    /// Omitted: inherit parent group; roots default to an empty group.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(with = "String")]
    pub group: Option<String>,
    /// Index into symbols. Omitted/null: no parent. Zero is a valid index.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<u32>,
    pub declaration: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub description: String,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub deprecated: bool,
    /// PHP property declared by constructor parameter promotion. Omitted: false.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub promoted: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub modifiers: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<CompactSource>,
    /// Index into types. Omitted/null: no type.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub r#type: Option<u32>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub signatures: Vec<CompactSignature>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub type_parameters: Vec<CompactTypeParameter>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub relations: Vec<CompactRelation>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<CompactTag>,
    /// Item key in this input's preserved rustdoc index.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rustdoc_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub framework: Option<CompactFrameworkMetadata>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CompactFrameworkMetadata {
    pub name: model::Framework,
    pub role: model::FrameworkRole,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub props: Vec<CompactParameter>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub events: Vec<CompactParameter>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub slots: Vec<CompactParameter>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub exposed: Vec<CompactParameter>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompactSource {
    /// Omitted: inherit the parent's source file. Diagnostics and roots require a file.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(length(min = 1))]
    #[schemars(with = "String")]
    pub file: Option<String>,
    #[schemars(range(min = 1))]
    pub line: u32,
    /// Omitted: equal to line.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(range(min = 1))]
    #[schemars(with = "u32")]
    pub end_line: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SharedType {
    pub text: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub references: Vec<CompactReference>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub structure: Option<SharedTypeStructure>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum SharedTypeStructure {
    Union {
        types: Vec<SharedType>,
    },
    Intersection {
        types: Vec<SharedType>,
    },
    Generic {
        name: String,
        arguments: Vec<SharedType>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        #[serde(rename = "argumentParameters")]
        argument_parameters: Vec<model::TypeArgumentParameter>,
    },
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompactReference {
    pub name: String,
    /// Index into symbols. Omitted/null: unresolved external declaration.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_id: Option<u32>,
    /// Compiler-identified origin for an external reference.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub package: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub qualified_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompactSignature {
    /// Omitted: inherit the owning symbol's declaration. Explicit empty string overrides it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(with = "String")]
    pub declaration: Option<String>,
    /// Omitted: inherit the owning symbol's description.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(with = "String")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub parameters: Vec<CompactParameter>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub returns: Option<u32>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub returns_description: String,
    /// Omitted: inherit owner templates. An explicit empty list overrides them.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(with = "Vec<CompactTypeParameter>")]
    pub type_parameters: Option<Vec<CompactTypeParameter>>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompactParameter {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub r#type: Option<u32>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub description: String,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub optional: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub variadic: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub by_reference: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<String>,
    /// Compiler-provided object properties. Omitted when the shape is unavailable.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub properties: Vec<CompactParameter>,
    /// Callback call signatures. Missing signature fields default to empty values.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub signatures: Vec<CompactSignature>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CompactTypeParameter {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub constraint: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<u32>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub description: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompactRelation {
    pub kind: model::RelationKind,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_id: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CompactTag {
    pub name: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub text: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CompactDiagnostic {
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<CompactSource>,
}

fn omit(value: &mut Value, key: &str, default: &Value) {
    if value.get(key) == Some(default) {
        value.as_object_mut().unwrap().remove(key);
    }
}

fn fill(value: &mut Value, key: &str, default: Value) {
    value.as_object_mut().unwrap().entry(key).or_insert(default);
}

fn qualified_name(
    language: model::Language,
    group: &str,
    name: &str,
    parent: Option<&str>,
) -> String {
    match (language, parent) {
        (model::Language::Php | model::Language::Rust, Some(parent)) => {
            format!("{parent}::{name}")
        }
        (_, Some(parent)) => format!("{parent}.{name}"),
        (model::Language::Php, None) if !group.is_empty() => format!("{group}\\{name}"),
        _ => name.into(),
    }
}

/// Encode a validated, ID-sorted semantic document. Types are interned in first
/// encounter order using complete canonical objects, including reference targets.
pub fn encode(document: &model::Document) -> Result<Value> {
    document.validate()?;
    let mut doc = serde_json::to_value(document)?;
    let indexes: BTreeMap<_, _> = document
        .symbols
        .iter()
        .enumerate()
        .map(|(i, s)| (s.id.as_str(), i))
        .collect();
    let mut inputs = vec![];
    let mut input_indexes = BTreeMap::new();
    for (symbol, original) in doc["symbols"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .zip(&document.symbols)
    {
        let key = (
            original.api.clone(),
            serde_json::to_string(&original.language)?,
        );
        let input = *input_indexes.entry(key).or_insert_with(|| {
            inputs.push(json!({"name": original.api, "language": original.language}));
            inputs.len() - 1
        });
        let parent = original
            .parent_id
            .as_deref()
            .map(|id| &document.symbols[indexes[id]]);
        let expected = qualified_name(
            original.language,
            &original.group,
            &original.name,
            parent.map(|p| p.qualified_name.as_str()),
        );
        omit(symbol, "qualifiedName", &json!(expected));
        omit(
            symbol,
            "group",
            &json!(parent.map_or("", |p| p.group.as_str())),
        );
        let object = symbol.as_object_mut().unwrap();
        object.remove("api");
        object.remove("language");
        object.insert("input".into(), json!(input));
        if let (Some(source), Some(parent_source)) = (
            original.source.as_ref(),
            parent.and_then(|p| p.source.as_ref()),
        ) && source.file == parent_source.file
        {
            symbol["source"].as_object_mut().unwrap().remove("file");
        }
        for signature in symbol["signatures"].as_array_mut().unwrap() {
            omit(signature, "declaration", &json!(original.declaration));
            omit(signature, "description", &json!(original.description));
            omit(
                signature,
                "typeParameters",
                &serde_json::to_value(&original.type_parameters)?,
            );
        }
    }
    doc["inputs"] = json!(inputs);
    let mut types = vec![];
    let mut type_indexes = BTreeMap::new();
    pack(&mut doc, None, &indexes, &mut types, &mut type_indexes)?;
    doc["types"] = json!(types);
    Ok(doc)
}

fn pack(
    value: &mut Value,
    key: Option<&str>,
    symbols: &BTreeMap<&str, usize>,
    types: &mut Vec<Value>,
    indexes: &mut BTreeMap<String, usize>,
) -> Result<()> {
    if key == Some("rustdoc") {
        return Ok(());
    }
    if matches!(key, Some("parentId" | "targetId"))
        && let Some(id) = value.as_str()
    {
        *value = json!(
            symbols
                .get(id)
                .ok_or_else(|| anyhow::anyhow!("Missing reference: {id}"))?
        );
        return Ok(());
    }
    if let Some(array) = value.as_array_mut() {
        for item in array {
            pack(item, None, symbols, types, indexes)?;
        }
    } else if value.is_object() {
        let is_type = matches!(key, Some("type" | "returns" | "constraint" | "default"))
            && value.get("text").is_some();
        let is_signature =
            value.get("parameters").is_some() && value.get("returnsDescription").is_some();
        let is_tag = value.get("name").is_some() && value.get("text").is_some();
        if value.get("line").is_some() {
            let line = value["line"].clone();
            omit(value, "endLine", &line);
        }
        for (k, v) in value.as_object_mut().unwrap().iter_mut() {
            pack(v, Some(k), symbols, types, indexes)?;
        }
        // Only signature inheritance can assign a nonempty default to an array.
        value.as_object_mut().unwrap().retain(|k, v| {
            let key = k.as_str();
            let null_default = matches!(
                key,
                "parentId"
                    | "targetId"
                    | "source"
                    | "type"
                    | "returns"
                    | "constraint"
                    | "default"
                    | "structure"
            );
            let false_default = matches!(
                key,
                "deprecated" | "promoted" | "optional" | "variadic" | "byReference"
            );
            let empty_string = (matches!(key, "description" | "returnsDescription")
                && !(is_signature && key == "description"))
                || (is_tag && key == "text");
            let empty_array = matches!(
                key,
                "diagnostics"
                    | "modifiers"
                    | "signatures"
                    | "typeParameters"
                    | "relations"
                    | "tags"
                    | "references"
                    | "parameters"
                    | "properties"
            ) && !(is_signature && key == "typeParameters");
            !(null_default && v.is_null()
                || false_default && v == &json!(false)
                || empty_string && v == &json!("")
                || empty_array && v == &json!([]))
        });
        if is_type {
            let identity = serde_json::to_string(value)?;
            let index = *indexes.entry(identity).or_insert_with(|| {
                types.push(value.clone());
                types.len() - 1
            });
            *value = json!(index);
        }
    }
    Ok(())
}

fn index(value: &Value, length: usize, label: &str) -> Result<usize> {
    let index = value
        .as_u64()
        .and_then(|i| usize::try_from(i).ok())
        .filter(|i| *i < length);
    index.ok_or_else(|| anyhow::anyhow!("Invalid {label} index: {value}"))
}

/// The caller validates the wire JSON Schema first. Expand in parent order with
/// an iterative traversal so deep untrusted parent chains cannot overflow a stack.
pub(crate) fn decode(mut doc: Value) -> Result<model::Document> {
    let inputs = doc.as_object_mut().unwrap().remove("inputs").unwrap();
    let types = doc.as_object_mut().unwrap().remove("types").unwrap();
    let symbols = doc["symbols"].as_array_mut().unwrap();
    let ids: Vec<_> = symbols.iter().map(|s| s["id"].clone()).collect();
    let mut input_keys = std::collections::BTreeSet::new();
    for input in inputs.as_array().unwrap() {
        ensure!(
            input_keys.insert(serde_json::to_string(input)?),
            "Duplicate input"
        );
    }
    for ty in types.as_array().unwrap() {
        // Validate references even in unused types and nested compositions.
        unpack(&mut ty.clone(), None, &ids, types.as_array().unwrap())?;
    }
    let mut parents = Vec::with_capacity(symbols.len());
    let mut input_indexes = Vec::with_capacity(symbols.len());
    for symbol in symbols.iter() {
        parents.push(
            symbol
                .get("parentId")
                .filter(|v| !v.is_null())
                .map(|v| index(v, symbols.len(), "parent"))
                .transpose()?,
        );
        input_indexes.push(index(
            &symbol["input"],
            inputs.as_array().unwrap().len(),
            "input",
        )?);
    }
    let mut states = vec![0; symbols.len()];
    let mut order = vec![];
    for start in 0..symbols.len() {
        let mut chain = vec![];
        let mut current = Some(start);
        while let Some(i) = current {
            if states[i] == 2 {
                break;
            }
            ensure!(states[i] == 0, "Cyclic parent: {}", ids[i]);
            states[i] = 1;
            chain.push(i);
            if let Some(parent) = parents[i] {
                ensure!(
                    input_indexes[i] == input_indexes[parent],
                    "Cross-input parent: {}",
                    ids[parent]
                );
            }
            current = parents[i];
        }
        for i in chain.into_iter().rev() {
            states[i] = 2;
            order.push(i);
        }
    }
    for i in order {
        let input = &inputs[input_indexes[i]];
        let parent = parents[i].map(|p| &symbols[p]);
        let group = parent.map_or_else(|| json!(""), |p| p["group"].clone());
        let language: model::Language = serde_json::from_value(input["language"].clone())?;
        let name = symbols[i].get("qualifiedName").is_none().then(|| {
            qualified_name(
                language,
                symbols[i].get("group").unwrap_or(&group).as_str().unwrap(),
                symbols[i]["name"].as_str().unwrap(),
                parent.map(|p| p["qualifiedName"].as_str().unwrap()),
            )
        });
        let file = parent
            .and_then(|p| p.get("source"))
            .and_then(|s| s.get("file"))
            .cloned();
        let symbol = &mut symbols[i];
        symbol.as_object_mut().unwrap().remove("input");
        symbol["api"] = input["name"].clone();
        symbol["language"] = input["language"].clone();
        fill(symbol, "group", group);
        if let Some(name) = name {
            fill(symbol, "qualifiedName", json!(name));
        }
        if let Some(source) = symbol.get_mut("source").filter(|v| !v.is_null())
            && !source.as_object().unwrap().contains_key("file")
        {
            source["file"] =
                file.ok_or_else(|| anyhow::anyhow!("Missing inherited source file: {}", ids[i]))?;
        }
    }
    // Resolve symbol inheritance before recursive callback signatures receive
    // their independent empty defaults.
    for symbol in doc["symbols"].as_array_mut().unwrap() {
        let declaration = symbol["declaration"].clone();
        let description = symbol.get("description").cloned().unwrap_or(json!(""));
        let templates = symbol.get("typeParameters").cloned().unwrap_or(json!([]));
        if let Some(signatures) = symbol.get_mut("signatures").and_then(Value::as_array_mut) {
            for signature in signatures {
                fill(signature, "declaration", declaration.clone());
                fill(signature, "description", description.clone());
                fill(signature, "typeParameters", templates.clone());
            }
        }
    }
    unpack(&mut doc, None, &ids, types.as_array().unwrap())?;
    fill(&mut doc, "diagnostics", json!([]));
    for symbol in doc["symbols"].as_array_mut().unwrap() {
        for (key, default) in [
            ("parentId", json!(null)),
            ("description", json!("")),
            ("deprecated", json!(false)),
            ("promoted", json!(false)),
            ("modifiers", json!([])),
            ("source", json!(null)),
            ("type", json!(null)),
            ("signatures", json!([])),
            ("typeParameters", json!([])),
            ("relations", json!([])),
            ("tags", json!([])),
        ] {
            fill(symbol, key, default);
        }
    }
    let document: model::Document = serde_json::from_value(doc)?;
    document.validate()?;
    Ok(document)
}

fn unpack(value: &mut Value, key: Option<&str>, ids: &[Value], types: &[Value]) -> Result<()> {
    if key == Some("rustdoc") {
        return Ok(());
    }
    if matches!(key, Some("parentId" | "targetId")) && !value.is_null() {
        *value = ids[index(value, ids.len(), "reference target")?].clone();
        return Ok(());
    }
    if matches!(key, Some("type" | "returns" | "constraint" | "default")) && value.is_number() {
        *value = types[index(value, types.len(), "type")?].clone();
        fill(value, "references", json!([]));
    }
    if let Some(array) = value.as_array_mut() {
        for item in array {
            unpack(item, None, ids, types)?;
        }
    } else if value.is_object() {
        for (k, v) in value.as_object_mut().unwrap().iter_mut() {
            unpack(v, Some(k), ids, types)?;
        }
        if value.get("line").is_some() {
            fill(value, "endLine", value["line"].clone());
        }
        // Distinguish record kinds by their required fields or their array key
        // (array records receive defaults in the explicit traversal below).
        if value.get("text").is_some() && value.get("name").is_none() {
            fill(value, "references", json!([]));
        }
    }
    // Array context assigns defaults without relying on optional field presence.
    if let Some(array) = value.as_array_mut() {
        let defaults: &[(&str, Value)] = match key {
            Some("signatures") => &[
                ("declaration", json!("")),
                ("description", json!("")),
                ("typeParameters", json!([])),
                ("parameters", json!([])),
                ("returns", json!(null)),
                ("returnsDescription", json!("")),
            ],
            Some("parameters" | "properties" | "props" | "events" | "slots" | "exposed") => &[
                ("type", json!(null)),
                ("description", json!("")),
                ("optional", json!(false)),
                ("variadic", json!(false)),
                ("byReference", json!(false)),
                ("default", json!(null)),
            ],
            Some("typeParameters") => &[
                ("constraint", json!(null)),
                ("default", json!(null)),
                ("description", json!("")),
            ],
            Some("references" | "relations") => &[("targetId", json!(null))],
            Some("tags") => &[("text", json!(""))],
            Some("diagnostics") => &[("source", json!(null))],
            _ => &[],
        };
        for item in array {
            for (k, v) in defaults {
                fill(item, k, v.clone());
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parent_chain(length: usize, reverse: bool) -> Value {
        let symbols: Vec<_> = (0..length)
            .map(|i| {
                let mut symbol = json!({
                    "id": format!("symbol-{i}"), "input": 0, "kind": "namespace",
                    "name": "n", "qualifiedName": format!("Explicit{i}"), "declaration": ""
                });
                let parent = if reverse {
                    (i + 1 < length).then_some(i + 1)
                } else {
                    i.checked_sub(1)
                };
                if let Some(parent) = parent {
                    symbol["parentId"] = json!(parent);
                }
                symbol
            })
            .collect();
        json!({
            "schemaVersion": 1, "generator": { "name": "refquill", "version": "test" },
            "title": "Parent chain", "fingerprint": "a".repeat(64),
            "inputs": [{ "name": "example", "language": "php" }],
            "types": [], "symbols": symbols
        })
    }

    #[test]
    fn long_parent_chains_validate_in_either_order_and_preserve_explicit_names() -> Result<()> {
        for reverse in [false, true] {
            let document = decode(parent_chain(10_000, reverse))?;
            assert_eq!(document.symbols.len(), 10_000);
            for (i, symbol) in document.symbols.iter().enumerate() {
                assert_eq!(symbol.qualified_name, format!("Explicit{i}"));
            }
            document.validate()?;
        }
        Ok(())
    }

    #[test]
    fn parent_validation_keeps_checks_when_reusing_completed_paths() -> Result<()> {
        let document = decode(parent_chain(4, false))?;
        let mut missing = document.clone();
        missing.symbols[3].parent_id = Some("missing".into());
        assert!(
            missing
                .validate()
                .unwrap_err()
                .to_string()
                .contains("Missing parent")
        );

        let mut cycle = document.clone();
        cycle.symbols[2].parent_id = Some("symbol-3".into());
        assert!(
            cycle
                .validate()
                .unwrap_err()
                .to_string()
                .contains("Cyclic parent")
        );

        let mut cross_input = document.clone();
        cross_input.symbols[1].api = "other".into();
        assert!(
            cross_input
                .validate()
                .unwrap_err()
                .to_string()
                .contains("Cross-input parent")
        );

        let mut cross_language = document;
        cross_language.symbols[1].language = model::Language::TypeScript;
        assert!(
            cross_language
                .validate()
                .unwrap_err()
                .to_string()
                .contains("Cross-input parent")
        );
        Ok(())
    }

    #[test]
    fn derived_names_use_explicit_parent_names_and_child_overrides() -> Result<()> {
        for (language, separator) in [("php", "::"), ("rust", "::"), ("typescript", ".")] {
            let mut input = parent_chain(3, false);
            input["inputs"][0]["language"] = json!(language);
            input["symbols"][1]
                .as_object_mut()
                .unwrap()
                .remove("qualifiedName");
            input["symbols"][2]["qualifiedName"] = json!("PublicAlias");
            let document = decode(input)?;
            assert_eq!(document.symbols[0].qualified_name, "Explicit0");
            assert_eq!(
                document.symbols[1].qualified_name,
                format!("Explicit0{separator}n")
            );
            assert_eq!(document.symbols[2].qualified_name, "PublicAlias");
        }
        Ok(())
    }

    #[test]
    fn round_trip_preserves_defaults_and_explicit_overrides() -> Result<()> {
        let bytes = include_bytes!("../../../tests/fixtures/schema-v1.json");
        let document = crate::artifact::parse(bytes)?;
        let encoded = encode(&document)?;
        let restored = crate::artifact::parse(&serde_json::to_vec(&encoded)?)?;
        assert_eq!(
            serde_json::to_value(&document)?,
            serde_json::to_value(&restored)?
        );
        let method = &restored.symbols[1];
        assert_eq!(method.parent_id.as_deref(), Some("class:A"));
        assert_eq!(method.signatures[1].declaration, "");
        assert_eq!(method.signatures[1].description, "");
        assert!(method.signatures[1].type_parameters.is_empty());
        assert_eq!(
            method.signatures[1].parameters[0].default.as_deref(),
            Some("")
        );
        assert_eq!(method.signatures[0].type_parameters[0].name, "T");
        assert_eq!(restored.symbols[3].group, "");
        assert_eq!(restored.symbols[3].qualified_name, "SpecialName");
        assert_eq!(encoded["types"].as_array().unwrap().len(), 3);
        assert!(encoded["symbols"][1]["tags"][0].get("text").is_none());
        Ok(())
    }

    #[test]
    fn rust_metadata_is_opaque_to_wire_compaction() -> Result<()> {
        let mut document =
            crate::artifact::parse(include_bytes!("../../../tests/fixtures/schema-v1.json"))?;
        for symbol in &mut document.symbols {
            symbol.language = model::Language::Rust;
        }
        document.symbols[0].qualified_name = "A".into();
        document.symbols[1].qualified_name = "A::greet".into();
        document.symbols[1].rustdoc_id = Some("1".into());
        let data = json!({
            "format_version": 57, "root": 0,
            "index": { "1": { "id": 1, "inner": { "function": {} } } },
            "extension": {
                "targetId": 5000, "type": { "text": "preserved", "references": [] },
                "line": 1, "default": null
            }
        });
        document.rustdoc.push(model::RustdocCrate {
            api: "backend".into(),
            data: data.as_object().unwrap().clone(),
        });
        let encoded = encode(&document)?;
        assert!(encoded["symbols"][1].get("qualifiedName").is_none());
        assert_eq!(encoded["rustdoc"][0]["data"], data);
        let restored = crate::artifact::parse(&serde_json::to_vec(&encoded)?)?;
        assert_eq!(restored.symbols[1].qualified_name, "A::greet");
        assert_eq!(
            serde_json::to_value(&document)?,
            serde_json::to_value(&restored)?
        );
        Ok(())
    }

    #[test]
    fn canonical_wire_fingerprint_is_stable_after_resolution() -> Result<()> {
        let mut document =
            crate::artifact::parse(include_bytes!("../../../tests/fixtures/schema-v1.json"))?;
        crate::artifact::seal(&mut document)?;
        let encoded = encode(&document)?;
        let resolved = crate::artifact::parse(&serde_json::to_vec(&encoded)?)?;
        assert_eq!(
            document.fingerprint,
            crate::artifact::fingerprint(&resolved)?
        );
        assert_eq!(encoded, encode(&resolved)?);
        Ok(())
    }
}
