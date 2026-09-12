# Video overlays — one scene renderer for preview, export, and native

> Status: **PHASE 0 LANDED** — the renderer unification below is done; the
> native pipeline phases live in LapWing (its `docs/plans/0001`) and land
> against this contract.

## Why this exists

The next major feature is video overlays in the **native app** (LapWing), with
Insta360 support — and the VFX must look the same on web, Android, iOS and
desktop. Research for that (LapWing plan 0001) found the drift already here:
the overlay system had **two renderers** —

- the per-type React components (`DigitalOverlay`, `AnalogOverlay`, …), some
  DOM, some canvas, used for the live preview, and
- `lib/overlayCanvasRenderer.ts`, drawing "simplified versions of each
  overlay type" for video export

— which had diverged: exports were missing the graph grid lines, the needle
and dot glow, the bubble's center dot, the pace bar's SLOW/FAST labels, and
every exported label was hardcoded English regardless of the app language.
The export also stacked the pace bar's center line under its fill, unlike the
preview, and formatted a first-lap sector delta differently.

Every renderer added later (the native shell's burn-in export is next) would
have been a third copy. So before any native work: **one scene renderer.**

## Decisions (from LapWing plan 0001, owner-approved)

- The TS Canvas2D scene renderer is the single source of truth for overlay
  VFX. Preview hosts it; export calls it; the native shell will call it for
  overlay layers over IPC.
- Web keeps its existing WebCodecs/mp4-muxer exporter unchanged.
- Anything time-based in a widget is driven by **data time**, never
  wall-clock, so a paused preview, an exported frame, and a native frame at
  time t are pixel-identical.

## Design

`lib/overlayCanvasRenderer.ts` is now the whole drawing surface:

- **Per-type draw functions are exported** (`drawDigital` … `drawLapTime`)
  and take an `OverlayLayout` (top-left px + scaled font size).
- **`measureOverlay()`** returns the box a draw paints into; the draws use
  the same math (most call it for their own box), so a host canvas can never
  disagree with the drawing.
- **`OverlayLabels`** carries every user-facing string; React callers build
  it from the `video` namespace's `widgets.*` translations,
  `DEFAULT_OVERLAY_LABELS` keeps non-React callers in English. Exports are
  no longer English-only.
- **`components/video-overlays/OverlayCanvas.tsx`** is the one preview host:
  a canvas sized by `measureOverlay`, drawn by `drawOverlayInstance`, with
  the theme glow filter and (for the formerly-DOM boxy widgets) a backdrop
  blur as the only CSS-side extras. The nine per-type components are gone.
- **Sector state machine extracted** to
  `sectorUtils.computeSectorDisplayStates()` (it existed twice, in
  `SectorOverlay` and `drawSector`); it also reports `completedAtMs`, which
  drives the **completion sweep in data time** (`SECTOR_SWEEP_MS`) — the old
  wall-clock CSS sparkle is replaced by a sweep that now also appears in
  exports, on the exact frames where the sector completed.
- Fidelity that existed on only one side is now on both: grid lines, glow
  shadows, bubble center dot, pace SLOW/FAST labels, preview's map framing
  (line follows the visible range, bounds follow the whole session), and
  the preview's pace-bar stacking and delta formatting win where the two
  disagreed.

Known, deliberate non-parities: the backdrop blur only exists in the preview
(an export has no page behind it to blur — same as before), and box widths
use the tuned monospace estimates rather than DOM auto-sizing.

## The native contract (what LapWing consumes)

The native burn-in path renders overlay RGBA layers by calling
`renderOverlaysToCanvas` (or per-type draws) in the WebView at requested
data timestamps, and composites them onto natively-decoded frames. Because
export and preview already share this exact code, native output matches both
by construction. Nothing in this repo needs to know about the native
pipeline beyond keeping this module's contract stable.

## Verification

- `overlayCanvasRenderer.test.ts`: box measurement, label injection, graph
  history capping, grid-line fidelity, sector display states (active /
  first / best / slower / outlap, deltas), the data-time sweep window, and
  the render loop's visibility gate — recording-stub context, no DOM.
- Full suite, `tsc -b`, `eslint`, and `vite build` green.
- Manual: preview a session with all nine widgets, export a lap, compare
  frames against the preview paused at the same time.
