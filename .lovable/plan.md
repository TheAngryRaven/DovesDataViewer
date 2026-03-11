

# Major Update: Track Import/Export, Course Detection, Direction Detection, Waypoint Mode, .dovex Parser

This is a large multi-part update touching the admin tools, runtime track detection, parsers, and types. Here is the breakdown:

---

## Part 1: Admin Tools Tab Overhaul

### 1A: Update Importer — `lengthFt` → `length_ft_override`
When importing tracks.json, the `lengthFt` value from each course should be stored in `length_ft_override` (not ignored). This gives imported tracks their known lengths immediately.

**File**: `src/lib/db/supabaseAdapter.ts` (`importFromTracksJson`)

### 1B: Remove Manifest Generator
Remove the "Build Track Manifest" section from `ToolsTab.tsx`, remove `buildTrackManifest()` from `ITrackDatabase` interface, and its implementation in `supabaseAdapter.ts`.

**Files**: `src/components/admin/ToolsTab.tsx`, `src/lib/db/types.ts`, `src/lib/db/supabaseAdapter.ts`

### 1C: Add Course Drawings Export
New "Export Course Drawings" button that builds a JSON file of all course layouts (keyed by `trackShortName/courseName`). If a course has `length_ft_override` set, skip that course's drawing (it's been manually overridden and the drawing isn't the source of truth).

**File**: `src/components/admin/ToolsTab.tsx`, `src/lib/db/supabaseAdapter.ts` (new `buildDrawingsJson()` method), `src/lib/db/types.ts`

### 1D: Add Course Drawings Import
New "Import Course Drawings" section. Paste JSON, import drawings. For each course that receives a drawing, clear its `length_ft_override` (the drawing becomes the source of truth). If no drawing is provided for a course, leave it alone.

**Files**: Same as 1C plus import method.

---

## Part 2: Runtime Track/Course Types Update

### 2A: Add `lengthFt` to Course type
Currently `Course` in `types/racing.ts` doesn't carry `lengthFt`. Add it as optional. Update `trackStorage.ts` to parse it from tracks.json and carry it through.

```typescript
export interface Course {
  name: string;
  lengthFt?: number; // known course length in feet
  // ... existing fields
}
```

**Files**: `src/types/racing.ts`, `src/lib/trackStorage.ts`

### 2B: Update `findNearestTrack` threshold
Change from 2km to 5 miles (~8047m) to match the user's spec.

**File**: `src/lib/trackUtils.ts`

---

## Part 3: Automatic Course Detection

Port the CourseDetector logic from the simulator. The web viewer has all data at once (post-parse), so this is simpler than realtime:

### Algorithm (batch, not realtime)
1. Find first GPS sample within 5 miles of any known track → identify track
2. Calculate average lap distance from existing lap calculations
3. For each course of that track, compare average lap distance (in feet) to `lengthFt`
4. Pick the closest match within 25% tolerance
5. If no course matches or no laps found, fall back to waypoint mode

### Direction Detection
After course is identified (if it has sectors):
- Check first sector crossing after first S/F crossing
- If sector 2 is hit first → forward
- If sector 3 is hit first → reverse
- Store direction as metadata

### Waypoint Mode ("Lap Anything")
If no track matches or no course start/finish lines produce valid laps:
1. Find first sample where speed >= 30 MPH → that's the waypoint
2. Walk through all samples, track cumulative distance (haversine odometer)
3. When returning within 30m of waypoint after traveling 100m+, use closest-approach point as lap boundary
4. Buffer approach points, pick minimum distance for precise timing
5. For sectors: divide lap distance by 3, place virtual sector boundaries at 1/3 and 2/3 distance marks
6. Show notice: "Waypoint timing — lower accuracy. Create a track for precise timing."

### Integration into `handleDataLoaded`
The flow becomes:
1. Parse data → get samples
2. Find nearest track (5mi radius)
3. If track found: try each course's S/F line → calculate laps → pick course by length match
4. If no course matches or no track: use waypoint mode
5. Direction detection runs as a secondary pass on sector crossings

**New files**:
- `src/lib/courseDetection.ts` — batch course detector + waypoint lap calculator + direction detector
  
**Modified files**:
- `src/pages/Index.tsx` — update `handleDataLoaded` to use auto-detection
- `src/hooks/useLapManagement.ts` — support waypoint laps
- `src/types/racing.ts` — add `direction` field to lap management, add waypoint mode types
- `src/components/TrackPromptDialog.tsx` — show detected course + direction, waypoint mode notice

---

## Part 4: `.dovex` Parser

New format: first 4096 bytes are a metadata header, rest is standard `.dove` CSV.

### Header Structure (within first 4096 bytes)
```
Line 1: datetime,driver,course,short_name,best_lap_ms,optimal_ms
Line 2: 2024-03-15 14:30:00,Mike,Full CW,OKC,62345,61200
Line 3: 65432,64321,62345,63456   (lap times in ms, comma-separated)
Line 4+: padding to byte 4096
```

### Parser Logic
1. Read first 4096 bytes as text
2. Parse metadata header (lines 1-3)
3. Remainder (byte 4096+) is standard `.dove` format — pass to existing `parseDoveFile()`
4. Attach metadata to `ParsedData` via new optional fields

### Extended ParsedData
```typescript
export interface DovexMetadata {
  datetime?: string;
  driver?: string;
  course?: string;
  shortName?: string;
  bestLapMs?: number;
  optimalMs?: number;
  lapTimesMs?: number[];
}

export interface ParsedData {
  // ... existing fields
  dovexMetadata?: DovexMetadata;
}
```

**New file**: `src/lib/dovexParser.ts`
**Modified files**: `src/lib/datalogParser.ts` (register), `src/types/racing.ts` (add metadata), `src/components/FileImport.tsx` (accept `.dovex`), `README.md`, `CLAUDE.md`

---

## Part 5: Documentation Updates

Update `CLAUDE.md` and `README.md`:
- Add `.dovex` format to supported formats
- Document course detection algorithm
- Document direction detection
- Document waypoint/"Lap Anything" mode
- Update admin tools documentation (removed manifest, added drawings import/export)
- Update `lengthFt` on Course type

---

## Implementation Order
1. Types update (Course.lengthFt, DovexMetadata, direction types)
2. Track storage update (parse lengthFt from JSON)
3. Admin tools (importer fix, remove manifest, drawings export/import)
4. `.dovex` parser
5. Course detection + direction detection + waypoint mode
6. Integration into Index.tsx flow
7. CLAUDE.md + README.md updates

---

## Files Summary

| Action | File |
|--------|------|
| Edit | `src/types/racing.ts` |
| Edit | `src/lib/trackStorage.ts` |
| Edit | `src/lib/trackUtils.ts` |
| Edit | `src/lib/datalogParser.ts` |
| Edit | `src/lib/db/types.ts` |
| Edit | `src/lib/db/supabaseAdapter.ts` |
| Edit | `src/components/admin/ToolsTab.tsx` |
| Edit | `src/components/FileImport.tsx` |
| Edit | `src/components/TrackPromptDialog.tsx` |
| Edit | `src/pages/Index.tsx` |
| Edit | `src/hooks/useLapManagement.ts` |
| Edit | `CLAUDE.md` |
| Edit | `README.md` |
| New | `src/lib/dovexParser.ts` |
| New | `src/lib/courseDetection.ts` |

