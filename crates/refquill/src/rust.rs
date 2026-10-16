//! Compiler-backed Rust API projection. The complete, filtered rustdoc graph is
//! retained alongside the common symbols, including compiler-specific details.
use crate::{config::Config, model::*};
use anyhow::{Context, Result, bail, ensure};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Component, Path, PathBuf},
};

/// rustdoc's JSON format is unstable. Accept only the format exercised by the
/// checked-in compiler-generated fixture, rather than guessing across versions.
pub const FORMAT_VERSION: u64 = 61;

pub fn analyze(config: &Config, name: &str, file: &Path, document: &mut Document) -> Result<()> {
    analyze_with_base(config, name, file, &config.source_root, document)
}

/// `source_base` is the working directory used when rustdoc generated its spans.
pub fn analyze_with_base(
    config: &Config,
    name: &str,
    file: &Path,
    source_base: &Path,
    document: &mut Document,
) -> Result<()> {
    let data: Value = serde_json::from_slice(
        &std::fs::read(file)
            .with_context(|| format!("Cannot read rustdoc JSON {}", file.display()))?,
    )
    .context("Invalid rustdoc JSON")?;
    ensure!(
        data["format_version"].as_u64() == Some(FORMAT_VERSION),
        "Unsupported rustdoc JSON format_version {}; expected {FORMAT_VERSION}. Generate JSON with a compatible Rust toolchain",
        data["format_version"]
    );
    ensure!(
        data["includes_private"].as_bool() == Some(false),
        "Rust input must be generated without --document-private-items"
    );
    let root = item_id(&data["root"])?;
    let index = data["index"]
        .as_object()
        .context("rustdoc index must be an object")?;
    ensure!(
        data["paths"].is_object() && data["external_crates"].is_object(),
        "Invalid rustdoc crate metadata"
    );
    let root_item = index
        .get(&root)
        .context("rustdoc root is missing from index")?;
    ensure!(
        root_item["inner"]["module"]["is_crate"] == true,
        "rustdoc root must be a crate module"
    );
    let crate_id = root_item["crate_id"]
        .as_u64()
        .context("Invalid rustdoc crate ID")?;
    let mut globs = globset::GlobSetBuilder::new();
    for pattern in &config.exclude {
        globs.add(globset::Glob::new(pattern)?);
    }
    let mut ctx = Analyzer {
        config,
        name,
        source_base,
        index,
        crate_id,
        globs: globs.build()?,
        symbols: vec![],
        visited: BTreeSet::new(),
        active: BTreeSet::new(),
        ids: BTreeMap::new(),
        retained_containers: BTreeSet::new(),
    };
    ctx.visit(&root, None, "", "", None)?;
    // Public reexports can expose items whose original module is private and
    // therefore absent from the root's module list. Follow their targets after
    // normal traversal so an ordinary declaration always owns its canonical path.
    loop {
        let mut pending: Vec<_> = ctx
            .symbols
            .iter()
            .filter(|s| s.kind == Kind::Reexport)
            .filter_map(|s| {
                let raw = &index[s.rustdoc_id.as_ref()?]["inner"]["use"]["id"];
                let target = item_id(raw).ok()?;
                (!ctx.visited.contains(&target)
                    && index
                        .get(&target)
                        .is_some_and(|v| v["crate_id"].as_u64() == Some(crate_id)))
                .then(|| {
                    (
                        target,
                        s.parent_id.clone(),
                        s.group.clone(),
                        s.name.clone(),
                        index[s.rustdoc_id.as_ref().unwrap()]["inner"]["use"]["is_glob"] == true,
                    )
                })
            })
            .collect();
        pending.sort_by(|left, right| (&left.2, &left.3).cmp(&(&right.2, &right.3)));
        if pending.is_empty() {
            break;
        }
        let before = ctx.visited.len();
        for (id, parent, group, alias, glob) in pending {
            if glob && index[&id]["inner"]["module"].is_object() {
                // A glob exports the contents, not its private source module.
                // Keep that container in the compiler graph without inventing a
                // public module path in the common projection.
                ctx.visited.insert(id.clone());
                if ctx
                    .source(&index[&id])?
                    .as_ref()
                    .is_some_and(|s| ctx.globs.is_match(&s.file))
                    || index[&id]["attrs"]
                        .as_array()
                        .is_some_and(|a| a.iter().any(hidden_attribute))
                {
                    continue;
                }
                ctx.retained_containers.insert(id.clone());
                for child in array(&index[&id]["inner"]["module"]["items"])? {
                    ctx.visit(&item_id(child)?, parent.as_deref(), &group, &group, None)?;
                }
            } else {
                ctx.visit(&id, parent.as_deref(), &group, &group, Some(&alias))?;
            }
        }
        if before == ctx.visited.len() {
            break;
        }
    }
    // An implementation of a local trait for an external receiver has no local
    // type page from which to discover it. Prefer type ownership where present,
    // then attach the remaining implementations to their trait.
    let implementations: Vec<_> = ctx
        .symbols
        .iter()
        .filter(|s| s.kind == Kind::Trait)
        .flat_map(|symbol| {
            index[symbol.rustdoc_id.as_ref().unwrap()]["inner"]["trait"]["implementations"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|id| {
                    (
                        id.clone(),
                        symbol.id.clone(),
                        symbol.qualified_name.clone(),
                        symbol.group.clone(),
                    )
                })
        })
        .collect();
    for (id, parent, path, group) in implementations {
        let id = item_id(&id)?;
        if !ctx.visited.contains(&id) {
            ctx.visit(&id, Some(&parent), &path, &group, None)?;
        }
    }
    // When a private definition is exposed under a public alias, the projected
    // declaration already owns that public path. Keep the original `use` in the
    // compiler graph without creating a second competing navigation entry.
    let projected: BTreeSet<_> = ctx
        .symbols
        .iter()
        .map(|symbol| (&symbol.id, &symbol.qualified_name))
        .collect();
    let mut redundant = BTreeSet::new();
    let mut aliases = Vec::new();
    for symbol in ctx.symbols.iter().filter(|s| s.kind == Kind::Reexport) {
        let raw = symbol.rustdoc_id.as_ref().unwrap();
        let Ok(target) = item_id(&index[raw]["inner"]["use"]["id"]) else {
            continue;
        };
        let Some(target) = ctx.ids.get(&target) else {
            continue;
        };
        if projected.contains(&(target, &symbol.qualified_name)) {
            redundant.insert(symbol.id.clone());
            aliases.push((raw.clone(), target.clone()));
        }
    }
    ctx.symbols.retain(|s| !redundant.contains(&s.id));
    ctx.ids.extend(aliases);
    ctx.link()?;
    ctx.inherit_trait_docs(&data, file)?;
    ensure!(
        !ctx.symbols.is_empty(),
        "No Rust symbols selected for {name}"
    );
    let mut snapshot = data
        .as_object()
        .context("rustdoc crate must be an object")?
        .clone();
    let retained: BTreeSet<_> = ctx
        .ids
        .keys()
        .cloned()
        .chain(ctx.retained_containers.iter().cloned())
        .collect();
    let removed: BTreeSet<_> = index
        .iter()
        .filter(|(id, item)| item["crate_id"].as_u64() == Some(crate_id) && !retained.contains(*id))
        .map(|(id, _)| id.clone())
        .collect();
    let raw_index = snapshot.get_mut("index").unwrap().as_object_mut().unwrap();
    raw_index
        .retain(|id, item| item["crate_id"].as_u64() != Some(crate_id) || retained.contains(id));
    for item in raw_index.values_mut() {
        let source = ctx.source(item)?;
        if let Some(source) = source {
            item["span"]["filename"] = Value::String(source.file);
        } else if let Some(object) = item.as_object_mut() {
            object.insert("span".into(), Value::Null);
        }
        prune_children(item, &removed, None);
    }
    // Excluded local entries must not survive through the path side table.
    snapshot
        .get_mut("paths")
        .unwrap()
        .as_object_mut()
        .unwrap()
        .retain(|id, item| item["crate_id"].as_u64() != Some(crate_id) || retained.contains(id));
    for external in snapshot
        .get_mut("external_crates")
        .unwrap()
        .as_object_mut()
        .unwrap()
        .values_mut()
    {
        // Format 61 includes host .rmeta paths; these are not API semantics.
        if let Some(object) = external.as_object_mut() {
            object.remove("path");
        }
    }
    document.symbols.extend(ctx.symbols);
    document.rustdoc.push(RustdocCrate {
        api: name.into(),
        data: snapshot,
    });
    Ok(())
}

