# Rust compiler fixture

`rustdoc.json` comes from the adjacent source files, generated with Rust 1.99.0, commit `b940084d7`, and rustdoc JSON format 61. Machine-specific paths in `external_crates` were removed, and object keys were sorted for review.

Regenerate from the repository root with a compatible nightly:

```sh
rustdoc +nightly -Z unstable-options --output-format json --crate-type lib \
  --crate-name refquill_fixture --edition 2024 \
  -o /tmp/refquill-rustdoc-fixture tests/fixtures/rust/lib.rs
```

The checked-in fixture was generated on stable Rust with `RUSTC_BOOTSTRAP=1`. The Refquill CLI never sets this variable. Adapter tests use the fixture without a nightly toolchain; the Cargo integration test runs rustdoc itself.
