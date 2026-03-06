

# Fix Video Export: Seekability, Storage Metadata, and UX

## Three Issues

### 1. WebM Seekability (Keyframes/Duration)
**Root cause**: Browser `MediaRecorder` produces WebM files without proper duration metadata and with insufficient keyframes. The current hand-rolled EBML patcher only searches the first 1024 bytes and assumes a specific byte layout -- it's fragile and incomplete.

**Solution**: Install `fix-webm-duration` (zero-dependency, 3KB, TypeScript support, well-maintained). It properly parses the EBML structure and appends the correct duration metadata section. This is the standard community solution used by thousands of projects.

Replace the custom `patchWebmDuration` function in `videoExport.ts` with `fixWebmDuration(blob, durationMs)`.

### 2. "Save to App" Overlay Warning + Video Metadata
When saving to app, warn the user that overlays will be baked in and will play back with the overlays permanently visible.

Add metadata to `StoredVideo` records:
- `exportType: "session" | "lap"` -- what range was exported
- `lapNumber?: number` -- which lap if lap export
- `hasOverlays: boolean` -- whether overlays were baked in
- `originalVideoFileName: string` -- source video name

This metadata is displayed in the export dialog's "already saved" notice and in the file list video indicator.

### 3. Delete Stored Video
Add a delete button in the export dialog when a video is already stored, and in the file list's video indicator area.

## File Changes

| File | Change |
|------|--------|
| `package.json` | Add `fix-webm-duration` dependency |
| `src/lib/videoExport.ts` | Replace custom EBML patcher with `fix-webm-duration`, track elapsed duration properly |
| `src/lib/videoFileStorage.ts` | Extend `StoredVideo` with `exportType`, `lapNumber`, `hasOverlays` fields |
| `src/components/video-overlays/VideoExportDialog.tsx` | Add overlay warning when destination is "app", show metadata for stored video, add delete button |
| `src/components/VideoPlayer.tsx` | Pass metadata when saving, wire delete handler |
| `src/components/drawer/FilesTab.tsx` | Show richer video indicator with delete option |

## Key Details

### VideoExportDialog UX Changes
- When "Save to App" is about to be clicked with overlays enabled: show an alert/notice: "Overlays will be permanently baked into the saved video. This video will auto-load with your session."
- When a video is already saved, show: "Session video saved" or "Lap 3 video saved (with overlays)" + size + delete button
- Delete button calls `deleteSessionVideo()` and refreshes state

### StoredVideo Extended Interface
```typescript
interface StoredVideo {
  sessionFileName: string;
  videoBlob: Blob;
  videoFileName: string;
  savedAt: number;
  size: number;
  // New fields
  exportType: "session" | "lap" | "raw";  // "raw" = saved source video without export
  lapNumber?: number;
  hasOverlays: boolean;
}
```

### fix-webm-duration Usage
```typescript
import fixWebmDuration from "fix-webm-duration";
// In finalize callback:
const fixed = await fixWebmDuration(blob, durationMs);
callbacks.onComplete(fixed);
```

## Implementation Order
1. Install `fix-webm-duration` + replace EBML patcher
2. Extend `StoredVideo` with metadata fields
3. Update export dialog with overlay warning + delete + metadata display
4. Wire delete through VideoPlayer and FilesTab

