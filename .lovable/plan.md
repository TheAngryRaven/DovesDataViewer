
# Optimize "All Laps" Initial Load

## Problem
At 25Hz over 10+ minutes, "All Laps" dumps 15,000+ samples into the renderer at once, causing lag. Speed event markers and braking zone overlays add further overhead on an already dense view.

## Solution -- Three Automatic Optimizations

### 1. Auto-crop to first minute via range slider
In `src/hooks/useLapManagement.ts`, modify the `visibleRange` reset effect (lines 30-34). When `selectedLapNumber` is `null` (All Laps mode) and the session has more than ~1500 samples (~1 minute at 25Hz), set the initial visible range to `[0, 1499]` instead of `[0, length-1]`. The user can still drag the range slider to see the full session -- this only affects the initial crop.

### 2. Auto-disable speed event markers
In `src/components/RaceLineView.tsx` and `src/components/graphview/MiniMap.tsx`, accept a new `isAllLaps` boolean prop. Add a `useEffect` that watches `isAllLaps` -- when it becomes `true`, set `showSpeedEvents` to `false`; when it becomes `false` (single lap selected), set it back to `true`.

### 3. Auto-disable braking zones
Same pattern as speed events: when `isAllLaps` becomes `true`, set `showBrakingZones` to `false`; restore to `true` when a single lap is selected.

## File Changes

### `src/hooks/useLapManagement.ts`
- Modify the `useEffect` at lines 30-34 that resets `visibleRange`
- When `selectedLapNumber === null` and `filteredSamples.length > 1500`, set range to `[0, 1499]`
- Otherwise keep existing behavior (full range)

### `src/components/RaceLineView.tsx`
- Add `isAllLaps?: boolean` to the props interface
- Add `useEffect` reacting to `isAllLaps` changes to toggle `showSpeedEvents` and `showBrakingZones` off/on

### `src/components/graphview/MiniMap.tsx`
- Same as RaceLineView: add `isAllLaps` prop and auto-toggle effect

### `src/components/tabs/RaceLineTab.tsx`
- Thread `isAllLaps` prop through to `RaceLineView`

### `src/components/graphview/GraphViewPanel.tsx`
- Thread `isAllLaps` prop through to `MiniMap`

### `src/components/tabs/GraphViewTab.tsx`
- Thread `isAllLaps` prop through to `GraphViewPanel`

### `src/pages/Index.tsx`
- Derive `isAllLaps = selectedLapNumber === null`
- Pass it to `RaceLineTab` and `GraphViewTab`

## Behavior Summary
- Selecting "All Laps": range crops to first minute, speed events off, braking zones off
- Selecting a specific lap: full lap visible, speed events on, braking zones on
- User can always manually re-enable overlays or expand the range slider
