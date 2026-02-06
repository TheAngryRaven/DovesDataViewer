

## Add Session Kart/Setup Link to Notes Tab

### Overview

Add a "Session Setup" selector at the top of the Notes tab. Two dropdowns (Kart, then Setup filtered by selected kart) and a Save button let the user link a kart and setup to the current session file. This link persists in the existing `metadata` IndexedDB store (via `FileMetadata`) so it's remembered when the session is reloaded.

### How It Works

1. User opens Notes tab with a session loaded
2. At the top: a Kart dropdown, a Setup dropdown (disabled until a kart is selected, only shows setups for that kart), and a Save/Update button
3. When saved, the selected `kartId` and `setupId` are stored in the existing `FileMetadata` record for that session file
4. On load, the saved kart/setup selection is restored and displayed

### Data Model Change

Add two optional fields to `FileMetadata` in `src/lib/fileStorage.ts`:

| Field | Type | Notes |
|-------|------|-------|
| `sessionKartId` | `string` (optional) | Links to a saved Kart |
| `sessionSetupId` | `string` (optional) | Links to a saved Setup |

No DB version bump needed -- these are just new properties on existing objects in the schemaless `metadata` store.

### Files Modified

| File | Changes |
|------|---------|
| `src/lib/fileStorage.ts` | Add `sessionKartId?` and `sessionSetupId?` to `FileMetadata` interface |
| `src/components/drawer/NotesTab.tsx` | Add kart/setup dropdowns and save button at top; accept new props for karts, setups, and metadata save/load |
| `src/components/FileManagerDrawer.tsx` | Pass karts, setups, and metadata callbacks to NotesTab |
| `src/pages/Index.tsx` | Pass metadata load/save functions and karts/setups to the drawer's Notes tab |

### NotesTab UI Changes

The top of the Notes tab (when a session is loaded) gets a new section above the notes list:

```text
+----------------------------------+
| Session Setup                    |
| [Kart dropdown    v]             |
| [Setup dropdown   v]             |
| [Save Selection]                 |
+--- divider ----------------------+
| (existing notes list)            |
| ...                              |
+--- divider ----------------------+
| (existing add/edit form)         |
+----------------------------------+
```

- Kart dropdown: lists all saved karts by name
- Setup dropdown: disabled until a kart is selected; filters to show only setups linked to that kart
- Save button: saves the `sessionKartId` and `sessionSetupId` to `FileMetadata` via the existing `saveFileMetadata` function
- When the session already has a saved kart/setup, the dropdowns show the saved selection and the button says "Update Selection"
- A small "Linked" or checkmark indicator shows when the selection matches what's saved

### Props Flow

NotesTab will receive additional props:
- `karts: Kart[]` -- already available in the drawer
- `setups: KartSetup[]` -- already available in the drawer
- `sessionKartId: string | null` -- loaded from metadata
- `sessionSetupId: string | null` -- loaded from metadata
- `onSaveSessionSetup: (kartId: string, setupId: string) => Promise<void>` -- persists to metadata

### Integration in Index.tsx

- On session load (when `currentFileName` changes), fetch `FileMetadata` to get `sessionKartId` and `sessionSetupId`
- Expose a callback that merges the kart/setup IDs into the existing metadata record and calls `saveFileMetadata`
- Pass the loaded IDs and callback down through the drawer

### Technical Notes

- The `metadata` store already uses `fileName` as its keyPath, so we just add properties to the existing record via `saveFileMetadata` (a `put` operation that merges)
- Need to be careful to preserve existing metadata fields (trackName, courseName, weather) when saving the session setup -- read existing metadata first, merge, then save
- Setup dropdown filtering uses the `kartId` field already present on every `KartSetup`
