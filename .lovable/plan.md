

## Plan: Update Track Exporters + Default Course + Track Manifest

### 1. Database Migration
Add `default_course_id` (nullable UUID, FK to `courses.id` with `ON DELETE SET NULL`) to `tracks` table.

### 2. Update `DbTrack` type (`src/lib/db/types.ts`)
- Add `default_course_id: string | null` to `DbTrack`
- Add `buildTrackManifest(): Promise<string>` to `ITrackDatabase`
- Update `updateTrack` to accept `default_course_id`

### 3. Update `buildTracksJson()` in `src/lib/db/supabaseAdapter.ts`
Change output from current format to new per-track format with courses as array:
```json
{
  "Orlando Kart Center": {
    "shortName": "OKC",
    "defaultCourse": "Normal",
    "courses": [
      { "name": "Normal", "lengthFt": 3383, "start_a_lat": ..., ... },
      { "name": "Pro", "lengthFt": 3828, ... }
    ]
  }
}
```
- Fetch all `course_layouts` to calculate `lengthFt` per course (polyline length in meters * 3.28084, rounded to int; 0 if no layout)
- Look up `default_course_id` to populate `defaultCourse` name (fallback to first course name)

### 4. Update `admin-build-zip` edge function
Same new structure per ZIP file. Must also query `course_layouts` table and `default_course_id` from tracks. Each file (`TRACKS/{shortName}.json`) contains:
```json
{
  "longName": "Orlando Kart Center",
  "shortName": "OKC",
  "defaultCourse": "Normal",
  "courses": [ { "name": "Normal", "lengthFt": 3383, ... } ]
}
```
Need to replicate the Haversine length calculation in the edge function since it can't import from `src/`.

### 5. New `buildTrackManifest()` in `supabaseAdapter.ts`
Generates:
```json
{
  "tracks": [
    { "filename": "okc.json", "lat": 28.412..., "lng": -81.379... }
  ]
}
```
Uses `start_a_lat`/`start_a_lng` from the default course (or first enabled course) of each enabled track. Filename is `{short_name lowercase}.json`.

### 6. Admin CoursesTab: Default Course selector
Add a radio button or star icon per course row. When clicked, updates `tracks.default_course_id`. Show current default highlighted. Load `default_course_id` with track data.

### 7. ToolsTab: Add manifest generator button
New card with "Build Track Manifest" button that calls `db.buildTrackManifest()`, displays output, and offers download as `track_manifest.json`.

### 8. Update `trackStorage.ts` client-side parser
The `loadDefaultTracks` function needs to handle the new JSON format where each track has `shortName`, `defaultCourse`, and courses array now includes `name` and `lengthFt` fields.

### 9. Update `importFromTracksJson`
Handle the new format on import (courses still an array with `name`, plus `lengthFt` ignored on import, `defaultCourse` mapped back to `default_course_id`).

### Files Changed
- DB migration: add `default_course_id` to tracks
- `src/lib/db/types.ts`
- `src/lib/db/supabaseAdapter.ts`
- `supabase/functions/admin-build-zip/index.ts`
- `src/components/admin/CoursesTab.tsx`
- `src/components/admin/ToolsTab.tsx`
- `src/lib/trackStorage.ts`

