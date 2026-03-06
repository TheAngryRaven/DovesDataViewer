

# Video Overlay System Rework + Video Export

## Summary

Replace the single hardcoded speed overlay with a modular, themeable gauge system supporting multiple overlay types, each bound to any available data source. Add video export with overlays rendered via canvas compositing.

## Architecture

```text
src/
├── components/
│   ├── VideoPlayer.tsx              # Refactored: renders overlay instances from config
│   ├── video-overlays/
│   │   ├── types.ts                 # OverlayConfig, OverlayType, ThemeId, DataSourceDef
│   │   ├── registry.ts              # Available overlay types + factory
│   │   ├── themes.ts                # Theme definitions (2 themes: "classic", "neon")
│   │   ├── dataSourceResolver.ts    # Maps data source IDs → current value + min/max/unit
│   │   ├── DigitalOverlay.tsx       # Number + unit display
│   │   ├── AnalogOverlay.tsx        # Needle gauge (canvas arc)
│   │   ├── GraphOverlay.tsx         # Mini line chart (canvas, configurable length/color)
│   │   ├── BarOverlay.tsx           # Horizontal 0-100 progress bar
│   │   ├── BubbleOverlay.tsx        # XY joystick-style circular widget
│   │   ├── MapOverlay.tsx           # Mini race line (reuses Leaflet or canvas)
│   │   ├── PaceOverlay.tsx          # Horizontal pace indicator (green/red around zero)
│   │   ├── SectorOverlay.tsx        # 3 sector bubbles with delta + animation
│   │   ├── OverlaySettingsPanel.tsx # Add overlay menu + list of configured overlays
│   │   └── VideoExportDialog.tsx    # Export dialog with quality/overlay options
│   └── ...
├── lib/
│   └── videoExport.ts               # Canvas compositing + MediaRecorder export logic
└── ...
```

## Data Model

### OverlayConfig (stored in VideoSyncRecord.overlaySettings)

```typescript
interface OverlayInstance {
  id: string;                    // uuid
  type: OverlayType;            // "digital" | "analog" | "graph" | "bar" | "bubble" | "map" | "pace" | "sector"
  dataSource: string;           // "speed" | "__pace__" | "__braking_g__" | field name | "lat_g+lon_g" (bubble)
  dataSourceSecondary?: string; // For bubble (Y axis)
  theme: ThemeId;               // "classic" | "neon"
  colorMode: "light" | "dark";
  opacity: number;              // 0-1
  position: OverlayPosition;    // {x, y, scale}
  // Type-specific config
  color?: string;               // graph/bar line color
  graphLength?: number;         // graph: number of samples to show
  showAnimation?: boolean;      // sector: sparkle toggle
}

// Replaces current OverlaySettings
interface OverlaySettings {
  overlaysLocked: boolean;
  overlays: OverlayInstance[];
}
```

Backward compat: if old `showSpeed` + `positions.speed` exist, migrate to a single `DigitalOverlay` instance on first load.

### DataSourceDef

```typescript
interface DataSourceDef {
  id: string;           // "speed", "__pace__", field name, etc.
  label: string;        // "Speed (KPH)", "Throttle", etc.
  getValue: (sample: GpsSample) => number | null;
  getMin: (samples: GpsSample[]) => number;
  getMax: (samples: GpsSample[]) => number;
  unit: string;
}
```

The resolver reuses the same `availableSources` logic from `GraphPanel.tsx` — speed, pace, braking G, plus all `fieldMappings` extra fields.

## Overlay Types Detail

| Type | Rendering | Data | Config |
|------|-----------|------|--------|
| **digital** | DOM: number + unit label | Any single source | — |
| **analog** | Canvas: arc needle gauge, ~200° sweep, unit in center | Any single source | — |
| **graph** | Canvas: rolling line chart | Any single source | `color`, `graphLength` (samples) |
| **bar** | DOM/SVG: horizontal 0→100% bar | Any single source (maps min→max to 0→100) | `color` |
| **bubble** | Canvas: circle with center dot, 2 rings, XY dot | Two sources (primary=X, secondary=Y) | — |
| **map** | Mini canvas race line with position dot | Uses lat/lon from current sample directly | — |
| **pace** | DOM/SVG: horizontal bar, center=0, green right, red left | Uses pace data from reference lap system | — |
| **sector** | DOM: 3 bubbles showing sector deltas | Uses current lap sectors vs session-best sectors | `showAnimation` |

## Themes

Two visual themes to start, applied via CSS classes and canvas draw params:

- **"classic"**: Dark semi-transparent backgrounds, white text, simple borders. Clean motorsport HUD feel.
- **"neon"**: Glowing edges, slightly saturated colors, subtle drop shadows. More "gaming" aesthetic.

Each theme defines: `bgColor`, `textColor`, `accentColor`, `borderStyle`, `needleColor`, `ringColor`, `glowFilter` (for neon).

Per-overlay `colorMode` (light/dark) adjusts the base bg opacity and text contrast within the theme.

## Sector Overlay Special Behavior

