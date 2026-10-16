use anyhow::Result;
use refquill::{
    config::Config,
    model::{Document, Kind, Language},
    rust,
};
use serde_json::Value;
use std::{collections::BTreeSet, path::PathBuf};

fn fixture() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/rust")
}
fn config() -> Result<Config> {
    Config::load(&fixture().join("refquill.json"))
}
fn analyze(config: &Config, path: &std::path::Path) -> Result<Document> {
    let mut document = Document::new("Rust".into());
    rust::analyze(config, "rust", path, &mut document)?;
    document.validate()?;
    Ok(document)
}

#[test]
fn projects_real_rustdoc_and_preserves_the_complete_semantic_graph() -> Result<()> {
    let document = analyze(&config()?, &fixture().join("rustdoc.json"))?;
    let find = |path: &str| {
        document
            .symbols
            .iter()
            .find(|s| s.qualified_name == format!("refquill_fixture::{path}"))
            .unwrap()
    };
    assert!(
        document
            .symbols
            .iter()
            .all(|s| s.language == Language::Rust)
    );
    assert_eq!(find("Record").kind, Kind::Struct);
    assert_eq!(find("Bits").kind, Kind::Union);
    assert_eq!(
        find("type").declaration,
        "pub fn r#type(r#match: u32) -> r#struct;"
    );
    assert_eq!(
        find("struct").declaration,
        "pub struct r#struct {\n    pub r#loop: u32,\n}"
    );
    assert_eq!(
        find("consume").declaration,
        "pub fn consume(value: impl Clone);"
    );
    assert!(find("consume").type_parameters.is_empty());
    assert!(document.symbols.iter().any(|s| s.kind == Kind::Struct
        && s.name == "Exposed"
        && s.declaration.starts_with("pub struct Exposed")));
    assert!(!document.symbols.iter().any(|s| s.name == "Original"));
    assert_eq!(
        document
            .symbols
            .iter()
            .filter(|s| s.qualified_name == "refquill_fixture::Exposed")
            .count(),
        1
    );
    assert!(
        document
            .symbols
            .iter()
            .any(|s| s.kind == Kind::Struct && s.qualified_name == "refquill_fixture::GlobExport")
    );
    assert!(
        !document
            .symbols
            .iter()
            .any(|s| s.kind == Kind::Module && s.name == "glob_private")
    );
    assert_eq!(
        find("SystemCallback").declaration,
        "pub type SystemCallback = extern \"system\" fn();"
    );
    assert!(
        document
            .symbols
            .iter()
            .any(|s| s.kind == Kind::Impl && s.declaration.contains("ExternalReceiver for String"))
    );
    assert_eq!(find("Compute").kind, Kind::Trait);
    assert_eq!(
        find("Compute::compute").signatures[0]
            .returns
            .as_ref()
            .unwrap()
            .text,
        "Self::Output"
    );
    assert_eq!(find("Status::Message").declaration, "Message(String)");
    assert!(
        find("Status")
            .declaration
            .contains("\n    Message(String),\n")
    );
    assert!(find("Bits").declaration.contains("\n    pub "));
    assert!(
        find("Record")
            .declaration
            .contains("\n    /* private fields */\n")
    );
    assert_eq!(
        find("Callback").r#type.as_ref().unwrap().text,
        "for<'a> unsafe extern \"C\" fn(&'a str, ...) -> i32"
    );
    assert_eq!(
        find("divergent").signatures[0]
            .returns
            .as_ref()
            .unwrap()
            .text,
        "!"
    );
    assert_eq!(
        find("iterator").signatures[0]
            .returns
            .as_ref()
            .unwrap()
            .text,
        "impl Iterator<Item = u32> + use<>"
    );
    assert!(
        find("callback")
            .declaration
            .contains("F: for<'a> Fn(&'a str) -> u32")
    );
    assert!(find("Lending::Item").declaration.contains("where Self: 'b"));
    assert!(
        find("inspect")
            .declaration
            .contains("async unsafe fn inspect<const N: usize>")
    );
    assert_eq!(
        find("foreign_function").declaration,
        "pub unsafe extern \"C\" fn foreign_function(value: i32) -> i32;"
    );
    assert!(find("old").deprecated);
    let renamed = find("Renamed");
    assert_eq!(renamed.kind, Kind::Reexport);
    assert_eq!(
        renamed.relations[0].target_id.as_ref(),
        Some(&find("nested::Inner").id)
    );
    assert_eq!(
        find("nested::*").relations[0].target_id.as_ref(),
        Some(&find("nested").id)
    );
    assert!(document.symbols.iter().any(|s|s.kind==Kind::Impl && s.declaration.contains("Compute<T> for Record<'a, T>")));
    assert!(
        document
            .symbols
            .iter()
            .any(|s| s.kind == Kind::Impl && s.modifiers.iter().any(|m| m == "synthetic"))
    );
    assert!(document.symbols.iter().any(|s| s.kind == Kind::Impl
        && s.modifiers.iter().any(|m| m == "blanket")
        && s.declaration.contains("for T")));
    let new = document.symbols.iter().find(|s| s.name == "new").unwrap();
    assert_eq!(new.kind, Kind::Method);
    assert!(!new.declaration.contains("hidden"));
    assert_eq!(
        new.source.as_ref().unwrap().file,
        "tests/fixtures/rust/lib.rs"
    );
    let record_id = find("Record").rustdoc_id.as_ref().unwrap();
    assert_eq!(
        document.rustdoc[0].data["index"][new.rustdoc_id.as_ref().unwrap()]["links"]["`Record`"]
            .as_u64()
            .unwrap()
            .to_string(),
        *record_id
    );
    for name in ["Private", "Hidden", "hidden", "Extra"] {
        assert!(
            !document.symbols.iter().any(|s| s.name == name),
            "{name} leaked"
        );
    }
    let original: Value = serde_json::from_slice(&std::fs::read(fixture().join("rustdoc.json"))?)?;
    assert_eq!(
        original["index"].as_object().unwrap().len(),
        document.rustdoc[0].data["index"].as_object().unwrap().len()
    );
    assert!(
        document.rustdoc[0].data["external_crates"]
            .as_object()
            .unwrap()
            .values()
            .all(|v| v.get("path").is_none())
    );
    assert!(!serde_json::to_string(&document)?.contains("/nix/store/"));
    let mut sealed = document.clone();
    refquill::artifact::seal(&mut sealed)?;
    let wire = refquill::wire::encode(&sealed)?;
    let restored = refquill::artifact::parse(&serde_json::to_vec(&wire)?)?;
    assert_eq!(
        serde_json::to_value(&restored.rustdoc)?,
        serde_json::to_value(&document.rustdoc)?
    );
    Ok(())
}

