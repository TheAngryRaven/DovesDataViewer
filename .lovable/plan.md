
# Add Privacy Policy Page

## Overview
Add a simple boilerplate privacy policy page at `/privacy` with a link always visible at the bottom of the homepage. The privacy content about track submissions and IP logging will be conditionally shown based on the `VITE_ENABLE_ADMIN` flag.

## Changes

### 1. New file: `src/pages/Privacy.tsx`
A clean, readable standalone page covering:
- All telemetry data, notes, setups, karts, graph preferences, and video sync are stored locally in your browser (IndexedDB and localStorage) -- nothing leaves your device
- No cookies, no analytics, no tracking scripts
- **Conditional block (only when `VITE_ENABLE_ADMIN` is true):** When submitting tracks or courses to the community database, your IP address is logged solely for spam prevention and rate limiting
- No personal information is required for any core feature
- How to clear local data (browser settings / clear site data)
- Back link to homepage

### 2. Update `src/App.tsx`
Add `/privacy` route (always available, not gated).

### 3. Update `src/pages/Index.tsx`
Add a "Privacy Policy" link below the GitHub links row (around line 485), using `react-router-dom` `Link`. The link itself is always visible. The conditional flag only controls the paragraph about IP logging inside the Privacy page itself.

## Technical Notes
- The Privacy page is a pure static component with zero backend calls -- fully offline-compatible
- Uses existing UI components and Tailwind styling to match the app's look
- The `VITE_ENABLE_ADMIN` flag is read inside `Privacy.tsx` to conditionally render the server-submission paragraph
- Import `Link` from `react-router-dom` for client-side navigation on the homepage
