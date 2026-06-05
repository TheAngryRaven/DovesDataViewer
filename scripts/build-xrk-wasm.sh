#!/usr/bin/env bash
#
# Build the libxrk wasm module used by the in-browser AiM .xrk/.xrz importer and
# write the artifacts into src/lib/xrk/wasm/ (committed to the repo so the JS
# toolchain / CI never needs Rust).
#
# This compiles libxrk's pure-Rust core (no Python) to wasm32 via the thin
# wrapper in xrk-wasm/. It needs:
#   - rustup (stable), with the wasm32-unknown-unknown target
#   - wasm-bindgen 0.2.122 (auto-downloaded prebuilt if missing)
#   - wasm-opt (optional; from binaryen — shrinks the module further)
#
# Bump the libxrk `rev` in xrk-wasm/Cargo.toml + the wasm-bindgen version here
# together, then re-run this and commit the regenerated artifacts.
set -euo pipefail

WBG_VERSION="0.2.122"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CRATE="$REPO_ROOT/xrk-wasm"
OUT="$REPO_ROOT/src/lib/xrk/wasm"

echo "==> Ensure wasm32 target"
rustup target add wasm32-unknown-unknown

echo "==> Ensure wasm-bindgen $WBG_VERSION"
WBG="$(command -v wasm-bindgen || true)"
if [ -z "$WBG" ] || ! wasm-bindgen --version 2>/dev/null | grep -q "$WBG_VERSION"; then
  TMP="$(mktemp -d)"
  TARBALL="wasm-bindgen-${WBG_VERSION}-x86_64-unknown-linux-musl"
  curl -sSL -o "$TMP/wbg.tar.gz" \
    "https://github.com/rustwasm/wasm-bindgen/releases/download/${WBG_VERSION}/${TARBALL}.tar.gz"
  tar xzf "$TMP/wbg.tar.gz" -C "$TMP"
  WBG="$TMP/$TARBALL/wasm-bindgen"
fi
echo "    using $("$WBG" --version)"

echo "==> cargo build (release, wasm32)"
( cd "$CRATE" && cargo build --release --target wasm32-unknown-unknown )

echo "==> wasm-bindgen (--target web)"
mkdir -p "$OUT"
"$WBG" --target web --out-dir "$OUT" \
  "$CRATE/target/wasm32-unknown-unknown/release/xrk_wasm.wasm"

if command -v wasm-opt >/dev/null 2>&1; then
  echo "==> wasm-opt -Oz"
  # Rust emits these wasm features by default; wasm-opt must be told to allow them.
  wasm-opt -Oz \
    --enable-bulk-memory --enable-nontrapping-float-to-int \
    --enable-sign-ext --enable-mutable-globals --enable-reference-types \
    "$OUT/xrk_wasm_bg.wasm" -o "$OUT/xrk_wasm_bg.wasm"
else
  echo "==> wasm-opt not found — skipping (artifact still valid, just larger)"
fi

echo "==> Done. Artifacts:"
ls -la "$OUT"
echo
echo "    gzipped wasm: $(gzip -9 -c "$OUT/xrk_wasm_bg.wasm" | wc -c | awk '{printf "%.0f KB", $1/1024}')"
echo "Commit src/lib/xrk/wasm/ along with any xrk-wasm/ changes."