// Dependency type graphs can contain deeply nested generic expressions. Read
// only documentation fields; serde skips the remaining compiler payload.
#[derive(Deserialize, Serialize)]
struct DependencyDocumentation {
    root: Value,
    format_version: u64,
    includes_private: bool,
    index: BTreeMap<String, DependencyItem>,
    paths: Value,
    external_crates: Value,
}

#[derive(Deserialize, Serialize)]
struct DependencyItem {
    name: Option<String>,
    crate_id: u64,
    docs: Option<String>,
    links: BTreeMap<String, Value>,
    inner: DependencyInner,
}

#[derive(Deserialize, Serialize)]
struct DependencyInner {
    r#trait: Option<DependencyTrait>,
}

#[derive(Deserialize, Serialize)]
struct DependencyTrait {
    items: Vec<Value>,
}

fn documentation_url(snapshot: &Value, id: &Value, own_root: Option<&str>) -> Option<String> {
    let id = item_id(id).ok()?;
    let path = &snapshot["paths"][&id];
    let parts = path["path"].as_array()?;
    let crate_id = path["crate_id"].as_u64()?;
    let root_id = item_id(&snapshot["root"]).ok()?;
    let root = if snapshot["index"][root_id]["crate_id"].as_u64() == Some(crate_id) {
        own_root?
    } else {
        snapshot["external_crates"][crate_id.to_string()]["html_root_url"].as_str()?
    };
    if !(root.starts_with("https://") || root.starts_with("http://"))
        || root.contains(['\r', '\n', '<', '>'])
    {
        return None;
    }
    let kind = path["kind"].as_str()?;
    if let Some((parent_id, parent)) =
        snapshot["paths"]
            .as_object()?
            .iter()
            .find(|(_, candidate)| {
                matches!(
                    candidate["kind"].as_str(),
                    Some("trait" | "struct" | "enum" | "union" | "primitive")
                ) && parts.len() > 1
                    && candidate["path"]
                        .as_array()
                        .is_some_and(|parent| parent == &parts[..parts.len() - 1])
            })
    {
        let parent_url = documentation_url(snapshot, &Value::String(parent_id.clone()), own_root)?;
        let anchor = match kind {
            "function" if parent["kind"] != "trait" => Some("method"),
            "assoc_type" => Some("associatedtype"),
            "assoc_const" => Some("associatedconstant"),
            "variant" => Some("variant"),
            "struct_field" => Some("structfield"),
            // A trait method's anchor depends on whether it has a default body.
            // A link to the trait remains valid when that metadata is absent.
            _ => None,
        };
        return Some(match anchor {
            Some(anchor) => format!("{parent_url}#{anchor}.{}", parts.last()?.as_str()?),
            None => parent_url,
        });
    }
    let prefix = match kind {
        "struct" => "struct",
        "enum" => "enum",
        "union" => "union",
        "trait" => "trait",
        "trait_alias" => "traitalias",
        "type_alias" => "type",
        "function" => "fn",
        "constant" => "constant",
        "static" => "static",
        "macro" => "macro",
        "proc_attribute" => "attr",
        "proc_derive" => "derive",
        "primitive" => "primitive",
        "foreign_type" => "foreigntype",
        "module" => "",
        _ => return None,
    };
    let mut segments = parts
        .iter()
        .map(|part| {
            Some(
                part.as_str()?
                    .bytes()
                    .map(|byte| {
                        if byte.is_ascii_alphanumeric() || b"-_.~".contains(&byte) {
                            char::from(byte).to_string()
                        } else {
                            format!("%{byte:02X}")
                        }
                    })
                    .collect::<String>(),
            )
        })
        .collect::<Option<Vec<_>>>()?;
    let name = segments.pop()?;
    if kind == "module" {
        segments.extend([name, "index.html".into()]);
    } else {
        segments.push(format!("{prefix}.{name}.html"));
    }
    Some(format!(
        "{}/{}",
        root.trim_end_matches('/'),
        segments.join("/")
    ))
}

struct Analyzer<'a> {
    config: &'a Config,
    name: &'a str,
    source_base: &'a Path,
    index: &'a Map<String, Value>,
    crate_id: u64,
    globs: globset::GlobSet,
    symbols: Vec<Symbol>,
    visited: BTreeSet<String>,
    active: BTreeSet<String>,
    ids: BTreeMap<String, String>,
    retained_containers: BTreeSet<String>,
}

