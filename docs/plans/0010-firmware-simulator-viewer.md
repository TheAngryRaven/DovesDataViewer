# 0010 — Firmware Simulator in the Viewer (`/simulator`)

**Status:** Phase A (sim panel + playback engine) shipped; Phase B (map +
cursor) and Phase C (session capture/share) pending.

## Context

The DovesDataLogger firmware now compiles to WebAssembly (the real sketch
sources — same lap timing, same display stack) and is vendored, pinned by
construction, under `public/sim/` (viewer PR #336; firmware repo PRs
#91–#96). The wasm module reproduces a hardware-recorded session's 13 lap
times to the exact millisecond in the firmware repo's CI oracle, and that
hardware session is **byte-identical** to our bundled sample
(`public/samples/okc-tillotson-data.dovex`) — so the viewer can demo the
real device replaying the real session it already ships.

External design record: the "BirdsEye WASM Simulator — Phased Handoff
Spec" (firmware-repo effort; its API contract v1 lives at
`BirdsEye/sim/API.md` in that repo). This plan covers the viewer-side
phases of that spec (its Phases 5–7 = our Phases A–C).

## Phase A — `/simulator` page (this plan's first shipping slice)

- `lib/sim/simClient.ts` — typed loader for `/sim/birdseye-sim.mjs`
  (runtime dynamic import, `@vite-ignore`; the module is same-origin and
  SW-precached). Types mirror API contract v1. `reset()` is async
  (module re-instantiation = true fresh boot).
- `lib/sim/simPlayback.ts` — PURE playback model (Vitest-covered):
  sample→PVT-JSON mapping (canonical channel ids from `channels.ts`),
  tick planning (each dovex row injected at its own timestamp, stepMillis
  between rows — max one injection per step batch, per the contract),
  no-fix boot pre-roll frames, scrub planning (backward = reset +
  headless fast-replay).
- `hooks/useSimPlayback.ts` — owns the sim instance + rAF loop:
  play/pause, 1/2/5/10× speed, seek, live state JSON at ~10 Hz,
  frame-hash-gated canvas blits (fw refreshes at 3 Hz; don't repaint 60).
- `components/sim/SimDevicePanel.tsx` — the "device": 128×64 canvas,
  integer scaling (4/6/8×) with `image-rendering: pixelated`, never
  fractional; true-size toggle (55 × 27.5 mm active area via CSS mm,
  default ON for first-time visitors with a "why so small?" tooltip);
  bezel; three buttons (pointer + ←/Enter/→ keyboard) wired to the real
  firmware debounce.
- `pages/Simulator.tsx` — public, lazy, offline-first route: loads the
  bundled sample (via `ensureSampleFile`'s IDB cache), transport bar
  (play/pause/skip-pre-roll/speed/timeline), status line from
  `getStateJson()`.
- SW: `mjs` added to the precache glob so the sim module works offline
  (the `.wasm` glob already covered the binary).

Done-criteria (from the external spec): bundled OKC demo Play → boot →
lock → auto race mode → laps count up; buttons navigate real firmware
menus mid-playback; scrubbing works.

## Phase B — map + playback cursor (external spec Phase 6)

Map above the sim panel reusing the existing Leaflet/track rendering;
one virtual clock drives map cursor + sim; session picker incl. "upload
your own .dovex".

## Phase C — session capture + share (external spec Phase 7)

Record inputs with virtual timestamps; Supabase `sim_sessions` table;
`/sim/<id>` share links; firmware-sha pinning banner. Determinism (CI-
enforced in the firmware repo) is what makes replays reproduce exactly.

## Decisions & constraints

- **Never re-implement timing/pixels client-side** — the wasm module IS
  the firmware; the viewer only feeds it rows and blits its framebuffer.
- Scrub-backward budget: a full 15-min session fast-replays in ~0.2 s
  native / low seconds wasm; if a scrub ever exceeds ~2 s, coarsen the
  scrub granularity rather than snapshotting wasm memory (out of scope
  in v1).
- The sim page must stay out of the main bundle (lazy route) and add no
  new dependencies.
