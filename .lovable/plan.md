
# Resample Layouts Button

## Overview
Add a "Resample" button to the left of the "Generate Course Mapping" button in the Layouts Overview section. When clicked, it resamples ALL displayed polylines to evenly spaced points (~5 meters apart), updating the overview map visually but NOT saving to the database. This normalizes point density from hand-drawn input and produces smoother, prettier lines.

## What Changes

### 1. New utility: `resamplePolyline` in `src/lib/trackUtils.ts`
A pure function that takes an array of `{lat, lon}` points and a target spacing in meters, and returns a new array of evenly spaced points interpolated along the original path.

Algorithm:
- Walk along the polyline segment by segment using haversine distance (already available in `parserUtils.ts`)
- Accumulate distance; when it exceeds the target spacing, interpolate a new point at that exact distance along the current segment
- Result: uniform ~5m spacing regardless of original point density

### 2. Resample button in CoursesTab Layouts Overview header
- Add a "Resample" button to the left of the existing "Generate Course Mapping" button
- Only enabled when there are layouts to resample
- On click: iterate over all `trackLayouts`, resample each one's `layout_data`, and update the `trackLayouts` state with the resampled data
- This updates the overview map immediately (polylines redraw) but does NOT call `db.saveLayout()` -- purely visual/in-memory
- The button could show a small toast or the point counts change visibly on the map

### 3. No database changes
The resampled data stays in React state only. Navigating away or reloading discards it.

## File Changes

| File | Change |
|------|--------|
| `src/lib/trackUtils.ts` | Add `resamplePolyline(points, spacingMeters)` function |
| `src/components/admin/CoursesTab.tsx` | Add Resample button, wire it to update `trackLayouts` state in-memory |

## Technical Details

The `resamplePolyline` function:
```text
Input:  [{lat, lon}, ...] (N points, irregular spacing)
Output: [{lat, lon}, ...] (M points, ~5m spacing)

1. For each consecutive pair of points, compute haversine distance
2. Walk along accumulated distance, emitting a new point every 5m
3. Interpolate lat/lon linearly between segment endpoints at each emission
4. Always include the first point; last point is the final emission
```

Uses `haversineDistance` from `parserUtils.ts` (already exists). Linear interpolation is fine at GPS scales (sub-km segments).
