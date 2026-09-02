# Native export bridge — hardware-speed overlay video in the shell

> Status: **LANDED** (bridge + renderer memoization; follow-up: gallery save + remembered video). Companion: LapWing's
> `tauri-plugin-videopipe` + `video_export_*` IPC (its `docs/video-pipeline.md`
> is the contract; LapWing plan 0001, Phase 2).

## Why this exists

On-device, the WebView exporter was unusable: ~30 s of 1080p30 hadn't finished
after a minute, because `videoExport.ts` seeks the `<video>` element once per
output frame (double-rAF wait, 500 ms no-op-seek stalls, GOP re-decode per
seek). In the native shell that entire job belongs on the platform's hardware
codecs — the owner's call: the video pipeline *is* the point of the native app.

## What landed

### `src/lib/nativeVideoExport.ts`
`startNativeVideoExport(source, exportCtx, options, callbacks)`:

- resolves **null** when the native path can't run — not the shell
  (`isNativeApp()` false), a shell without the commands / the desktop stub
  (`unsupported:` sentinel), or a multi-chunk playlist (v1 limitation) — and
  the caller falls back to the unchanged WebView exporter;
- otherwise stages and drives the job: `video_export_begin` (same
  quality→resolution/bitrate mapping as the web path), the source blob in
  8 MB **raw-body** chunks, then transparent overlay layers rendered by the
  plan-0023 unified renderer at **15 Hz** (telemetry cadence — overlays
  change with data, not video frames), PNG-encoded at output resolution,
  timestamps relative to the export start;
- `video_export_run` streams transcode progress (staging owns the first 35 %
  of the bar), `video_export_collect` returns the MP4 for the existing
  save/share flows, `dispose` cleans up — also on error/cancel.

`VideoPlayer.handleExport` tries the native path first and falls back
seamlessly; web and desktop behavior is byte-identical to before.

### Renderer memoization (`overlayCanvasRenderer.ts`)
The per-frame invariant work found while profiling the export path is now
cached per session via `WeakMap` on array identity (no invalidation, no
leaks): per-source ranges (`memoRange`, validated against the pace/braking
arrays for the special sources), map bounds (`memoMapBounds`), the pace bar's
scale (`memoPaceMax`), and the digital widget no longer resolves its value
twice per draw (`digitalBox`). This speeds up preview, the WebView exporter,
and native layer generation alike — the draws' output is bit-identical.

## Deliberate v1 limits

- Multi-chunk (multi-file recording) exports keep the WebView path.
- Layer cadence is a constant 15 Hz; the sector sweep (600 ms) gets ~9 layers,
  which reads smoothly. A per-widget change-detection cadence is the next
  lever if layer generation ever dominates long-session exports (an
  OffscreenCanvas worker after that).
- The one flagged cross-repo unknown: media3's clipped-stream presentation
  times are assumed 0-based against our export-relative layer timestamps —
  if a device shows a constant offset, the fix is one constant on the LapWing
  side (`TimedBitmapOverlay`).

## Verification

- Unit: range memoization scans once per session arrays (counting source
  fixture); all prior renderer tests unchanged — the memo layer is
  behavior-invisible.
- On-device (owner): export the same 30 s 1080p30 clip with a full overlay
  layout — expect seconds, not minutes; check overlay parity against the
  paused preview, audio presence, A/V sync at the trim boundaries, and that
  cancelling mid-export leaves no stale job (next export begins clean).

## Follow-up (landed): save to gallery + the remembered video

Two gaps the first on-device run exposed:

- **"Save to device" saved nowhere.** It fell into `downloadBlob()` — an
  `<a download href="blob:…">` click — which the Android WebView has no
  download handler for. On native, `destination: "device"` now means the
  **gallery**: the bridge calls `video_export_save(jobId, fileName)` and the
  shell copies the finished MP4 straight out of its job dir into MediaStore
  `Movies/LapWing` (the file never round-trips through the WebView); the
  dialog's button reads *Save to Gallery* on native and `VideoPlayer` toasts
  `export.savedToGallery`. New `ExportCallbacks.onSavedToDevice`; the web
  path is untouched.
- **The video was forgotten on reopen.** The web remembers it via a
  `FileSystemFileHandle` (Chrome desktop only). `src/lib/nativeVideoStore.ts`
  is the shell's equivalent: `useVideoSync.loadRecording` copies a
  single-file recording into the shell's store in the background (8 MB
  raw-body chunks; the blob URL keeps playing meanwhile), and the restore
  effect tries `getNativeStoredVideo` before the IndexedDB fallback — the
  `<video>` then streams from app storage over the asset protocol. The
  store key rides `VideoSyncState.nativeStoredKey`, and the export bridge
  passes it as `sourceKey` so an export of a remembered video **skips the
  source upload entirely** (a stale key silently falls back to uploading).
  Multi-file recordings keep today's behavior (no store, v1).
