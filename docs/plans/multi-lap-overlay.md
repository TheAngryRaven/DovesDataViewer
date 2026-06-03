# Plan: Multi-lap racing-line overlay on the map

Status: **Phase 1 in progress** · Branch: `claude/multi-lap-overlay-minimap` → PR into `BETA`

Origin: addresses the Reddit critique that the tool can't "align the lines from
different stints on the map" (a feature AiM Race Studio 3 lost from v2). Builds on
the distance-axis (#121) and G-G diagram (#125) work in the race-data-analysis arc.

---

## Phase 1 (this PR) — overlay current-session laps + snapshots on the pro map

**Decisions (locked with the user):**
- Sources: **current-session laps + lap snapshots**.
- Spatial drift-correction: **deferred to phase 2** (raw absolute GPS for now).
- Selection UX: **per-lap toggle in the lap list** (LapTable) + per-snapshot toggle
  in LapSnapshotControls.
- Surface: **all four data views** — both maps (RaceLineView + MiniMap) **and** both
  chart types (TelemetryChart speed + SingleSeriesChart per-series), with per-lap
  values in the cursor tooltip. (Originally scoped to the MiniMap only; expanded
  mid-phase-1 once the maintainer clarified the overlays should be full comparison
  lines on the graphs too.)
- **Current lap always on top** in every view.

**Behavior**
- Overlay any number of selected laps/snapshots as solid distinct-colored lines on
  the GraphView MiniMap, beneath the active speed-heatmap line, above the grey
  reference.
- A small legend on the MiniMap (color swatch + label + ✕ to remove) for in-context
  visibility/removal, since selection happens in another tab.
- Map auto-fits to include overlay extents (snapshots can run slightly outside the
  current lap's bounds).

**Data model**
```ts
interface OverlayLine { id: string; label: string; color: string; samples: GpsSample[]; }
```
- Stable ids: `lap:<n>`, `snap:<snapshotId>`. Deterministic palette colors
  (chosen not to clash with the speed heatmap or the grey reference).

**Files**
- New `src/lib/lapOverlays.ts` (+ `.test.ts`) — pure: id format/parse, palette/color
  assignment, `resolveOverlayLines(selections, laps, sessionSamples, snapshots)` →
  `OverlayLine[]`, `unionBounds(...)`.
- New `useLapOverlays` hook — `overlaySelections: string[]`, `toggleOverlay(id)`,
  `clearOverlays()`, derived `overlayLines`.
- `SessionContext` + `Index.tsx` — thread `overlayLines`, `overlaySelections`,
  `onToggleOverlay` to tabs.
- `MiniMap.tsx` — new `overlayLinesLayer` (one `L.polyline` per line, rebuilt only
  when the set changes, not on scrub); legend; union-bounds fit.
- `LapTable.tsx` — per-row overlay toggle + color swatch (next to "Set Ref").
- `LapSnapshotControls.tsx` — per-snapshot overlay toggle.
- CHANGELOG + CLAUDE.md.

**Verification**: unit tests for `lapOverlays` + lint/typecheck/test/build gate.
Visual map check is on the user (headless-browser screenshot blocked in the agent
sandbox).

---

## Phase 1.5 (done) — overlays everywhere

Pulled forward from the original phase-2 list mid-phase-1:
- ✅ **Simple-mode RaceLineView** overlay parity (racing lines + legend).
- ✅ **Per-overlay traces on the charts** (`TelemetryChart` speed + `SingleSeriesChart`
  per-series), distance-aligned via `alignByDistance`, with per-lap cursor-tooltip
  values. Current lap always on top.

## Phase 2 (done) — alignment + external sources

These two were one feature in practice (external laps are what introduce real drift),
and together they close the "align data from different loggers" half of the critique.

- ✅ **External / cross-logger file overlays**: laps from *other saved files* are an
  overlay source — id kind `file:<lap>\x1f<name>`, loaded/parsed on demand and cached
  in `useLapOverlays`, picked via `OverlayFilePicker`.
- ✅ **Spatial drift-correction**: an **Align lines** toggle (map legend, default on)
  rigidly registers cross-session overlays (`snap:`/`file:`) onto the current lap via
  `lib/lapAlignment.ts` (2D closed-form Kabsch: rotation + translation, with a
  rotation guard). Map-only — charts compare by distance and are transform-invariant.
  Same-session `lap:` overlays are never transformed (shared receiver).

## Possible future polish (not planned)
- Surface the align toggle / external picker in the post-UI-rework layout.
- Per-overlay clouds on the G-G diagram.
- Let the synthetic pace / brake-% pro charts overlay too.

---

## Notes / caveats
- Cross-tab nuance: toggles live in the lap list (LapTimes tab); lines render on the
  pro MiniMap. State persists via SessionContext; the map legend softens it. The user
  is contemplating broader UI changes, so this placement is "best for now."
- Snapshot overlays draw at raw GPS in phase 1 → may sit a few meters off the current
  lap until phase-2 alignment lands. Same-session lap overlays register exactly.
