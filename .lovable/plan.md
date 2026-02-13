

# Video Player Toolbar, Overlay Settings, and Auto-Hide

## Overview
Restructure the video player controls into a unified bottom toolbar area that auto-hides during playback, add a configurable overlay system persisted per session in IndexedDB, and introduce an overlay settings popup.

## Layout Changes

The current video player has controls scattered between the top-right corner (sync/lock/frame-step) and a bottom progress bar. The new structure consolidates everything into a single bottom control group:

```text
+--------------------------------------------------+
|                                                  |
|          VIDEO AREA (click to toggle toolbar)    |
|   [Speed Overlay]                                |
|                                                  |
+--------------------------------------------------+
| TOOLBAR: [Play] [Mute] [+] [-] [Lock] [Sync] [Overlay Settings] |
| PROGRESS: [============================] 1:23/5:00 [Replace]     |
+--------------------------------------------------+
```

The toolbar + progress bar group fades out after ~3 seconds while video is playing. It always shows when paused. Clicking/tapping the video area (not the toolbar) toggles visibility.

## What Changes

### 1. `src/lib/videoStorage.ts` -- Add overlay settings to persistence
- Add an `overlaySettings` field to `VideoSyncRecord` with shape `{ showSpeed: boolean }` (extensible later)
- Overlay settings persist independently of the video file -- they stay even if the video is replaced or can't be loaded

### 2. `src/hooks/useVideoSync.ts` -- Expose overlay state
- Add `overlaySettings` to `VideoSyncState`
- Add `updateOverlaySettings` to `VideoSyncActions`
- Restore overlay settings from IndexedDB on session load
- Persist overlay changes via the existing `persistSync` helper

### 3. `src/components/VideoPlayer.tsx` -- Major restructure
- **Remove** the top-right control group entirely
- **New toolbar row** above the progress bar: contains Play, Mute, frame-step (+/-), Lock, Set Sync, and an Overlay Settings button (Sliders icon)
- **Progress bar row** below: progress scrubber, timecode, replace button (same as current)
- Both rows wrapped in a single container with `bg-black/90` styling
- **Speed overlay** now conditional on `overlaySettings.showSpeed`
- **Auto-hide logic**:
  - `controlsVisible` state, default `true`
  - When `isPlaying` becomes true, start a 3-second timer; on expiry set `controlsVisible = false`
  - When `isPlaying` becomes false, set `controlsVisible = true`
  - Any pointer activity on the toolbar resets the 3-second timer
  - Clicking the video area (not the toolbar) toggles `controlsVisible`
  - The toolbar container uses `opacity` + `pointer-events-none` transition for smooth fade
- **Overlay Settings popup**: a small absolute-positioned panel that opens above the toolbar when the settings button is clicked, containing a toggle for "Show Speed". Clean card-style with backdrop blur.

## Technical Details

### VideoSyncRecord update
```typescript
interface OverlaySettings {
  showSpeed: boolean;
}

interface VideoSyncRecord {
  sessionFileName: string;
  fileHandle?: FileSystemFileHandle;
  syncOffsetMs: number;
  videoFileName: string;
  overlaySettings?: OverlaySettings;
}
```

No DB version bump needed -- IndexedDB stores are schemaless, adding a new optional field to existing records is safe.

### Auto-hide implementation
- A `useEffect` watches `isPlaying`: when true, sets a `setTimeout(3000)` to hide; clears on pause or unmount
- `onPointerMove` on the toolbar container resets the timer (clears + restarts)
- `onClick` on the video element (not toolbar) toggles visibility
- CSS: `transition-opacity duration-300` with `opacity-0 pointer-events-none` when hidden

### Files Modified (3 total)
1. **`src/lib/videoStorage.ts`** -- Add `OverlaySettings` type and optional field to record
2. **`src/hooks/useVideoSync.ts`** -- Add overlay state, update action, restore/persist logic
3. **`src/components/VideoPlayer.tsx`** -- Full control restructure, auto-hide, overlay settings popup
