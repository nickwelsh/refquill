//! Cargo owns feature selection, macro expansion, cfg and dependency resolution.
//! Only explicitly configured manifest inputs execute Cargo/build scripts.
use crate::{
    config::{Config, Input},
    model::Document,
};
use anyhow::{Context, Result, ensure};
use serde::Deserialize;
use std::{
    path::PathBuf,
    process::{Command, Stdio},
};

#[derive(Deserialize)]
struct Metadata {
    packages: Vec<Package>,
    workspace_members: Vec<String>,
    workspace_root: PathBuf,
}

#[derive(Deserialize)]
struct Package {
    id: String,
    name: String,
    manifest_path: PathBuf,
    targets: Vec<Target>,
}

#[derive(Deserialize)]
struct Target {
    name: String,
    kind: Vec<String>,
}

pub fn analyze(config: &Config, input: &Input, document: &mut Document) -> Result<()> {
    let Input::Rust {
        name,
        manifest_path: Some(manifest),
        package,
        toolchain,
        features,
        all_features,
        no_default_features,
        ..
    } = input
    else {
        anyhow::bail!("Cargo analysis requires a Rust manifestPath input");
    };
    let command = || {
        let mut command = Command::new("cargo");
        if let Some(toolchain) = toolchain {
            command.arg(format!("+{toolchain}"));
        }
        command.current_dir(manifest.parent().expect("canonical manifest has parent"));
        command.stdin(Stdio::null());
        command
    };
    let metadata = command().args(["metadata", "--no-deps", "--format-version", "1", "--manifest-path"]).arg(manifest).output()
        .context("Cannot start Cargo; install a compatible nightly Rust toolchain or configure rustdoc JSON import")?;
    ensure!(
        metadata.status.success(),
        "Cargo metadata failed; previous output is preserved:\n{}",
        String::from_utf8_lossy(&metadata.stderr)
    );
    let metadata: Metadata =
        serde_json::from_slice(&metadata.stdout).context("Invalid Cargo metadata")?;
    let candidates: Vec<_> = metadata
        .packages
        .iter()
        .filter(|p| metadata.workspace_members.contains(&p.id))
        .filter(|p| {
            package
                .as_ref()
                .map_or_else(|| p.manifest_path == *manifest, |name| p.name == *name)
        })
        .collect();
    ensure!(
        candidates.len() == 1,
        "Rust manifest must select one package; set package for a workspace manifest"
    );
    let selected = candidates[0];
    ensure!(
        selected
            .manifest_path
            .canonicalize()?
            .starts_with(&config.source_root),
        "Selected Rust package must be inside sourceRoot"
    );
    let targets: Vec<_> = selected
        .targets
        .iter()
        .filter(|target| {
            target.kind.iter().any(|kind| {
                matches!(
                    kind.as_str(),
                    "lib" | "rlib" | "dylib" | "cdylib" | "staticlib" | "proc-macro"
                )
            })
        })
        .collect();
    ensure!(
        targets.len() == 1,
        "Rust package must have one library target"
    );
    // A fresh target directory prevents reading stale JSON after changed flags or
    // a failed build, and keeps generated files away from managed outputs.
    let temporary = tempfile::tempdir()?;
    let mut build = command();
    build
        .args(["rustdoc", "--manifest-path"])
        .arg(manifest)
        .args(["--package", &selected.name, "--lib", "--target-dir"])
        .arg(temporary.path());
    if !features.is_empty() {
        build.arg("--features").arg(features.join(","));
    }
    if *all_features {
        build.arg("--all-features");
    }
    if *no_default_features {
        build.arg("--no-default-features");
    }
    build.args(["--", "-Z", "unstable-options", "--output-format", "json"]);
    let result = build.output().context("Cannot start Cargo rustdoc")?;
    ensure!(
        result.status.success(),
        "Cargo rustdoc failed; JSON output requires a compatible nightly toolchain (use toolchain or import rustdoc JSON). Previous output is preserved:\n{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let filename = format!("{}.json", targets[0].name.replace('-', "_"));
    // Cargo's configured build target can insert a target-triple directory.
    // Search only the fresh target tree and the selected crate's doc filename.
    let mut outputs = Vec::new();
    for entry in walkdir::WalkDir::new(temporary.path()) {
        let entry = entry?;
        if entry.file_type().is_file()
            && entry.file_name() == filename.as_str()
            && entry
                .path()
                .parent()
                .and_then(|p| p.file_name())
                .is_some_and(|name| name == "doc")
        {
            outputs.push(entry.into_path());
        }
    }
    ensure!(
        outputs.len() == 1,
        "Cargo must produce exactly one {filename}; configure one build target or import rustdoc JSON"
    );
    crate::rust::analyze_with_base(
        config,
        name,
        &outputs[0],
        &metadata.workspace_root,
        document,
    )
}
