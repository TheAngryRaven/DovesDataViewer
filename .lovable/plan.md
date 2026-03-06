

# Fix Video Export + Add IndexedDB Video Storage

## Problems to Fix

### 1. Export hangs at 100%
The `recorder.onstop` fires asynchronously after `recorder.stop()`, but the `video.ended` check races with MediaRecorder finalization. The 500ms timeout is fragile. Also, the video `ended` event may fire before the last frame is drawn, or the progress reaches 1 but `recorder.stop()` hasn't been called reliably.

**Fix**: Listen for the video `ended` event explicitly instead of polling `videoElement.ended` in the frame loop. Call `recorder.stop()` from the `ended` handler, and only call `onComplete` from `recorder.onstop`.

### 2. Overlays not rendering in export
`overlayCanvas` is always passed as `null` (line 378 in VideoPlayer.tsx). The overlay system renders via React DOM components, not to a canvas. The export pipeline needs a reference to a canvas that captures the overlay layer.

**Fix**: Add an offscreen canvas that mirrors the overlay DOM layer. During export, use `html2canvas` or — better for performance — render overlays to a dedicated `<canvas>` element that sits over the video rect. Since overlays like Analog, Graph, Bubble already use canvas internally, we need a composite approach: place a transparent canvas over the video rect, and during export frames, capture the overlay container's visual state. The simplest reliable approach: add a `ref` to the overlay container div, and use the browser's built-in `drawImage` with an `OffscreenCanvas` created from the overlay DOM via a snapshot. However, `html2canvas` is heavyweight.

**Better approach**: Since we control all overlay rendering, add a "render to canvas" mode for each overlay type. During export, instead of rendering React components, call canvas drawing functions directly for each overlay instance. This keeps things fast and avoids DOM dependencies. Each overlay component already has the rendering logic — we extract the drawing into pure canvas functions.

**Pragmatic approach for now**: Use the existing overlay container div and capture it via `canvas.drawImage()` with an intermediate step — actually, we can use a dedicated overlay `<canvas>` that all overlays render to. The DOM-based overlays (Digital, Bar, Pace, Sector) would need canvas equivalents. This is a lot of work.

**Most pragmatic**: During export, render each frame's overlays to a temporary canvas using simple canvas 2D drawing for each overlay type. Create a `renderOverlaysToCanvas(ctx, width, height, overlays, renderCtx, dataSources)` function that draws simplified versions of each overlay. This gives us WYSIWYG-ish export without needing to screenshot DOM.

### 3. Exported video not seekable
WebM files from MediaRecorder often lack proper seeking metadata. This is a known browser limitation. We can fix it by post-processing the blob to add duration metadata, or by using a library. For now, document the limitation or use the `fix-webm-duration` approach (small inline fix that patches the EBML header).

### 4. Video file not auto-loading on next session
Currently uses `FileSystemFileHandle` which requires permission re-grant. The user wants to store the video blob in IndexedDB instead.

## New Feature: Save Video to IndexedDB

### Storage
- Add a new IndexedDB store `"session-videos"` (key: `sessionFileName`) in `dbUtils.ts` (bump to v9)
- Store: `{ sessionFileName, videoBlob, videoFileName, savedAt, size }`
- One video per session file

### New module: `src/lib/videoFileStorage.ts`
- `saveSessionVideo(sessionFileName, blob, videoFileName)`
- `loadSessionVideo(sessionFileName) → { blob, videoFileName } | null`
- `deleteSessionVideo(sessionFileName)`
- `hasSessionVideo(sessionFileName) → boolean`
- `listSessionVideos() → { sessionFileName, videoFileName, size, savedAt }[]`

### Export dialog changes
Replace the single "Export" button with two options:
- "Save to App" — saves blob to IndexedDB, links to current session
- "Save to Device" — triggers browser download (current behavior)
- If a video is already saved in IndexedDB for this session, show "Already saved — Download copy?" instead of re-exporting

### Auto-load from IndexedDB
In `useVideoSync.ts`, after checking `fileHandle`, also check IndexedDB for a stored video. Priority: fileHandle (if permission granted) → IndexedDB blob → show "Last used" hint.

### File list indicator
In `FilesTab.tsx`, check if each session has a stored video and show a small video icon (🎬 or `<Video>` icon) next to files that have an attached video.

### Scope control (whole session vs single lap)
Add a "Range" selector in the export dialog:
- "Full Session" — exports entire video
- "Current Lap" — exports only the video segment corresponding to the selected lap's time range (using sync offset to calculate video start/end times)

## File Changes

| File | Change |
|------|--------|
| `src/lib/dbUtils.ts` | Add `SESSION_VIDEOS` store, bump to v9 |
| `src/lib/videoFileStorage.ts` | **New** — IndexedDB CRUD for video blobs |
| `src/lib/videoExport.ts` | Fix completion logic, add overlay canvas rendering, add time range support |
| `src/components/video-overlays/VideoExportDialog.tsx` | Add "Save to App"/"Save to Device" buttons, range selector, already-saved detection |
| `src/components/VideoPlayer.tsx` | Pass overlay canvas ref to export, wire up new export flow, auto-load from IndexedDB |
| `src/hooks/useVideoSync.ts` | Add IndexedDB video auto-load fallback, expose `hasStoredVideo` state |
| `src/components/drawer/FilesTab.tsx` | Show video icon for sessions with stored videos |
| `src/lib/videoStorage.ts` | No change (overlay settings stay here) |
| `CLAUDE.md` | Document new video storage |

## Implementation Order

1. **IndexedDB store + videoFileStorage module** — foundation
2. **Fix export pipeline** — completion logic, overlay rendering to canvas, seekable output
3. **Export dialog redesign** — save to app/device, range selector
4. **Auto-load from IndexedDB** — in useVideoSync
5. **File list video indicator** — in FilesTab
6. **Update CLAUDE.md**

