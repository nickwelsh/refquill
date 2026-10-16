use anyhow::Result;
use refquill::{artifact, config::Config};
use serde_json::json;
use std::{
    fs,
    path::Path,
    process::{Command, Output},
};

fn run(config: &Path, compiler_fixture: bool) -> Result<Output> {
    let mut command = Command::new(env!("CARGO_BIN_EXE_refquill"));
    command.arg("generate").arg(config);
    // Only the compiler fixture test enables unstable rustdoc on CI's pinned
    // stable compiler. Refquill itself never changes RUSTC_BOOTSTRAP.
    if compiler_fixture {
        command.env("RUSTC_BOOTSTRAP", "1");
    }
    Ok(command.output()?)
}

#[test]
fn rustdoc_import_is_deterministic_and_failure_preserves_output() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/rust");
    fs::copy(fixture.join("lib.rs"), dir.path().join("lib.rs"))?;
    fs::copy(fixture.join("excluded.rs"), dir.path().join("excluded.rs"))?;
    let raw_path = dir.path().join("rustdoc.json");
    fs::copy(fixture.join("rustdoc.json"), &raw_path)?;
    let config = dir.path().join("refquill.json");
    fs::write(
        &config,
        serde_json::to_vec(
            &json!({"output":"api.json", "inputs":[{"language":"rust","name":"rust","rustdoc":"rustdoc.json"}]}),
        )?,
    )?;
    let result = run(&config, false)?;
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let output = dir.path().join("api.json");
    let bytes = fs::read(&output)?;
    let document = artifact::parse(&bytes)?;
    assert_eq!(document.rustdoc.len(), 1);
    assert_eq!(document.fingerprint, artifact::fingerprint_bytes(&bytes)?);
    let before = fs::metadata(&output)?.modified()?;
    assert!(run(&config, false)?.status.success());
    assert_eq!(bytes, fs::read(&output)?);
    assert_eq!(before, fs::metadata(&output)?.modified()?);
    let mut raw: serde_json::Value = serde_json::from_slice(&fs::read(&raw_path)?)?;
    raw["format_version"] = json!(999999);
    fs::write(&raw_path, serde_json::to_vec(&raw)?)?;
    let result = run(&config, false)?;
    assert!(!result.status.success());
    assert!(String::from_utf8_lossy(&result.stderr).contains("Unsupported rustdoc"));
    assert_eq!(bytes, fs::read(&output)?);
    Ok(())
}

#[test]
fn cargo_compiler_features_sources_and_failure_preservation() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/rust");
    let project = dir.path().join("crate");
    fs::create_dir(&project)?;
    fs::copy(fixture.join("Cargo.toml"), project.join("Cargo.toml"))?;
    fs::copy(fixture.join("lib.rs"), project.join("lib.rs"))?;
    fs::copy(fixture.join("excluded.rs"), project.join("excluded.rs"))?;
    let dependency = dir.path().join("dependency");
    fs::create_dir(&dependency)?;
    fs::write(
        dependency.join("Cargo.toml"),
        "[package]\nname = 'fixture_dependency'\nversion = '0.1.0'\nedition = '2024'\n[lib]\npath = 'lib.rs'\n[workspace]\n",
    )?;
    fs::write(dependency.join("lib.rs"), "pub struct Dependency;")?;
    let manifest = project.join("Cargo.toml");
    fs::write(
        &manifest,
        format!(
            "{}\n[dependencies]\nfixture_dependency = {{ path = '../dependency' }}\n",
            fs::read_to_string(&manifest)?
        ),
    )?;
    let source = project.join("lib.rs");
    fs::write(
        &source,
        format!(
            "{}\npub fn dependency() -> fixture_dependency::Dependency {{ fixture_dependency::Dependency }}\n",
            fs::read_to_string(&source)?
        ),
    )?;
    let config = dir.path().join("refquill.json");
    let configuration = |features: serde_json::Value| json!({"output":"api.json", "inputs":[{"language":"rust","name":"rust","manifestPath":"crate/Cargo.toml", "features": features}]});
    fs::write(&config, serde_json::to_vec(&configuration(json!([])))?)?;
    let result = run(&config, true)?;
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let output = dir.path().join("api.json");
    let document = artifact::parse(&fs::read(&output)?)?;
    assert!(!document.symbols.iter().any(|s| s.name == "Extra"));
    assert!(
        document
            .symbols
            .iter()
            .filter_map(|s| s.source.as_ref())
            .any(|s| s.file == "crate/lib.rs")
    );
    fs::write(
        &config,
        serde_json::to_vec(&configuration(json!(["extra"])))?,
    )?;
    let result = run(&config, true)?;
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let bytes = fs::read(&output)?;
    let document = artifact::parse(&bytes)?;
    assert!(document.symbols.iter().any(|s| s.name == "Extra"));
    assert!(run(&config, true)?.status.success());
    assert_eq!(bytes, fs::read(&output)?);
    fs::write(project.join("lib.rs"), "pub fn broken( {")?;
    assert!(!run(&config, true)?.status.success());
    assert_eq!(bytes, fs::read(&output)?);
    assert!(Config::load(&config).is_ok());
    Ok(())
}

