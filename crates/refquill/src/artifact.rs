use crate::model::Document;
use anyhow::{Context, Result, bail, ensure};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

pub fn fingerprint(document: &Document) -> Result<String> {
    fingerprint_value(crate::wire::encode(document)?)
}

/// Hash the complete wire content before resolution can discard unused tables
/// or explicit defaults. Whitespace/property order do not affect integrity.
pub fn fingerprint_bytes(bytes: &[u8]) -> Result<String> {
    fingerprint_value(serde_json::from_slice(bytes)?)
}

fn fingerprint_value(mut value: serde_json::Value) -> Result<String> {
    value["fingerprint"] = "".into();
    Ok(Sha256::digest(serde_json::to_vec(&value)?)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

pub fn seal(document: &mut Document) -> Result<()> {
    document.symbols.sort_by(|a, b| a.id.cmp(&b.id));
    document.validate()?;
    document.fingerprint = fingerprint(document)?;
    Ok(())
}

pub fn parse(bytes: &[u8]) -> Result<Document> {
    let value: serde_json::Value =
        serde_json::from_slice(bytes).context("Invalid JSON document")?;
    let schema: serde_json::Value = serde_json::from_str(include_str!(
        "../../../packages/schema/document.schema.json"
    ))?;
    jsonschema::validate(&schema, &value)
        .map_err(|e| anyhow::anyhow!("Invalid document at {}: {e}", e.instance_path()))?;
    let document = crate::wire::decode(value)?;
    document.validate()?;
    Ok(document)
}

struct Lock(PathBuf);
impl Drop for Lock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

/// Hold the exclusive sidecar lock through the ownership check and atomic replace.
/// Failed analysis never reaches this function. No-op writes retain timestamps.
pub fn write(output: &Path, document: &Document, force: bool) -> Result<bool> {
    let parent = output.parent().context("Output needs a parent directory")?;
    fs::create_dir_all(parent)?;
    let lock_path = output.with_extension("json.lock");
    let mut lock = OpenOptions::new().write(true).create_new(true).open(&lock_path)
        .with_context(|| format!("Cannot lock {}; if a previous run was killed, confirm it stopped before removing {}", output.display(), lock_path.display()))?;
    let _guard = Lock(lock_path);
    writeln!(lock, "{}", std::process::id())?;
    if let Ok(meta) = fs::symlink_metadata(output) {
        ensure!(
            meta.is_file() && !meta.file_type().is_symlink(),
            "Output must be a regular file, not a symlink"
        );
        let bytes = fs::read(output)?;
        if !force {
            let previous = parse(&bytes).context(
                "Refusing to replace an unmanaged file; choose another output or use --force",
            )?;
            ensure!(
                previous.fingerprint == fingerprint_bytes(&bytes)?,
                "Refusing to replace an edited artifact; use --force to explicitly replace it"
            );
        }
        if bytes == encode(document)? {
            return Ok(false);
        }
    } else if output.try_exists()? {
        bail!("Cannot inspect output");
    }
    let mut temp = tempfile::NamedTempFile::new_in(parent)?;
    temp.write_all(&encode(document)?)?;
    temp.as_file().sync_all()?;
    temp.persist(output)
        .context("Could not atomically replace output")?;
    #[cfg(unix)]
    File::open(parent)?.sync_all()?;
    Ok(true)
}

fn encode(document: &Document) -> Result<Vec<u8>> {
    let mut bytes = serde_json::to_vec(&crate::wire::encode(document)?)?;
    bytes.push(b'\n');
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn protects_output_and_keeps_identical_bytes() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let output = dir.path().join("api.json");
        let mut document = Document::new("Test".into());
        seal(&mut document)?;
        assert!(write(&output, &document, false)?);
        let before = fs::metadata(&output)?.modified()?;
        assert!(!write(&output, &document, false)?);
        assert_eq!(before, fs::metadata(&output)?.modified()?);
        fs::write(&output, b"handwritten")?;
        assert!(write(&output, &document, false).is_err());
        assert_eq!(fs::read(&output)?, b"handwritten");
        assert!(write(&output, &document, true)?);
        let edited = fs::read_to_string(&output)?.replace("Test", "Edited");
        fs::write(&output, edited)?;
        assert!(write(&output, &document, false).is_err());
        fs::write(output.with_extension("json.lock"), "other process")?;
        assert!(write(&output, &document, true).is_err());
        Ok(())
    }
    #[test]
    fn diagnostics_use_the_same_source_rules_as_symbols() {
        let mut document = Document::new("Test".into());
        document.diagnostics.push(crate::model::Diagnostic {
            message: "Warning".into(),
            source: Some(crate::model::Source {
                file: "../private.php".into(),
                line: 1,
                end_line: 1,
            }),
        });
        assert!(seal(&mut document).is_err());
    }
    #[test]
    fn integrity_covers_unused_tables_and_explicit_defaults() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let output = dir.path().join("reference.json");
        let mut document = Document::new("Test".into());
        seal(&mut document)?;
        write(&output, &document, false)?;
        for field in ["types", "diagnostics"] {
            let mut edited = crate::wire::encode(&document)?;
            edited[field] = if field == "types" {
                serde_json::json!([{ "text": "unused" }])
            } else {
                serde_json::json!([])
            };
            let bytes = serde_json::to_vec(&edited)?;
            // Both edits leave the resolved semantic model unchanged.
            let parsed = parse(&bytes)?;
            assert_eq!(fingerprint(&parsed)?, document.fingerprint);
            assert_ne!(fingerprint_bytes(&bytes)?, document.fingerprint);
            fs::write(&output, &bytes)?;
            assert!(write(&output, &document, false).is_err());
            assert_eq!(fs::read(&output)?, bytes);
        }
        Ok(())
    }
    #[test]
    #[cfg(unix)]
    fn rejects_symlinks_even_with_force() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let target = dir.path().join("target.json");
        let output = dir.path().join("api.json");
        std::os::unix::fs::symlink(&target, &output)?;
        let mut document = Document::new("Test".into());
        seal(&mut document)?;
        assert!(write(&output, &document, true).is_err());
        assert!(!target.exists());
        Ok(())
    }
}
