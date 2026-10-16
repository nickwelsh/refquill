use anyhow::{Context, Result, ensure};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
};

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    #[serde(rename = "$schema", default, skip_serializing_if = "Option::is_none")]
    pub schema: Option<String>,
    #[serde(default = "title")]
    pub title: String,
    pub output: PathBuf,
    #[serde(default = "root")]
    pub source_root: PathBuf,
    #[serde(default)]
    pub include_protected: bool,
    #[serde(default = "excludes")]
    pub exclude: Vec<String>,
    #[schemars(length(min = 1))]
    pub inputs: Vec<Input>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "language", rename_all = "lowercase", deny_unknown_fields)]
pub enum Input {
    Php {
        name: String,
        paths: Vec<PathBuf>,
    },
    TypeScript {
        name: String,
        tsconfig: PathBuf,
        #[serde(rename = "entryPoints")]
        entry_points: Vec<PathBuf>,
    },
    Rust {
        name: String,
        /// Import an existing rustdoc JSON file, without running project code.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        rustdoc: Option<PathBuf>,
        /// Generate JSON for a Cargo library (requires a compatible nightly).
        #[serde(
            rename = "manifestPath",
            default,
            skip_serializing_if = "Option::is_none"
        )]
        manifest_path: Option<PathBuf>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        package: Option<String>,
        /// Optional rustup toolchain; omitted means the current Cargo toolchain.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        toolchain: Option<String>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        features: Vec<String>,
        #[serde(
            rename = "allFeatures",
            default,
            skip_serializing_if = "std::ops::Not::not"
        )]
        all_features: bool,
        #[serde(
            rename = "noDefaultFeatures",
            default,
            skip_serializing_if = "std::ops::Not::not"
        )]
        no_default_features: bool,
    },
}

fn title() -> String {
    "API reference".into()
}
fn root() -> PathBuf {
    ".".into()
}
fn excludes() -> Vec<String> {
    [
        "**/vendor/**",
        "**/node_modules/**",
        "**/.git/**",
        "**/target/**",
    ]
    .into_iter()
    .map(str::to_owned)
    .collect()
}

impl Input {
    pub fn name(&self) -> &str {
        match self {
            Self::Php { name, .. } | Self::TypeScript { name, .. } | Self::Rust { name, .. } => {
                name
            }
        }
    }
}

impl Config {
    pub fn load(file: &Path) -> Result<Self> {
        let file = file
            .canonicalize()
            .with_context(|| format!("Cannot read config {}", file.display()))?;
        let mut config: Self =
            serde_json::from_slice(&std::fs::read(&file)?).context("Invalid Refquill config")?;
        let root = file.parent().expect("canonical file has parent");
        config.source_root = root
            .join(&config.source_root)
            .canonicalize()
            .context("sourceRoot does not exist")?;
        ensure!(
            config.source_root.is_dir(),
            "sourceRoot must be a directory"
        );
        ensure!(!config.inputs.is_empty(), "Configure at least one input");
        ensure!(
            config.output.extension().is_some_and(|v| v == "json"),
            "output must be a .json file"
        );
        config.output = absolute(&root.join(&config.output));
        let output_identity = if config.output.try_exists()? {
            config.output.canonicalize()?
        } else {
            config.output.clone()
        };
        ensure!(
            output_identity != file,
            "Output cannot overwrite configuration"
        );
        let mut names = BTreeSet::new();
        for input in &mut config.inputs {
            let name = input.name();
            ensure!(
                !name.is_empty()
                    && name
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'),
                "Input name must contain letters, numbers, hyphens, or underscores"
            );
            ensure!(
                names.insert(name.to_owned()),
                "Duplicate input name: {name}"
            );
            let paths = match input {
                Input::Rust {
                    rustdoc,
                    manifest_path,
                    package,
                    toolchain,
                    features,
                    all_features,
                    no_default_features,
                    ..
                } => {
                    ensure!(
                        rustdoc.is_some() != manifest_path.is_some(),
                        "Rust input requires exactly one of rustdoc or manifestPath"
                    );
                    if rustdoc.is_some() {
                        ensure!(
                            package.is_none()
                                && toolchain.is_none()
                                && features.is_empty()
                                && !*all_features
                                && !*no_default_features,
                            "Cargo options require manifestPath"
                        );
                    }
                    for (value, label) in [
                        (package.as_ref(), "package"),
                        (toolchain.as_ref(), "toolchain"),
                    ] {
                        if let Some(value) = value {
                            ensure!(
                                !value.is_empty()
                                    && !value.starts_with('-')
                                    && !value.chars().any(char::is_whitespace),
                                "Invalid Rust {label}"
                            );
                        }
                    }
                    ensure!(
                        features.iter().all(|value| !value.is_empty()
                            && !value.starts_with('-')
                            && !value.chars().any(char::is_whitespace)),
                        "Invalid Rust feature"
                    );
                    let path = rustdoc
                        .as_mut()
                        .or(manifest_path.as_mut())
                        .expect("validated Rust source");
                    *path = root.join(&*path).canonicalize().with_context(|| {
                        format!("Rust input does not exist: {}", path.display())
                    })?;
                    ensure!(path.is_file(), "Rust input must be a file");
                    ensure!(
                        path.starts_with(&config.source_root),
                        "Rust input must be inside sourceRoot"
                    );
                    ensure!(
                        *path != output_identity,
                        "Output cannot overwrite Rust input"
                    );
                    continue;
                }
                Input::Php { paths, .. } => paths,
                Input::TypeScript {
                    tsconfig,
                    entry_points,
                    ..
                } => {
                    *tsconfig = root
                        .join(&*tsconfig)
                        .canonicalize()
                        .context("tsconfig does not exist")?;
                    ensure!(tsconfig.is_file(), "tsconfig must be a file");
                    ensure!(
                        *tsconfig != output_identity,
                        "Output cannot overwrite tsconfig"
                    );
                    entry_points
                }
            };
            ensure!(
                !paths.is_empty(),
                "Input must have at least one source path"
            );
            for path in paths {
                *path = root
                    .join(&*path)
                    .canonicalize()
                    .with_context(|| format!("Source does not exist: {}", path.display()))?;
                ensure!(
                    path.starts_with(&config.source_root),
                    "Sources must be inside sourceRoot"
                );
                ensure!(*path != output_identity, "Output cannot overwrite a source");
            }
        }
        for pattern in &config.exclude {
            globset::Glob::new(pattern)
                .with_context(|| format!("Invalid exclude glob: {pattern}"))?;
        }
        Ok(config)
    }
}

/// Normalize a possibly nonexistent output without requiring its parent to exist.
fn absolute(path: &Path) -> PathBuf {
    let mut result = PathBuf::new();
    for part in path.components() {
        match part {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                result.pop();
            }
            other => result.push(other.as_os_str()),
        }
    }
    result
}
