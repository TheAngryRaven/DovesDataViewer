

## Fix: Braking Zones Not Rendering on Map

### Root Cause

The sample NMEA data (and likely the user's real data) comes from a **25Hz GPS receiver**, producing samples every **0.04 seconds** (40ms). The heuristic guard added to prevent division artifacts sets `MIN_DT_S = 0.05` (50ms), which is **larger than the actual sample interval**. This means every single sample pair is skipped in both `detectBrakingZones` and `computeBrakingGSeries`, so no braking zones are ever detected.

### Fix

Lower `MIN_DT_S` from `0.05` to `0.02` in `src/lib/brakingZones.ts`. This accommodates GPS receivers up to 50Hz while still filtering out degenerate near-zero time deltas that would cause division artifacts.

### Changes

**`src/lib/brakingZones.ts`** (single line change)

Change line 28:
```
const MIN_DT_S = 0.05;   // was too high for 25Hz GPS
```
to:
```
const MIN_DT_S = 0.02;   // Supports GPS up to 50Hz
```

This one constant is shared by both `detectBrakingZones` and `computeBrakingGSeries`, so both the map overlay and the graph channel will be fixed simultaneously.

