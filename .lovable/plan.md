

# Labs Tab — Video Sync Implementation

## Overview
Add a gated "Labs" tab with synchronized video playback alongside the existing telemetry graph. Users can load a local video, set a manual sync point, and scrub/play video and telemetry in lockstep.

## New Files (4)

### 1. `src/lib/videoStorage.ts`
IndexedDB persistence for video sync data (file handle, sync offset, video filename) per session. Uses a new `VIDEO_SYNC` object store.

### 2. `src/hooks/useVideoSync.ts`
Core hook managing:
- File loading via File System Access API (with `<input>` fallback for Safari)
- Object URL lifecycle
- Sync offset calculation (`syncOffset = telemetryTimestamp - videoCurrentTimeMs`)
- Bidirectional sync: video drives data via `requestVideoFrameCallback`, data drives video via throttled seeks
- Frame stepping, play/pause, lock/unlock state
- FPS detection from video metadata
- Persistence and restoration of sync state from IndexedDB

### 3. `src/components/VideoPlayer.tsx`
Self-contained video player component with:
- Native `<video>` element with custom controls
- Speed overlay (upper-left) showing current speed in user's preferred unit
- Upper-right controls: +/- frame step (unlocked only) and Lock/Unlock toggle
- "Set Sync Point" button to capture sync offset
- Progress bar with play/pause (progress bar disabled when locked)
- "No video for this portion" overlay when telemetry maps outside video duration
- "Load Video" prompt when no video is attached

### 4. `src/components/tabs/LabsTab.tsx`
Tab component using `ResizableSplit` (60/40 default):
- Top panel: `VideoPlayer`
- Bottom panel: Reuses `TelemetryChart` + `RangeSlider` (identical to Race Line tab)

## Modified Files (5)

### 5. `src/lib/dbUtils.ts`
- Bump `DB_VERSION` from 5 to 6
- Add `VIDEO_SYNC: "video-sync"` to `STORE_NAMES`
- Create the new object store in `onupgradeneeded` with keyPath `sessionFileName`

### 6. `src/hooks/useSettings.ts`
- Add `enableLabs: boolean` (default `false`) to `AppSettings` interface and defaults

### 7. `src/contexts/SettingsContext.tsx`
- Add `enableLabs: boolean` to `SettingsContextValue`

### 8. `src/components/SettingsModal.tsx`
- Add a new "Super Experimental Features" section at the bottom with a Flask icon
- Toggle switch: "Enable Labs tab with experimental video sync and analysis tools"

### 9. `src/pages/Index.tsx`
- Add `"labs"` to `TopPanelView` union type
- Import `LabsTab`, `useVideoSync`, and `Flask` icon
- Initialize `useVideoSync` hook with session data
- Expose `enableLabs` in settings context value
- Conditionally render `LabsTab` when `topPanelView === "labs"`
- Update `TabBar` to accept `enableLabs` prop and render Labs tab button (with Flask icon) only when enabled

## Sync Architecture

The relationship between video and telemetry timelines:

```text
telemetryMs = (video.currentTime * 1000) + syncOffset

Locked mode, video playing:
  requestVideoFrameCallback -> compute telemetryMs -> binary search nearest sample -> onScrub(idx)

Locked mode, user scrubs graph:
  currentIndex changes -> compute videoSec from sample.t -> video.currentTime = videoSec
  (throttled to max ~15 seeks/sec to avoid decoder stutter)

Unlocked mode:
  Video and telemetry are independent. +/- step frames, free scrub progress bar.
```

## Key Constraints
- NO file copying into storage (videos are multi-GB)
- NO ffmpeg.wasm -- native `<video>` element only
- Use `requestVideoFrameCallback` for frame-accurate sync (rAF fallback for Firefox)
- FileSystemFileHandle persisted in IndexedDB for session restore
- Object URLs revoked on cleanup
- Feedback loop prevention via `isSyncingRef`
