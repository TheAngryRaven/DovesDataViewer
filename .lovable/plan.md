

# Fix Video Sync to Use Entire Session

## Problem
Video sync currently receives `visibleSamples` (filtered by selected lap + range slider). When the user switches laps, the sample array changes and the sync offset becomes meaningless -- the video jumps around or goes out of range. The sync point should be relative to the entire session so switching laps just moves the cursor within the same absolute timeline.

## Additional Feature
Show the last-used video filename above the "Load Video" button so users know which file to re-attach after reopening the app. The File System Access API auto-restore breaks after the browser closes (this is a browser security feature, not a bug), so displaying the filename is the workaround.

## Changes

### 1. `src/hooks/useVideoSync.ts` -- Accept full session samples

Add a new `allSamples` parameter to `UseVideoSyncOptions`. This is the complete `data.samples` array (never filtered). The existing `samples` + `currentIndex` params continue to represent the visible/cropped view for UI purposes.

**Video-drives-data (playing + locked):** Convert video time to absolute telemetry time using `allSamples`, then find the corresponding index within `samples` (visible) to call `onScrub`. If the telemetry time falls outside the visible window, set `isOutOfRange` to true.

**Data-drives-video (paused + locked):** Look up the current visible sample's `.t` timestamp directly (already absolute), subtract `syncOffsetMs`, and seek the video. This path already works correctly since `sample.t` is absolute.

**Set sync point:** Use `allSamples` to find the absolute timestamp at `currentIndex` mapped back through the visible samples. Actually, since `visibleSamples[currentIndex].t` is already absolute, the existing logic (`samples[currentIndex].t - videoMs`) is correct. The key fix is in the playback loop.

### 2. `src/hooks/useVideoSync.ts` -- `findNearestIndex` for visible samples

When video drives data, the flow becomes:
1. `videoMs = video.currentTime * 1000`
2. `telemetryMs = videoMs + syncOffsetMs` (absolute session time)
3. Find the nearest index within `samples` (visible) by matching `.t` values
4. Call `onScrub(idx)`

Since `visibleSamples` already contain absolute `.t` timestamps, the existing `findNearestIndex` searching by `.t` actually works. The bug is that when samples change (lap switch), the indices shift but the binary search still finds the right timestamp. So the real fix is simpler than expected -- we just need to detect when the telemetry time falls outside the visible samples' time range and set `isOutOfRange`.

**Key change:** In the video-drives-data loop, after finding `idx`, check if `telemetryMs` is outside `[samples[0].t, samples[samples.length-1].t]` and set `isOutOfRange` accordingly instead of comparing to video duration.

### 3. `src/pages/Index.tsx` -- Pass `allSamples` to `useVideoSync`

Change the call from:
```
useVideoSync({ samples: visibleSamples, ... })
```
to:
```
useVideoSync({ samples: visibleSamples, allSamples: data?.samples ?? [], ... })
```

The `allSamples` will be used inside the hook for sync point calculation, while `samples` (visible) is used for index-based scrubbing.

### 4. `src/components/VideoPlayer.tsx` -- Show last-used video filename

When no video is loaded but `state.videoFileName` exists (restored from IndexedDB), display it above the "Load Video" button as a hint like:

```
Last used: session_recording.mp4
```

Styled as subtle `text-xs text-muted-foreground` text so users know which file to re-attach.

### 5. `src/lib/videoStorage.ts` -- No changes needed

The `videoFileName` is already persisted in the `VideoSyncRecord`. The existing save/load logic handles this correctly.

## Technical Details

- The `allSamples` array provides the absolute time reference for sync calculations
- `visibleSamples[i].t` values are already absolute timestamps (they're slices of the original array), so data-drives-video already works correctly
- The main fix is ensuring video-drives-data correctly maps absolute time back to a visible sample index, and gracefully handles out-of-range when the video time doesn't correspond to the currently visible lap
- No IndexedDB schema changes needed -- `videoFileName` is already stored
- The "last used" filename display is purely cosmetic and reads from existing persisted state
