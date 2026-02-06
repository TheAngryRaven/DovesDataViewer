

## Kart Setups Tab - Full Implementation (with field type corrections)

### Overview

Replace the placeholder Setups tab with a fully functional setup management system. The tab has two views: a **list view** showing saved setups, and a **form view** for creating/editing. Setups are linked to karts and stored in a new IndexedDB object store (DB version 5).

### Field Types (corrected)

| Field | Type | Precision | Input Constraints |
|-------|------|-----------|-------------------|
| Toe | integer | whole number | `step="1"` |
| Camber | integer | whole number | `step="1"` |
| Castor | integer | whole number | `step="1"` |
| Front Width | number | 0.00 | `step="0.01"` |
| Rear Width | number | 0.00 | `step="0.01"` |
| Rear Height | number | 0.00 | `step="0.01"` |
| Front Sprocket | integer | whole number | `step="1"` |
| Rear Sprocket | integer | whole number | `step="1"` |
| Steering Setting | integer | 1-5 | `min=1 max=5 step="1"` |
| Spindle Setting | integer | 1-5 | `min=1 max=5 step="1"` |
| All PSI fields | number | 0.00 | `step="0.01"` |
| All Tire Width fields | number | 0.00 | `step="0.01"` |

### New Files

| File | Purpose |
|------|---------|
| `src/lib/setupStorage.ts` | IndexedDB CRUD for "setups" store, index on `kartId`, `getLatestSetupForKart` helper |
| `src/hooks/useSetupManager.ts` | Hook wrapping setup CRUD + state refresh |

### Modified Files

| File | Changes |
|------|---------|
| `src/lib/fileStorage.ts` | Bump DB_VERSION to 5, add "setups" store in onupgradeneeded |
| `src/lib/kartStorage.ts` | Bump DB_VERSION to 5 |
| `src/lib/noteStorage.ts` | Bump DB_VERSION to 5 |
| `src/components/drawer/SetupsTab.tsx` | Full rewrite with list view + form sub-view |
| `src/components/FileManagerDrawer.tsx` | Pass karts + setup manager props to SetupsTab |
| `src/pages/Index.tsx` | Wire up useSetupManager hook, pass to drawer |

### Data Model (`KartSetup`)

- `id`: string (auto, crypto.randomUUID)
- `kartId`: string (required, links to Kart)
- `name`: string (required)
- `toe`, `camber`, `castor`: number or null (integers)
- `frontWidth`, `rearWidth`, `rearHeight`: number or null (0.00 precision)
- `frontWidthUnit`, `rearWidthUnit`, `rearHeightUnit`: "mm" or "in" (default "mm")
- `frontSprocket`, `rearSprocket`: number or null (integers)
- `steeringBrand`: string
- `steeringSetting`, `spindleSetting`: number or null (1-5 integers)
- `tireBrand`: string
- `psiMode`: "single" / "halves" / "quarters" (default "single")
- `psiFrontLeft`, `psiFrontRight`, `psiRearLeft`, `psiRearRight`: number or null (0.00)
- `tireWidthMode`: "halves" / "quarters" (default "halves")
- `tireWidthFrontLeft`, `tireWidthFrontRight`, `tireWidthRearLeft`, `tireWidthRearRight`: number or null (0.00)
- `tireWidthUnit`: "mm" or "in" (default "mm")
- `createdAt`, `updatedAt`: number (timestamps)

Validation: kartId, name, and at least one setting field must be filled.

### UI Design

**List View (default)**
- Scrollable list of setups showing name, linked kart name, date
- Edit (pencil) and Delete (trash) per row; delete uses inline confirmation banner
- "Add New Setup" button at bottom
- Empty state: wrench icon + "No setups yet"

**Form View (replaces list within the tab)**
- Back arrow at top to return to list
- Title: "New Setup" or "Edit Setup"
- Scrollable form with sections separated by dividers, in this order:

1. **Kart and Name** -- Kart dropdown (from saved karts), Setup Name text input
2. **Alignment** -- Toe, Camber, Castor (integer inputs, step=1)
3. **Dimensions** -- Front Width, Rear Width, Rear Height (step=0.01, each with mm/in switch)
4. **Sprockets** -- Front Sprocket, Rear Sprocket (integer inputs, step=1)
5. **Steering** -- Steering Column Brand (text), Steering Setting (1-5), Spindle Setting (1-5)
6. **Tires** -- Tire Brand (text)
7. **Tire PSI** -- 3-way toggle (Single/Halves/Quarters), dynamic inputs (step=0.01)
8. **Tire Widths** -- 2-way toggle (Halves/Quarters), dynamic inputs (step=0.01, with mm/in switch)
9. **Save/Update button + Cancel**

### Pre-load Logic

When selecting a kart in a **new** setup form:
1. Query `getLatestSetupForKart(kartId)` (most recent by `updatedAt`)
2. If found, populate all fields except `name` (stays empty) and `id` (new)
3. Show small info indicator: "Pre-loaded from last setup"
4. Only triggers for new setups, not edits

### PSI/Width Mode Mapping

- **Single PSI**: one input, all four fields get same value on save
- **Halves PSI**: two inputs (Front/Rear), FL+FR share front value, RL+RR share rear
- **Quarters PSI**: four independent inputs (FL/FR/RL/RR)
- **Halves Width**: two inputs (Front/Rear), same sharing pattern
- **Quarters Width**: four independent inputs
- On edit load, mode is auto-detected from stored values (all equal = single, pairs equal = halves, else quarters)

