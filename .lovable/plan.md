

## Add Tire Diameter Section to Kart Setups

### Overview

Add a "Tire Diameter" section to the setup form, placed directly below Tire Widths. It follows the exact same pattern as Tire Widths: a Halves/Quarters toggle, mm/in unit switch, and 2 or 4 dynamic inputs with `step="0.01"` precision.

### Data Model Changes (`src/lib/setupStorage.ts`)

Add 6 new fields to the `KartSetup` interface:

| Field | Type | Default |
|-------|------|---------|
| `tireDiameterMode` | `"halves" \| "quarters"` | `"halves"` |
| `tireDiameterFrontLeft` | `number \| null` | `null` |
| `tireDiameterFrontRight` | `number \| null` | `null` |
| `tireDiameterRearLeft` | `number \| null` | `null` |
| `tireDiameterRearRight` | `number \| null` | `null` |
| `tireDiameterUnit` | `"mm" \| "in"` | `"mm"` |

No DB version bump needed -- IndexedDB is schemaless for object properties; only new object stores or indexes require version changes. Existing setups will simply have `undefined` for these fields, which the form handles as `null`.

### Files Modified

| File | Changes |
|------|---------|
| `src/lib/setupStorage.ts` | Add 6 new fields to `KartSetup` interface |
| `src/components/drawer/SetupsTab.tsx` | Add diameter defaults to `emptyForm`, add `detectDiameterMode` helper, add diameter display helpers (`diamFront`/`diamRear`), add "Tire Diameter" section to form UI (clone of Tire Widths pattern), include diameter fields in pre-load logic, save mapping, and edit loading |

### UI Addition

A new section appears below Tire Widths in the form:

```text
--- Tire Diameter ---
[Halves | Quarters toggle]  [mm/in switch]

Halves mode:
  Front [____]   Rear [____]

Quarters mode:
  FL [____]   FR [____]
  RL [____]   RR [____]
```

### Technical Details

- Clone the existing Tire Widths pattern exactly: same `ModeToggle`, `UnitSwitch`, `Field` components, same `step="0.01"` inputs
- Add `diamFront`/`diamRear` state for halves-mode display helpers (mirrors `widthFront`/`widthRear`)
- Add `detectDiameterMode` function (mirrors `detectWidthMode`)
- Pre-load logic copies diameter fields from latest setup, same as width fields
- Save logic maps halves mode to all four fields (front value to FL+FR, rear value to RL+RR)
- Validation includes diameter fields in the "at least one setting" check
