use crate::{config::Config, model::*};
use anyhow::{Context as _, Result, bail, ensure};
use mago_allocator::LocalArena;
use mago_database::file::FileId;
use mago_names::{ResolvedNames, kind::NameKind, resolver::NameResolver, scope::NamespaceScope};
use mago_phpdoc_syntax::{
    PHPDocParser,
    cst::{Element, TagValue, Text as DocText},
};
use mago_span::{HasSpan, Span};
use mago_syntax::{
    comments::docblock::get_docblock_for_node, cst::*, parser::parse_file_content, walker::Walker,
};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
};

pub fn analyze(
    config: &Config,
    input_name: &str,
    paths: &[PathBuf],
    document: &mut Document,
) -> Result<()> {
    let mut globs = globset::GlobSetBuilder::new();
    for pattern in &config.exclude {
        globs.add(globset::Glob::new(pattern)?);
    }
    let globs = globs.build()?;
    let mut files = BTreeSet::new();
    for path in paths {
        for entry in walkdir::WalkDir::new(path)
            .follow_links(false)
            .into_iter()
            .filter_entry(|entry| {
                let relative = entry
                    .path()
                    .strip_prefix(&config.source_root)
                    .unwrap_or(entry.path());
                !globs.is_match(relative) && !globs.is_match(relative.join("_"))
            })
        {
            let entry = entry?;
            if entry.file_type().is_symlink() {
                continue;
            }
            if entry.file_type().is_file()
                && entry.path().extension().is_some_and(|ext| ext == "php")
            {
                let file = entry.path().canonicalize()?;
                ensure!(
                    file.starts_with(&config.source_root),
                    "Source escaped sourceRoot"
                );
                files.insert(file);
            }
        }
    }
    ensure!(!files.is_empty(), "No PHP files selected for {input_name}");
    for file in files {
        analyze_file(config, input_name, &file, document)?;
    }
    link(document);
    Ok(())
}

fn analyze_file(
    config: &Config,
    input_name: &str,
    file: &Path,
    document: &mut Document,
) -> Result<()> {
    let content = std::fs::read_to_string(file)
        .with_context(|| format!("Cannot read UTF-8 PHP source {}", file.display()))?;
    let arena = LocalArena::new();
    let program = parse_file_content(&arena, FileId::zero(), content.as_bytes());
    let relative = file
        .strip_prefix(&config.source_root)?
        .to_string_lossy()
        .replace('\\', "/");
    if let Some(error) = program.errors.first() {
        bail!(
            "{relative}:{}: {error}",
            line(&content, error.span().start.offset)
        );
    }
    let names = NameResolver::new(&arena).resolve(program);
    let mut name_spans: Vec<_> = names
        .iter()
        .map(|(start, end, name, _)| (start, end, name))
        .collect();
    name_spans.sort_unstable_by_key(|(start, _, _)| *start);
    let mut context = Context {
        arena: &arena,
        program,
        names,
        name_spans,
        content: &content,
        file: &relative,
        input_name,
        config,
        scope: NamespaceScope::global(),
        document,
        docs_cache: BTreeMap::new(),
        generic_names: BTreeSet::new(),
    };
    Extractor.walk_program(program, &mut context);
    Ok(())
}