impl Analyzer<'_> {
    fn inherit_trait_docs(&mut self, metadata: &Value, file: &Path) -> Result<()> {
        let parents: BTreeMap<_, _> = self
            .symbols
            .iter()
            .filter(|symbol| symbol.kind == Kind::Impl)
            .map(|symbol| (symbol.id.clone(), symbol.rustdoc_id.clone().unwrap()))
            .collect();
        let mut dependencies = BTreeMap::<String, Option<Value>>::new();
        for symbol in &mut self.symbols {
            if !symbol.description.is_empty() {
                continue;
            }
            let Some(parent) = symbol.parent_id.as_ref().and_then(|id| parents.get(id)) else {
                continue;
            };
            let Ok(trait_id) = item_id(&self.index[parent]["inner"]["impl"]["trait"]["id"]) else {
                continue;
            };
            let path = &metadata["paths"][&trait_id];
            let crate_id = path["crate_id"].as_u64();
            let (snapshot, trait_item, external_root) = if let Some(item) =
                self.index.get(&trait_id)
            {
                // Do not recover documentation from excluded local traits.
                if item["crate_id"].as_u64() == Some(self.crate_id)
                    && !self.ids.contains_key(&trait_id)
                {
                    continue;
                }
                (metadata, item, None)
            } else {
                let Some(external) =
                    crate_id.map(|id| &metadata["external_crates"][id.to_string()])
                else {
                    continue;
                };
                let Some(name) = external["name"].as_str() else {
                    continue;
                };
                // Cargo writes dependency JSON beside the selected crate. Only
                // read compiler-named companions, never paths supplied in JSON.
                if name.is_empty() || !name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
                {
                    continue;
                }
                if !dependencies.contains_key(name) {
                    let dependency = file.with_file_name(format!("{name}.json"));
                    let data = if dependency.try_exists()? {
                        let data: DependencyDocumentation = serde_json::from_slice(&std::fs::read(
                            &dependency,
                        )?)
                        .with_context(|| {
                            format!("Invalid dependency rustdoc JSON {}", dependency.display())
                        })?;
                        ensure!(
                            data.format_version == FORMAT_VERSION && !data.includes_private,
                            "Dependency rustdoc must use format {FORMAT_VERSION} without private items: {}",
                            dependency.display()
                        );
                        Some(serde_json::to_value(data)?)
                    } else {
                        None
                    };
                    dependencies.insert(name.into(), data);
                }
                let Some(dependency) = dependencies[name].as_ref() else {
                    continue;
                };
                let Some((id, _)) =
                    dependency["paths"]
                        .as_object()
                        .into_iter()
                        .flatten()
                        .find(|(_, candidate)| {
                            candidate["kind"] == "trait" && candidate["path"] == path["path"]
                        })
                else {
                    continue;
                };
                (
                    dependency,
                    &dependency["index"][id],
                    external["html_root_url"].as_str(),
                )
            };
            let Some(member) = trait_item["inner"]["trait"]["items"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|id| item_id(id).ok())
                .map(|id| &snapshot["index"][id])
                .find(|item| item["name"].as_str() == Some(&symbol.name))
            else {
                continue;
            };
            let Some(docs) = member["docs"].as_str().filter(|docs| !docs.is_empty()) else {
                continue;
            };
            symbol.description = docs.into();
            if !std::ptr::eq(snapshot, metadata) {
                // Resolve inherited dependency links in their original crate's
                // namespace before moving the Markdown to the implementation.
                for (name, target) in member["links"].as_object().into_iter().flatten() {
                    if name.contains(['[', ']', '\r', '\n']) {
                        continue;
                    }
                    if let Some(url) = documentation_url(snapshot, target, external_root) {
                        symbol.description.push_str(&format!("\n\n[{name}]: {url}"));
                    }
                }
            }
            for signature in &mut symbol.signatures {
                signature.description.clone_from(&symbol.description);
            }
        }
        Ok(())
    }

    fn source(&self, item: &Value) -> Result<Option<Source>> {
        let span = &item["span"];
        if span.is_null() {
            return Ok(None);
        }
        let filename = span["filename"]
            .as_str()
            .context("Invalid rustdoc span filename")?;
        // Compiler-generated and dependency spans may refer to virtual files or
        // paths outside sourceRoot. Preserve their metadata without a local link.
        if filename.starts_with('<') {
            return Ok(None);
        }
        let path = Path::new(filename);
        let mut absolute = PathBuf::new();
        for part in self.source_base.join(path).components() {
            match part {
                Component::CurDir => {}
                Component::ParentDir => {
                    absolute.pop();
                }
                other => absolute.push(other.as_os_str()),
            }
        }
        if absolute.exists() {
            absolute = absolute.canonicalize()?;
        }
        let Ok(relative) = absolute.strip_prefix(&self.config.source_root) else {
            return Ok(None);
        };
        let file = relative.to_string_lossy().replace('\\', "/");
        if file.is_empty() || file.contains(':') {
            return Ok(None);
        }
        let source = Source {
            file,
            line: u32::try_from(
                span["begin"][0]
                    .as_u64()
                    .context("Invalid rustdoc span begin")?,
            )?,
            end_line: u32::try_from(
                span["end"][0]
                    .as_u64()
                    .context("Invalid rustdoc span end")?,
            )?,
        };
        source.validate()?;
        Ok(Some(source))
    }

    fn visit(
        &mut self,
        id: &str,
        parent: Option<&str>,
        parent_path: &str,
        group: &str,
        exposed: Option<&str>,
    ) -> Result<()> {
        let item = self
            .index
            .get(id)
            .with_context(|| format!("Missing rustdoc item {id}"))?;
        ensure!(
            self.active.len() < 256,
            "Rustdoc item ownership exceeds 256 levels"
        );
        if self.visited.contains(id) && item["crate_id"].as_u64() == Some(self.crate_id) {
            return Ok(());
        }
        ensure!(
            self.active.insert(id.into()),
            "Cyclic rustdoc item ownership at {id}"
        );
        ensure!(
            item_id(&item["id"])? == id,
            "rustdoc index key does not match item ID: {id}"
        );
        let source = self.source(item)?;
        if source
            .as_ref()
            .is_some_and(|s| self.globs.is_match(&s.file))
        {
            self.active.remove(id);
            self.visited.insert(id.into());
            return Ok(());
        }
        let (tag, inner) = variant(&item["inner"])?;
        // Default visibility is meaningful for trait/impl items and variants.
        // Restricting those to `public` would erase required public API members.
        let public_context = parent.is_some_and(|p| {
            self.symbols.iter().any(|s| {
                s.id == p
                    && matches!(
                        s.kind,
                        Kind::Trait | Kind::Impl | Kind::Enum | Kind::EnumCase
                    )
            })
        });
        let visible =
            item["visibility"] == "public" || public_context || tag == "impl" || exposed.is_some();
        if !visible
            || item["attrs"]
                .as_array()
                .is_some_and(|a| a.iter().any(hidden_attribute))
        {
            self.active.remove(id);
            self.visited.insert(id.into());
            return Ok(());
        }
        let kind = match tag {
            "module" => Kind::Module,
            "struct" => Kind::Struct,
            "union" => Kind::Union,
            "enum" => Kind::Enum,
            "variant" => Kind::EnumCase,
            "struct_field" => Kind::Property,
            "function" if public_context => Kind::Method,
            "function" => Kind::Function,
            "trait" => Kind::Trait,
            "trait_alias" => Kind::TraitAlias,
            "impl" => Kind::Impl,
            "type_alias" | "assoc_type" => Kind::TypeAlias,
            "constant" | "assoc_const" => Kind::Constant,
            "static" => Kind::Variable,
            "macro" | "proc_macro" => Kind::Macro,
            "use" => Kind::Reexport,
            "extern_crate" => Kind::Module,
            "extern_type" => Kind::ExternType,
            "primitive" => Kind::Primitive,
            _ => bail!("Unsupported rustdoc item kind: {tag}"),
        };
        let name = if tag == "impl" {
            self.impl_declaration(inner)?
        } else if tag == "use" {
            format!(
                "{}{}",
                string(&inner["name"])?,
                if inner["is_glob"] == true { "::*" } else { "" }
            )
        } else {
            exposed.unwrap_or(string(&item["name"])?).to_owned()
        };
        let qualified = if parent_path.is_empty() {
            name.clone()
        } else {
            format!("{parent_path}::{name}")
        };
        let stable_id = format!("rust:{}:{tag}:{qualified}", self.name);
        self.ids.insert(id.into(), stable_id.clone());
        let declaration = self.declaration(tag, inner, &name, item["visibility"] == "public")?;
        let mut symbol = Symbol {
            id: stable_id.clone(),
            language: Language::Rust,
            kind,
            name,
            qualified_name: qualified.clone(),
            api: self.name.into(),
            group: group.into(),
            parent_id: parent.map(str::to_owned),
            declaration,
            description: item["docs"].as_str().unwrap_or("").into(),
            deprecated: !item["deprecation"].is_null(),
            promoted: false,
            framework: None,
            modifiers: vec![],
            source,
            r#type: None,
            signatures: vec![],
            type_parameters: self.type_parameters(&inner["generics"])?,
            relations: vec![],
            tags: vec![],
            rustdoc_id: Some(id.into()),
        };
        for key in ["is_unsafe", "is_auto", "is_synthetic", "is_negative"] {
            if inner[key] == true {
                symbol
                    .modifiers
                    .push(key.strip_prefix("is_").unwrap().replace('_', "-"));
            }
        }
        if tag == "impl" && !inner["blanket_impl"].is_null() {
            symbol.modifiers.push("blanket".into());
        }
        match tag {
            "function" => {
                let parameters = self.parameters(&inner["sig"])?;
                let returns = self.optional_type(&inner["sig"]["output"])?;
                symbol.signatures.push(Signature {
                    declaration: symbol.declaration.clone(),
                    description: symbol.description.clone(),
                    parameters,
                    returns,
                    returns_description: String::new(),
                    type_parameters: symbol.type_parameters.clone(),
                });
                for key in ["is_const", "is_unsafe", "is_async"] {
                    if inner["header"][key] == true {
                        symbol
                            .modifiers
                            .push(key.strip_prefix("is_").unwrap().into());
                    }
                }
            }
            "struct_field" => symbol.r#type = Some(self.ty(inner)?),
            "type_alias" | "assoc_type" | "constant" | "assoc_const" | "static" => {
                symbol.r#type = self.optional_type(&inner["type"])?
            }
            _ => {}
        }
        // Identical implementation headers form one public implementation group,
        // even when the source splits its methods across multiple blocks. Each
        // original block still survives in the rustdoc graph. This keeps URLs
        // stable when an unrelated method or block is added.
        if tag == "impl" && self.symbols.iter().any(|s| s.id == stable_id) {
            if !symbol.description.is_empty() {
                let existing = self.symbols.iter_mut().find(|s| s.id == stable_id).unwrap();
                if !existing.description.is_empty() {
                    existing.description.push_str("\n\n");
                }
                existing.description.push_str(&symbol.description);
            }
        } else {
            self.symbols.push(symbol);
        }
        let child_group = if tag == "module" {
            qualified.as_str()
        } else {
            group
        };
        for child in children(tag, inner)? {
            if child.is_null() {
                continue;
            }
            self.visit(
                &item_id(child)?,
                Some(&stable_id),
                &qualified,
                child_group,
                None,
            )?;
        }
        self.visited.insert(id.into());
        self.active.remove(id);
        Ok(())
    }

    fn link(&mut self) -> Result<()> {
        // Types initially store numeric rustdoc IDs; resolve only after all public
        // declarations and reexport targets have been projected.
        for symbol in &mut self.symbols {
            let raw = &self.index[symbol.rustdoc_id.as_ref().unwrap()];
            let (tag, inner) = variant(&raw["inner"])?;
            let relation = if tag == "use" {
                Some((
                    RelationKind::Reexports,
                    inner["source"].as_str().unwrap_or(""),
                    &inner["id"],
                ))
            } else if tag == "impl" && !inner["trait"].is_null() {
                Some((
                    RelationKind::Implements,
                    inner["trait"]["path"].as_str().unwrap_or(""),
                    &inner["trait"]["id"],
                ))
            } else {
                None
            };
            if let Some((kind, name, target)) = relation {
                symbol.relations.push(Relation {
                    kind,
                    name: name.into(),
                    target_id: item_id(target)
                        .ok()
                        .and_then(|id| self.ids.get(&id).cloned()),
                });
            }
            let mut types: Vec<&mut Type> = symbol.r#type.iter_mut().collect();
            for parameter in &mut symbol.type_parameters {
                types.extend(parameter.constraint.iter_mut());
                types.extend(parameter.default.iter_mut());
            }
            for sig in &mut symbol.signatures {
                types.extend(sig.returns.iter_mut());
                for p in &mut sig.parameters {
                    types.extend(p.r#type.iter_mut());
                }
                for p in &mut sig.type_parameters {
                    types.extend(p.constraint.iter_mut());
                    types.extend(p.default.iter_mut());
                }
            }
            for ty in types {
                for reference in &mut ty.references {
                    reference.target_id = reference
                        .target_id
                        .as_ref()
                        .and_then(|id| self.ids.get(id).cloned());
                }
            }
        }
        Ok(())
    }

    fn ty(&self, value: &Value) -> Result<Type> {
        let mut references = BTreeMap::new();
        collect_references(value, &mut references);
        Ok(Type {
            structure: None,
            text: render_type(value)?,
            references: references
                .into_iter()
                .map(|(id, name)| Reference {
                    package: None,
                    qualified_name: None,
                    name,
                    target_id: Some(id),
                })
                .collect(),
        })
    }

    fn optional_type(&self, value: &Value) -> Result<Option<Type>> {
        if value.is_null() {
            Ok(None)
        } else {
            self.ty(value).map(Some)
        }
    }

    fn type_parameters(&self, generics: &Value) -> Result<Vec<TypeParameter>> {
        if generics.is_null() {
            return Ok(vec![]);
        }
        array(&generics["params"])?
            .iter()
            .filter(|param| param["kind"]["type"]["is_synthetic"] != true)
            .map(|param| {
                let (kind, value) = variant(&param["kind"])?;
                let mut constraint = match kind {
                    "type" => nonempty_type(render_bounds(&value["bounds"])?, &value["bounds"]),
                    "lifetime" => {
                        nonempty_type(join_strings(&value["outlives"], " + ")?, &value["outlives"])
                    }
                    "const" => Some(self.ty(&value["type"])?),
                    _ => bail!("Unsupported rustdoc generic parameter: {kind}"),
                };
                if let Some(ty) = &mut constraint {
                    let mut refs = BTreeMap::new();
                    collect_references(value, &mut refs);
                    ty.references = refs
                        .into_iter()
                        .map(|(id, name)| Reference {
                            package: None,
                            qualified_name: None,
                            name,
                            target_id: Some(id),
                        })
                        .collect();
                }
                let default = if kind == "type" {
                    self.optional_type(&value["default"])?
                } else if kind == "const" {
                    value["default"].as_str().map(|v| Type {
                        structure: None,
                        text: v.into(),
                        references: vec![],
                    })
                } else {
                    None
                };
                Ok(TypeParameter {
                    name: string(&param["name"])?.into(),
                    constraint,
                    default,
                    description: String::new(),
                })
            })
            .collect()
    }

    fn parameters(&self, sig: &Value) -> Result<Vec<Parameter>> {
        let mut parameters: Vec<_> = array(&sig["inputs"])?
            .iter()
            .map(|input| {
                Ok(Parameter {
                    properties: Vec::new(),
                    signatures: Vec::new(),
                    name: string(&input[0])?.into(),
                    r#type: Some(self.ty(&input[1])?),
                    description: String::new(),
                    optional: false,
                    variadic: false,
                    by_reference: input[1].get("borrowed_ref").is_some(),
                    default: None,
                })
            })
            .collect::<Result<_>>()?;
        if sig["is_c_variadic"] == true {
            parameters.push(Parameter {
                properties: Vec::new(),
                signatures: Vec::new(),
                name: "...".into(),
                r#type: None,
                description: String::new(),
                optional: false,
                variadic: true,
                by_reference: false,
                default: None,
            });
        }
        Ok(parameters)
    }

    fn impl_declaration(&self, inner: &Value) -> Result<String> {
        let prefix = if inner["is_unsafe"] == true {
            "unsafe "
        } else {
            ""
        };
        let trait_part = if inner["trait"].is_null() {
            String::new()
        } else {
            format!(
                "{}{} for ",
                if inner["is_negative"] == true {
                    "!"
                } else {
                    ""
                },
                render_path(&inner["trait"])?
            )
        };
        Ok(format!(
            "{prefix}impl{} {trait_part}{}{}",
            render_generics(&inner["generics"])?,
            render_type(if inner["blanket_impl"].is_null() {
                &inner["for"]
            } else {
                &inner["blanket_impl"]
            })?,
            render_where(&inner["generics"])?
        ))
    }

    fn declaration(&self, tag: &str, inner: &Value, name: &str, public: bool) -> Result<String> {
        let name = render_identifier(name);
        let vis = if public { "pub " } else { "" };
        let generics = render_generics(&inner["generics"])?;
        let where_clause = render_where(&inner["generics"])?;
        Ok(match tag {
            "module" => format!("{vis}mod {name};"),
            "extern_crate" => format!(
                "{vis}extern crate {}{};",
                render_identifier(string(&inner["name"])?),
                inner["rename"]
                    .as_str()
                    .map(|n| format!(" as {}", render_identifier(n)))
                    .unwrap_or_default()
            ),
            "struct" => {
                let body = if inner["kind"] == "unit" {
                    format!("{where_clause};")
                } else if let Some(tuple) = inner["kind"].get("tuple") {
                    format!("({}){where_clause};", self.fields(tuple, true)?.join(", "))
                } else {
                    let mut fields = self.fields(&inner["kind"]["plain"]["fields"], false)?;
                    if inner["kind"]["plain"]["has_stripped_fields"] == true {
                        fields.push("/* private fields */".into());
                    }
                    format!("{where_clause} {}", render_block(&fields))
                };
                format!("{vis}struct {name}{generics}{body}")
            }
            "union" => format!(
                "{vis}union {name}{generics}{where_clause} {}",
                render_block(&self.fields(&inner["fields"], false)?)
            ),
            "enum" => format!(
                "{vis}enum {name}{generics}{where_clause} {}",
                render_block(
                    &array(&inner["variants"])?
                        .iter()
                        .map(|id| {
                            let id = item_id(id)?;
                            let item = self.index.get(&id).context("Missing enum variant")?;
                            self.declaration(
                                "variant",
                                &item["inner"]["variant"],
                                string(&item["name"])?,
                                false,
                            )
                        })
                        .collect::<Result<Vec<_>>>()?
                )
            ),
            "variant" => {
                let shape = if inner["kind"] == "plain" {
                    String::new()
                } else if let Some(tuple) = inner["kind"].get("tuple") {
                    format!("({})", self.fields(tuple, true)?.join(", "))
                } else {
                    format!(
                        " {}",
                        render_block(&self.fields(&inner["kind"]["struct"]["fields"], false)?)
                    )
                };
                format!(
                    "{name}{shape}{}",
                    inner["discriminant"]["expr"]
                        .as_str()
                        .map(|v| format!(" = {v}"))
                        .unwrap_or_default()
                )
            }
            "struct_field" => format!("{vis}{name}: {}", render_type(inner)?),
            "function" => format!(
                "{vis}{}fn {name}{generics}{}{};",
                render_header(&inner["header"])?,
                render_signature(&inner["sig"], true)?,
                render_where_lines(&inner["generics"])?
            ),
            "trait" => format!(
                "{vis}{}{}trait {name}{generics}{}{where_clause} {{ … }}",
                if inner["is_unsafe"] == true {
                    "unsafe "
                } else {
                    ""
                },
                if inner["is_auto"] == true {
                    "auto "
                } else {
                    ""
                },
                bounds_suffix(&inner["bounds"])?
            ),
            "trait_alias" => format!(
                "{vis}trait {name}{generics} = {}{where_clause};",
                render_bounds(&inner["params"])?
            ),
            "impl" => format!("{} {{ … }}", self.impl_declaration(inner)?),
            "type_alias" => format!(
                "{vis}type {name}{generics}{where_clause} = {};",
                render_type(&inner["type"])?
            ),
            "assoc_type" => format!(
                "type {name}{generics}{}{where_clause}{};",
                bounds_suffix(&inner["bounds"])?,
                if inner["type"].is_null() {
                    String::new()
                } else {
                    format!(" = {}", render_type(&inner["type"])?)
                }
            ),
            "constant" => format!(
                "{vis}const {name}: {} = {};",
                render_type(&inner["type"])?,
                string(&inner["const"]["expr"])?
            ),
            "assoc_const" => format!(
                "const {name}: {}{};",
                render_type(&inner["type"])?,
                inner["value"]
                    .as_str()
                    .map(|v| format!(" = {v}"))
                    .unwrap_or_default()
            ),
            "static" => format!(
                "{vis}{}static {}{name}: {};",
                if inner["is_unsafe"] == true {
                    "unsafe "
                } else {
                    ""
                },
                if inner["is_mutable"] == true {
                    "mut "
                } else {
                    ""
                },
                render_type(&inner["type"])?
            ),
            "macro" => string(inner)?.into(),
            "proc_macro" => format!(
                "#[proc_macro{}]\npub fn {name}(…);",
                match inner["kind"].as_str() {
                    Some("bang") => "".into(),
                    Some("attr") => "_attribute".into(),
                    Some("derive") => format!("_derive({name})"),
                    _ => bail!("Unsupported procedural macro kind"),
                }
            ),
            "use" => format!(
                "{vis}use {}{}{};",
                render_rust_path(string(&inner["source"])?),
                if inner["is_glob"] == true { "::*" } else { "" },
                if inner["is_glob"] != true
                    && inner["source"].as_str().unwrap_or("").rsplit("::").next()
                        != inner["name"].as_str()
                {
                    format!(" as {}", render_identifier(string(&inner["name"])?))
                } else {
                    String::new()
                }
            ),
            "extern_type" => format!("extern {{ {vis}type {name}; }}"),
            "primitive" => name.to_string(),
            _ => bail!("Unsupported rustdoc declaration: {tag}"),
        })
    }

    fn fields(&self, ids: &Value, tuple: bool) -> Result<Vec<String>> {
        array(ids)?
            .iter()
            .map(|id| {
                if id.is_null() {
                    return Ok("_".into());
                }
                let id = item_id(id)?;
                let item = self.index.get(&id).context("Missing rustdoc field")?;
                let public = if item["visibility"] == "public" {
                    "pub "
                } else {
                    ""
                };
                Ok(format!(
                    "{public}{}{}",
                    if tuple {
                        String::new()
                    } else {
                        format!("{}: ", render_identifier(string(&item["name"])?))
                    },
                    render_type(&item["inner"]["struct_field"])?
                ))
            })
            .collect::<Result<Vec<_>>>()
    }
}

