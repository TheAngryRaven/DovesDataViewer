

## Multi-Purpose Drawer: Files, Karts, and Setups

### Overview

Transform the current file manager drawer into a tabbed, multi-purpose management panel. The drawer shell (backdrop, header, close button, animation) becomes a reusable container with a tab bar at the top. Each tab renders its own self-contained content component. The drawer always opens to the "Files" tab by default.

### Architecture

```text
FileManagerDrawer (shell + tabs)
  |-- FilesTab (existing file manager content, extracted as-is)
  |-- KartsTab (kart list + add/edit form)
  |-- SetupsTab (placeholder)
```

### New Files

| File | Purpose |
|------|---------|
| `src/lib/kartStorage.ts` | IndexedDB CRUD for the "karts" object store (same DB, bumped version) |
| `src/hooks/useKartManager.ts` | Hook wrapping kart CRUD state + refresh logic |
| `src/components/drawer/FilesTab.tsx` | Extracted file manager content (list, confirmations, upload actions, storage bar) |
| `src/components/drawer/KartsTab.tsx` | Kart list (top half) + add/edit form (bottom half) |
| `src/components/drawer/SetupsTab.tsx` | Placeholder tab with a "Coming soon" message |

### Modified Files

| File | Changes |
|------|---------|
| `src/lib/fileStorage.ts` | Bump `DB_VERSION` to 3, add "karts" object store in `onupgradeneeded` |
| `src/components/FileManagerDrawer.tsx` | Replace inner content with a tab bar (`Files | Karts | Setups`) and render the matching tab component. Header title changes to just the app icon + close button. Always defaults to "Files" tab on open. |
| `src/pages/Index.tsx` | Pass kart manager hook data into the drawer (minor prop additions) |

### Detailed Design

**1. IndexedDB - Kart Storage (`src/lib/kartStorage.ts`)**

- Kart interface: `{ id: string, name: string, engine: string, number: number, weight: number, weightUnit: "lb" | "kg" }`
- `id` uses `crypto.randomUUID()` for unique keys
- Functions: `saveKart`, `listKarts`, `deleteKart`, `getKart`
- Reuses the same `dove-file-manager` database, version bumped to 3
- New object store `karts` with `keyPath: "id"` created in `onupgradeneeded`

**2. Kart Manager Hook (`src/hooks/useKartManager.ts`)**

- State: `karts: Kart[]`, manages refresh cycle
- Exposes: `karts`, `refresh`, `addKart`, `updateKart`, `removeKart`
- Called from `Index.tsx` alongside the existing `useFileManager` hook

**3. FilesTab (`src/components/drawer/FilesTab.tsx`)**

- Extracted directly from the current `FileManagerDrawer.tsx` inner content
- Receives the same props (files, storage, callbacks, autoSave)
- Contains: confirmation banners, file list, storage bar, upload/BLE buttons

**4. KartsTab (`src/components/drawer/KartsTab.tsx`)**

- **Top half (~50%)**: Scrollable list of karts, each row shows name, engine, number, weight+unit. Two icon buttons per row: Edit (pencil) and Delete (trash). Delete shows an inline confirmation banner (same pattern as files).
- **Bottom half (~50%)**: Add/Edit form with:
  - Text input: Name
  - Text input: Engine
  - Number input: Number (integer)
  - Number input: Weight (step 0.01 for two decimal places)
  - Switch next to weight toggling lb/kg (defaults to lb)
  - Button labeled "Add Kart" or "Update Kart" depending on whether an existing kart is being edited
  - When editing, form is pre-populated; pressing the button saves changes and clears the form back to "Add" mode
  - A small "Cancel" link/button to exit edit mode without saving

**5. SetupsTab (`src/components/drawer/SetupsTab.tsx`)**

- Simple centered placeholder: wrench icon + "Setups coming soon" text

**6. Drawer Shell Updates (`FileManagerDrawer.tsx`)**

- Header simplified: generic icon + "Garage" or similar title + close button
- Below header: tab bar using three buttons styled as pills/segments: `Files | Karts | Setups`
- Active tab highlighted with primary color
- State: `activeTab` defaults to `"files"` and resets to `"files"` each time the drawer opens
- Renders the matching tab component below the tab bar

### Technical Notes

- The `onupgradeneeded` handler in `fileStorage.ts` will be updated to handle version 3 by adding the `karts` store if it doesn't exist, without touching existing stores
- All kart data persists locally in IndexedDB, no server needed
- The tab bar uses simple button styling (not Radix Tabs) to keep it lightweight and match the existing drawer aesthetic
- The 50/50 split on the Karts tab uses `flex` with `flex-1` and `overflow-y-auto` on the list portion

