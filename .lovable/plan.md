

## Video Export Fix Plan

### Two Confirmed Issues

**1. Overlay animation frozen during export**
In `videoExport.ts` line 229, `drawOverlays` calls `exportCtx.buildRenderCtx(0)`. While `buildExportRenderCtx` ignores this parameter and reads `video.currentTime` from a ref (which should work), the real-time video playback approach creates a fragile dependency on the video element's timing. The current architecture is also fundamentally limited — it can only export at 1x real-time speed because it plays the video live.

**2. Exported WebM won't play in external players (VLC, QuickTime, etc.)**
This is a well-documented Chrome/MediaRecorder limitation. The WebM output has:
- Missing or broken Cues (seek index) — `fix-webm-duration` only patches the Duration header, not the Cues
- VP8/VP9 codec in WebM container has poor compatibility with most desktop players
- No proper keyframe interval control

### Solution: MP4 output via WebCodecs + mp4-muxer

Replace the MediaRecorder-based pipeline with WebCodecs API + `mp4-muxer` library. This produces proper H.264/MP4 files that play everywhere.

**Key advantages:**
- H.264 in MP4 container = universal playback (VLC, QuickTime, Windows, phones, everything)
- Proper keyframes at regular intervals
- Correct duration and seek metadata built-in
- Can encode faster than real-time (bonus: shorter export times)
- Frame-accurate overlay rendering — each frame is explicitly drawn to canvas, encoded, then muxed

### Implementation Steps

1. **Add `mp4-muxer` dependency** (~30KB, MIT, pure TypeScript)

2. **Rewrite `videoExport.ts`** with a new pipeline:
   - Create `VideoEncoder` (H.264/avc1) + `Mp4Muxer.Muxer` with `ArrayBufferTarget`
   - For each frame: seek video → wait for seeked → draw frame to canvas → draw overlays → create `VideoFrame` from canvas → encode → mux
   - Step through frames at target FPS (e.g., every 33ms of video time) rather than real-time playback
   - On complete: finalize muxer → create Blob with `video/mp4` type
   - **Fallback**: If WebCodecs is unavailable (older browsers), keep current MediaRecorder path but try `video/mp4;codecs=avc1` mime type first, then WebM

3. **Fix overlay animation** — the new frame-stepping approach explicitly passes the video time for each frame, eliminating the timing race condition. Each frame: `video.currentTime = frameTime` → seeked → `buildRenderCtx(frameTime)` → draw

4. **Update export dialog** — change download filename extension from `.webm` to `.mp4`

5. **Update README and CLAUDE.md** — note mp4-muxer dependency in credits

### Technical Details

```text
Current pipeline (broken):
  video.play() → requestVideoFrameCallback loop → drawImage + drawOverlays → MediaRecorder → WebM blob → fix-webm-duration

New pipeline:
  for each frame at 1/fps intervals:
    video.currentTime = t → seeked event
    → canvas.drawImage(video) + renderOverlays(ctx, t)
    → new VideoFrame(canvas) → encoder.encode(frame)
    → muxer receives encoded chunks
  → muxer.finalize() → MP4 blob
```

The frame-stepping approach is actually faster than real-time since we don't wait for playback — we just seek, capture, encode, repeat. Progress callback updates based on `currentFrame / totalFrames`.

### Scope
- `src/lib/videoExport.ts` — major rewrite
- `src/components/VideoPlayer.tsx` — minor updates (filename extension, remove fix-webm-duration import if unused)
- `src/components/video-overlays/VideoExportDialog.tsx` — no changes needed
- `package.json` — add `mp4-muxer`
- `README.md`, `CLAUDE.md` — update credits/docs

