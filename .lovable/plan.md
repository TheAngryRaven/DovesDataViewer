

## Plan: Device Track Manager — Delete, Resync, and Label Fixes

### What we're building

1. **Delete track/course from device** — TDEL BLE command + confirmation dialogs
2. **"Resync All Tracks"** button — wipes known tracks from device, re-uploads from app
3. **Terminology cleanup** — "Upload" = app→device, "Download" = device→app (currently "Save" is ambiguous)

### Changes

#### 1. `src/lib/bleDatalogger.ts` — Add `deleteTrackFile()`
- New function: sends `TDEL:filename.json` via fileRequest characteristic
- Waits for `TOK` or `TERR:` on fileStatus (same pattern as TPUT)
- 10s timeout

#### 2. `src/components/drawer/DeviceTracksTab.tsx` — UI additions

**Delete track from device:**
- Add a `Trash2` icon button on each track row (device_only, synced, mismatch — anything present on device)
- Click opens a confirmation dialog: "Delete SHORTNAME from device?"
- On confirm: call `deleteTrackFile(connection, shortName + ".json")` → `syncAll()`

**Delete course from device:**
- In the course drill-down view, add a `Trash2` button on courses that exist on device (synced, mismatch, device_only)
- Confirmation dialog: "Delete course NAME from SHORTNAME on device? This will re-upload the track without this course."
- Implementation: rebuild the device JSON without that course, TPUT the updated file (if no courses remain, TDEL the whole file)

**Resync All Tracks:**
- New button in the track list toolbar next to "Refresh"
- Confirmation dialog: "This will delete all known tracks from the device and re-upload them from the app. Device-only tracks will be left untouched. Continue?"
- Logic: for each `mergedTrack` where `appTrack` exists AND device has the file (status synced/mismatch): `deleteTrackFile` then `uploadTrackFile`. For `app_only`: just `uploadTrackFile`. Skip `device_only` entries entirely.
- Show progress during operation

**Terminology fix:**
- "Upload" → "Send to Device" (app→device)  
- "Save" → "Download to App" (device→app)
- Update all button labels and toast messages consistently

#### 3. Verification of upload/save logic
- Current `handleUploadToDevice` calls `buildTrackJsonForUpload(entry.appTrack)` which converts all app courses → device JSON array. This is correct.
- Current `handleSaveToApp` saves device courses to localStorage via `addCourse`. This is correct.
- The only issue is labeling ambiguity, which the terminology fix addresses.

### Files modified
- `src/lib/bleDatalogger.ts` — add `deleteTrackFile`
- `src/components/drawer/DeviceTracksTab.tsx` — delete buttons, resync, confirmation dialogs, label fixes