struct Extractor;
struct Context<'a, 'arena> {
    arena: &'arena LocalArena,
    program: &'arena Program<'arena>,
    names: ResolvedNames<'arena>,
    name_spans: Vec<(u32, u32, &'arena [u8])>,
    content: &'a str,
    file: &'a str,
    input_name: &'a str,
    config: &'a Config,
    scope: NamespaceScope,
    document: &'a mut Document,
    docs_cache: BTreeMap<u32, Docs>,
    generic_names: BTreeSet<String>,
}

#[derive(Default, Clone)]
struct Docs {
    description: String,
    tags: Vec<Tag>,
    parameters: BTreeMap<String, (Type, String)>,
    returns: Option<(Type, String)>,
    var_type: Option<Type>,
    templates: Vec<TypeParameter>,
}
impl Docs {
    fn has(&self, name: &str) -> bool {
        self.tags.iter().any(|t| t.name == name)
    }
}

impl<'ast, 'arena, 'a> Walker<'ast, 'arena, Context<'a, 'arena>> for Extractor {
    fn walk_program(&self, program: &'ast Program<'arena>, c: &mut Context<'a, 'arena>) {
        for statement in &program.statements {
            if let Statement::Use(node) = statement {
                c.scope.populate_from_use(node);
            }
        }
        for statement in &program.statements {
            self.walk_statement(statement, c);
        }
    }
    fn walk_namespace(&self, namespace: &'ast Namespace<'arena>, c: &mut Context<'a, 'arena>) {
        let old = std::mem::replace(
            &mut c.scope,
            NamespaceScope::new(namespace.name.as_ref().map(|name| name.value().to_vec())),
        );
        for statement in namespace.statements() {
            if let Statement::Use(node) = statement {
                c.scope.populate_from_use(node);
            }
        }
        for statement in namespace.statements() {
            self.walk_statement(statement, c);
        }
        c.scope = old;
    }
    fn walk_use(&self, node: &'ast Use<'arena>, c: &mut Context<'a, 'arena>) {
        c.scope.populate_from_use(node);
    }
    fn walk_class(&self, node: &'ast Class<'arena>, c: &mut Context<'a, 'arena>) {
        let mut symbol = c.base(
            Kind::Class,
            &c.name(&node.name),
            node.span(),
            c.until(
                node.span(),
                node.left_brace.start.offset,
                Some(node.name.span()),
            ),
        );
        symbol.modifiers = c.modifiers(&node.modifiers);
        if let Some(extends) = &node.extends {
            for ty in &extends.types {
                symbol.relations.push(c.relation(RelationKind::Extends, ty));
            }
        }
        if let Some(implements) = &node.implements {
            for ty in &implements.types {
                symbol
                    .relations
                    .push(c.relation(RelationKind::Implements, ty));
            }
        }
        c.class_like(symbol, &node.members);
    }
    fn walk_interface(&self, node: &'ast Interface<'arena>, c: &mut Context<'a, 'arena>) {
        let mut symbol = c.base(
            Kind::Interface,
            &c.name(&node.name),
            node.span(),
            c.until(
                node.span(),
                node.left_brace.start.offset,
                Some(node.name.span()),
            ),
        );
        if let Some(extends) = &node.extends {
            for ty in &extends.types {
                symbol.relations.push(c.relation(RelationKind::Extends, ty));
            }
        }
        c.class_like(symbol, &node.members);
    }
    fn walk_trait(&self, node: &'ast Trait<'arena>, c: &mut Context<'a, 'arena>) {
        let symbol = c.base(
            Kind::Trait,
            &c.name(&node.name),
            node.span(),
            c.until(
                node.span(),
                node.left_brace.start.offset,
                Some(node.name.span()),
            ),
        );
        c.class_like(symbol, &node.members);
    }
    fn walk_enum(&self, node: &'ast Enum<'arena>, c: &mut Context<'a, 'arena>) {
        let mut symbol = c.base(
            Kind::Enum,
            &c.name(&node.name),
            node.span(),
            c.until(
                node.span(),
                node.left_brace.start.offset,
                Some(node.name.span()),
            ),
        );
        symbol.r#type = node
            .backing_type_hint
            .as_ref()
            .map(|h| c.native_type(h.hint.span()));
        if let Some(implements) = &node.implements {
            for ty in &implements.types {
                symbol
                    .relations
                    .push(c.relation(RelationKind::Implements, ty));
            }
        }
        c.class_like(symbol, &node.members);
    }
    fn walk_function(&self, node: &'ast Function<'arena>, c: &mut Context<'a, 'arena>) {
        let declaration = c.until(
            node.span(),
            node.body.left_brace.start.offset,
            Some(node.name.span()),
        );
        let mut symbol = c.base(
            Kind::Function,
            &c.name(&node.name),
            node.span(),
            declaration.clone(),
        );
        let docs = c.docs(node.span());
        symbol.signatures.push(c.signature(
            declaration,
            &node.parameter_list,
            node.return_type_hint.as_ref().map(|r| r.hint.span()),
            &docs,
        ));
        c.push(symbol);
    }
    fn walk_constant(&self, node: &'ast Constant<'arena>, c: &mut Context<'a, 'arena>) {
        for item in &node.items {
            let symbol = c.base(
                Kind::Constant,
                &c.name(&item.name),
                node.span(),
                format!("const {};", c.text(item.span())),
            );
            c.push(symbol);
        }
    }
    // Local declarations and anonymous implementations are not public API.
    fn walk_anonymous_class(&self, _: &'ast AnonymousClass<'arena>, _: &mut Context<'a, 'arena>) {}
    fn walk_closure(&self, _: &'ast Closure<'arena>, _: &mut Context<'a, 'arena>) {}
    fn walk_arrow_function(&self, _: &'ast ArrowFunction<'arena>, _: &mut Context<'a, 'arena>) {}
}

