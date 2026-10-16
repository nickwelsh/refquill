use anyhow::Result;
use refquill::{
    config::Config,
    model::{Document, Kind},
    php,
};
use std::path::PathBuf;

fn analyze(protected: bool) -> Result<Document> {
    let path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/php/refquill.json");
    let mut config = Config::load(&path)?;
    config.include_protected = protected;
    let mut document = Document::new(config.title.clone());
    let refquill::config::Input::Php { name, paths } = &config.inputs[0] else {
        unreachable!()
    };
    php::analyze(&config, name, paths, &mut document)?;
    document.validate()?;
    Ok(document)
}

#[test]
fn extracts_public_api_and_resolves_php_relationships() -> Result<()> {
    let document = analyze(false)?;
    let find = |name: &str| {
        document
            .symbols
            .iter()
            .find(|s| s.qualified_name == name)
            .unwrap()
    };
    assert_eq!(find("Demo\\Person").kind, Kind::Class);
    assert!(
        find("Demo\\Person")
            .declaration
            .contains("extends \\Demo\\Repository")
    );
    assert!(
        find("Demo\\Person::$created")
            .declaration
            .contains("\\DateTimeImmutable")
    );
    assert!(
        find("Demo\\format")
            .declaration
            .contains("\\Demo\\Person $person")
    );
    assert_eq!(
        find("Demo\\Person::$created").r#type.as_ref().unwrap().text,
        "\\DateTimeImmutable"
    );
    let same = &find("Demo\\Person::same").signatures[0]
        .returns
        .as_ref()
        .unwrap()
        .references;
    assert!(
        same.iter()
            .any(|r| r.target_id.as_deref() == Some(find("Demo\\Person").id.as_str()))
    );
    let base = &find("Demo\\Person::base").signatures[0]
        .returns
        .as_ref()
        .unwrap()
        .references;
    assert!(
        base.iter()
            .any(|r| r.target_id.as_deref() == Some(find("Demo\\Repository").id.as_str()))
    );
    let shape = &find("Demo\\Person::shape").signatures[0]
        .returns
        .as_ref()
        .unwrap()
        .references;
    assert!(!shape.iter().any(|r| r.name == "Demo\\Person"));
    assert!(
        shape
            .iter()
            .any(|r| r.target_id.as_deref() == Some(find("Demo\\Named").id.as_str()))
    );
    assert!(
        find("Demo\\Person::generic").signatures[0]
            .returns
            .as_ref()
            .unwrap()
            .references
            .is_empty()
    );
    let person = find("Demo\\Person");
    assert_eq!(person.relations.len(), 3);
    assert!(person.relations.iter().all(|r| r.target_id.is_some()));
    assert!(!person.declaration.contains("return"));
    assert!(person.declaration.contains("AllowDynamicProperties"));
    assert_eq!(
        find("Demo\\Person::$label").parent_id.as_deref(),
        Some(person.id.as_str())
    );
    assert!(find("Demo\\Person::oldName").deprecated);
    let signature = &find("Demo\\Repository::all").signatures[0];
    assert_eq!(
        signature.parameters[0].r#type.as_ref().unwrap().text,
        "array<string, list<T>>"
    );
    assert_eq!(signature.parameters[0].description, "Filtering rules.");
    assert_eq!(signature.returns.as_ref().unwrap().text, "list<T>");
    assert_eq!(signature.returns_description, "The matching records.");
    let signature = &find("Demo\\format").signatures[0];
    assert!(signature.parameters[1].by_reference);
    assert_eq!(signature.parameters[1].default.as_deref(), Some("true"));
    assert!(signature.parameters[2].variadic);
    for name in [
        "Demo\\Repository::secret",
        "Demo\\Repository::protectedHelper",
        "Demo\\Person::implementation",
        "Demo\\InternalClass",
        "Demo\\InternalClass::shouldNotLeak",
        "Demo\\implementationDetail",
    ] {
        assert!(
            !document.symbols.iter().any(|s| s.qualified_name == name),
            "{name} leaked"
        );
    }
    assert!(find("Demo\\Person::$display").declaration.contains("get;"));
    assert!(!find("Demo\\Person::$display").declaration.contains("$this"));
    assert_eq!(
        find("Demo\\Status::Active").parent_id.as_deref(),
        Some(find("Demo\\Status").id.as_str())
    );
    assert!(
        analyze(true)?
            .symbols
            .iter()
            .any(|s| s.qualified_name == "Demo\\Repository::protectedHelper")
    );
    Ok(())
}

#[test]
fn syntax_errors_abort_extraction() -> Result<()> {
    let dir = tempfile::tempdir()?;
    std::fs::write(dir.path().join("broken.php"), "<?php class {")?;
    let config_file = dir.path().join("refquill.json");
    std::fs::write(
        &config_file,
        r#"{"output":"api.json","inputs":[{"language":"php","name":"php","paths":["broken.php"]}]}"#,
    )?;
    let config = Config::load(&config_file)?;
    let mut document = Document::new("Test".into());
    assert!(
        php::analyze(
            &config,
            "php",
            &[dir.path().join("broken.php")],
            &mut document
        )
        .is_err()
    );
    Ok(())
}

