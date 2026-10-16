use anyhow::Result;
use clap::{Parser, Subcommand};
use refquill::{artifact, config, model};
use std::path::PathBuf;

#[derive(Parser)]
#[command(
    version,
    about = "Generate portable PHP, TypeScript, and Rust API references"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    Schema {
        #[arg(long)]
        output: PathBuf,
    },
    /// Validate an artifact's schema, graph, and integrity.
    Validate { file: PathBuf },
    /// Create a small language-specific config without overwriting a file.
    Init {
        #[arg(long, default_value = "refquill.json")]
        config: PathBuf,
        #[arg(long, value_parser = ["php", "typescript", "rust"], default_value = "php")]
        language: String,
    },
    /// Generate one JSON document from every configured input.
    Generate {
        #[arg(default_value = "refquill.json")]
        config: PathBuf,
        /// Explicitly allow replacing an unmanaged or edited regular file.
        #[arg(long)]
        force: bool,
    },
}

fn main() -> Result<()> {
    match Cli::parse().command {
        Command::Generate { config, force } => {
            let config = config::Config::load(&config)?;
            let mut document = model::Document::new(config.title.clone());
            for input in &config.inputs {
                match input {
                    config::Input::Rust { name, rustdoc, .. } => {
                        if let Some(path) = rustdoc {
                            refquill::rust::analyze(&config, name, path, &mut document)?;
                        } else {
                            refquill::rust_cargo::analyze(&config, input, &mut document)?;
                        }
                    }
                    config::Input::Php { name, paths } => {
                        refquill::php::analyze(&config, name, paths, &mut document)?
                    }
                    config::Input::TypeScript {
                        name,
                        tsconfig,
                        entry_points,
                    } => refquill::typescript::analyze(
                        &config,
                        name,
                        tsconfig,
                        entry_points,
                        &mut document,
                    )?,
                }
            }
            artifact::seal(&mut document)?;
            artifact::parse(&serde_json::to_vec(&refquill::wire::encode(&document)?)?)?;
            let changed = artifact::write(&config.output, &document, force)?;
            println!(
                "{} {} ({} symbols)",
                if changed { "Generated" } else { "Unchanged" },
                config.output.display(),
                document.symbols.len()
            );
            for diagnostic in document.diagnostics {
                if let Some(source) = diagnostic.source {
                    eprintln!(
                        "Warning: {}:{}: {}",
                        source.file, source.line, diagnostic.message
                    );
                } else {
                    eprintln!("Warning: {}", diagnostic.message);
                }
            }
        }
        Command::Validate { file } => {
            let bytes = std::fs::read(&file)?;
            let document = artifact::parse(&bytes)?;
            anyhow::ensure!(
                document.fingerprint == artifact::fingerprint_bytes(&bytes)?,
                "Artifact fingerprint does not match its content"
            );
            println!(
                "Valid Refquill document: {} symbols",
                document.symbols.len()
            );
        }
        Command::Init { config, language } => {
            use std::io::Write;
            let input = if language == "rust" {
                serde_json::json!({"language":"rust", "name":"rust", "manifestPath":"Cargo.toml", "toolchain":"nightly"})
            } else if language == "php" {
                serde_json::json!({"language":"php", "name":"backend", "paths":["src"]})
            } else {
                serde_json::json!({"language":"typescript", "name":"frontend", "tsconfig":"tsconfig.json", "entryPoints":["src/index.ts"]})
            };
            let value = serde_json::json!({"$schema": "./node_modules/@nickwelsh/refquill-schema/config.schema.json", "title":"API reference", "output":"docs/api.generated.json", "inputs":[input]});
            // $schema is an editor hint, not a behavior setting.
            let mut file = std::fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&config)?;
            writeln!(file, "{}", serde_json::to_string_pretty(&value)?)?;
            println!("Created {}", config.display());
        }
        Command::Schema { output } => {
            std::fs::create_dir_all(&output)?;
            let schema = schemars::schema_for!(refquill::wire::Document);
            std::fs::write(
                output.join("document.schema.json"),
                format!("{}\n", serde_json::to_string_pretty(&schema)?),
            )?;
            let schema = schemars::schema_for!(model::Document);
            std::fs::write(
                output.join("resolved.schema.json"),
                format!("{}\n", serde_json::to_string_pretty(&schema)?),
            )?;
            let schema = schemars::schema_for!(config::Config);
            std::fs::write(
                output.join("config.schema.json"),
                format!("{}\n", serde_json::to_string_pretty(&schema)?),
            )?;
        }
    }
    Ok(())
}