impl Context<'_, '_> {
    fn text(&self, span: Span) -> String {
        self.content[span.start.offset as usize..span.end.offset as usize]
            .trim()
            .to_owned()
    }
    fn until(&self, span: Span, end: u32, definition: Option<Span>) -> String {
        self.qualified_text(span.start.offset, end, definition)
    }
    // Index once per file, then visit only identifiers starting in this span.
    // The end check also excludes a name only partially covered by the span.
    fn names_in(&self, start: u32, end: u32) -> impl DoubleEndedIterator<Item = (u32, u32, &[u8])> {
        let first = self
            .name_spans
            .partition_point(|(offset, _, _)| *offset < start);
        let last = self
            .name_spans
            .partition_point(|(offset, _, _)| *offset < end);
        self.name_spans[first..last]
            .iter()
            .copied()
            .filter(move |(_, stop, _)| *stop <= end)
    }
    // Mago owns alias/name resolution and exact source ranges. Never qualify
    // strings, comments, variables, or the declaration's own name.
    fn qualified_text(&self, start: u32, end: u32, definition: Option<Span>) -> String {
        let mut text = self.content[start as usize..end as usize].to_owned();
        for (a, b, name) in self
            .names_in(start, end)
            .rev()
            .filter(|(a, _, _)| definition.is_none_or(|s| *a != s.start.offset))
        {
            text.replace_range(
                (a - start) as usize..(b - start) as usize,
                &format!("\\{}", bytes(name).trim_start_matches('\\')),
            );
        }
        text.trim().to_owned()
    }
    fn name(&self, node: &LocalIdentifier<'_>) -> String {
        self.names
            .resolve(&node.span.start)
            .map(bytes)
            .unwrap_or_else(|| bytes(&self.scope.qualify_name(node.value)))
    }
    fn source(&self, span: Span) -> Source {
        Source {
            file: self.file.into(),
            line: line(self.content, span.start.offset),
            end_line: line(self.content, span.end.offset.saturating_sub(1)),
        }
    }
    fn doc_text(&self, text: &DocText<'_>) -> String {
        self.text(text.span())
            .lines()
            .map(|line| {
                let trimmed = line.trim_start();
                if trimmed == "*" {
                    ""
                } else {
                    trimmed.strip_prefix("* ").unwrap_or(line)
                }
            })
            .collect::<Vec<_>>()
            .join("\n")
            .trim()
            .to_owned()
    }
    fn clean_type(&self, span: Span) -> String {
        self.text(span)
            .lines()
            .map(|line| line.trim_start().strip_prefix('*').unwrap_or(line).trim())
            .collect::<Vec<_>>()
            .join(" ")
    }
    fn docs(&mut self, span: Span) -> Docs {
        if let Some(docs) = self.docs_cache.get(&span.start.offset) {
            return docs.clone();
        }
        let Some(trivia) = get_docblock_for_node(self.program, span) else {
            return Docs::default();
        };
        let parsed = PHPDocParser::parse_with_span(self.arena, trivia.value, trivia.span);
        let mut docs = Docs::default();
        let mut generic_names = self.generic_names.clone();
        for tag in parsed.tags() {
            if let TagValue::Template(value) = &tag.value {
                generic_names.insert(bytes(value.name.value));
            }
        }
        for error in parsed.errors {
            self.document.diagnostics.push(Diagnostic {
                message: format!(
                    "PHPDoc annotation could not be structured; raw tag preserved: {error}"
                ),
                source: Some(self.source(error.span())),
            });
        }
        for element in &parsed.elements {
            match element {
                Element::Tag(tag) => {
                    let name = bytes(tag.name.value);
                    let raw = self.clean_type(tag.value.span());
                    docs.tags.push(Tag {
                        name: name.clone(),
                        text: raw,
                    });
                    let description = |text: &Option<DocText<'_>>| {
                        text.as_ref().map(|t| self.doc_text(t)).unwrap_or_default()
                    };
                    match &tag.value {
                        TagValue::Param(value) => {
                            if let Some(parameter) = &value.parameter {
                                let key = self.text(parameter.span());
                                let entry = (
                                    self.doc_type(value.r#type, &generic_names),
                                    description(&value.description),
                                );
                                if !docs.parameters.contains_key(&key)
                                    || name.starts_with("phpstan-")
                                    || name.starts_with("psalm-")
                                {
                                    docs.parameters.insert(key, entry);
                                }
                            }
                        }
                        TagValue::Return(value) => {
                            if docs.returns.is_none()
                                || name.starts_with("phpstan-")
                                || name.starts_with("psalm-")
                            {
                                docs.returns = Some((
                                    self.doc_type(value.r#type, &generic_names),
                                    description(&value.description),
                                ));
                            }
                        }
                        TagValue::Var(value) => {
                            docs.var_type = Some(self.doc_type(value.r#type, &generic_names));
                        }
                        TagValue::Template(value) => docs.templates.push(TypeParameter {
                            name: bytes(value.name.value),
                            constraint: value
                                .bound
                                .as_ref()
                                .map(|v| self.doc_type(v.r#type, &generic_names)),
                            default: value
                                .default
                                .as_ref()
                                .map(|v| self.doc_type(v.r#type, &generic_names)),
                            description: description(&value.description),
                        }),
                        _ => {}
                    }
                }
                Element::Text(text) => {
                    docs.description.push_str(&self.doc_text(text));
                    docs.description.push_str("\n\n");
                }
                Element::Code(code) => {
                    docs.description.push_str(&format!(
                        "```{}\n{}\n```\n\n",
                        code.language
                            .as_ref()
                            .map(|l| bytes(l.value))
                            .unwrap_or_default(),
                        bytes(code.value)
                    ));
                }
            }
        }
        docs.description = docs.description.trim().to_owned();
        self.docs_cache.insert(span.start.offset, docs.clone());
        docs
    }
    fn base(&mut self, kind: Kind, qualified: &str, span: Span, declaration: String) -> Symbol {
        let docs = self.docs(span);
        let name = qualified
            .rsplit("::")
            .next()
            .unwrap_or(qualified)
            .rsplit('\\')
            .next()
            .unwrap_or(qualified)
            .to_owned();
        let group = bytes(self.scope.namespace_name().unwrap_or_default());
        Symbol {
            id: id(self.input_name, kind, qualified),
            language: Language::Php,
            kind,
            name,
            qualified_name: qualified.into(),
            api: self.input_name.into(),
            group,
            parent_id: None,
            declaration,
            description: docs.description.clone(),
            deprecated: docs.has("deprecated"),
            promoted: false,
            framework: None,
            modifiers: vec![],
            source: Some(self.source(span)),
            r#type: None,
            signatures: vec![],
            type_parameters: self.templates(&docs),
            relations: vec![],
            tags: docs.tags,
            rustdoc_id: None,
        }
    }
    fn push(&mut self, symbol: Symbol) {
        if !symbol
            .tags
            .iter()
            .any(|t| t.name == "internal" || t.name == "ignore")
        {
            self.document.symbols.push(symbol);
        }
    }
    fn visible(&self, modifiers: &[String]) -> bool {
        !modifiers.iter().any(|m| m == "private")
            && (self.config.include_protected || !modifiers.iter().any(|m| m == "protected"))
    }
    fn modifiers(
        &self,
        modifiers: &mago_syntax::cst::sequence::Sequence<'_, Modifier<'_>>,
    ) -> Vec<String> {
        modifiers.iter().map(|m| self.text(m.span())).collect()
    }
    fn relation(&self, kind: RelationKind, node: &Identifier<'_>) -> Relation {
        let name = self
            .names
            .resolve(&node.span().start)
            .map(bytes)
            .unwrap_or_else(|| bytes(node.value()));
        Relation {
            kind,
            name,
            target_id: None,
        }
    }
    fn native_type(&self, span: Span) -> Type {
        let mut references: Vec<_> = self
            .names_in(span.start.offset, span.end.offset)
            .map(|(_, _, name)| Reference {
                package: None,
                qualified_name: None,
                name: bytes(name),
                target_id: None,
            })
            .collect();
        for keyword in self
            .text(span)
            .split(|c: char| !c.is_alphanumeric() && c != '_' && c != '\\')
        {
            if ["self", "static", "parent"].contains(&keyword) {
                references.push(Reference {
                    package: None,
                    qualified_name: None,
                    name: keyword.into(),
                    target_id: None,
                });
            }
        }
        references.sort_by(|a, b| a.name.cmp(&b.name));
        references.dedup_by(|a, b| a.name == b.name);
        Type {
            structure: None,
            text: self.qualified_text(span.start.offset, span.end.offset, None),
            references,
        }
    }
    fn doc_type(
        &self,
        ty: &mago_phpdoc_syntax::cst::r#type::Type<'_>,
        generic_names: &BTreeSet<String>,
    ) -> Type {
        let mut text = self.text(ty.span());
        let mut references = vec![];
        let mut nodes = crate::php_types::references(ty);
        nodes.sort_by_key(|(span, _)| std::cmp::Reverse(span.start.offset));
        for (span, original) in nodes {
            if generic_names.contains(&original) {
                continue;
            }
            let name = if ["self", "static", "parent"].contains(&original.as_str()) {
                original.clone()
            } else {
                let (name, _) = self.scope.resolve(NameKind::Default, original.as_bytes());
                bytes(&name)
            };
            let printed = if ["self", "static", "parent"].contains(&name.as_str()) {
                name.clone()
            } else {
                format!("\\{}", name.trim_start_matches('\\'))
            };
            let start = (span.start.offset - ty.span().start.offset) as usize;
            let end = (span.end.offset - ty.span().start.offset) as usize;
            text.replace_range(start..end, &printed);
            references.push(Reference {
                package: None,
                qualified_name: None,
                name,
                target_id: None,
            });
        }
        references.sort_by(|a, b| a.name.cmp(&b.name));
        references.dedup_by(|a, b| a.name == b.name);
        Type {
            structure: None,
            text: text
                .lines()
                .map(|line| line.trim_start().strip_prefix('*').unwrap_or(line).trim())
                .collect::<Vec<_>>()
                .join(" "),
            references,
        }
    }
    fn templates(&self, docs: &Docs) -> Vec<TypeParameter> {
        docs.templates.clone()
    }
    fn signature(
        &self,
        declaration: String,
        parameters: &FunctionLikeParameterList<'_>,
        returns: Option<Span>,
        docs: &Docs,
    ) -> Signature {
        let parameters = parameters
            .parameters
            .iter()
            .map(|p| {
                let name = bytes(p.variable.name);
                let annotation = docs.parameters.get(&name);
                Parameter {
                    properties: Vec::new(),
                    signatures: Vec::new(),
                    name,
                    r#type: annotation
                        .map(|(ty, _)| ty.clone())
                        .or_else(|| p.hint.as_ref().map(|h| self.native_type(h.span()))),
                    description: annotation.map(|(_, d)| d.trim().into()).unwrap_or_default(),
                    optional: p.default_value.is_some(),
                    variadic: p.ellipsis.is_some(),
                    by_reference: p.ampersand.is_some(),
                    default: p.default_value.as_ref().map(|d| {
                        let span = d.value.span();
                        self.qualified_text(span.start.offset, span.end.offset, None)
                    }),
                }
            })
            .collect();
        let annotation = docs.returns.as_ref();
        Signature {
            declaration,
            description: docs.description.clone(),
            parameters,
            returns: annotation
                .map(|(ty, _)| ty.clone())
                .or_else(|| returns.map(|span| self.native_type(span))),
            returns_description: annotation.map(|(_, desc)| desc.clone()).unwrap_or_default(),
            type_parameters: self.templates(docs),
        }
    }
    fn class_like(
        &mut self,
        mut parent: Symbol,
        members: &mago_syntax::cst::sequence::Sequence<'_, ClassLikeMember<'_>>,
    ) {
        if parent
            .tags
            .iter()
            .any(|t| t.name == "internal" || t.name == "ignore")
        {
            return;
        }
        let old_generics = self.generic_names.clone();
        self.generic_names
            .extend(parent.type_parameters.iter().map(|p| p.name.clone()));
        for member in members {
            match member {
                ClassLikeMember::Method(node) => {
                    let modifiers = self.modifiers(&node.modifiers);
                    if !self.visible(&modifiers) {
                        continue;
                    }
                    let kind = if node.name.value.eq_ignore_ascii_case(b"__construct") {
                        Kind::Constructor
                    } else {
                        Kind::Method
                    };
                    let declaration = self.until(node.span(), node.body.span().start.offset, None);
                    let mut symbol = self.base(
                        kind,
                        &format!("{}::{}", parent.qualified_name, bytes(node.name.value)),
                        node.span(),
                        declaration.clone(),
                    );
                    symbol.parent_id = Some(parent.id.clone());
                    symbol.modifiers = modifiers;
                    let docs = self.docs(node.span());
                    symbol.signatures.push(self.signature(
                        declaration,
                        &node.parameter_list,
                        node.return_type_hint.as_ref().map(|h| h.hint.span()),
                        &docs,
                    ));
                    if kind == Kind::Constructor {
                        for p in &node.parameter_list.parameters {
                            if !p.is_promoted_property() {
                                continue;
                            }
                            let modifiers = self.modifiers(&p.modifiers);
                            if !self.visible(&modifiers) {
                                continue;
                            }
                            let mut property = self.base(
                                Kind::Property,
                                &format!("{}::{}", parent.qualified_name, bytes(p.variable.name)),
                                p.span(),
                                format!(
                                    "{} {}{};",
                                    modifiers.join(" "),
                                    p.hint
                                        .as_ref()
                                        .map(|h| format!("{} ", self.native_type(h.span()).text))
                                        .unwrap_or_default(),
                                    bytes(p.variable.name)
                                ),
                            );
                            property.promoted = true;
                            property.parent_id = Some(parent.id.clone());
                            property.modifiers = modifiers;
                            property.r#type = p.hint.as_ref().map(|h| self.native_type(h.span()));
                            self.push(property);
                        }
                    }
                    self.push(symbol);
                }
                ClassLikeMember::Property(node) => {
                    let modifiers = self.modifiers(node.modifiers());
                    if !self.visible(&modifiers) {
                        continue;
                    }
                    let (items, hooks): (Vec<&PropertyItem<'_>>, Option<&PropertyHookList<'_>>) =
                        match node {
                            Property::Plain(p) => (p.items.iter().collect(), None),
                            Property::Hooked(p) => (vec![&p.item], Some(&p.hook_list)),
                        };
                    for item in items {
                        let prefix = self.until(node.span(), item.span().start.offset, None);
                        // For multi-property declarations build the common modifiers/type prefix.
                        let prefix = if matches!(node, Property::Plain(_)) {
                            format!(
                                "{}{}",
                                if modifiers.is_empty() {
                                    String::new()
                                } else {
                                    format!("{} ", modifiers.join(" "))
                                },
                                node.hint()
                                    .map(|h| format!("{} ", self.native_type(h.span()).text))
                                    .unwrap_or_default()
                            )
                        } else {
                            prefix
                        };
                        let hook_text = hooks
                            .map(|h| {
                                format!(
                                    " {{ {} }}",
                                    h.hooks
                                        .iter()
                                        .map(|hook| format!(
                                            "{}{};",
                                            self.text(hook.name.span()),
                                            hook.parameter_list
                                                .as_ref()
                                                .map(|p| self.text(p.span()))
                                                .unwrap_or_default()
                                        ))
                                        .collect::<Vec<_>>()
                                        .join(" ")
                                )
                            })
                            .unwrap_or_default();
                        let mut symbol = self.base(
                            Kind::Property,
                            &format!("{}::{}", parent.qualified_name, bytes(item.variable().name)),
                            node.span(),
                            format!("{prefix}{}{hook_text};", self.text(item.span())),
                        );
                        symbol.parent_id = Some(parent.id.clone());
                        symbol.modifiers = modifiers.clone();
                        let docs = self.docs(node.span());
                        symbol.r#type = docs
                            .var_type
                            .as_ref()
                            .cloned()
                            .or_else(|| node.hint().map(|h| self.native_type(h.span())));
                        self.push(symbol);
                    }
                }
                ClassLikeMember::Constant(node) => {
                    let modifiers = self.modifiers(&node.modifiers);
                    if !self.visible(&modifiers) {
                        continue;
                    }
                    for item in &node.items {
                        let mut symbol = self.base(
                            Kind::Constant,
                            &format!("{}::{}", parent.qualified_name, bytes(item.name.value)),
                            node.span(),
                            format!(
                                "{}const {}{};",
                                if modifiers.is_empty() {
                                    String::new()
                                } else {
                                    format!("{} ", modifiers.join(" "))
                                },
                                node.hint
                                    .as_ref()
                                    .map(|h| format!("{} ", self.native_type(h.span()).text))
                                    .unwrap_or_default(),
                                self.text(item.span())
                            ),
                        );
                        symbol.parent_id = Some(parent.id.clone());
                        symbol.modifiers = modifiers.clone();
                        symbol.r#type = node.hint.as_ref().map(|h| self.native_type(h.span()));
                        self.push(symbol);
                    }
                }
                ClassLikeMember::EnumCase(node) => {
                    let mut symbol = self.base(
                        Kind::EnumCase,
                        &format!(
                            "{}::{}",
                            parent.qualified_name,
                            bytes(node.item.name().value)
                        ),
                        node.span(),
                        self.text(node.span()),
                    );
                    symbol.parent_id = Some(parent.id.clone());
                    self.push(symbol);
                }
                ClassLikeMember::TraitUse(node) => {
                    for name in &node.trait_names {
                        parent
                            .relations
                            .push(self.relation(RelationKind::Uses, name));
                    }
                    // Keep adaptations rather than claiming runtime trait composition.
                    parent.tags.push(Tag {
                        name: "trait-use".into(),
                        text: self.text(node.span()),
                    });
                }
            }
        }
        self.push(parent);
        self.generic_names = old_generics;
    }
}

fn bytes(value: &[u8]) -> String {
    String::from_utf8_lossy(value).into_owned()
}
fn line(source: &str, offset: u32) -> u32 {
    source.as_bytes()[..(offset as usize).min(source.len())]
        .iter()
        .filter(|b| **b == b'\n')
        .count() as u32
        + 1
}
fn id(input_name: &str, kind: Kind, name: &str) -> String {
    let (category, name) = match kind {
        Kind::Class | Kind::Interface | Kind::Trait | Kind::Enum => {
            ("type", name.to_ascii_lowercase())
        }
        Kind::Method | Kind::Constructor => ("method", name.to_ascii_lowercase()),
        Kind::Function => ("function", name.to_ascii_lowercase()),
        Kind::Property => ("property", name.to_owned()),
        _ => ("constant", name.to_owned()),
    };
    format!("php:{input_name}:{category}:{name}")
}

fn link(document: &mut Document) {
    let types: BTreeMap<_, _> = document
        .symbols
        .iter()
        .filter(|s| {
            s.language == Language::Php
                && matches!(
                    s.kind,
                    Kind::Class | Kind::Interface | Kind::Trait | Kind::Enum
                )
        })
        .map(|s| {
            (
                (s.api.clone(), s.qualified_name.to_ascii_lowercase()),
                s.id.clone(),
            )
        })
        .collect();
    let classes: BTreeMap<_, _> = document
        .symbols
        .iter()
        .filter(|s| {
            s.language == Language::Php
                && matches!(
                    s.kind,
                    Kind::Class | Kind::Interface | Kind::Trait | Kind::Enum
                )
        })
        .map(|s| {
            (
                s.id.clone(),
                (
                    s.id.clone(),
                    s.relations
                        .iter()
                        .find(|r| matches!(r.kind, RelationKind::Extends))
                        .map(|r| r.name.clone()),
                ),
            )
        })
        .collect();
    for symbol in &mut document.symbols {
        if symbol.language != Language::Php {
            continue;
        }
        let resolve = |name: &str| {
            if let Some((class_id, parent)) =
                classes.get(symbol.parent_id.as_ref().unwrap_or(&symbol.id))
            {
                if ["self", "static"].contains(&name) {
                    return Some(class_id.clone());
                }
                if name == "parent" {
                    return parent.as_ref().and_then(|parent| {
                        types
                            .get(&(symbol.api.clone(), parent.to_ascii_lowercase()))
                            .cloned()
                    });
                }
            }
            types
                .get(&(
                    symbol.api.clone(),
                    name.trim_start_matches('\\').to_ascii_lowercase(),
                ))
                .cloned()
        };
        for relation in &mut symbol.relations {
            relation.target_id = resolve(&relation.name);
        }
        let update = |ty: &mut Type| {
            for reference in &mut ty.references {
                reference.target_id = resolve(&reference.name);
            }
        };
        if let Some(ty) = &mut symbol.r#type {
            update(ty);
        }
        for p in &mut symbol.type_parameters {
            if let Some(ty) = &mut p.constraint {
                update(ty);
            }
            if let Some(ty) = &mut p.default {
                update(ty);
            }
        }
        for signature in &mut symbol.signatures {
            if let Some(ty) = &mut signature.returns {
                update(ty);
            }
            for parameter in &mut signature.parameters {
                if let Some(ty) = &mut parameter.r#type {
                    update(ty);
                }
            }
            for p in &mut signature.type_parameters {
                if let Some(ty) = &mut p.constraint {
                    update(ty);
                }
                if let Some(ty) = &mut p.default {
                    update(ty);
                }
            }
        }
    }
}