#[test]
fn excludes_apply_to_symbols_and_preserved_items() -> Result<()> {
    let mut cfg = config()?;
    cfg.exclude.push("**/excluded.rs".into());
    let document = analyze(&cfg, &fixture().join("rustdoc.json"))?;
    assert!(!document.symbols.iter().any(|s| s.name == "Excluded"));
    let raw = &document.rustdoc[0].data;
    assert!(
        !raw["index"]
            .as_object()
            .unwrap()
            .values()
            .any(|v| v["name"] == "Excluded")
    );
    assert!(!raw["paths"].as_object().unwrap().values().any(|v| {
        v["path"]
            .as_array()
            .is_some_and(|p| p.iter().any(|n| n == "Excluded"))
    }));
    cfg.exclude.push("**/lib.rs".into());
    assert!(analyze(&cfg, &fixture().join("rustdoc.json")).is_err());
    Ok(())
}

#[test]
fn many_private_reexports_preserve_order_canonical_paths_and_alias_targets() -> Result<()> {
    let mut raw: Value = serde_json::from_slice(&std::fs::read(fixture().join("rustdoc.json"))?)?;
    let index = raw["index"].as_object().unwrap();
    let original = index
        .values()
        .find(|item| item["name"] == "Original" && item["inner"]["struct"].is_object())
        .unwrap()
        .clone();
    let reexport = index
        .values()
        .find(|item| item["inner"]["use"]["name"] == "Exposed")
        .unwrap()
        .clone();
    let root = raw["root"].as_u64().unwrap().to_string();
    let count = 512;
    // Reverse the source order to distinguish traversal order from the sorted
    // private-target discovery pass. Forwarding uses must resolve through the
    // removed use IDs to the surviving canonical declarations.
    for number in (0..count).rev() {
        let target_id = 1_000_000 + number * 3;
        let reexport_id = target_id + 1;
        let forward_id = target_id + 2;
        let mut target = original.clone();
        target["id"] = target_id.into();
        target["name"] = format!("Original{number:04}").into();
        target["inner"]["struct"]["impls"] = serde_json::json!([]);
        let mut public = reexport.clone();
        public["id"] = reexport_id.into();
        public["inner"]["use"]["id"] = target_id.into();
        public["inner"]["use"]["name"] = format!("Alias{number:04}").into();
        let mut forward = reexport.clone();
        forward["id"] = forward_id.into();
        forward["inner"]["use"]["id"] = reexport_id.into();
        forward["inner"]["use"]["name"] = format!("Forward{number:04}").into();
        for item in [target, public, forward] {
            let id = item["id"].as_u64().unwrap().to_string();
            raw["index"].as_object_mut().unwrap().insert(id, item);
        }
        raw["index"][&root]["inner"]["module"]["items"]
            .as_array_mut()
            .unwrap()
            .extend([reexport_id.into(), forward_id.into()]);
    }
    let dir = tempfile::tempdir()?;
    let file = dir.path().join("rustdoc.json");
    std::fs::write(&file, serde_json::to_vec(&raw)?)?;
    let document = analyze(&config()?, &file)?;
    let added: Vec<_> = document
        .symbols
        .iter()
        .filter(|symbol| symbol.name.starts_with("Alias") || symbol.name.starts_with("Forward"))
        .collect();
    let expected: Vec<_> = (0..count)
        .rev()
        .map(|number| format!("Forward{number:04}"))
        .chain((0..count).map(|number| format!("Alias{number:04}")))
        .collect();
    assert_eq!(
        added.iter().map(|s| &s.name).collect::<Vec<_>>(),
        expected.iter().collect::<Vec<_>>()
    );
    let graph = document.rustdoc[0].data["index"].as_object().unwrap();
    for number in 0..count {
        let canonical = added[count as usize + number as usize];
        let forward = added[(count - number - 1) as usize];
        let target_id = 1_000_000 + number * 3;
        assert_eq!(canonical.kind, Kind::Struct);
        assert_eq!(
            canonical.qualified_name,
            format!("refquill_fixture::Alias{number:04}")
        );
        assert_eq!(canonical.rustdoc_id, Some(target_id.to_string()));
        assert_eq!(forward.kind, Kind::Reexport);
        assert_eq!(forward.relations[0].target_id.as_ref(), Some(&canonical.id));
        for id in target_id..=target_id + 2 {
            assert!(graph.contains_key(&id.to_string()));
        }
    }
    Ok(())
}

