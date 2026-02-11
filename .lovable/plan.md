

# Modularize Tabs, Bind Telemetry Chart to Race Line, Add Graph View Placeholder

## Overview

Refactor the top panel into modular tab components and restructure the layout so the telemetry chart is part of the Race Line view (not a global bottom panel). Add a new "Graph View" tab as a placeholder for future per-series graph panels.

## Layout Change

Currently the layout is a vertical split: top panel (race line OR lap table) and bottom panel (telemetry chart + range slider, always visible). After this change:

- **Race Line tab**: Shows the resizable split with race line on top, telemetry chart + range slider on bottom (same as today)
- **Lap Times tab**: Shows just the lap table (full height, no chart below)
- **Graph View tab**: Placeholder for now (full height)

The telemetry chart and range slider move from being a global bottom panel into being part of the Race Line tab's content.

## New File Structure

| File | Purpose |
|------|---------|
| `src/components/tabs/RaceLineTab.tsx` | Contains the resizable split: RaceLineView (top) + TelemetryChart + RangeSlider (bottom) |
| `src/components/tabs/LapTimesTab.tsx` | Wraps LapTable with all its props |
| `src/components/tabs/GraphViewTab.tsx` | Placeholder with info text about upcoming per-series graphing |

## Step-by-Step

### 1. Create `RaceLineTab.tsx`
Extracts the full resizable split panel content from Index.tsx -- includes RaceLineView, TelemetryChart, and RangeSlider. Receives all needed props from Index.tsx.

### 2. Create `LapTimesTab.tsx`
Thin wrapper around LapTable. Takes the same props currently passed to LapTable.

### 3. Create `GraphViewTab.tsx`
Placeholder component with a centered icon (e.g., `BarChart3`) and text like:
- "Graph View -- Coming Soon"
- "Individual telemetry channels with independent scales"

### 4. Refactor `Index.tsx`
- Add `"graphview"` to the `TopPanelView` type
- Add a third tab button with a chart icon
- Remove the `ResizableSplit` wrapper from Index.tsx -- each tab now manages its own full-height content
- Race Line tab renders its own `ResizableSplit` internally (with the chart bound inside it)
- Lap Times and Graph View tabs take the full panel height
- The tab container becomes a simple full-height area that swaps between the three tab components

### 5. Future-proof TelemetryChart
No changes to TelemetryChart now. The future Graph View will use **new, simpler chart components** -- each rendering 1-2 series with their own Y-axis. The existing TelemetryChart stays as the multi-series overview bound to the Race Line tab.

## Technical Notes

- State remains centralized in Index.tsx; tab components are presentational
- The range slider state (`visibleRange`) stays in Index.tsx since it affects scrubbing and other cross-cutting concerns
- Tab components receive props via a clean interface -- no prop drilling beyond one level
- The `ResizableSplit` component moves from wrapping the entire data view to being internal to `RaceLineTab`