fn render_block(items: &[String]) -> String {
    if items.is_empty() {
        return "{}".into();
    }
    let body = items
        .iter()
        .map(|item| {
            let indented = item
                .lines()
                .map(|line| format!("    {line}"))
                .collect::<Vec<_>>()
                .join("\n");
            if item.starts_with("/*") {
                indented
            } else {
                format!("{indented},")
            }
        })
        .collect::<Vec<_>>()
        .join("\n");
    format!("{{\n{body}\n}}")
}

fn prune_children(value: &mut Value, removed: &BTreeSet<String>, key: Option<&str>) {
    match value {
        Value::Object(object) => {
            for (key, value) in object {
                prune_children(value, removed, Some(key));
            }
        }
        Value::Array(values) => {
            if matches!(
                key,
                Some("items" | "impls" | "variants" | "implementations" | "fields")
            ) {
                values.retain(|v| item_id(v).ok().is_none_or(|id| !removed.contains(&id)));
            } else if key == Some("tuple") {
                // Tuple positions cannot shift when a field is omitted.
                for value in values.iter_mut() {
                    if item_id(value).ok().is_some_and(|id| removed.contains(&id)) {
                        *value = Value::Null;
                    }
                }
            }
            for value in values {
                prune_children(value, removed, None);
            }
        }
        _ => {}
    }
}

