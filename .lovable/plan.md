

## Add "Braking G" as a Virtual Graph Channel

### What This Does
Adds a new selectable "Braking G" channel in Graph View that plots the **continuous smoothed longitudinal acceleration** (in G) used by the braking zone detector. This gives you a time-series view of deceleration intensity across the entire session, not just the discrete zones.

### How It Works

The existing `detectBrakingZones` function already calculates a smoothed acceleration value at every sample point using exponential smoothing and your configured thresholds. Currently, that per-sample signal is thrown away and only the detected zone boundaries are returned. The plan is to expose that continuous signal.

### Implementation Steps

**1. New utility function in `brakingZones.ts`**

Add a `computeBrakingGSeries()` function that runs the same smoothed longitudinal acceleration math as `detectBrakingZones`, but returns a `number[]` array (one value per sample) instead of zone objects. This reuses the same config (entry/exit thresholds, smoothing alpha) from settings.

**2. Register as a virtual channel in `GraphPanel.tsx`**

- Add `"__braking_g__"` to `availableSources` (always available, like speed -- no reference lap needed)
- Compute the series using `computeBrakingGSeries(filteredSamples, config)` in the existing `useMemo` block
- Pass braking zone settings into `GraphPanel` (they already flow to `GraphViewPanel` via `brakingZoneSettings`)
- Slice the computed values by `visibleRange` for rendering, same as other channels

**3. Rendering in `SingleSeriesChart.tsx`**

- Detect `isBrakingG` via `seriesKey === '__braking_g__'`
- Draw a **zero-line baseline** (like the pace channel) since braking G oscillates around zero
- Use symmetric Y-axis scaling (like pace)
- Negative values = braking, positive = acceleration
- Assign a distinct color (orange-red, e.g. `hsl(15, 80%, 55%)`)

**4. Wire braking settings through props**

- Pass `brakingZoneSettings` from `GraphViewPanel` into `GraphPanel`
- Use the smoothing alpha and threshold values from user settings so the graph matches what the map overlay shows

### Technical Details

```text
brakingZones.ts
  +-- computeBrakingGSeries(samples, config) -> number[]
      (same EMA smoothing + speed-derived accel as detectBrakingZones)

GraphViewPanel.tsx
  +-- pass brakingZoneSettings to GraphPanel

GraphPanel.tsx
  +-- add '__braking_g__' to availableSources
  +-- compute series via computeBrakingGSeries in useMemo
  +-- slice by visibleRange for SingleSeriesChart

SingleSeriesChart.tsx
  +-- handle isBrakingG: zero-line, symmetric Y-axis
```

### What You'll See
- A new "Braking G" option in the "Add Graph" dropdown
- A continuous trace showing deceleration intensity (negative = braking harder)
- Zero-line baseline for easy reading
- Synchronized cursor with all other channels
- Reference overlay support if a reference lap is selected (braking G computed for reference samples too, aligned by distance)

