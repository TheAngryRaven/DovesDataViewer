

## Browser Compatibility Checklist Button + Dialog

### Concept
A button on the homepage below the "Try it out" section, styled like the weather button. Greyed out when all features pass, turns **blue** (not red) when any feature is degraded/unavailable. Clicking opens a dialog with a live-detected checklist.

### Feature Detection (`src/lib/browserCompat.ts`)
Runtime checks returning `{ feature, status, level: 'green' | 'yellow' | 'red' }`:

| Feature | Detection | Green | Yellow | Red |
|---|---|---|---|---|
| GPS File Parsing | `'indexedDB' in window` | Supported | — | Not Available |
| Video Sync | `'requestVideoFrameCallback' in HTMLVideoElement.prototype` | Frame-accurate | Approximate sync | — |
| Video Export (MP4) | `typeof VideoEncoder !== 'undefined'` | MP4 (H.264) | WebM fallback | — |
| Audio in Export | `typeof AudioEncoder !== 'undefined'` | Supported | Silent exports | — |
| BLE Datalogger | `navigator.bluetooth` | Supported | — | Not Available |
| File Picker | `'showOpenFilePicker' in window` | Native | File input fallback | — |
| PWA / Offline | `'serviceWorker' in navigator` | Supported | — | Not Available |

### Button Behavior
- Default: greyed out outline button with `Monitor` icon + "Browser Compatibility"
- If any check is yellow or red: button border/text turns blue (`text-blue-500 border-blue-500`)
- Always clickable regardless of state

### Dialog
- Lists all checks with CheckCircle (green), AlertTriangle (yellow/blue tint), XCircle (red/muted) icons
- Small note at bottom: "All core features work across modern browsers. Some advanced features work best in Chrome or Edge."
- No aggressive "download Chrome" messaging

### Files
- **New**: `src/lib/browserCompat.ts` — `detectCapabilities()` function
- **New**: `src/components/BrowserCompatDialog.tsx` — button + dialog component
- **Edit**: `src/pages/Index.tsx` — add `<BrowserCompatDialog />` after the "Try it out" card (around line 526)

