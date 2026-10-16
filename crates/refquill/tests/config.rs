use anyhow::Result;
use refquill::config::Config;

#[test]
fn rust_config_selects_exactly_one_source_and_protects_it() -> Result<()> {
    let dir = tempfile::tempdir()?;
    std::fs::write(
        dir.path().join("Cargo.toml"),
        "[package]\nname = 'example'\nversion = '0.1.0'\n",
    )?;
    std::fs::write(dir.path().join("rustdoc.json"), "{}")?;
    let file = dir.path().join("refquill.json");
    let check = |input: serde_json::Value, output: &str| -> Result<bool> {
        std::fs::write(
            &file,
            serde_json::to_vec(&serde_json::json!({"output": output, "inputs": [input]}))?,
        )?;
        Ok(Config::load(&file).is_ok())
    };
    assert!(check(
        serde_json::json!({"language":"rust", "name":"api", "rustdoc":"rustdoc.json"}),
        "api.json"
    )?);
    assert!(check(
        serde_json::json!({"language":"rust", "name":"api", "manifestPath":"Cargo.toml", "features":["extra"], "allFeatures":true}),
        "api.json"
    )?);
    for input in [
        serde_json::json!({"language":"rust", "name":"api"}),
        serde_json::json!({"language":"rust", "name":"api", "rustdoc":"rustdoc.json", "manifestPath":"Cargo.toml"}),
        serde_json::json!({"language":"rust", "name":"api", "rustdoc":"rustdoc.json", "features":["extra"]}),
        serde_json::json!({"language":"rust", "name":"api", "manifestPath":"Cargo.toml", "toolchain":""}),
        serde_json::json!({"language":"rust", "name":"api", "rustdoc":"rustdoc.json", "typo":true}),
    ] {
        assert!(!check(input, "api.json")?);
    }
    assert!(!check(
        serde_json::json!({"language":"rust", "name":"api", "rustdoc":"rustdoc.json"}),
        "rustdoc.json"
    )?);
    Ok(())
}

#[test]
#[cfg(unix)]
fn output_cannot_overwrite_config_through_a_symlinked_directory() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let alias = dir.path().join("alias");
    std::os::unix::fs::symlink(dir.path(), &alias)?;
    std::fs::write(dir.path().join("Api.php"), "<?php class Api {}")?;
    let config = dir.path().join("refquill.json");
    std::fs::write(
        &config,
        r#"{"output":"alias/refquill.json","inputs":[{"language":"php","name":"php","paths":["Api.php"]}]}"#,
    )?;
    assert!(Config::load(&config).is_err());
    Ok(())
}