fn hidden_attribute(value: &Value) -> bool {
    value
        .as_str()
        .is_some_and(|v| v == "#[doc(hidden)]" || v == "doc(hidden)")
        || value["other"]
            .as_str()
            .is_some_and(|v| v == "#[doc(hidden)]")
}

fn item_id(value: &Value) -> Result<String> {
    if let Some(id) = value.as_u64() {
        Ok(id.to_string())
    } else {
        bail!("Invalid rustdoc item ID: {value}")
    }
}
fn string(value: &Value) -> Result<&str> {
    value.as_str().context("Expected rustdoc string")
}
fn array(value: &Value) -> Result<&Vec<Value>> {
    value.as_array().context("Expected rustdoc array")
}
fn variant(value: &Value) -> Result<(&str, &Value)> {
    let object = value.as_object().context("Expected rustdoc tagged value")?;
    ensure!(object.len() == 1, "Invalid rustdoc tagged value");
    let (key, value) = object.iter().next().unwrap();
    Ok((key, value))
}
fn children<'a>(tag: &str, inner: &'a Value) -> Result<Vec<&'a Value>> {
    let mut children = vec![];
    for key in match tag {
        "module" | "trait" | "impl" => &["items"][..],
        "enum" => &["variants", "impls"][..],
        "struct" => &["impls"][..],
        "union" => &["fields", "impls"][..],
        "primitive" => &["impls"][..],
        _ => &[][..],
    } {
        children.extend(array(&inner[key])?);
    }
    let fields = match tag {
        "struct" => inner["kind"]
            .get("tuple")
            .or_else(|| inner["kind"]["plain"].get("fields")),
        "variant" => inner["kind"]
            .get("tuple")
            .or_else(|| inner["kind"]["struct"].get("fields")),
        _ => None,
    };
    if let Some(fields) = fields {
        children.extend(array(fields)?);
    }
    Ok(children)
}
fn nonempty_type(text: String, _value: &Value) -> Option<Type> {
    (!text.is_empty()).then_some(Type {
        structure: None,
        text,
        references: vec![],
    })
}
fn join_strings(value: &Value, separator: &str) -> Result<String> {
    array(value)?
        .iter()
        .map(string)
        .collect::<Result<Vec<_>>>()
        .map(|v| v.join(separator))
}
fn collect_references(value: &Value, refs: &mut BTreeMap<String, String>) {
    match value {
        Value::Object(object) => {
            if let (Some(id), Some(path)) = (
                object.get("id").and_then(|v| item_id(v).ok()),
                object.get("path").and_then(Value::as_str),
            ) {
                refs.insert(id, path.into());
            }
            for value in object.values() {
                collect_references(value, refs);
            }
        }
        Value::Array(values) => {
            for value in values {
                collect_references(value, refs);
            }
        }
        _ => {}
    }
}

