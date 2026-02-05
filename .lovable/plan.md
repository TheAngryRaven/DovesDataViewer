

## Add Session Notes Tab to Garage Drawer

### Overview

Add a fourth "Notes" tab to the Garage drawer. Notes are tied to the currently loaded session file. Users can add, edit, and delete text notes that persist in IndexedDB, associated with the session's file name.

### How It Works

- The Notes tab is always visible in the tab bar, but shows a message like "Load a session to add notes" when no file is loaded
- When a session is loaded (identified by its file name), the tab shows that session's notes
- Notes persist across sessions -- reloading the same file brings back its notes
- Delete uses the same inline confirmation banner pattern as Files and Karts tabs

### New Files

| File | Purpose |
|------|---------|
| `src/lib/noteStorage.ts` | IndexedDB CRUD for the "notes" object store (DB version bumped to 4) |
| `src/hooks/useNoteManager.ts` | Hook wrapping note CRUD + auto-refresh when session file changes |
| `src/components/drawer/NotesTab.tsx` | Notes list + textarea form UI |

### Modified Files

| File | Changes |
|------|---------|
| `src/lib/fileStorage.ts` | Bump DB_VERSION to 4, add "notes" store in onupgradeneeded |
| `src/lib/kartStorage.ts` | Bump DB_VERSION to 4 to match (same shared DB) |
| `src/components/FileManagerDrawer.tsx` | Add "notes" to DrawerTab union and tabs array; pass session file name and note props to NotesTab |
| `src/pages/Index.tsx` | Wire up useNoteManager hook with currentFileName; pass note props to FileManagerDrawer |

### Data Model

A note has:
- `id`: string (crypto.randomUUID)
- `fileName`: string (the session file it belongs to, used as an index)
- `text`: string (the note content)
- `createdAt`: number (timestamp for ordering)
- `updatedAt`: number (timestamp for tracking edits)

The "notes" object store uses `keyPath: "id"` and an index on `fileName` for efficient per-session lookups.

### NotesTab UI Layout

- **No session loaded**: Centered placeholder with a notebook icon and "Load a session to add notes"
- **Session loaded, no notes**: Centered placeholder "No notes yet" with prompt to use the form below
- **Session loaded, with notes**: 
  - Scrollable list taking up most of the space, each note shows truncated text preview, timestamp, edit and delete icon buttons
  - Delete shows inline confirmation banner (same pattern as Karts)
  - Bottom: a textarea input + "Add Note" / "Update Note" button, with Cancel button when editing

### Technical Details

- The IndexedDB "notes" store gets an index on "fileName" so we can efficiently query `store.index("fileName").getAll(currentFileName)`
- Both `fileStorage.ts` and `kartStorage.ts` openDB functions must bump to version 4 and add the "notes" store in onupgradeneeded to keep them in sync
- The `useNoteManager` hook takes `fileName: string | null` and re-fetches notes whenever the file name changes
- Notes are displayed newest-first (sorted by createdAt descending)

