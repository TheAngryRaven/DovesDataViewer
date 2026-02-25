
# Fix Fastest Lap Persistence for Old (and New) Files

## Problem Found
There's a React state timing bug. When a file is loaded via `handleDataLoaded`, it calls:
1. `sessionData.loadParsedData(parsedData, fileName)` -- sets `currentFileName` via `setState` (async)
2. `lapMgmt.calculateAndSetLaps(course, samples)` -- tries to use `currentFileName` to save metadata

But `currentFileName` inside `calculateAndSetLaps` is captured from the previous render cycle. It's still `null` (or the previous file's name), so the metadata save either skips or writes to the wrong file. This means fastest lap data only gets saved when laps are recalculated after a subsequent re-render (e.g., manually changing the track dropdown), not on initial file load.

## Fix

### 1. `src/hooks/useLapManagement.ts` -- Accept optional `fileName` override
- Add an optional `fileNameOverride?: string` parameter to `calculateAndSetLaps`
- Use `fileNameOverride ?? currentFileName` when saving metadata
- This lets callers pass the filename directly instead of relying on stale React state

### 2. `src/pages/Index.tsx` -- Pass `fileName` when calling `calculateAndSetLaps`
- In `handleDataLoaded`, pass the `fileName` argument through: `lapMgmt.calculateAndSetLaps(courseToUse, parsedData.samples, fileName)`
- This ensures old files get their fastest lap saved on first reload

### 3. `src/components/drawer/FilesTab.tsx` -- Already handled
The file browser already conditionally renders fastest lap only when data exists (no "N/A"). No changes needed here.

### 4. `CLAUDE.md` -- Note the timing pattern
Add a brief note about the stale-state gotcha when calling functions that depend on freshly-set React state.

## Behavior After Fix
- **New files**: Fastest lap saved immediately on import when track is auto-detected or selected
- **Old files (reloaded)**: Fastest lap saved on load when track/course is restored from metadata -- no need to reprocess all files, just opening one backfills the data
- **File browser**: Shows the lightning bolt + lap time for any file that has been opened at least once since this feature exists. Shows nothing for files never opened -- clean, no clutter

## Technical Detail

```text
Before (broken):
  loadParsedData(data, "session.nmea")   --> setState({ currentFileName: "session.nmea" })
  calculateAndSetLaps(course, samples)   --> currentFileName is still null (stale closure)
  --> metadata save skipped

After (fixed):
  loadParsedData(data, "session.nmea")   --> setState (still async)
  calculateAndSetLaps(course, samples, "session.nmea")  --> uses override directly
  --> metadata saved correctly
```