- 3 bubbles: `( -0.123 )( +1.203 )( -0.300 )`
- Delta = current sector time - best sector time of the session
- Purple background: fastest sector of session (new best)
- Red: slower than best
- Green: first lap (no comparison yet)
- Grey/transparent: outlap or 0.00
- Animation (toggleable): on sector completion, a progress-bar sweep fills the bubble; on purple (new best), a subtle CSS shimmer/shine keyframe animation
- Animation uses CSS `@keyframes` with a `background-position` shimmer trick

## Overlay Settings Panel (replaces current dialog)

Top section: "Add Overlay" dropdown (type) + "Add" button → opens inline config:
- Select data source (dropdown of available sources)
- Select theme (classic/neon)
- Light/Dark toggle
- Opacity slider
- Type-specific options (color picker for graph, graph length slider, animation toggle for sector, secondary data source for bubble)

Below: list of configured overlays with:
- Type icon + data source label
- Toggle visibility
- Delete button
- Tap to edit (expand inline)

## Video Export

### `VideoExportDialog.tsx`
- Toggle: include overlays (default on)
- Quality: "Standard" (720p) / "High" (original resolution)
- Export button → shows progress bar
- Cancel button

### `videoExport.ts` — Export Pipeline
1. Create offscreen `<canvas>` at target resolution
2. Create `<video>` element from source
3. Step through video frame-by-frame using `requestVideoFrameCallback`
4. For each frame:
   - Draw video frame to canvas
   - If overlays enabled: render each overlay to canvas at its position/scale (this is why WYSIWYG matters — overlays must render identically to canvas as they do to DOM)
5. Use `canvas.captureStream()` + `MediaRecorder` to encode
6. Collect chunks → create blob → trigger download

**WYSIWYG constraint**: Overlay rendering functions must be able to target both DOM (live preview) and Canvas (export). For simple overlays (digital, bar, pace, sector), we render to a temporary offscreen canvas during export. For canvas-based overlays (analog, graph, bubble), they already draw to canvas so we just draw them at the right position on the export canvas.

**Quality presets**:
- Standard: 720p height, maintain aspect ratio, 30fps, ~5Mbps bitrate
- High: original video resolution, original fps, ~15Mbps bitrate

## Props Changes

`VideoPlayer` needs additional props to support the overlay system:
- `samples` (visible range) — for graph overlay history + data resolution
- `allSamples` — for min/max computation
- `fieldMappings` — to build available data sources
- `laps` + `selectedLapNumber` — for sector overlay
- `referenceSamples` + `paceData` — for pace overlay
- `course` — for map overlay

These will be threaded from `Index.tsx` → `GraphViewPanel` → `InfoBox` → `VideoPlayer`.

## File Changes

| File | Action |
|------|--------|
| `src/components/video-overlays/types.ts` | **New** — all types |
| `src/components/video-overlays/registry.ts` | **New** — overlay type registry |
| `src/components/video-overlays/themes.ts` | **New** — classic + neon theme defs |
| `src/components/video-overlays/dataSourceResolver.ts` | **New** — builds available sources from samples + fieldMappings |
| `src/components/video-overlays/DigitalOverlay.tsx` | **New** |
| `src/components/video-overlays/AnalogOverlay.tsx` | **New** |
| `src/components/video-overlays/GraphOverlay.tsx` | **New** |
| `src/components/video-overlays/BarOverlay.tsx` | **New** |
| `src/components/video-overlays/BubbleOverlay.tsx` | **New** |
| `src/components/video-overlays/MapOverlay.tsx` | **New** |
| `src/components/video-overlays/PaceOverlay.tsx` | **New** |
| `src/components/video-overlays/SectorOverlay.tsx` | **New** |
| `src/components/video-overlays/OverlaySettingsPanel.tsx` | **New** — replaces old dialog content |
| `src/components/video-overlays/VideoExportDialog.tsx` | **New** |
| `src/lib/videoExport.ts` | **New** — canvas compositing + MediaRecorder |
| `src/lib/videoStorage.ts` | Update `OverlaySettings` type, add migration from old format |
| `src/hooks/useVideoSync.ts` | Update to new `OverlaySettings` shape |
| `src/components/VideoPlayer.tsx` | Major rewrite — render overlay instances, pass new props, add export button |
| `src/components/graphview/InfoBox.tsx` | Thread new props through to VideoPlayer |
| `src/components/graphview/GraphViewPanel.tsx` | Thread new props |
| `src/pages/Index.tsx` | Pass additional data (fieldMappings, laps, paceData, etc.) to graph view |
| `src/index.css` | Add shimmer/sparkle keyframes for sector animation |
| `CLAUDE.md` | Document new overlay system |
| `README.md` | Document video export feature |

## Implementation Order

1. **Types + themes + data source resolver** — foundation
2. **OverlaySettings panel** — add/remove/configure overlays
3. **Digital + Analog overlays** — most immediately useful
4. **Bar + Graph overlays** — straightforward canvas work
5. **Pace + Map overlays** — special data sources
6. **Bubble overlay** — dual data source
7. **Sector overlay** — most complex (session-best tracking, animation)
8. **Video export** — canvas compositing pipeline
9. **Prop threading** — connect everything through the component tree
10. **Migration** — old overlay settings → new format

