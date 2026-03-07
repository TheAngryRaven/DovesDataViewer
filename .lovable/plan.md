

## Add Audio to MP4 Video Export

### Current State
Video export works perfectly with overlays and plays in external players, but has **no audio track**. The source video's audio is completely ignored during the frame-stepping export.

### Approach: AudioEncoder + mp4-muxer (no ffmpeg needed)

**mp4-muxer already supports audio** — it has `addAudioChunk()` and accepts AAC audio config. We just need to extract the audio from the source video and encode it alongside the video frames. No need for ffmpeg.wasm (~25MB bundle) when we already have the right tool.

### How it works

1. **Extract audio** from the source `<video>` element using the Web Audio API:
   - Create an `OfflineAudioContext` for the export duration
   - Fetch the video file's raw data from IndexedDB (we already store video blobs)
   - Decode the audio buffer via `decodeAudioData()`

2. **Encode audio** using the WebCodecs `AudioEncoder` API:
   - Configure with AAC codec (`mp4a.40.2`), matching the source sample rate
   - Feed `AudioData` frames from the decoded buffer
   - Chunks go to `muxer.addAudioChunk()`

3. **Update muxer config** to include an audio track:
   ```typescript
   const muxer = new Muxer({
     target: new ArrayBufferTarget(),
     video: { codec: "avc", width, height },
     audio: { codec: "aac", numberOfChannels: 2, sampleRate: 44100 },
     fastStart: "in-memory",
   });
   ```

4. **Graceful degradation**: If the video has no audio track or `AudioEncoder` is unavailable, export proceeds as video-only (current behavior).

### Files to change
- `src/lib/videoExport.ts` — add audio extraction, encoding, and muxing alongside existing video pipeline
- `src/lib/videoFileStorage.ts` — may need to expose raw blob access for audio decoding (check if already available)
- `CLAUDE.md` — note audio support in video export section

### No new dependencies needed
mp4-muxer already handles audio muxing. AudioEncoder is part of the same WebCodecs API we already use for VideoEncoder.

