

# Labs Tab — Video Sync Feature

## Overview

Add a new "Labs" tab to the main data view that provides synchronized video playback alongside the existing telemetry graph. The tab is gated behind a new "Enable super experimental features" toggle in Settings. When enabled, users can load a local video file, sync it to their telemetry data via a manual sync point, and scrub/play them in lockstep.

## New Files

### 1. `src/hooks/useVideoSync.ts` — Core video sync hook
Manages all video-related state:
- File loading via File System Access API (`showOpenFilePicker`) with `<input type="file">` fallback for Safari
- Persisting `FileSystemFileHandle` in IndexedDB keyed by session filename
- Object URL lifecycle (`createObjectURL` / `revokeObjectURL`)
- Sync offset storage and calculation (`syncOffset = telemetryTimestamp - videoCurrentTimeMs`)
- Bidirectional sync: video time to telemetry index and vice versa
- Frame-stepping (+/- one frame using `video.currentTime += 1/fps`)
- Lock/unlock state
- `requestVideoFrameCallback` loop for frame-accurate sync during video-driven playback
- Throttled seeking when telemetry drives video (debounce rapid scrubs)

### 2. `src/components/tabs/LabsTab.tsx` — Labs tab component
Layout using `ResizableSplit` (same as Race Line tab):
- **Top panel**: Video player area
- **Bottom panel**: Reuses `TelemetryChart` + `RangeSlider` (identical to Race Line tab's bottom panel)

### 3. `src/components/VideoPlayer.tsx` — Video player component
Self-contained video player with:
- Native `<video>` element (hidden controls, custom UI)
- **Upper-left overlay**: Speed display in user's preferred unit (from `useSettingsContext`)
- **Upper-right controls**: `+` / `-` frame step buttons (visible only when unlocked) and a Lock/Unlock toggle button
- **Bottom bar**: Play/Pause button on the left, custom progress/seek bar
- "No video for this portion" message when video time falls outside the video's duration
- "Load Video" button when no video is attached
- "Set Sync Point" button to capture current video time + telemetry cursor for offset calculation
- Progress bar scrubbing disabled when locked (sync mode)

### 4. `src/lib/videoStorage.ts` — IndexedDB persistence for video handles
Stores per-session:
- `FileSystemFileHandle` (structured-cloneable, Chromium only)
- `syncOffsetMs: number`
- `videoFileName: string` (for display and fallback re-attach prompt)

Uses a dedicated IndexedDB object store `video-sync` separate from file storage.

## Modified Files

### 5. `src/hooks/useSettings.ts`
Add `enableLabs: boolean` (default `false`) to `AppSettings`.

### 6. `src/contexts/SettingsContext.tsx`
Expose `enableLabs` in the context value.

### 7. `src/components/SettingsModal.tsx`
Add a new section at the very bottom with a `Flask` icon:
- "Super Experimental Features" heading
- Toggle switch: "Enable Labs tab with experimental video sync and analysis tools"

### 8. `src/pages/Index.tsx`
- Add `"labs"` to the `TopPanelView` union type
- Conditionally render `LabsTab` when `topPanelView === "labs"` and `settings.enableLabs`
- Pass the same telemetry chart props as Race Line tab (samples, fieldMappings, scrub handler, etc.)
- Update `TabBar` to accept `enableLabs` and render the Labs tab button (with `Flask` icon) only when enabled

## Sync Architecture

The sync between video and telemetry works as follows:

```text
+---------------------+       syncOffset        +---------------------+
|   Video Timeline    | <---------------------> | Telemetry Timeline  |
|   (seconds)         |   telemetryMs =         |   (sample.t in ms)  |
|                     |   videoSec*1000 + offset |                     |
+---------------------+                         +---------------------+

Locked Mode (video drives data):
  video playing -> requestVideoFrameCallback -> compute telemetryMs -> find nearest sample index -> onScrub()

Locked Mode (data drives video):
  user scrubs graph -> onScrub(index) -> compute videoSec from sample.t -> video.currentTime = videoSec

Unlocked Mode:
  Video and telemetry are independent. User can scrub video freely, step frames with +/-.
```

### Frame Rate Handling
- Detect video frame rate from `requestVideoFrameCallback` metadata or assume 30fps as default
- Telemetry at 25Hz and video at 30/60fps means not every video frame has a matching sample; use nearest-neighbor lookup via binary search on `sample.t`
- When telemetry drives video, throttle `video.currentTime` seeks to max ~15/sec to avoid decoder stutter

### Key Constraints (from spec)
- NO file copying into storage (videos are multi-GB)
- NO ffmpeg.wasm — native `<video>` only
- NO `setInterval`/`requestAnimationFrame` polling for sync — use `requestVideoFrameCallback`
- File System Access API for persistent handle; fallback to `<input type="file">` on Safari
- Object URLs revoked on cleanup

## Technical Notes

- The `requestVideoFrameCallback` API is supported in Chrome 83+, Edge 83+, and Safari 15.4+. For Firefox (no support), fall back to `requestAnimationFrame` + `video.currentTime` polling
- The Lock button defaults to "unlocked" so users can position the video before syncing
- The "Set Sync Point" workflow: user pauses video at a recognizable moment, scrubs telemetry to the matching point, clicks "Set Sync Point" — the offset is calculated and persisted
- When the video time maps to before/after the video's actual duration, the video element is paused and "No video for this portion" is shown as an overlay