#[test]
fn rejects_unknown_versions_private_items_and_missing_graph_members_atomically() -> Result<()> {
    let cfg = config()?;
    let original: Value = serde_json::from_slice(&std::fs::read(fixture().join("rustdoc.json"))?)?;
    let dir = tempfile::tempdir()?;
    for failure in [
        "version",
        "private",
        "member",
        "cycle",
        "unknown-item",
        "unknown-type",
    ] {
        let mut raw = original.clone();
        let root = raw["root"].as_u64().unwrap().to_string();
        match failure {
            "version" => raw["format_version"] = 999.into(),
            "private" => raw["includes_private"] = true.into(),
            "member" => raw["index"][&root]["inner"]["module"]["items"][0] = 999999.into(),
            "cycle" => raw["index"][&root]["inner"]["module"]["items"][0] = raw["root"].clone(),
            "unknown-item" => raw["index"][&root]["inner"] = serde_json::json!({"future_item":{}}),
            "unknown-type" => {
                let function = raw["index"]
                    .as_object_mut()
                    .unwrap()
                    .values_mut()
                    .find(|v| v["name"] == "inspect")
                    .unwrap();
                function["inner"]["function"]["sig"]["output"] =
                    serde_json::json!({"future_type":{}});
            }
            _ => unreachable!(),
        }
        let file = dir.path().join("rustdoc.json");
        std::fs::write(&file, serde_json::to_vec(&raw)?)?;
        let mut document = Document::new("Test".into());
        assert!(
            rust::analyze(&cfg, "rust", &file, &mut document).is_err(),
            "{failure} was accepted"
        );
        assert!(document.symbols.is_empty());
        assert!(document.rustdoc.is_empty());
    }
    Ok(())
}

