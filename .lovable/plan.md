

# Plan Update: Global Unit Toggle

The approved plan currently has unit switches per-field for measurement fields. The user wants a single global unit toggle button (mm ↔ in) that applies to the entire setup form at once, rather than individual toggles on each row.

## Change to the Plan

**Remove**: Per-field `<UnitSwitch>` next to each measurement input.

**Add**: A single toggle button at the top of the setup form (e.g., "mm / in" button) that controls the display unit for ALL measurement fields in that setup simultaneously.

### How it works:
- The setup stores a single `unitSystem: "mm" | "in"` field (replaces the per-field `frontWidthUnit`, `rearWidthUnit`, `rearHeightUnit`, `tireWidthUnit`, `tireDiameterUnit` fields on the current setup)
- Template fields that have a unit of `"mm"` or `"in"` all follow the global toggle
- Values are stored as-entered (no conversion) — the unit just labels what the user typed
- The toggle button sits at the top of the form, styled distinctly (like a segmented control or small outlined button showing the active unit)

### Impact on template creator:
- When defining a field, the user still types a unit string (e.g., "psi", "teeth", "degrees") — these are just labels
- The special `"mm"` / `"in"` pair is recognized as switchable and follows the global toggle
- Other units display as static suffixes

This is a minor simplification — fewer controls per row, cleaner form, one source of truth for measurement units.

No other changes to the approved plan.

