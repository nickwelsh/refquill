//! Generate a shared JSON API reference from PHP, TypeScript, and Rust.
//!
//! Analyzers populate [`model::Document`]. The [`artifact`] module validates and
//! seals the document, and [`wire`] encodes the compact schema-v1 representation.
//! The command-line interface combines configured inputs and writes one artifact.

/// Validate, fingerprint, and atomically write generated API documents.
pub mod artifact;
/// Load and validate source selections and output settings from refquill.json.
pub mod config;
/// Complete symbols, types, relationships, and document graph validation.
pub mod model;
/// Extract PHP declarations, names, and PHPDoc with Mago.
pub mod php;
mod php_types;
/// Import compiler-generated rustdoc JSON and retain its native metadata.
pub mod rust;
/// Run Cargo rustdoc for an explicitly configured library or proc-macro crate.
pub mod rust_cargo;
/// Invoke the bundled TypeDoc and TypeScript compiler worker.
pub mod typescript;
/// Encode and decode the compact schema-v1 document and its shared tables.
pub mod wire;