#[test]
fn public_ids_do_not_depend_on_numeric_rustdoc_ids() -> Result<()> {
    let cfg = config()?;
    let first = analyze(&cfg, &fixture().join("rustdoc.json"))?;
    let mut raw: Value = serde_json::from_slice(&std::fs::read(fixture().join("rustdoc.json"))?)?;
    fn renumber(v: &mut Value, key: Option<&str>) {
        match v {
            Value::Number(n) if matches!(key, Some("id" | "root")) => {
                *n = serde_json::Number::from(n.as_u64().unwrap() + 10000)
            }
            Value::Object(object) => {
                if matches!(key, Some("index" | "paths")) {
                    *object = std::mem::take(object)
                        .into_iter()
                        .map(|(k, mut v)| {
                            renumber(&mut v, None);
                            ((k.parse::<u64>().unwrap() + 10000).to_string(), v)
                        })
                        .collect();
                } else if key == Some("links") {
                    for v in object.values_mut() {
                        renumber(v, Some("id"));
                    }
                } else {
                    for (key, value) in object {
                        renumber(value, Some(key));
                    }
                }
            }
            Value::Array(values) => {
                let numbers = matches!(
                    key,
                    Some("items" | "impls" | "variants" | "implementations" | "fields" | "tuple")
                );
                for v in values {
                    renumber(v, if numbers { Some("id") } else { None });
                }
            }
            _ => {}
        }
    }
    renumber(&mut raw, None);
    let dir = tempfile::tempdir()?;
    let file = dir.path().join("rustdoc.json");
    std::fs::write(&file, serde_json::to_vec(&raw)?)?;
    let second = analyze(&cfg, &file)?;
    let ids = |d: Document| d.symbols.into_iter().map(|s| s.id).collect::<BTreeSet<_>>();
    assert_eq!(ids(first), ids(second));
    Ok(())
}

