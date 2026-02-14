

## Dark/Light Mode Toggle

### Overview
Add a dark/light mode switch to the Settings panel. The current dark theme becomes the default. A light mode alternative will be created. Critically, the canvas-drawn charts (TelemetryChart, SingleSeriesChart) have hardcoded dark HSL colors that must also respond to the theme.

### Approach

**1. Add `darkMode` setting to `useSettings` and `SettingsContext`**
- Add `darkMode: boolean` (default: `true`) to `AppSettings` in `src/hooks/useSettings.ts`
- Expose it through `SettingsContext` in `src/contexts/SettingsContext.tsx`

**2. Apply `dark` class to document root**
- In `src/pages/Index.tsx` (or `App.tsx`), use a `useEffect` that toggles `document.documentElement.classList` between `dark` and removing it, based on the `darkMode` setting.

**3. Define light mode CSS variables in `src/index.css`**
- The current `:root` block already defines the dark palette. Add a second block (outside `.dark`) for light mode values:
  - Light backgrounds (white/near-white)
  - Dark text
  - Adjusted muted, border, card colors for light backgrounds
  - Adjusted racing/chart colors for readability on light backgrounds
- Keep the `.dark` block as-is (it already mirrors `:root`)
- Change `:root` to contain the light theme values, and keep `.dark` for the dark overrides (this is the standard Tailwind dark mode pattern)

**4. Create a chart color helper**
- Create a small utility (e.g., `src/lib/chartColors.ts`) that returns the correct hardcoded canvas colors based on a `darkMode` boolean:
  ```
  chartBg, chartGrid, chartAxisText, chartTooltipBg, chartTooltipBorder, scrubCursor
  ```
- Update `TelemetryChart.tsx` and `SingleSeriesChart.tsx` to import and use these instead of inline HSL strings. Both components already have access to `useSettingsContext()`.

**5. Add toggle to SettingsModal**
- Add a "Theme" section near the top of `src/components/SettingsModal.tsx` with a Sun/Moon switch toggle between Dark and Light mode.

### Files to modify
- `src/hooks/useSettings.ts` -- add `darkMode: boolean` to AppSettings
- `src/contexts/SettingsContext.tsx` -- expose `darkMode`
- `src/index.css` -- restructure CSS variables: light in `:root`, dark in `.dark`
- `src/pages/Index.tsx` (or `src/App.tsx`) -- apply/remove `.dark` class on `<html>`
- `src/lib/chartColors.ts` -- new file, chart color palette helper
- `src/components/graphview/SingleSeriesChart.tsx` -- use chart color helper
- `src/components/TelemetryChart.tsx` -- use chart color helper
- `src/components/SettingsModal.tsx` -- add Dark/Light toggle UI

### Notes
- The Leaflet map already has a dark tile layer and won't need CSS variable changes -- it uses its own tile URLs
- Map marker SVG colors (arrow icon, speed event badges) are functional colors and should remain as-is in both modes
- The `tailwind.config.ts` already has `darkMode: ["class"]` configured, so the class-based approach works out of the box