fn render_identifier(name: &str) -> String {
    if let Some(lifetime) = name.strip_prefix('\'') {
        return format!("'{}", render_identifier(lifetime));
    }
    if matches!(
        name,
        "as" | "break"
            | "const"
            | "continue"
            | "else"
            | "enum"
            | "extern"
            | "false"
            | "fn"
            | "for"
            | "if"
            | "impl"
            | "in"
            | "let"
            | "loop"
            | "match"
            | "mod"
            | "move"
            | "mut"
            | "pub"
            | "ref"
            | "return"
            | "static"
            | "struct"
            | "trait"
            | "true"
            | "type"
            | "unsafe"
            | "use"
            | "where"
            | "while"
            | "async"
            | "await"
            | "dyn"
            | "abstract"
            | "become"
            | "box"
            | "do"
            | "final"
            | "macro"
            | "override"
            | "priv"
            | "typeof"
            | "unsized"
            | "virtual"
            | "yield"
            | "try"
            | "gen"
    ) {
        format!("r#{name}")
    } else {
        name.into()
    }
}
fn render_rust_path(path: &str) -> String {
    path.split("::")
        .map(render_identifier)
        .collect::<Vec<_>>()
        .join("::")
}

fn render_type(value: &Value) -> Result<String> {
    if value == "infer" {
        return Ok("_".into());
    }
    let (tag, value) = variant(value)?;
    Ok(match tag {
        "resolved_path" => render_path(value)?,
        "generic" => render_identifier(string(value)?),
        "primitive" => match string(value)? {
            "never" => "!",
            other => other,
        }
        .into(),
        "tuple" => {
            let mut text = array(value)?
                .iter()
                .map(render_type)
                .collect::<Result<Vec<_>>>()?
                .join(", ");
            if array(value)?.len() == 1 {
                text.push(',');
            }
            format!("({text})")
        }
        "slice" => format!("[{}]", render_type(value)?),
        "array" => format!(
            "[{}; {}]",
            render_type(&value["type"])?,
            string(&value["len"])?
        ),
        "pat" => format!(
            "{} is {}",
            render_type(&value["type"])?,
            string(&value["__pat_unstable_do_not_use"])?
        ),
        "impl_trait" => format!("impl {}", render_bounds(value)?),
        "borrowed_ref" => format!(
            "&{}{}{}",
            value["lifetime"]
                .as_str()
                .map(|v| format!("{v} "))
                .unwrap_or_default(),
            if value["is_mutable"] == true {
                "mut "
            } else {
                ""
            },
            render_type(&value["type"])?
        ),
        "raw_pointer" => format!(
            "*{} {}",
            if value["is_mutable"] == true {
                "mut"
            } else {
                "const"
            },
            render_type(&value["type"])?
        ),
        "function_pointer" => format!(
            "{}{}fn{}",
            render_binder(&value["generic_params"])?,
            render_header(&value["header"])?,
            render_signature(&value["sig"], false)?
        ),
        "dyn_trait" => {
            let mut bounds = array(&value["traits"])?
                .iter()
                .map(|v| {
                    Ok(format!(
                        "{}{}",
                        render_binder(&v["generic_params"])?,
                        render_path(&v["trait"])?
                    ))
                })
                .collect::<Result<Vec<_>>>()?;
            if let Some(lifetime) = value["lifetime"].as_str() {
                bounds.push(lifetime.into());
            }
            format!("dyn {}", bounds.join(" + "))
        }
        "qualified_path" => {
            // rustdoc uses an empty trait path for an associated type in its
            // declaring trait, such as `Self::Output`.
            let prefix = if value["trait"].is_null() || value["trait"]["path"] == "" {
                let receiver = render_type(&value["self_type"])?;
                if value["self_type"].get("generic").is_some()
                    || value["self_type"].get("resolved_path").is_some()
                {
                    receiver
                } else {
                    format!("<{receiver}>")
                }
            } else {
                format!(
                    "<{} as {}>",
                    render_type(&value["self_type"])?,
                    render_path(&value["trait"])?
                )
            };
            format!(
                "{prefix}::{}{}",
                render_identifier(string(&value["name"])?),
                render_args(&value["args"])?
            )
        }
        _ => bail!("Unsupported rustdoc type: {tag}"),
    })
}
fn render_path(value: &Value) -> Result<String> {
    Ok(format!(
        "{}{}",
        render_rust_path(string(&value["path"])?),
        render_args(&value["args"])?
    ))
}
fn render_args(value: &Value) -> Result<String> {
    if value.is_null() {
        return Ok(String::new());
    }
    let (tag, value) = variant(value)?;
    match tag {
        "angle_bracketed" => {
            let mut args = array(&value["args"])?
                .iter()
                .map(|arg| {
                    if arg == "infer" {
                        return Ok("_".into());
                    }
                    let (tag, v) = variant(arg)?;
                    match tag {
                        "lifetime" => Ok(string(v)?.into()),
                        "type" => render_type(v),
                        "const" => Ok(string(&v["expr"])?.into()),
                        _ => bail!("Unsupported rustdoc generic argument: {tag}"),
                    }
                })
                .collect::<Result<Vec<_>>>()?;
            for constraint in array(&value["constraints"])? {
                let (kind, binding) = variant(&constraint["binding"])?;
                let text = match kind {
                    "equality" => render_term(binding)?,
                    "constraint" => render_bounds(binding)?,
                    _ => bail!("Unsupported rustdoc associated constraint: {kind}"),
                };
                args.push(format!(
                    "{}{}{}{}",
                    render_identifier(string(&constraint["name"])?),
                    render_args(&constraint["args"])?,
                    if kind == "equality" { " = " } else { ": " },
                    text
                ));
            }
            Ok(if args.is_empty() {
                String::new()
            } else {
                format!("<{}>", args.join(", "))
            })
        }
        "parenthesized" => Ok(format!(
            "({}){}",
            array(&value["inputs"])?
                .iter()
                .map(render_type)
                .collect::<Result<Vec<_>>>()?
                .join(", "),
            if value["output"].is_null() {
                String::new()
            } else {
                format!(" -> {}", render_type(&value["output"])?)
            }
        )),
        "return_type_notation" => Ok("(..)".into()),
        _ => bail!("Unsupported rustdoc generic arguments: {tag}"),
    }
}
fn render_term(value: &Value) -> Result<String> {
    let (tag, value) = variant(value)?;
    match tag {
        "type" => render_type(value),
        "constant" => Ok(string(&value["expr"])?.into()),
        _ => bail!("Unsupported rustdoc term: {tag}"),
    }
}
fn render_bounds(value: &Value) -> Result<String> {
    if value.is_null() {
        return Ok(String::new());
    }
    array(value)?
        .iter()
        .map(|bound| {
            let (tag, v) = variant(bound)?;
            Ok(match tag {
                "trait_bound" => format!(
                    "{}{}{}",
                    render_binder(&v["generic_params"])?,
                    match v["modifier"].as_str() {
                        Some("none") => "",
                        Some("maybe") => "?",
                        Some("maybe_const") => "~const ",
                        _ => bail!("Unsupported rustdoc trait bound modifier"),
                    },
                    render_path(&v["trait"])?
                ),
                "outlives" => string(v)?.into(),
                "use" => format!(
                    "use<{}>",
                    array(v)?
                        .iter()
                        .map(|v| {
                            let (tag, value) = variant(v)?;
                            match tag {
                                "lifetime" | "param" => Ok(string(value)?.to_owned()),
                                _ => bail!("Unsupported precise capture"),
                            }
                        })
                        .collect::<Result<Vec<_>>>()?
                        .join(", ")
                ),
                _ => bail!("Unsupported rustdoc bound: {tag}"),
            })
        })
        .collect::<Result<Vec<_>>>()
        .map(|v| v.join(" + "))
}
fn bounds_suffix(value: &Value) -> Result<String> {
    let bounds = render_bounds(value)?;
    Ok(if bounds.is_empty() {
        String::new()
    } else {
        format!(": {bounds}")
    })
}
fn render_generic(param: &Value) -> Result<String> {
    let name = render_identifier(string(&param["name"])?);
    let (tag, v) = variant(&param["kind"])?;
    Ok(match tag {
        "lifetime" => format!("{name}{}", {
            let out = join_strings(&v["outlives"], " + ")?;
            if out.is_empty() {
                String::new()
            } else {
                format!(": {out}")
            }
        }),
        "type" => format!(
            "{name}{}{}",
            bounds_suffix(&v["bounds"])?,
            if v["default"].is_null() {
                String::new()
            } else {
                format!(" = {}", render_type(&v["default"])?)
            }
        ),
        "const" => format!(
            "const {name}: {}{}",
            render_type(&v["type"])?,
            v["default"]
                .as_str()
                .map(|s| format!(" = {s}"))
                .unwrap_or_default()
        ),
        _ => bail!("Unsupported rustdoc generic parameter: {tag}"),
    })
}
fn render_generics(value: &Value) -> Result<String> {
    if value.is_null() {
        return Ok(String::new());
    }
    let params = array(&value["params"])?
        .iter()
        .filter(|param| param["kind"]["type"]["is_synthetic"] != true)
        .map(render_generic)
        .collect::<Result<Vec<_>>>()?;
    Ok(if params.is_empty() {
        String::new()
    } else {
        format!("<{}>", params.join(", "))
    })
}
fn render_binder(value: &Value) -> Result<String> {
    if value.is_null() || array(value)?.is_empty() {
        return Ok(String::new());
    }
    Ok(format!(
        "for<{}> ",
        array(value)?
            .iter()
            .map(render_generic)
            .collect::<Result<Vec<_>>>()?
            .join(", ")
    ))
}
fn render_where(generics: &Value) -> Result<String> {
    let predicates = where_predicates(generics)?;
    Ok(if predicates.is_empty() {
        String::new()
    } else {
        format!(" where {}", predicates.join(", "))
    })
}