#[test]
fn preserves_multiline_markdown_without_phpdoc_margins() -> Result<()> {
    let dir = tempfile::tempdir()?;
    std::fs::write(
        dir.path().join("docs.php"),
        r#"<?php
namespace Demo;
use Demo\Status as State;
/**
 * A **documented** enum with `inline code` and more text.
 *
 * - Keep the first item.
 * - Keep the second item.
 *
 * See [PHP](https://www.php.net/).
 */
enum Status: string { case Active = 'active'; }

/**
 * Return `value` with its spacing preserved.
 * @param string $value A `string` value.
 *   A continuation with **emphasis**.
 * @return string The `same` value.
 */
function identity(string $value): string { return $value; }
function defaults(State $status = State::Active, string $literal = 'State::Active'): void {}
"#,
    )?;
    let config_file = dir.path().join("refquill.json");
    std::fs::write(
        &config_file,
        r#"{"output":"api.json","inputs":[{"language":"php","name":"php","paths":["docs.php"]}]}"#,
    )?;
    let config = Config::load(&config_file)?;
    let mut document = Document::new("Test".into());
    php::analyze(
        &config,
        "php",
        &[dir.path().join("docs.php")],
        &mut document,
    )?;
    let status = document
        .symbols
        .iter()
        .find(|s| s.name == "Status")
        .unwrap();
    assert_eq!(
        status.description,
        "A **documented** enum with `inline code` and more text.\n\n- Keep the first item.\n- Keep the second item.\n\nSee [PHP](https://www.php.net/)."
    );
    let function = document
        .symbols
        .iter()
        .find(|s| s.name == "identity")
        .unwrap();
    assert_eq!(
        function.description,
        "Return `value` with its spacing preserved."
    );
    assert_eq!(
        function.signatures[0].parameters[0].description,
        "A `string` value.\n  A continuation with **emphasis**."
    );
    assert_eq!(
        function.signatures[0].returns_description,
        "The `same` value."
    );
    let defaults = document
        .symbols
        .iter()
        .find(|s| s.name == "defaults")
        .unwrap();
    assert_eq!(
        defaults.signatures[0].parameters[0].default.as_deref(),
        Some("\\Demo\\Status::Active")
    );
    assert_eq!(
        defaults.signatures[0].parameters[1].default.as_deref(),
        Some("'State::Active'")
    );
    Ok(())
}

#[test]
fn distinguishes_promoted_properties_from_explicit_properties() -> Result<()> {
    let document = analyze(false)?;
    let find = |name: &str| {
        document
            .symbols
            .iter()
            .find(|s| s.qualified_name == name)
            .unwrap()
    };
    let constructor = find("Demo\\Promotions::__construct");
    for name in [
        "Demo\\Promotions::$first",
        "Demo\\Promotions::$second",
        "Demo\\Person::$label",
    ] {
        let property = find(name);
        assert_eq!(property.kind, Kind::Property);
        assert!(property.promoted);
        assert!(property.parent_id.is_some());
    }
    assert!(!find("Demo\\Promotions::$explicit").promoted);
    assert!(!find("Demo\\Person::$created").promoted);
    assert!(!constructor.promoted);
    let source = constructor.source.as_ref().unwrap();
    assert_eq!(
        find("Demo\\Promotions::$first")
            .source
            .as_ref()
            .unwrap()
            .line,
        source.line + 1
    );
    assert_eq!(
        find("Demo\\Promotions::$second")
            .source
            .as_ref()
            .unwrap()
            .line,
        source.line + 2
    );
    let wire = refquill::wire::encode(&document)?;
    assert!(
        wire["symbols"]
            .as_array()
            .unwrap()
            .iter()
            .any(|s| s["promoted"] == true)
    );
    assert_eq!(
        wire["symbols"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|s| s.get("promoted").is_some())
            .count(),
        3
    );
    Ok(())
}

#[test]
fn qualifies_nested_signature_spans_among_many_unrelated_names() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let source = dir.path().join("many.php");
    let mut content = String::from(
        "<?php\nnamespace Bench;\nuse Vendor\\First as A;\nuse Vendor\\Second as B;\nuse Vendor\\Third as C;\n",
    );
    for index in 0..1024 {
        content.push_str(&format!(
            "function f{index}((A&B)|C $value, ?A $fallback = null, array $config = [A::class, B::VALUE, 'A::class']): (A&B)|C {{}}\n"
        ));
    }
    std::fs::write(&source, content)?;
    let config_file = dir.path().join("refquill.json");
    std::fs::write(
        &config_file,
        r#"{"output":"api.json","inputs":[{"language":"php","name":"php","paths":["many.php"]}]}"#,
    )?;
    let config = Config::load(&config_file)?;
    let mut document = Document::new("Test".into());
    php::analyze(&config, "php", &[source], &mut document)?;
    document.validate()?;
    assert_eq!(document.symbols.len(), 1024);
    for (index, symbol) in document.symbols.iter().enumerate() {
        assert_eq!(symbol.qualified_name, format!("Bench\\f{index}"));
        assert!(
            symbol
                .declaration
                .starts_with(&format!("function f{index}("))
        );
        let signature = &symbol.signatures[0];
        let parameter = signature.parameters[0].r#type.as_ref().unwrap();
        assert_eq!(
            parameter.text,
            "(\\Vendor\\First&\\Vendor\\Second)|\\Vendor\\Third"
        );
        assert_eq!(
            parameter
                .references
                .iter()
                .map(|reference| reference.name.as_str())
                .collect::<Vec<_>>(),
            ["Vendor\\First", "Vendor\\Second", "Vendor\\Third"]
        );
        assert_eq!(
            serde_json::to_value(signature.returns.as_ref().unwrap())?,
            serde_json::to_value(parameter)?
        );
        assert_eq!(
            signature.parameters[1].r#type.as_ref().unwrap().text,
            "?\\Vendor\\First"
        );
        assert_eq!(
            signature.parameters[2].default.as_deref(),
            Some("[\\Vendor\\First::class, \\Vendor\\Second::VALUE, 'A::class']")
        );
    }
    Ok(())
}
