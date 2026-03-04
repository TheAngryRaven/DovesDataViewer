

# Device Track Manager — BLE Sync & Diff UI

## Overview
Replace the DeviceTracksTab placeholder with a full track sync manager. On tab open, the app fetches the track file list from the device via `TLIST`, downloads all track JSONs into memory, then renders a merged list showing sync status between the webapp's known tracks and the device's tracks.

## Architecture

```text
DeviceTracksTab (on mount)
  1. TLIST → get filenames (OKC.json, TEST.json, …)
  2. TGET each file → parse JSON → build Map<shortName, DeviceCourse[]>
  3. Load webapp tracks (loadTracks() from trackStorage)
  4. Merge into unified list with sync status per track

UI States:
  [Loading] → progress dialog "Syncing track data… 2/5"
  [Track List] → rows with status icons + action buttons
  [Course List] → drill into a track, per-course status
  [Diff Modal] → side-by-side course comparison
```

## Data Model

```typescript
// In-memory representation of device track data
interface DeviceTrackFile {
  shortName: string;           // filename without .json
  courses: DefaultCourseJson[]; // raw array from device JSON
}

type TrackSyncStatus = 
  | 'synced'      // all courses match
  | 'mismatch'    // track exists on both but courses differ
  | 'device_only' // track on device but not in webapp
  | 'app_only';   // track in webapp but not on device

interface MergedTrackEntry {
  shortName: string;
  trackName?: string;      // full name from webapp (if known)
  status: TrackSyncStatus;
  appCourses: Course[];           // from webapp (trackStorage)
  deviceCourses: DefaultCourseJson[]; // from device
}
```

## BLE Protocol — New Functions in `bleDatalogger.ts`

### `requestTrackFileList(connection)` → `string[]`
- Sends `TLIST` on fileRequest
- Listens on fileStatus for `TFILE:name.json` lines until `TEND`
- Returns array of filenames

### `downloadTrackFile(connection, filename)` → `Uint8Array`
- Sends `TGET:filename` on fileRequest  
- Reuses existing `downloadFile` transfer pattern: SIZE → data chunks on fileData → DONE on fileStatus
- Actually, this is almost identical to the existing `downloadFile()` — we can literally reuse it by sending `TGET:` instead of `GET:`. But the existing function sends `GET:` prefix. We'll add a new thin wrapper or parameterize the command prefix.

### `uploadTrackFile(connection, filename, data)` → `void`
- Sends `TPUT:filename` on fileRequest
- Waits for `TREADY` on fileStatus
- Sends data in 64-byte chunks on fileRequest
- Sends `TDONE` on fileRequest
- Waits for `TOK` or `TERR:*` on fileStatus

## New Files

### `src/lib/deviceTrackSync.ts` — Comparison Logic
Pure functions, no BLE or UI:
- `parseDeviceCourseJson(raw: string): DefaultCourseJson[]` — parse the device JSON
- `buildMergedTrackList(appTracks: Track[], deviceFiles: DeviceTrackFile[]): MergedTrackEntry[]` — merge logic:
  - Match by shortName (app track shortName vs device filename)
  - For each pair, compare courses by name, compare coordinates with a small epsilon for float equality
  - Classify as synced/mismatch/device_only/app_only
- `coursesMatch(appCourse: Course, deviceCourse: DefaultCourseJson): boolean` — coordinate comparison
- `buildTrackJsonForUpload(track: Track): string` — serialize a Track's courses into the flat JSON array format the device expects
- `deviceCourseToAppCourse(dc: DefaultCourseJson): Course` — convert device format to app Course for import

### `src/components/drawer/DeviceTracksTab.tsx` — Complete Rewrite
Props: receives `connection` from parent (same pattern as DeviceSettingsTab).

**States:**
1. **Loading** — shows a small progress dialog/overlay: "Downloading tracks… 2/5 files"
2. **Track List** — the merged list
3. **Course List** — drilling into a specific track
4. **Diff Modal** — comparing a mismatched course

**Track List UI:**
- Ordered: known app tracks first, then device-only tracks
- Each row: `[StatusIcon] ShortName [ActionButton]`
- Status icons:
  - `HelpCircle` (orange) — device_only (unknown to webapp)
  - `AlertTriangle` (yellow) — mismatch
  - `CloudOff` (blue) — app_only (not on device)
  - No icon or `Check` (green) when synced
- Action buttons:
  - app_only → "Upload to Device" (builds JSON, calls uploadTrackFile)
  - device_only → "Save to App" (converts courses, calls addTrack/addCourse from trackStorage)
  - mismatch → "View Courses" (navigates to course list, same as clicking the name)
  - synced → no button (or just clickable to view courses)
- Clicking any track name → navigates to course list

**Course List UI:**
- Back button at top to return to track list
- Header: track shortName
- Same icon scheme per course:
  - Course only on device → download button
  - Course only on app → upload button  
  - Course mismatch → "Compare" button → opens diff modal
  - Course synced → check icon

**Diff Modal (Dialog):**
- Title: "Course Mismatch — {courseName}"
- Two columns: "On Server" | "On Logger"
- Shows: start/finish coordinates, sector count (0, 2, or 3), distance between start_a points (haversine in meters)
- Two action buttons: "Download from Server" | "Upload from Logger"
- Download: overwrites device file (rebuilds full track JSON, uploads via TPUT)
- Upload: saves device course data to app localStorage via trackStorage

### `src/components/FileManagerDrawer.tsx` — Minor Change
Pass `connection` prop to `DeviceTracksTab`:
```tsx
{deviceTab === "tracks" && <DeviceTracksTab connection={device.connection!} />}
```

## Upload Flow Detail
When uploading a track to the device:
1. Get the full Track from webapp (all courses for that shortName)
2. Convert to device JSON format (flat course array)
3. `JSON.stringify` → encode to UTF-8
4. Call `uploadTrackFile(connection, "SHORTNAME.json", encodedData)`
5. The device handles deletion of the old file internally

When "downloading" a course from device to app:
1. Already have the parsed device course data in memory
2. Convert to app Course format
3. Call `addCourse(trackName, course)` from trackStorage
4. Refresh the merged list

## File Summary

| File | Action |
|------|--------|
| `src/lib/bleDatalogger.ts` | Add `requestTrackFileList`, `downloadTrackFile`, `uploadTrackFile` |
| `src/lib/deviceTrackSync.ts` | **New** — merge/compare/convert logic |
| `src/components/drawer/DeviceTracksTab.tsx` | **Rewrite** — full track sync UI |
| `src/components/FileManagerDrawer.tsx` | Pass `connection` to DeviceTracksTab |
| `CLAUDE.md` | Document new files |
| `README.md` | Note track sync feature |

