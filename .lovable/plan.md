

## In-App File Manager (IndexedDB + Pull-Out Overlay)

This plan adds a full client-side file manager using IndexedDB for storage, accessible as a slide-in overlay drawer from two entry points.

---

### Overview

**New files:**
- `src/lib/fileStorage.ts` - IndexedDB wrapper for storing/retrieving/deleting file blobs
- `src/components/FileManagerDrawer.tsx` - The overlay drawer UI component
- `src/hooks/useFileManager.ts` - Hook managing file list state, CRUD operations, and storage estimates

**Modified files:**
- `src/hooks/useSettings.ts` + `src/components/SettingsModal.tsx` - Add "Auto-save" toggle
- `src/components/FileImport.tsx` - Rename button, add "Browse files" button, hook into auto-save
- `src/components/DataloggerDownload.tsx` - Hook into auto-save after BLE download
- `src/pages/Index.tsx` - Wire up file manager state, change FolderOpen button behavior

---

### 1. IndexedDB Storage Layer (`src/lib/fileStorage.ts`)

A thin wrapper around IndexedDB using the `idb`-free raw API (no new dependencies).

```text
Database: "dove-file-manager"
Object Store: "files"
Key: filename (string)
Value: { name: string, data: Blob, size: number, savedAt: number }
```

**Exported functions:**
- `initFileDB()` - Open/create the database
- `saveFile(name: string, data: Blob): Promise<void>`
- `listFiles(): Promise<FileEntry[]>` - Returns `{ name, size, savedAt }`
- `getFile(name: string): Promise<Blob | null>`
- `deleteFile(name: string): Promise<void>`
- `getStorageEstimate(): Promise<{ used: number, quota: number } | null>` - Wraps `navigator.storage.estimate()`

All functions handle errors gracefully and log warnings.

---

### 2. File Manager Hook (`src/hooks/useFileManager.ts`)

Manages reactive state for the file list and storage usage.

**State:**
- `files: FileEntry[]` - Current list of stored files
- `storageUsed: number` / `storageQuota: number` - From storage estimate
- `isOpen: boolean` - Drawer open/close

**Methods:**
- `open()` / `close()` - Toggle drawer
- `refresh()` - Re-fetch file list + storage estimate from IndexedDB
- `saveFile(name, blob)` - Save + refresh
- `removeFile(name)` - Delete + refresh
- `exportFile(name)` - Get blob, create download link, trigger browser download

---

### 3. File Manager Drawer UI (`src/components/FileManagerDrawer.tsx`)

A slide-in overlay panel rendered at the app root level (inside Index.tsx).

**Layout:**
```text
+-------------------------------+
| [X]  File Manager             |  <- Header with close button
+-------------------------------+
|                               |
|  file1.nmea         [D] [Ex] |  <- Scrollable file list
|  file2.csv          [D] [Ex] |     D = Delete, Ex = Export
|  file3.vbo          [D] [Ex] |
|                               |
|  (empty state when no files)  |
|                               |
+-------------------------------+
|  [====........] 12MB / 500MB  |  <- Storage usage bar
+-------------------------------+
|  [Upload files] [BT Import]  |  <- Bottom action bar
+-------------------------------+
```

**Sizing:**
- Desktop/tablet: `w-[28vw] min-w-[320px]` fixed to right edge
- Mobile (`< 640px`): `w-full`
- Uses `fixed inset-y-0 right-0 z-50` with backdrop overlay
- Slide-in animation via CSS transform transition

**Interactions:**
- Click filename: Confirmation dialog "Load {filename}?" then parse blob, call `onDataLoaded`, close drawer
- Delete button: Confirmation dialog "Delete {filename}? This cannot be undone." then remove from IndexedDB
- Export button: Trigger browser file download with original filename and blob content
- "Upload files": Opens hidden file input (same accept types as FileImport)
- "Import via Bluetooth": Triggers BLE connect flow (reuses DataloggerDownload logic)

**Storage bar:**
- Progress bar showing used/quota from `navigator.storage.estimate()`
- Text: "12.3 MB used of 500 MB" or "Storage usage unavailable"

---

### 4. Settings Toggle

**`src/hooks/useSettings.ts`** - Add to `AppSettings`:
```typescript
autoSaveFiles: boolean;  // default: true
```

**`src/components/SettingsModal.tsx`** - Add new section at the TOP of the settings list (before Speed Unit), with a `HardDrive` icon:
- Label: "Auto-save imported/uploaded files to device"
- Switch toggle, default ON
- Description: "Automatically store files in on-device storage for later access"

---

### 5. Home Page Changes (`src/components/FileImport.tsx`)

Current buttons: `[Browse Files]` `[Download from DovesDataLogger]`

New buttons: `[Upload Files]` `[Browse Files]` `[Download from DovesDataLogger]`

- Rename existing "Browse Files" to "Upload Files" (keeps the hidden file input behavior)
- Add new "Browse Files" button that calls `onOpenFileManager()` callback
- New prop: `onOpenFileManager: () => void`
- New prop: `autoSaveFile: (name: string, blob: Blob) => Promise<void>` - called after successful file parse when auto-save is ON
- New prop: `autoSave: boolean`

After a file is successfully parsed via upload, if `autoSave` is true, also call `autoSaveFile(file.name, file)` to persist the original File blob.

---

### 6. Bluetooth Auto-Save (`src/components/DataloggerDownload.tsx`)

- Add props: `autoSave: boolean`, `autoSaveFile: (name: string, blob: Blob) => Promise<void>`
- After successful BLE download + parse, if `autoSave` is true, save the raw `Uint8Array` as a Blob to IndexedDB via the callback

---

### 7. Index.tsx Wiring

**New state/hooks:**
- `useFileManager()` hook instance
- File manager open/close state

**Home page (no data loaded):**
- Pass `onOpenFileManager`, `autoSave`, and `autoSaveFile` to `FileImport`
- Pass `autoSave` and `autoSaveFile` to `DataloggerDownload` (through FileImport)
- Render `FileManagerDrawer` overlay

**Data loaded view:**
- Change the `FolderOpen` button (line 496) from `onClick={() => setData(null)}` to `onClick={() => fileManager.open()}`
- Render `FileManagerDrawer` overlay
- When a file is loaded from the file manager, parse it through `parseDatalogFile` and call `handleDataLoaded`

---

### Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/fileStorage.ts` | **New** | IndexedDB CRUD wrapper |
| `src/hooks/useFileManager.ts` | **New** | Reactive file list + storage state |
| `src/components/FileManagerDrawer.tsx` | **New** | Overlay drawer UI |
| `src/hooks/useSettings.ts` | Edit | Add `autoSaveFiles` setting |
| `src/components/SettingsModal.tsx` | Edit | Add auto-save toggle at top |
| `src/components/FileImport.tsx` | Edit | Rename button, add Browse Files, auto-save hook |
| `src/components/DataloggerDownload.tsx` | Edit | Add auto-save after BLE download |
| `src/pages/Index.tsx` | Edit | Wire file manager, change FolderOpen behavior |

