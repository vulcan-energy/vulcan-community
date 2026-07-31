# jsonschema 0.46.5 offline patch

This directory is derived from the crates.io `jsonschema` 0.46.5 package:

- crates.io archive SHA-256: `6a5fe5206f06e589caf25e79fc05ccdf91fca745685fe9fe1a13bbdfb479a631`
- upstream repository commit: `77457694b36546bd9b79662d92a64b531d88bb7f`
- upstream path: `crates/jsonschema`
- upstream license: MIT (see `LICENSE`)

The functional delta is in the generated `Cargo.toml`: the crate's default
features are empty instead of enabling `resolve-http`, `resolve-file`, and
`tls-aws-lc-rs`. This preserves the existing offline resolver behaviour and
keeps the dependency compatible with `wasm32-unknown-unknown`.

The only other differences from the crates.io archive are rustfmt whitespace
in two test cases in `src/error.rs` and omission of the unused
`tests/test_cert.pem` fixture. Neither changes validation behaviour.