fn render_where_lines(generics: &Value) -> Result<String> {
    let predicates = where_predicates(generics)?;
    Ok(if predicates.is_empty() {
        String::new()
    } else {
        format!("\nwhere\n    {}", predicates.join(",\n    "))
    })
}

fn where_predicates(generics: &Value) -> Result<Vec<String>> {
    if generics.is_null() {
        return Ok(vec![]);
    }
    array(&generics["where_predicates"])?
        .iter()
        .map(|predicate| {
            let (tag, v) = variant(predicate)?;
            Ok(match tag {
                "bound_predicate" => format!(
                    "{}{}: {}",
                    render_binder(&v["generic_params"])?,
                    render_type(&v["type"])?,
                    render_bounds(&v["bounds"])?
                ),
                "lifetime_predicate" => format!(
                    "{}: {}",
                    string(&v["lifetime"])?,
                    join_strings(&v["outlives"], " + ")?
                ),
                "eq_predicate" => {
                    format!("{} = {}", render_type(&v["lhs"])?, render_term(&v["rhs"])?)
                }
                _ => bail!("Unsupported rustdoc where predicate: {tag}"),
            })
        })
        .collect::<Result<Vec<_>>>()
}
fn render_header(header: &Value) -> Result<String> {
    let mut result = String::new();
    for (key, text) in [
        ("is_const", "const "),
        ("is_async", "async "),
        ("is_unsafe", "unsafe "),
    ] {
        if header[key] == true {
            result.push_str(text);
        }
    }
    let abi = &header["abi"];
    if abi != "Rust" {
        let (name, value) = if let Some(name) = abi.as_str() {
            (name, &Value::Null)
        } else {
            variant(abi)?
        };
        let name = if name == "Other" {
            string(value)?.to_owned()
        } else {
            let name = match name {
                "C" => "C",
                "Cdecl" => "cdecl",
                "Stdcall" => "stdcall",
                "Fastcall" => "fastcall",
                "Aapcs" => "aapcs",
                "Win64" => "win64",
                "SysV64" => "sysv64",
                "System" => "system",
                "Thiscall" => "thiscall",
                "Vectorcall" => "vectorcall",
                "RustCall" => "rust-call",
                "Unadjusted" => "unadjusted",
                "RustIntrinsic" => "rust-intrinsic",
                _ => bail!("Unsupported rustdoc ABI: {name}"),
            };
            format!(
                "{name}{}",
                if value["unwind"] == true {
                    "-unwind"
                } else {
                    ""
                }
            )
        };
        result.push_str(&format!("extern {name:?} "));
    }
    Ok(result)
}
fn render_signature(sig: &Value, names: bool) -> Result<String> {
    let mut inputs = array(&sig["inputs"])?
        .iter()
        .map(|input| {
            let ty = render_type(&input[1])?;
            Ok(if names {
                format!("{}: {ty}", render_identifier(string(&input[0])?))
            } else {
                ty
            })
        })
        .collect::<Result<Vec<_>>>()?;
    if sig["is_c_variadic"] == true {
        inputs.push("...".into());
    }
    Ok(format!(
        "({}){}",
        inputs.join(", "),
        if sig["output"].is_null() {
            String::new()
        } else {
            format!(" -> {}", render_type(&sig["output"])?)
        }
    ))
}
