

## Braking Zone Detection & Visualization

This plan implements discrete braking zone detection and map visualization using a hysteresis-based state machine algorithm, with both a quick-toggle in the map controls and detailed tuning in settings.

---

### Overview

**New file to create:**
- `src/lib/brakingZones.ts` - Detection algorithm with state machine and configurable thresholds

**Files to modify:**
- `src/hooks/useSettings.ts` - Add braking zone tuning settings
- `src/components/SettingsModal.tsx` - Add Braking Zones settings section with sliders
- `src/components/RaceLineView.tsx` - Add toggle under speed events, render braking zone polylines
- `src/pages/Index.tsx` - Pass braking settings to RaceLineView

---

### Feature 1: Braking Zone Detection Algorithm

**New file: `src/lib/brakingZones.ts`**

Types:
```typescript
interface BrakingZone {
  start: { lat: number; lon: number; t: number; speedMps: number };
  end: { lat: number; lon: number; t: number; speedMps: number };
  path: Array<{ lat: number; lon: number }>;
  durationMs: number;
  speedDeltaMps: number;
}

interface BrakingZoneConfig {
  entryThresholdG: number;    // default: -0.25
  exitThresholdG: number;     // default: -0.10
  minDurationMs: number;      // default: 120
  smoothingAlpha: number;     // default: 0.4
}
```

Algorithm:
1. Calculate longitudinal acceleration from scalar speed changes
2. Apply exponential smoothing with configurable alpha
3. State machine with hysteresis (entry at -0.25g, exit at -0.10g)
4. Filter zones shorter than minimum duration (120ms default)
5. Return array of zones with full GPS path for curved rendering

---

### Feature 2: Map Controls Toggle

**Location:** Controls panel, directly below "Speed events" toggle

**UI:**
```
├─ [Switch] Speed events
│  └─ Peak/Valley legend (when enabled)
│
├─ [Switch] Braking zones      ← NEW
│  └─ Orange square legend (when enabled)
```

**Behavior:**
- Local state `showBrakingZones` in RaceLineView (default: true)
- Independent of speed events toggle
- Zones render as thick orange polylines (weight: 8-10)
- Follows global `showOverlays` visibility

---

### Feature 3: Settings for Threshold Tuning

**Location:** Settings modal, new "Braking Zones" section after G-Force Smoothing

**New settings in AppSettings:**
```typescript
brakingEntryThreshold: number;    // 10-50, represents 0.10-0.50g (default: 25)
brakingExitThreshold: number;     // 5-25, represents 0.05-0.25g (default: 10)
brakingMinDuration: number;       // 50-500ms (default: 120)
brakingSmoothingAlpha: number;    // 10-80, represents 0.1-0.8 (default: 40)
```

**UI in SettingsModal:**
```
[Icon: Circle] Braking Zone Detection
─────────────────────────────────────
Entry Threshold        [-0.25g] ●────────○
Exit Threshold         [-0.10g] ●────○
Min Duration           [120ms]  ●──────○
Smoothing              [0.4]    ●────○
```

Each slider shows the current value with proper formatting.

---

### Feature 4: Map Rendering

**New layer in RaceLineView:**
- `brakingZonesLayerRef` - Layer group for zone polylines
- Compute zones via `useMemo` when samples change
- Draw each zone as polyline following actual GPS path
- Style: Orange (`hsl(30, 90%, 50%)`), weight 8-10px
- Render below race line, above reference line

**Visual hierarchy:**
```
Top:     Position marker, speed event bubbles
         Race line (weight: 4)
         Braking zones (weight: 8, orange)
         Reference line (weight: 4, grey)
Bottom:  Map tiles
```

---

### Technical Implementation

**File: `src/lib/brakingZones.ts` (NEW)**
- Export `detectBrakingZones(samples, config)` function
- Export `BrakingZone` and `BrakingZoneConfig` types
- Export `DEFAULT_BRAKING_CONFIG` constants

**File: `src/hooks/useSettings.ts`**
- Add 4 new settings to `AppSettings` interface
- Add defaults to `defaultSettings`

**File: `src/components/SettingsModal.tsx`**
- Import `Circle` icon from lucide-react
- Add new "Braking Zone Detection" section with 4 sliders
- Display values with proper units (-0.XXg for thresholds, ms for duration)

**File: `src/components/RaceLineView.tsx`**
- Add `showBrakingZones` local state (default: true)
- Add toggle UI below speed events toggle with orange legend
- Add `brakingZonesLayerRef` for the layer
- Import and call `detectBrakingZones` in useMemo
- Render zones as thick orange polylines
- Add new prop `brakingZoneSettings` for threshold values

**File: `src/pages/Index.tsx`**
- Pass braking settings to RaceLineView as `brakingZoneSettings` prop

---

### Files Summary

| File | Changes |
|------|---------|
| `src/lib/brakingZones.ts` | **New** - Detection algorithm, types, constants |
| `src/hooks/useSettings.ts` | Add 4 braking threshold settings |
| `src/components/SettingsModal.tsx` | Add Braking Zone Detection section with sliders |
| `src/components/RaceLineView.tsx` | Add toggle, layer, compute and render zones |
| `src/pages/Index.tsx` | Pass braking settings to RaceLineView |

---

### Default Tuning Values

| Setting | Default | Range | Display |
|---------|---------|-------|---------|
| Entry Threshold | 25 | 10-50 | -0.25g |
| Exit Threshold | 10 | 5-25 | -0.10g |
| Min Duration | 120 | 50-500 | 120ms |
| Smoothing Alpha | 40 | 10-80 | 0.4 |

