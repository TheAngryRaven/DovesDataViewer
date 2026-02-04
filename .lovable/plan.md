
## Map Overlay Toggle & Enhanced Stats Display

This plan reorganizes the main viewing page by moving the lap summary widget data into the map overlays and adding a toggle to show/hide the overlay panels.

---

### Overview

**Changes to make:**

1. Replace the `LapSummaryWidget` in the tab bar with a simple "Toggle Overlay" button
2. Add overlay visibility state that controls the two map panels
3. Add current lap time display in the right stats panel (above Avg Top Speed)
4. Add reference lap's average speeds with deltas to the delta section

---

### Feature 1: Toggle Overlay Button

**Location**: Tab bar, right side (replacing LapSummaryWidget)

**Behavior**:
- Button toggles a new `showOverlays` state
- When `showOverlays` is false, both the left panel (map style/speed events) and right panel (speed legend/stats) are hidden
- Race line, position marker, and speed event bubbles (if previously enabled) remain visible
- Default state: overlays visible (true)

**Icon**: Use `Eye` / `EyeOff` from lucide-react

---

### Feature 2: Pass Overlay Visibility to RaceLineView

**New prop**: `showOverlays?: boolean`

**Changes to RaceLineView**:
- Wrap both panel `div` elements in a conditional: `{showOverlays && (...)}`
- Panels fade out when hidden (can use CSS transitions for polish)

---

### Feature 3: Add Lap Time Above Stats

**Location**: Right stats panel, directly above "Avg Top Speed"

**Display**:
```text
Lap Time: 0:42.567
```

**Data source**: New prop `lapTimeMs?: number | null` passed from Index.tsx
- When a specific lap is selected, show that lap's time
- When "All Laps" is selected, don't show (or show fastest)

---

### Feature 4: Reference Lap Average Speeds in Delta Section

**Current delta section shows**:
- Δ Lap (reference lap number)
- Δ Time (lap time difference)
- Δ Top Speed (current vs reference average top speed)
- Δ Min Speed (current vs reference average min speed)

**Enhancement**: Show the actual reference lap averages, then the delta

New display format in the delta section:
```text
Δ ref
─────────────────────
Δ Lap:      8
Δ Time:     +0.234s
Ref Avg Top: 54.3 mph
Δ Top Speed: +1.2 mph
Ref Avg Min: 18.7 mph  
Δ Min Speed: -0.5 mph
```

**Data to pass**: New props `refAvgTopSpeed` and `refAvgMinSpeed` to RaceLineView

---

### Technical Implementation

**File: `src/pages/Index.tsx`**

1. Add state:
   ```tsx
   const [showOverlays, setShowOverlays] = useState(true);
   ```

2. Calculate reference lap average speeds in the existing `paceDiff` useMemo:
   - Already calculates `deltaTopSpeed` and `deltaMinSpeed`
   - Add `refAvgTopSpeed` and `refAvgMinSpeed` to the return value

3. Replace LapSummaryWidget in tab bar (lines 511-521):
   ```tsx
   <div className="ml-auto mr-3">
     <Button 
       variant="ghost" 
       size="sm"
       onClick={() => setShowOverlays(!showOverlays)}
     >
       {showOverlays ? <Eye /> : <EyeOff />}
       <span className="ml-1">Overlay</span>
     </Button>
   </div>
   ```

4. Pass new props to RaceLineView:
   - `showOverlays={showOverlays}`
   - `lapTimeMs={selectedLap?.lapTimeMs ?? null}`
   - `refAvgTopSpeed={refAvgTopSpeed}`
   - `refAvgMinSpeed={refAvgMinSpeed}`

**File: `src/components/RaceLineView.tsx`**

1. Add new props to interface:
   ```tsx
   showOverlays?: boolean;
   lapTimeMs?: number | null;
   refAvgTopSpeed?: number | null;
   refAvgMinSpeed?: number | null;
   ```

2. Wrap control panels in conditional:
   ```tsx
   {showOverlays !== false && (
     <div className="absolute top-4 left-4 ...">
       {/* Controls panel content */}
     </div>
   )}
   
   {showOverlays !== false && (
     <div className="absolute top-4 right-4 ...">
       {/* Stats panel content */}
     </div>
   )}
   ```

3. Add lap time display above Avg Top Speed:
   ```tsx
   {lapTimeMs !== null && (
     <div className="flex justify-between text-xs mb-2 pb-2 border-b border-border">
       <span className="text-muted-foreground">Lap Time:</span>
       <span className="font-mono text-foreground font-semibold">
         {formatLapTime(lapTimeMs)}
       </span>
     </div>
   )}
   ```

4. Add reference averages to delta section:
   ```tsx
   {refAvgTopSpeed !== null && (
     <div className="flex justify-between text-xs">
       <span className="text-muted-foreground">Ref Avg Top:</span>
       <span className="font-mono text-muted-foreground">
         {convertSpeed(refAvgTopSpeed).toFixed(1)} {unit}
       </span>
     </div>
   )}
   ```

---

### Import Changes

**Index.tsx**: Add `Eye`, `EyeOff` from lucide-react

**RaceLineView.tsx**: Import `formatLapTime` from `@/lib/lapCalculation`

---

### Files to Modify

| File | Changes |
|------|---------|
| `src/pages/Index.tsx` | Add overlay toggle state, calculate ref averages, replace LapSummaryWidget with toggle button, pass new props |
| `src/components/RaceLineView.tsx` | Add new props, conditionally render panels, show lap time and ref averages |

---

### Edge Cases

- **"All Laps" selected**: `lapTimeMs` will be null, so lap time row won't show in stats panel
- **No reference selected**: Delta section won't show (existing behavior), ref averages won't show
- **No course selected**: Stats section doesn't render (existing behavior preserved)
