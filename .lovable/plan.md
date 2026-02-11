
# Graph View Tab - Full Implementation Plan

## Overview
Build the Graph View tab as a complex multi-panel analysis view with synchronized graphs, a mini map, and an info box displaying session/kart data. The layout is a 30/70 vertical split (left sidebar / right graph area).

## Layout Structure

```text
+---------------------------+----------------------------------------------+
|  LEFT PANEL (30%)         |  RIGHT PANEL (70%)                           |
|                           |                                              |
|  +---------------------+ |  +------------------------------------------+|
|  | INFO BOX (70%)       | |  | GRAPH 1 (Speed)              [X delete] ||
|  | [Data] [Kart] tabs   | |  |                                          ||
|  |                      | |  +------------------------------------------+|
|  | Data tab:            | |  | GRAPH 2 (RPM)                [X delete]  ||
|  |  - Lap time          | |  |                                          ||
|  |  - Avg top/min speed | |  +------------------------------------------+|
|  |  - Deltas            | |  |                                          ||
|  |  - Weather (full)    | |  |     [+ Add Graph] button                  ||
|  |                      | |  |                                          ||
|  | Kart tab:            | |  +------------------------------------------+|
|  |  - Kart name/number  | |  | RANGE SLIDER (crop bar)                  ||
|  |  - Full setup data   | |  +------------------------------------------+|
|  +---------------------+ |                                              |
|  +---------------------+ |                                              |
|  | MAP (30%)            | |                                              |
|  | [cycle] [brake][spd] | |                                              |
|  | [hide map]           | |                                              |
|  +---------------------+ |                                              |
+---------------------------+----------------------------------------------+
```

## Files to Create

### 1. `src/components/graphview/GraphViewPanel.tsx`
The main Graph View layout component. Renders the 30/70 horizontal split using CSS flexbox or the resizable panels library. Receives all necessary props from Index.tsx.

### 2. `src/components/graphview/SingleSeriesChart.tsx`
A reusable canvas-based chart that renders ONE data series with its own Y-axis scale. Props:
- `samples: GpsSample[]` -- the visible samples
- `seriesKey: string` -- which data to plot (e.g. "speed", "RPM", "Lat G", etc.)
- `currentIndex: number` -- synced cursor position
- `onScrub: (index: number) => void` -- cursor sync callback
- `useKph: boolean`
- `color: string`
- `label: string`
- `onDelete: () => void`

This reuses the canvas rendering patterns from `TelemetryChart.tsx` (grid drawing, scrub line, glitch filtering for speed) but simplified to one series with its own independent min/max scale.

### 3. `src/components/graphview/GraphPanel.tsx`
The right 70% panel. Manages:
- An array of active graph series (state: `activeGraphs: string[]`)
- The "+ Add Graph" dropdown (lists available data sources not yet added)
- Scrollable container of `SingleSeriesChart` instances
- The `RangeSlider` at the bottom
- Cursor sync: passes the same `currentIndex` and `onScrub` to all charts

### 4. `src/components/graphview/InfoBox.tsx`
The upper-left info panel with two tabs:
- **Data tab**: Extracts the stats overlay logic currently in `RaceLineView.tsx` (lap time, avg top/min speed, deltas, weather) into a reusable display. Weather data is shown inline (always visible, no toggle needed).
- **Kart tab**: Displays the kart name/number and full setup dataset if linked to the session. If no kart/setup is linked, shows selectors (reusing the same pattern from `NotesTab.tsx`). An "Edit" button opens the Garage drawer with the setup loaded.

### 5. `src/components/graphview/MiniMap.tsx`
A simplified version of `RaceLineView` for the bottom-left panel:
- Shows the race line with speed heatmap coloring
- Shows braking zones and speed event markers
- Toggle buttons (icon-only) in the upper-right for braking/speed events
- Map style cycle button in upper-left
- "Hide map" toggle button at bottom of panel
- No stats overlay, no weather panel, no reference line
- Syncs the cursor position (shows the arrow marker)

## Files to Modify

### 6. `src/components/tabs/GraphViewTab.tsx`
Replace the placeholder with `GraphViewPanel`, passing through all props from Index.tsx.

### 7. `src/pages/Index.tsx`
Pass additional props to `GraphViewTab`:
- All the data props (samples, laps, field mappings, visible range, etc.)
- Kart/setup data (karts, setups, sessionKartId, sessionSetupId)
- Weather props
- Map-related props (bounds, course, braking zone settings)
- Scrub/range handlers

## Reusability Strategy

### Stats Data Module
Extract the stats computation (avg top speed, avg min speed, delta calculations) that currently lives inline in `RaceLineView.tsx` and `Index.tsx` into a shared utility or a custom hook. Both the Race Line view's overlay and the Graph View's Info Box will consume the same computed values from Index.tsx via props -- no duplication needed since Index.tsx already computes all of this.

### Chart Rendering
`SingleSeriesChart` will reuse the canvas rendering patterns from `TelemetryChart`:
- Same grid drawing code
- Same scrub cursor rendering
- Same glitch filtering for speed series
- Same G-force smoothing logic
- Simplified to single series with own Y-axis auto-scaling

### Map Component
`MiniMap` will reuse the core Leaflet setup from `RaceLineView`:
- Same map initialization pattern
- Same race line drawing with speed heatmap
- Same braking zone rendering
- Same speed event markers
- Same arrow cursor marker
- Stripped of overlay panels, weather, and reference line

## Data Flow

```text
Index.tsx (state owner)
  |
  +---> GraphViewTab (props pass-through)
          |
          +---> GraphViewPanel
                  |
                  +---> InfoBox
                  |       +---> Data tab (stats, weather)
                  |       +---> Kart tab (kart info, setup details)
                  |
                  +---> MiniMap (simplified RaceLineView)
                  |
                  +---> GraphPanel
                          +---> SingleSeriesChart (x N, synced cursor)
                          +---> RangeSlider (reused component)
```

## Available Data Sources for Graph Dropdown
The dropdown will list:
- "Speed" (always available -- uses `speedMph`/`speedKph`)
- Each entry from `fieldMappings` (e.g., "RPM", "Temp", "Lat G", "Lon G", etc.)
- Sources already added are excluded from the dropdown

## Cursor Synchronization
All `SingleSeriesChart` instances share the same `currentIndex` state from Index.tsx. When any chart is scrubbed, it calls `onScrub` which updates `currentIndex` in Index.tsx, which propagates to all charts AND the MiniMap's arrow marker. This ensures perfect synchronization.

## Technical Notes
- The left panel uses a vertical split (70/30) via CSS flexbox with the map collapsible via a toggle
- When the map is hidden, the info box expands to fill the full left panel height
- The right panel's graph area is scrollable (`overflow-y: auto`) to accommodate many graphs
- The RangeSlider is fixed at the bottom of the right panel (not scrollable)
- Each SingleSeriesChart has a fixed minimum height (e.g., 150px) to remain usable
- The delete button (X icon) sits in the upper-right corner of each chart
- The "+ Add Graph" button appears below the last chart (or centered if no charts exist)
