

## External Reference Lap from Another Session

### Overview

Add an "External Reference" bar at the top of the Lap Times view. It displays a "Choose Log" button and shows either "No session loaded" or the loaded file name, lap number, and lap time. When a log is chosen and a lap selected, that external lap's samples replace the internal reference for all delta/pace calculations.

### User Flow

1. User sees: `External Reference: [Choose Log] | No session loaded`
2. Clicks "Choose Log" -- a dialog lists all saved files from IndexedDB (names only, clickable)
3. User clicks a file -- the app loads and parses it, calculates laps using the *currently selected course*
4. If no laps found: show an error message in the dialog ("No laps detected for the current track/course")
5. If laps found: the dialog switches to show a lap list (`Lap #: lap time`), user clicks one
6. The external reference is set. The bar now shows: `External Reference: [Choose Log] | filename.nmea : Lap 3 : 1:02.345`
7. All reference-based features (pace, reference speed line, grey map polyline, delta metrics) now use the external lap's samples
8. The internal "Set Ref" buttons in the lap table still work -- clicking one clears the external reference and uses the internal one instead

### Architecture

The external reference produces a `GpsSample[]` array, which is the same type the existing reference system uses. The change is that `referenceSamples` can now come from either:
- An internal lap (existing behavior via `referenceLapNumber`)
- An external session+lap (new behavior)

When an external reference is active, it takes priority. Setting an internal reference clears the external one and vice versa.

### Files Modified

| File | Changes |
|------|---------|
| `src/pages/Index.tsx` | Add external reference state (`externalRefSamples`, `externalRefLabel`), modify `referenceSamples` memo to prefer external when set, add handler for setting external ref, clear external when internal ref is set, pass new props to LapTable |
| `src/components/LapTable.tsx` | Add external reference bar at top with "Choose Log" button and status label, add dialog for file selection and lap selection |

### State in Index.tsx

```text
externalRefSamples: GpsSample[] | null   -- the external lap's raw samples
externalRefLabel: string | null          -- "filename : Lap # : time" display string
```

The existing `referenceSamples` memo changes from:

```text
if externalRefSamples is set -> use externalRefSamples
else if referenceLapNumber is set -> use internal lap samples
else -> empty
```

When `handleSetReference` (internal) is called, clear `externalRefSamples`. When external ref is set, clear `referenceLapNumber`.

### LapTable Changes

New props:
- `externalRefLabel: string | null`
- `onChooseExternalRef: () => void` (opens dialog)
- Plus the dialog logic can live inside LapTable itself using local state

Actually, to keep it self-contained, the dialog will live inside LapTable. LapTable will receive:
- `savedFiles: FileEntry[]` -- list of files in storage
- `onLoadExternalRef: (fileName: string, lapNumber: number) => Promise<{ success: boolean; error?: string }>` -- callback that loads file, parses, calculates laps, sets reference
- `externalRefLabel: string | null` -- current external ref display text
- `onClearExternalRef: () => void` -- clears external ref

### Dialog Flow (inside LapTable)

The dialog has two stages managed by local state:

**Stage 1 -- File List:**
- Shows all files from `savedFiles` as a clickable list
- Clicking a file calls `onLoadExternalRef` which returns the laps
- Actually, better approach: pass a callback that returns laps for a file, then LapTable manages lap selection locally

Revised approach -- LapTable receives:
- `savedFiles: FileEntry[]`
- `onLoadFileForRef: (fileName: string) => Promise<Lap[] | null>` -- loads, parses, calculates laps; returns laps or null
- `onSetExternalRef: (fileName: string, lapNumber: number, lapSamples: GpsSample[]) => void`
- `externalRefLabel: string | null`

Wait, LapTable shouldn't need to know about GpsSample. Simpler:

- `onLoadFileForRef: (fileName: string) => Promise<{ laps: Array<{ lapNumber: number; lapTimeMs: number }> } | null>`
- `onSelectExternalLap: (fileName: string, lapNumber: number) => void`

Index.tsx handles all the heavy lifting (loading blob, parsing, calculating laps, extracting samples, storing them).

### Technical Details

**Index.tsx additions:**
- State: `externalRefFile: string | null`, `externalRefLapNumber: number | null`, `externalRefSamples: GpsSample[] | null`, `externalParsedData: ParsedData | null` (cached parsed data for the external file)
- `handleLoadFileForRef(fileName)`: calls `getFile(fileName)`, creates a File-like blob, calls `parseDatalogContent()`, runs `calculateLaps()` with current `selectedCourse`, returns simplified lap list
- `handleSelectExternalLap(fileName, lapNumber)`: extracts the samples for that lap from the cached parsed data, sets `externalRefSamples`, clears `referenceLapNumber`, builds display label
- Modify `referenceSamples` memo: if `externalRefSamples` is set, return those; otherwise fall back to internal
- Modify `handleSetReference`: when internal ref is set, clear external ref state

**LapTable.tsx additions:**
- New props for external ref functionality
- A sticky bar at the top (above the table header) with: label "External Reference:", a "Choose Log" button, and the status text
- A Dialog component with two views:
  - File list view: scrollable list of file names
  - Lap list view: shows laps for the selected file with `Lap #: formatted time`, or error if no laps found
- Loading state while parsing file

### Prop Changes Summary

LapTable new props:
- `savedFiles: FileEntry[]`
- `externalRefLabel: string | null`
- `onLoadFileForRef: (fileName: string) => Promise<Array<{ lapNumber: number; lapTimeMs: number }> | null>`
- `onSelectExternalLap: (fileName: string, lapNumber: number) => void`