#[test]
fn implementation_docs_inherit_local_and_companion_traits_without_overwriting_overrides()
-> Result<()> {
    let cfg = config()?;
    let mut raw: Value = serde_json::from_slice(&std::fs::read(fixture().join("rustdoc.json"))?)?;
    let trait_id = raw["index"]
        .as_object()
        .unwrap()
        .iter()
        .find(|(_, item)| item["name"] == "Compute" && item["inner"]["trait"].is_object())
        .unwrap()
        .0
        .clone();
    let method_id = raw["index"][&trait_id]["inner"]["trait"]["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|id| id.as_u64().unwrap().to_string())
        .find(|id| raw["index"][id]["name"] == "compute")
        .unwrap();
    let record_id = raw["index"]
        .as_object()
        .unwrap()
        .iter()
        .find(|(_, item)| item["name"] == "Record" && item["inner"]["struct"].is_object())
        .unwrap()
        .0
        .clone();
    raw["index"][&method_id]["docs"] = "Compute a value. See [Record].".into();
    raw["index"][&method_id]["links"] = serde_json::json!({ "Record": record_id.parse::<u64>()? });
    let dir = tempfile::tempdir()?;
    let file = dir.path().join("rustdoc.json");
    std::fs::write(&file, serde_json::to_vec(&raw)?)?;
    let local = analyze(&cfg, &file)?;
    let method = local
        .symbols
        .iter()
        .find(|symbol| {
            symbol.name == "compute"
                && symbol.parent_id.as_ref().is_some_and(|id| {
                    local
                        .symbols
                        .iter()
                        .any(|parent| parent.id == *id && parent.kind == Kind::Impl)
                })
        })
        .unwrap();
    let implementation_method = method.rustdoc_id.clone().unwrap();
    assert_eq!(method.description, "Compute a value. See [Record].");
    assert_eq!(method.signatures[0].description, method.description);

    // Simulate an external dependency. Its numeric IDs stay local to its JSON.
    let mut dependency = raw.clone();
    // Dependency generic graphs may exceed serde_json's Value depth limit.
    // Documentation loading must skip those types rather than disabling limits.
    let mut nested = Value::Null;
    for _ in 0..160 {
        nested = serde_json::json!({"nested": nested});
    }
    dependency["index"][&method_id]["inner"]["function"]["generics"] = nested;
    for path in dependency["paths"].as_object_mut().unwrap().values_mut() {
        if path["crate_id"] == 0 {
            path["path"][0] = "contracts".into();
        }
    }
    let root = raw["root"].as_u64().unwrap().to_string();
    raw["index"][&root]["inner"]["module"]["items"]
        .as_array_mut()
        .unwrap()
        .retain(|id| id.as_u64().unwrap().to_string() != trait_id);
    raw["index"].as_object_mut().unwrap().remove(&trait_id);
    raw["paths"][&trait_id] =
        serde_json::json!({"crate_id":999, "kind":"trait", "path":["contracts", "Compute"]});
    raw["external_crates"]["999"] =
        serde_json::json!({"name":"contracts", "html_root_url":"https://docs.example.test/"});
    std::fs::write(&file, serde_json::to_vec(&raw)?)?;
    let missing = analyze(&cfg, &file)?;
    assert!(
        missing
            .symbols
            .iter()
            .find(|s| s.rustdoc_id.as_ref() == Some(&implementation_method))
            .unwrap()
            .description
            .is_empty()
    );
    std::fs::write(
        dir.path().join("contracts.json"),
        serde_json::to_vec(&dependency)?,
    )?;
    let external = analyze(&cfg, &file)?;
    let method = external
        .symbols
        .iter()
        .find(|s| s.rustdoc_id.as_ref() == Some(&implementation_method))
        .unwrap();
    assert_eq!(
        method.description,
        "Compute a value. See [Record].\n\n[Record]: https://docs.example.test/contracts/struct.Record.html"
    );
    assert_eq!(method.signatures[0].description, method.description);

    raw["index"][&implementation_method]["docs"] = "Implementation-specific docs.".into();
    std::fs::write(&file, serde_json::to_vec(&raw)?)?;
    let overridden = analyze(&cfg, &file)?;
    assert_eq!(
        overridden
            .symbols
            .iter()
            .find(|s| s.rustdoc_id.as_ref() == Some(&implementation_method))
            .unwrap()
            .description,
        "Implementation-specific docs."
    );
    raw["index"][&implementation_method]["docs"] = Value::Null;
    std::fs::write(&file, serde_json::to_vec(&raw)?)?;
    dependency["format_version"] = 999.into();
    std::fs::write(
        dir.path().join("contracts.json"),
        serde_json::to_vec(&dependency)?,
    )?;
    assert!(analyze(&cfg, &file).is_err());
    Ok(())
}

#[test]
fn unrelated_methods_do_not_change_existing_symbol_ids_or_parent_ids() -> Result<()> {
    let cfg = config()?;
    let first = analyze(&cfg, &fixture().join("rustdoc.json"))?;
    let original_method = first.symbols.iter().find(|s| s.name == "new").unwrap();
    let same_group = first
        .symbols
        .iter()
        .find(|s| s.name == "label" && s.kind == Kind::Method)
        .unwrap();
    assert_eq!(
        original_method.parent_id, same_group.parent_id,
        "Identical inherent headers should form one implementation group"
    );
    let mut raw: Value = serde_json::from_slice(&std::fs::read(fixture().join("rustdoc.json"))?)?;
    let method_id = original_method.rustdoc_id.as_ref().unwrap();
    let mut new_method = raw["index"][method_id].clone();
    new_method["id"] = 999999.into();
    new_method["name"] = "unrelated".into();
    raw["index"]
        .as_object_mut()
        .unwrap()
        .insert("999999".into(), new_method);
    let implementation = raw["index"]
        .as_object_mut()
        .unwrap()
        .values_mut()
        .find(|v| {
            v["inner"]["impl"]["items"].as_array().is_some_and(|items| {
                items
                    .iter()
                    .any(|id| id.as_u64().unwrap().to_string() == *method_id)
            })
        })
        .unwrap();
    implementation["inner"]["impl"]["items"]
        .as_array_mut()
        .unwrap()
        .push(999999.into());
    let dir = tempfile::tempdir()?;
    let file = dir.path().join("rustdoc.json");
    std::fs::write(&file, serde_json::to_vec(&raw)?)?;
    let second = analyze(&cfg, &file)?;
    for before in first.symbols {
        let after = second.symbols.iter().find(|s| s.id == before.id).unwrap();
        assert_eq!(before.parent_id, after.parent_id);
    }
    Ok(())
}

#[test]
fn absolute_and_external_sources_are_normalized() -> Result<()> {
    let cfg = config()?;
    let mut raw: Value = serde_json::from_slice(&std::fs::read(fixture().join("rustdoc.json"))?)?;
    for item in raw["index"].as_object_mut().unwrap().values_mut() {
        if let Some(file) = item["span"]["filename"].as_str() {
            item["span"]["filename"] = cfg
                .source_root
                .join(file)
                .to_string_lossy()
                .to_string()
                .into();
        }
    }
    let dir = tempfile::tempdir()?;
    let file = dir.path().join("rustdoc.json");
    std::fs::write(&file, serde_json::to_vec(&raw)?)?;
    let document = analyze(&cfg, &file)?;
    assert!(
        document
            .symbols
            .iter()
            .filter_map(|s| s.source.as_ref())
            .all(|s| !s.file.starts_with('/'))
    );
    assert!(!serde_json::to_string(&document)?.contains(cfg.source_root.to_str().unwrap()));
    Ok(())
}