#[test]
fn cargo_workspace_and_configured_target_keep_real_source_paths() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let member = dir.path().join("member");
    fs::create_dir_all(member.join("src"))?;
    fs::write(
        dir.path().join("Cargo.toml"),
        "[workspace]\nmembers = ['member']\nresolver = '3'\n",
    )?;
    fs::write(
        member.join("Cargo.toml"),
        "[package]\nname = 'workspace_member'\nversion = '0.1.0'\nedition = '2024'\n",
    )?;
    fs::write(member.join("src/lib.rs"), "pub struct Widget;")?;
    let rustc = Command::new("rustc").arg("-vV").output()?;
    let version = String::from_utf8(rustc.stdout)?;
    let host = version
        .lines()
        .find_map(|line| line.strip_prefix("host: "))
        .expect("rustc reports host");
    fs::create_dir(dir.path().join(".cargo"))?;
    fs::write(
        dir.path().join(".cargo/config.toml"),
        format!("[build]\ntarget = {host:?}\n"),
    )?;
    let config = dir.path().join("refquill.json");
    fs::write(
        &config,
        serde_json::to_vec(
            &json!({"output":"api.json", "inputs":[{"language":"rust", "name":"rust", "manifestPath":"Cargo.toml", "package":"workspace_member"}]}),
        )?,
    )?;
    let result = run(&config, true)?;
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let bytes = fs::read(dir.path().join("api.json"))?;
    let document = artifact::parse(&bytes)?;
    let widget = document
        .symbols
        .iter()
        .find(|s| s.name == "Widget")
        .unwrap();
    assert_eq!(widget.source.as_ref().unwrap().file, "member/src/lib.rs");
    assert!(
        dir.path()
            .join(&widget.source.as_ref().unwrap().file)
            .is_file()
    );
    let id = widget.rustdoc_id.as_ref().unwrap();
    assert_eq!(
        document.rustdoc[0].data["index"][id]["span"]["filename"],
        "member/src/lib.rs"
    );
    Ok(())
}

#[test]
#[cfg(unix)]
fn cargo_workspace_member_cannot_escape_source_root_through_symlinks() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let workspace = dir.path().join("workspace");
    let external = dir.path().join("external");
    fs::create_dir(&workspace)?;
    fs::create_dir(&external)?;
    fs::write(
        workspace.join("Cargo.toml"),
        "[workspace]\nmembers = ['member']\nresolver = '3'\n",
    )?;
    fs::write(
        external.join("Cargo.toml"),
        "[package]\nname = 'outside'\nversion = '0.1.0'\n[lib]\npath = 'lib.rs'\n",
    )?;
    fs::write(external.join("lib.rs"), "pub struct Outside;")?;
    std::os::unix::fs::symlink(&external, workspace.join("member"))?;
    let config = workspace.join("refquill.json");
    fs::write(
        &config,
        serde_json::to_vec(
            &json!({"output":"api.json", "inputs":[{"language":"rust", "name":"rust", "manifestPath":"Cargo.toml", "package":"outside"}]}),
        )?,
    )?;
    let result = run(&config, false)?;
    assert!(!result.status.success());
    assert!(
        String::from_utf8_lossy(&result.stderr)
            .contains("Selected Rust package must be inside sourceRoot")
    );
    assert!(!workspace.join("api.json").exists());
    Ok(())
}
