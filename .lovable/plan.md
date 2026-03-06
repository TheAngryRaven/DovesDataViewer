

# Fix Video Export Playback + Overlay Bugs + Stored Video UX

## 6 Issues to Fix

### 1. Exported video only plays first half-second
The export pipeline captures the video playing from `startTime` to `endTime`, but `fix-webm-duration` receives `durationMs` calculated correctly. The issue is likely that MediaRecorder's `captureStream(fps)` doesn't generate enough keyframes. The `recorder.start(500)` timeslice should help, but the real problem may be that the browser only plays until the first seek point. We should request keyframes more aggressively by using `recorder.start(100)` (100ms chunks = more frequent keyframes in the WebM) and ensure the video element's playback rate is 1.0 during export.

### 2. Stored video meta not showing after save-to-app (until reload)
In `VideoPlayer.tsx` line 471-477, after `saveSessionVideo` completes, it imports `getSessionVideoMeta` dynamically but doesn't actually update the state. The `storedVideoMeta` state lives in `useVideoSync`, but the save handler in VideoPlayer has no way to refresh it. Fix: add a `refreshStoredMeta` action to `useVideoSync` and call it after save completes.

### 3. Deleting video doesn't remove it from the player
`handleDeleteStoredVideo` in `useVideoSync` clears the meta state but doesn't revoke the URL or clear `videoUrl`. Fix: if the current video was loaded from IndexedDB (no fileHandle), also revoke the URL and clear `videoUrl`/`videoFileName`.

### 4. Map overlay shows entire session instead of selected lap
`MapOverlay` uses `ctx.allSamples` for drawing the track line. Should use `ctx.samples` (visible range, which is the selected lap when a lap is selected) for the track outline, and `ctx.allSamples` only as a fallback when no lap is selected. The position dot uses `ctx.currentSample` which is correct.

### 5. Pace overlay indicator moves in wrong direction
The comment says "Negative pace (ahead) fills right from center, positive fills left" but this is backwards. Looking at the labels: left = SLOW, right = FAST. So negative pace (faster/ahead) should fill LEFT from center (toward FAST label on the right — wait, labels are `SLOW` on left, `FAST` on right). Actually re-reading: when you're FAST (negative pace), the bar should go RIGHT (toward FAST). Currently the fill for negative fraction goes left of center. The labels say SLOW on left, FAST on right, so negative (ahead/fast) should fill right. But the code fills LEFT for negative. Fix: swap the fill direction — negative fraction fills right from center, positive fills left.

Wait, let me re-read carefully:
- `fraction < 0` → `left: 50 + fraction*50` (goes left of center)
- `fraction > 0` → `left: 50%` (starts at center, goes right)
- Labels: left=SLOW, right=FAST
- Negative pace = ahead = FAST

So currently negative (fast) fills LEFT toward "SLOW" label. That's backwards. Fix: swap the direction.

### 6. Sector overlay shows static deltas, not real-time
The sector overlay currently reads `currentLap.sectors` which are the FINAL sector times for the completed lap. It doesn't respond to scrubbing — it always shows the same values regardless of where in the lap you are. 

Fix: Make it time-aware. Using `currentSample.t` relative to `currentLap.startTime`, determine which sector the cursor is currently in:
- Before sector2 crossing: S1 is "in progress" (show grey/active), S2/S3 are blank
- After sector2 crossing but before sector3: S1 shows its delta, S2 is "in progress", S3 is blank  
- After sector3 crossing: S1/S2 show deltas, S3 is "in progress"
- After lap end (or viewing completed lap statically): show all final deltas

Need sector crossing absolute times. These can be derived from `lap.startTime + sectors.s1` for sector2 crossing, `lap.startTime + sectors.s1 + sectors.s2` for sector3 crossing.

## File Changes

| File | Change |
|------|--------|
| `src/lib/videoExport.ts` | Change `recorder.start(500)` → `recorder.start(100)` for better keyframes |
| `src/hooks/useVideoSync.ts` | Add `refreshStoredMeta` action; update `handleDeleteStoredVideo` to also clear video URL when loaded from storage |
| `src/components/VideoPlayer.tsx` | Call `refreshStoredMeta` after save; track whether video came from storage |
| `src/components/video-overlays/MapOverlay.tsx` | Use `ctx.samples` instead of `ctx.allSamples` for track line |
| `src/components/video-overlays/PaceOverlay.tsx` | Swap fill direction so negative (fast) goes right toward FAST label |
| `src/components/video-overlays/SectorOverlay.tsx` | Rewrite to be time-aware: show sectors progressively as cursor advances through the lap |

