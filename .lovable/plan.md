

# Course Layouts Overview Map

## Overview
Move the "Generate Course Mapping" button out of the course edit form and into a new **Layouts Overview** section below the course list. This section contains a Leaflet map showing all course layout drawings for the selected track, each in a distinct color. The course list items get a colored dot indicator matching their map color when they have a layout.

## Changes

### 1. Course list: colored layout indicator
Each course row in the list gets a small colored circle next to the name if that course has a saved layout. The color matches the polyline on the overview map below. Courses without a layout show no indicator.

To know which courses have layouts, load all layouts for the selected track's courses in one batch when courses load (`Promise.all` of `db.getLayout()` for each course, or a new `getLayoutsForTrack` method).

### 2. Color palette for courses
Define a small array of high-contrast, distinct colors (similar to chart series colors). Assign colors by course index position:

```text
const COURSE_COLORS = [
  '#ff6600',  // orange
  '#06b6d4',  // cyan
  '#a855f7',  // purple
  '#22c55e',  // green
  '#f43f5e',  // rose
  '#eab308',  // yellow
  '#3b82f6',  // blue
  '#ec4899',  // pink
];
```

Each course gets `COURSE_COLORS[index % length]`.

### 3. Layouts Overview Map (new component section)
Below the course list, render a new `racing-card` containing:
- A header row: "Course Layouts" label on the left, "Generate Course Mapping" button (disabled, tooltip) on the right
- A Leaflet map (`h-64 sm:h-80 md:h-96`) showing ESRI satellite tiles
- All courses that have layout data are drawn as polylines, each in their assigned color
- The map auto-fits bounds to contain all drawn layouts
- Only shown when there's at least one course with a layout (or always shown once a track is selected -- can show "No layouts drawn yet" if empty)

### 4. Remove "Generate Course Mapping" from course edit form
Move it from the edit form's button row to the overview map header.

### 5. Batch layout loading
Add a new method to `ITrackDatabase`:
```typescript
getLayoutsForCourses(courseIds: string[]): Promise<DbCourseLayout[]>
```
This fetches all layouts in a single query using `course_id.in.(ids)` rather than N individual calls. Called once when courses load.

## File Changes

| File | Change |
|------|--------|
| `src/lib/db/types.ts` | Add `getLayoutsForCourses()` to interface |
| `src/lib/db/supabaseAdapter.ts` | Implement batch layout query |
| `src/components/admin/CoursesTab.tsx` | Add layout map section, colored indicators, move Generate button, batch-load layouts |

## Layout of the Courses Tab (after changes)

```text
[Track selector] [+ Add Course]

(course edit form, if editing/adding)

Course List:
  [toggle] [orange dot] Normal        [edit]
  [toggle]              Pro           [edit]   <-- no dot = no layout
  [toggle] [cyan dot]   Short         [edit]
  [toggle]              xShort        [edit]

Course Layouts                [Generate Course Mapping (disabled)]
+----------------------------------------------------------+
|                                                          |
|   Leaflet map with satellite tiles                       |
|   Orange polyline = Normal layout                        |
|   Cyan polyline = Short layout                           |
|                                                          |
+----------------------------------------------------------+
```

## Technical Notes
- The overview map is a separate Leaflet instance from the VisualEditor -- simpler, read-only, no editing tools
- Uses `L.polyline` for each course layout with the assigned color, weight 5, opacity 0.9
- `map.fitBounds()` on the combined bounds of all polylines so all drawings are visible
- The colored dot in the course list is a simple `<span>` with inline `backgroundColor` style, sized ~12px
- The Generate Course Mapping button stays disabled with the same tooltip as before

