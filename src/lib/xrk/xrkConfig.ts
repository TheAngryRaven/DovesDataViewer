// Configuration for the AiM .xrk/.xrz importer.
//
// The parser is libxrk's pure-Rust core compiled to a small standalone wasm
// module (no Pyodide/Python). The wasm + JS glue are committed under
// `src/lib/xrk/wasm/` and rebuilt by `scripts/build-xrk-wasm.sh`. The pinned
// libxrk revision + wasm-bindgen version live in `xrk-wasm/Cargo.toml` and that
// script — keep them in lockstep with the committed artifacts.

/** File extensions handled by the XRK importer. */
export const XRK_EXTENSIONS = [".xrk", ".xrz"] as const;
