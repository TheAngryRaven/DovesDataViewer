# Vendored BirdsEye firmware simulator

The files in this folder are a **committed build artifact**: the real
DovesDataLogger firmware compiled to WebAssembly, consumed by the
`/simulator` page. The viewer only ever runs a deliberately-vendored
build — there is no build-time fetch — so updating the simulator means
rebuilding these files from the firmware repo and committing them here.

| File | What |
|---|---|
| `birdseye-sim.mjs` | Public module — hand-written ESM wrapper, import THIS |
| `birdseye-sim-core.mjs` | Emscripten-emitted factory (internal; loaded by the wrapper) |
| `birdseye-sim-core.wasm` | The firmware, compiled |
| `version.json` | Build provenance: `firmwareSha`, `buildDate`, `simApiVersion`, `dovesLapTimerSha`, display-lib versions |
| `test.html` | Standalone harness (serve this folder, open it) |

The API contract (v1) lives in the firmware repo at `BirdsEye/sim/API.md`.

## Rebuilding & vendoring (e.g. for a release)

Prerequisite: Emscripten **3.1.61** — the exact version the firmware
repo's `sim-build` CI job pins. One-time install via
[emsdk](https://github.com/emscripten-core/emsdk):

```bash
./emsdk install 3.1.61 && ./emsdk activate 3.1.61
```

Then, in a clone of `TheAngryRaven/DovesDataLogger`:

```bash
# 1. Check out the ref you are shipping (tag, BETA, etc.)
git checkout v3.0.0

# 2. Configure + build. IMPORTANT: always re-run the configure step after
#    changing refs — version.json's firmwareSha is stamped at CONFIGURE
#    time, so a stale build dir ships the wrong provenance.
source /path/to/emsdk/emsdk_env.sh
emcmake cmake -S BirdsEye/sim -B BirdsEye/sim/build-wasm -DCMAKE_BUILD_TYPE=Release
cmake --build BirdsEye/sim/build-wasm --parallel

# 3. Smoke-test the artifact (boot → menu, state, determinism, reset).
#    Must end with "--- smoke ok ---".
node BirdsEye/sim/build-wasm/dist/smoke.mjs

# 4. Vendor: copy exactly these five files into this folder.
cd BirdsEye/sim/build-wasm/dist
cp birdseye-sim.mjs birdseye-sim-core.mjs birdseye-sim-core.wasm \
   test.html version.json <viewer>/public/sim/
```

Finally, in the viewer: check `git diff public/sim/version.json` shows the
expected `firmwareSha`, run the gates
(`bun run typecheck && bun run lint && bun run test:run && bun run build`),
add a CHANGELOG entry, and PR into `BETA`.

### No local toolchain?

Every firmware push that touches the sim runs the `sim-build` workflow,
whose wasm job uploads a **`birdseye-sim-wasm`** artifact containing the
same `dist/` folder — download it from the Actions run for your ref and
copy the same five files instead of building locally.
