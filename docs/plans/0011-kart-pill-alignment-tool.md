# 0011 — Kart Pill Alignment Calculator (tools plugin)

## Goal / problem

Karts with OTK-style eccentric kingpin pills (Tony Kart and the CompKart /
Birel / Kart Republic 22 mm-bore dial clones) set front camber/caster by
rotating two eccentric pills per side. Getting from "I want −0.9° camber" to
"turn the top pill here, the bottom pill there" is two-link planar geometry
that people currently do by trial and error or with paid standalone
calculators. We already ship setup storage and telemetry — the calculator
belongs in the Tools tab, fully offline (it's a paddock tool with no signal).

The math was reverse-engineered from a reference app and hand-specced before
this plan (forward model, two-circle inverse, envelope sweep, calibration
constants). This plan records how it landed in the codebase.

## Approach & key decisions

- **Pure TypeScript, no Rust/WASM.** The reference spec suggested a Rust
  crate; rejected here. The envelope sweep is ~32k trig evaluations (<5 ms in
  JS, memoized, recomputed only when pill sizes or calibration change), and
  this repo is TS-only — the sole WASM (xrk importer) exists for a binary
  format, not speed. Math lives in pure `.ts` modules inside the tools plugin
  so it lands in Vitest coverage scope (`components/**/*.tsx` is excluded).
- **Tools-plugin tool, not a page.** One `ToolDef` entry in
  `src/plugins/tools/toolList.ts` surfaces the tool both in the in-session
  Tools tab and the landing-page Tools drawer — no host/framework changes.
  Follows the seat-position convention: pure modules + tests, thin `.tsx`.
- **Modular chassis-profile system, built for measurement.** Real
  eccentricities (mm offset per dot count) are not published for any brand,
  so calibration is a first-class `ChassisProfile` record (`profiles.ts`)
  rather than hardcoded presets. Built-ins cover the common eccentric-pill
  brands (Generic, OTK/Tony Kart, Kart Republic, CompKart, Birel ART, Praga,
  Sodi), all flagged `source: "estimated"` — placeholders sharing the 22 mm
  dial geometry until someone measures the real numbers. The workflow the
  system is designed around: measure a chassis (the calibration panel has
  helpers — dial-indicator sweep over 180° → e = sweep/2, and a zero-point
  back-out that inverts the forward model from gauge readings at size-0
  pills), then "save as measured profile" freezes the constants as a named
  user profile (plugin store, `pill-alignment:profiles:v1`). Adding a newly
  measured brand later = one entry in `BUILTIN_PROFILES`. Every constant
  stays hand-editable; any edit detaches the active profile. A least-squares
  multi-config fit is a future follow-up.
- **Angle convention.** Dial angle 0° = dot forward, positive toward
  outboard, per corner — so identical dial settings on both sides produce
  symmetric camber by default. A `mirrorRight` calibration flag negates
  right-side angles for users whose physical reference is a fixed global
  handedness (cos unchanged → caster identical; sin flips → lateral mirrors).
  Tests lock the internal convention so UI semantics can flip via the flag
  without touching math.
- **Drag never dead-ends.** Dragging the envelope setpoint outside the
  reachable annulus `[|e_t−e_b|, e_t+e_b]` for the chosen pill sizes projects
  the target radially onto the annulus boundary (`nearestAngles`), then picks
  the two-circle elbow nearest the current angles — the marker always lands
  somewhere physical.
- **Resultant-toe color mode is a labelled heuristic.** The reference app's
  color modes are themselves heuristics per the spec. Per-point resultant toe
  = user's static per-side toe + `toeCouplingMmPerMm · Δwheelbase(point)`,
  coupling constant editable in calibration. Full 3D steer kinematics
  deferred. Computed at draw time over the cached sweep so toe edits recolor
  without re-sweeping.

## Touch points

```
src/plugins/tools/pill-alignment/
├── model.ts / model.test.ts       types, calibration, forwardCorner, snapToHole, measurement helpers, persisted state
├── profiles.ts / profiles.test.ts chassis-profile system: built-in brands + user "measured" profile CRUD
├── inverse.ts / inverse.test.ts   findSetups (two-circle Find Setup), nearestAngles (drag-solve)
├── envelope.ts / envelope.test.ts sweepEnvelope, singlePillLoci, color buckets + ramp
├── toe.ts / toe.test.ts           tie-rod→toe, toe-mm, resolveSetupAlignmentFields (session setup read)
├── PillAlignmentTool.tsx          state, plugin-store persistence, layout
├── EnvelopePlot.tsx               two-layer canvas scatter (GGDiagram pattern), draggable setpoint
├── PillDial.tsx                   SVG hub dial ×4, drag-to-rotate, keyboard steps
├── OverheadToeView.tsx            SVG overhead toe widget
├── FindSetupPanel.tsx             target → ranked candidates → Apply
└── CalibrationPanel.tsx           advanced constants + presets
src/plugins/tools/shared/          NumRow + Section lifted out of SeatPositionTool for reuse
src/plugins/tools/toolList.ts      + pill-alignment entry (the only wiring)
src/plugins/tools/locales/*.json   + pillAlignment.* / pill.* keys (all 7 languages)
CHANGELOG.md, CLAUDE.md            user-facing entry + architecture-map line
```

Persistence: `getPluginStore("tools")`, key `"pill-alignment:v1"` —
calibration, presetId, per-side pills, linked L/R flag, active side, color
mode, hole-snap, toe inputs.

## Status / phasing

- **Phase 1 (done):** forward model, envelope plot with draggable setpoint +
  single-pill loci, 4 SVG pill dials, readouts, Find Setup solver,
  calibration panel with presets.
- **Phase 2 (done):** toe inputs (tie-rod or per-side), overhead toe SVG,
  resultant-toe color mode, camber deg⇄mm readout, read-only "load from
  session setup" (default-template ids `f-toe`/`f-camber`/`f-castor`,
  name-matched fallback for custom templates).
- **Phase 3 (follow-up, not built):** simulated laser-board visualiser
  ("sniper"-style) — pure projection `beamX = d·tan(toe)`,
  `beamY = d·tan(camber)` per side on an SVG board with graduations; one
  `boardDistanceMm` state field. Do last, after the calculator has earned
  trust against real gauges.
- **Future:** per-chassis least-squares calibration fit from measured
  configs; telemetry link (stamp sessions with alignment, data-derived grip
  coloring on the envelope).
