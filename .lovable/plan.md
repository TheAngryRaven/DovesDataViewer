

# Add Fastest Lap to File Metadata and File Browser

## What
When laps are calculated for a session, persist the fastest lap time and lap number into the existing IndexedDB metadata store. Display the fastest lap time next to each file in the Garage file browser (only when data exists).

## Changes

### 1. `src/lib/fileStorage.ts` -- Extend `FileMetadata` interface
Add two optional fields:
- `fastestLapMs?: number` -- fastest lap time in milliseconds
- `fastestLapNumber?: number` -- which lap number was fastest

No DB version bump needed -- IndexedDB is schemaless for object stores, new fields just get stored alongside existing ones.

### 2. `src/hooks/useLapManagement.ts` -- Save fastest lap on calculation
In `calculateAndSetLaps` (and `handleSelectionChange`), after finding the fastest lap, call `saveFileMetadata` to persist `fastestLapMs` and `fastestLapNumber` into the existing metadata record. This merges with the existing track/course/weather data already stored there.

### 3. `src/hooks/useFileManager.ts` -- Load metadata alongside file list
Extend `useFileManager` to also load `FileMetadata` for each file when refreshing. Return a `Map<string, FileMetadata>` (or similar) so the UI can look up fastest lap per file.

### 4. `src/components/drawer/FilesTab.tsx` -- Display fastest lap
Accept a metadata map prop. For each file row, if metadata has `fastestLapMs`, render the formatted lap time (e.g. "1:02.347") below the file size/date line. If no data, render nothing -- no "N/A", just clean.

### 5. `src/components/FileManagerDrawer.tsx` -- Thread metadata prop
Pass the metadata map from `useFileManager` through to `FilesTab`.

### 6. Update `CLAUDE.md`
Note the new `fastestLapMs` / `fastestLapNumber` fields on `FileMetadata`.

## Data Flow

```text
Laps calculated (useLapManagement)
  --> find fastest lap
  --> saveFileMetadata({ ...existing, fastestLapMs, fastestLapNumber })
  --> stored in IndexedDB "metadata" store

File browser opened (useFileManager.refresh)
  --> listFiles() + getFileMetadata() for each file
  --> metadata map passed to FilesTab
  --> fastest lap time rendered per file (or nothing if absent)
```

## Formatting
Lap times will use the standard mm:ss.SSS format (e.g. "1:02.347"). A small helper function handles the conversion from milliseconds.

