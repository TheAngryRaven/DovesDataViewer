

# Track Layout Drawing Feature

## Overview
Add the ability to draw a track layout outline over the satellite view in the Visual Editor. This is a foundational feature -- the drawing data will be stored in the database and eventually used to generate course fingerprint data for automatic track detection on the DovesDataLogger hardware.

## What Changes

### 1. Database: New `course_layouts` table
A new table to store drawing data per course. One course can have one layout drawing (1:1 relationship via unique constraint on `course_id`).

```text
course_layouts
  id            uuid PK
  course_id     uuid FK -> courses.id (unique, cascade delete)
  layout_data   jsonb NOT NULL   -- array of {lat, lon} points
  created_at    timestamptz
  updated_at    timestamptz
```

RLS: Admin-only (same pattern as courses table). The layout data is NOT exported to `tracks.json` -- it stays in the DB for admin/processing use only.

### 2. Database: Add `has_layout` boolean to `submissions` table
Add optional `has_layout` boolean column (default false) and `layout_data` jsonb column (nullable) to the existing `submissions` table. This lets users submit drawings alongside their course submission.

### 3. Visual Editor: "Draw" tool button
Add a new `'draw'` option to the `VisualEditorTool` type, with a "Draw" button placed between "Sector 3" and "Done" in the toolbar.

**Visibility rules:**
- In the admin CoursesTab: always visible
- In the user-side TrackEditor: only visible when `enableLabs` is true (from SettingsContext)

**Drawing behavior:**
- When "Draw" mode is active, clicking on the map appends lat/lon points to a polyline
- The polyline renders in a distinct color (e.g., cyan/teal) on top of the satellite view
- An "Undo" button removes the last point (or hold to clear all)
- Clicking "Done" commits the drawing to the parent via a new `onLayoutChange` callback
- The drawing is a simple ordered array of `{lat: number, lon: number}` points -- no fancy bezier curves, just polyline segments

### 4. Visual Editor: Responsiveness improvements
- Make the map container taller: change from `h-64` to `h-64 sm:h-80 md:h-96` 
- Make the entire dialog/popup that wraps the VisualEditor wider on desktop: add `max-w-3xl` or `max-w-4xl` where currently constrained
- On mobile, ensure the dialog takes near-full-screen height so you can see the whole track layout
- The toolbar buttons should wrap on narrow screens instead of overflowing

### 5. Admin CoursesTab: Layout management
- When editing a course, load any existing `course_layouts` row for that course
- Display the drawing on the VisualEditor as a static polyline when not in draw mode
- Add a "Delete Layout" button if one exists
- The "Draw" button is always available here (not gated by Labs)

### 6. Admin CoursesTab: "Generate Course Mapping" button
- Add a non-functional button below the course form labeled "Generate Course Mapping"
- Shows a tooltip: "Coming soon -- will generate fingerprint data for automatic track detection"
- Disabled state, does nothing when clicked -- placeholder for future work

### 7. Submissions: Include layout data
- In `SubmitTrackDialog`, add a hidden/checkbox field "Drawing included" that is auto-set when layout data exists in the form
- The `layout_data` JSON array gets sent alongside the existing `course_data`
- Admin SubmissionsTab: render the drawing on a mini-map preview if `layout_data` is present, plus a badge "Drawing included"

### 8. ITrackDatabase interface + Supabase adapter
Add methods to the database abstraction layer:
- `getLayout(courseId: string): Promise<{id, layout_data} | null>`
- `saveLayout(courseId: string, layoutData: Array<{lat: number, lon: number}>): Promise<void>` (upsert)
- `deleteLayout(courseId: string): Promise<void>`

### 9. Update docs
- `CLAUDE.md`: Document the new table, drawing feature, and "Generate Course Mapping" placeholder
- `README.md`: No changes needed (drawing is admin/labs-only, not a public-facing parser)

## Data Flow

```text
User/Admin draws on VisualEditor
  --> polyline points stored in component state as [{lat, lon}, ...]
  --> on "Done", passed to parent via onLayoutChange callback
  --> Admin: saved to course_layouts table via db.saveLayout()
  --> User (Labs): included in submission via layout_data field
  --> Admin reviews submission, can view drawing on mini-map
  --> Admin approves + saves layout to course_layouts

Future:
  course_layouts data --> "Generate Course Mapping" button
  --> produces fingerprint/diff data for track detection
  --> saved to tracks.json or SD card format (TBD)
```

## File Summary

| File | Change |
|------|--------|
| DB migration | New `course_layouts` table + add columns to `submissions` |
| `src/lib/db/types.ts` | Add `DbCourseLayout` type + layout methods to `ITrackDatabase` |
| `src/lib/db/supabaseAdapter.ts` | Implement layout CRUD methods |
| `src/components/track-editor/VisualEditor.tsx` | Add `draw` tool, drawing polyline logic, responsive sizing |
| `src/components/admin/CoursesTab.tsx` | Layout load/save/delete, "Generate Course Mapping" button |
| `src/components/TrackEditor.tsx` | Pass `enableLabs` to control Draw button visibility, responsive dialog |
| `src/components/SubmitTrackDialog.tsx` | Add layout_data to submission payload |
| `src/components/admin/SubmissionsTab.tsx` | Show layout drawing preview if present |
| `src/contexts/SettingsContext.tsx` | No changes (enableLabs already exposed) |
| `CLAUDE.md` | Document new table and feature |

## Technical Notes

- The drawing is stored as a simple JSON array of `{lat, lon}` objects -- no encoding/compression needed at this scale (typical track outlines are 50-200 points)
- Leaflet's `L.Polyline` handles rendering; click events on the map append points
- The `course_layouts` table uses a unique constraint on `course_id` so there's at most one layout per course -- upsert pattern via `ON CONFLICT`
- The "Generate Course Mapping" button is intentionally non-functional -- it's a UI placeholder for the future fingerprinting algorithm

