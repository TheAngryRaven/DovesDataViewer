

## Findings & Plan: Course Lengths + Drawings for All Users

### Issues Found

1. **Device JSON missing `lengthFt`**: `appCourseToDeviceJson()` in `deviceTrackSync.ts` does NOT include `lengthFt`. The `DeviceCourseJson` interface doesn't even have the field. So every track uploaded to the SD card is missing course lengths — the logger can't do proper course detection by length matching.

2. **`tracks.json` DOES include `lengthFt`**: The admin build and `trackStorage.ts` both handle it correctly. The app-side `Course` type has `lengthFt`. So the webapp itself works fine — the gap is only in the device sync path.

3. **Drawings are admin-only**: `course_drawings.json` is only exported manually by admins. No `public/drawings.json` exists, so regular users never see course outlines. You want this available to all users.

### Plan

#### 1. Add `lengthFt` to device track JSON format
- Add `lengthFt?: number` to `DeviceCourseJson` interface
- Include `lengthFt` in `appCourseToDeviceJson()` when present on the Course
- Include `lengthFt` in `deviceCourseToAppCourse()` when present on the device JSON
- This fixes both upload (app→device) and download (device→app)

#### 2. Add `public/drawings.json` support
- **Admin generates it** — you'll place the exported `course_drawings.json` at `public/drawings.json` (same as you do with `tracks.json`)
- Add a loader function in `trackStorage.ts`: `loadCourseDrawings()` that fetches `/drawings.json` and returns `Record<string, Array<{lat, lon}>>` (keyed by `shortName/courseName`)
- Cache it the same way `defaultTracksCache` works

#### 3. Show course drawings to all users
- In `RaceLineTab` / `RaceLineView`, when no session data is loaded but a track is selected, show the course outline from drawings
- In the Track Editor (non-admin), show the drawing as a read-only reference polyline
- Expose a helper `getDrawingForCourse(shortName, courseName)` that components can call

#### 4. Edge function `admin-build-zip` — already includes `lengthFt` ✓
The edge function already calculates and includes `lengthFt` in each course object from layout data or overrides. No change needed there.

### Files Modified
- `src/lib/deviceTrackSync.ts` — add `lengthFt` to `DeviceCourseJson`, update conversion functions
- `src/lib/trackStorage.ts` — add `loadCourseDrawings()` loader
- `src/components/tabs/RaceLineTab.tsx` — show course drawing when available
- `src/components/RaceLineView.tsx` — render drawing polyline
- `CLAUDE.md` — document drawings.json

