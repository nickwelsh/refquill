use crate::{
    config::Config,
    model::{Diagnostic, Document, Language, Symbol},
};
use anyhow::{Context, Result, ensure};
use serde::Deserialize;
use std::{
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WorkerOutput {
    symbols: Vec<Symbol>,
    diagnostics: Vec<Diagnostic>,
}

pub fn analyze(
    config: &Config,
    input_name: &str,
    tsconfig: &Path,
    entry_points: &[PathBuf],
    document: &mut Document,
) -> Result<()> {
    let worker = std::env::var_os("REFQUILL_TYPESCRIPT_WORKER")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../packages/cli/src/typescript.mjs")
        });
    ensure!(
        worker.is_file(),
        "TypeScript analysis needs the bundled Node worker; install @nickwelsh/refquill or set REFQUILL_TYPESCRIPT_WORKER"
    );
    let node = std::env::var_os("REFQUILL_NODE").unwrap_or_else(|| "node".into());
    let mut child = Command::new(node)
        .arg(&worker)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .context("Cannot start TypeScript analyzer; Node 22.18+ is required")?;
    let input = serde_json::json!({ "name": input_name, "tsconfig": tsconfig, "entryPoints": entry_points, "sourceRoot": config.source_root, "includeProtected": config.include_protected, "exclude": config.exclude });
    child
        .stdin
        .take()
        .context("Worker stdin is unavailable")?
        .write_all(&serde_json::to_vec(&input)?)?;
    let result = child.wait_with_output()?;
    ensure!(
        result.status.success(),
        "TypeScript analyzer failed; previous output is preserved"
    );
    let output: WorkerOutput = serde_json::from_slice(&result.stdout)
        .context("Invalid response from TypeScript analyzer")?;
    ensure!(
        output
            .symbols
            .iter()
            .all(|s| s.api == input_name && s.language == Language::TypeScript),
        "Worker returned symbols for a different configured input"
    );
    document.symbols.extend(output.symbols);
    document.diagnostics.extend(output.diagnostics);
    Ok(())
}
