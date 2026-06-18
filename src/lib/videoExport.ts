/**
 * Video export pipeline: frame-stepping via WebCodecs + mp4-muxer for proper MP4 output.
 *
 * Instead of recording live playback, we seek frame-by-frame through the video,
 * draw each frame + overlays to a canvas, encode via VideoEncoder (H.264),
 * and mux into a standard MP4 file. This produces universally playable files
 * and correctly animates overlays since each frame gets its own render context.
 *
 * Audio is extracted from the source video via Web Audio API, encoded with
 * AudioEncoder (AAC), and muxed alongside the video track.
 *
 * Memory: both encoders run with bounded queues (backpressure), and exports
 * whose estimated size exceeds the streaming threshold mux into chunked
 * streamed parts (fragmented MP4) instead of one contiguous ArrayBuffer —
 * see lib/videoExportTarget.ts.
 *
 * Falls back to MediaRecorder (WebM) if WebCodecs is unavailable.
 */

import { Muxer, ArrayBufferTarget, StreamTarget } from "mp4-muxer";
import type { ExportOptions } from "@/components/video-overlays/VideoExportDialog";
import type { OverlayInstance, OverlayRenderContext } from "@/components/video-overlays/types";
import { renderOverlaysToCanvas } from "@/lib/overlayCanvasRenderer";
import { shouldStreamExport, writeStreamChunk, type StreamedPart } from "@/lib/videoExportTarget";
import { virtualToLocal, planAudioSegments, type Playlist } from "@/lib/videoPlaylist";

/** A muxer over either export target (in-memory buffer or chunked stream). */
type ExportMuxer = Muxer<ArrayBufferTarget | StreamTarget>;

// Encoder backpressure: cap the number of frames in flight inside the
// encoders. Without this the frame loop queues raw frames as fast as it can
// seek — unbounded memory on slow encoders.
const MAX_ENCODE_QUEUE = 4;
const MAX_AUDIO_ENCODE_QUEUE = 32;

async function waitForEncoderQueue(
  encoder: { encodeQueueSize: number },
  max: number,
): Promise<void> {
  while (encoder.encodeQueueSize > max) {
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

export interface ExportController {
  cancel: () => void;
}

export interface ExportCallbacks {
  onProgress: (fraction: number) => void;
  onComplete: (blob: Blob) => void;
  onError: (error: string) => void;
}

export interface ExportContext {
  overlays: OverlayInstance[];
  buildRenderCtx: (videoCurrentTime: number) => OverlayRenderContext | null;
}

/** One chunk of the source recording on the virtual timeline. */
export interface ExportChunk {
  url: string;
  startOffsetSec: number;
  durationSec: number;
}

/**
 * What the exporter reads from. `chunks` describes the whole recording on the
 * virtual timeline (a single file is a 1-chunk list); `liveVideo` is the
 * player's element, reused for dimensions and the single-chunk MediaRecorder
 * fallback.
 */
export interface ExportSource {
  liveVideo: HTMLVideoElement;
  chunks: ExportChunk[];
  totalDuration: number;
}

/* ------------------------------------------------------------------ */
/*  Public entry point                                                 */
/* ------------------------------------------------------------------ */

export function startVideoExport(
  source: ExportSource,
  exportCtx: ExportContext | null,
  options: ExportOptions,
  callbacks: ExportCallbacks,
): ExportController {
  let cancelled = false;

  const controller: ExportController = {
    cancel: () => { cancelled = true; },
  };

  if (supportsWebCodecs()) {
    runWebCodecsExport(source, exportCtx, options, callbacks, () => cancelled);
  } else if (source.chunks.length > 1) {
    // The MediaRecorder fallback plays a single element through; it can't span
    // chunk boundaries. Multi-chapter recordings need WebCodecs.
    callbacks.onError("Exporting a multi-chapter (GoPro) recording requires a browser with WebCodecs support.");
  } else {
    runFallbackExport(source.liveVideo, exportCtx, options, callbacks, () => cancelled);
  }

  return controller;
}

/* ------------------------------------------------------------------ */
/*  Frame source: a dedicated offscreen <video> that seeks across chunks */
/* ------------------------------------------------------------------ */

interface FrameSource {
  element: HTMLVideoElement;
  /** Seek to a virtual (whole-recording) time, switching chunks as needed. */
  seek: (virtualSec: number) => Promise<void>;
  dispose: () => void;
}

/**
 * Build an offscreen <video> that the frame loop seeks through in virtual time.
 * Keeping it separate from the player element means the export never disturbs
 * on-screen playback and the single-chunk case is just a 1-element playlist.
 */
async function createFrameSource(chunks: ExportChunk[]): Promise<FrameSource> {
  const playlist: Playlist = {
    chunks: chunks.map((c) => ({ name: "", durationSec: c.durationSec, startOffsetSec: c.startOffsetSec })),
    totalDuration: chunks.reduce((sum, c) => sum + c.durationSec, 0),
  };

  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  // Kept on-screen (but invisible & offscreen) so browsers don't throttle
  // media loading/seeking the way they can for a fully-detached element.
  video.style.cssText = "position:fixed;left:-10000px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;";
  document.body.appendChild(video);

  let currentIndex = -1;

  const loadChunk = (index: number) => new Promise<void>((resolve, reject) => {
    currentIndex = index;
    const cleanup = () => {
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("error", onErr);
    };
    const onReady = () => { cleanup(); resolve(); };
    const onErr = () => { cleanup(); reject(new Error("Failed to load video chunk")); };
    video.addEventListener("loadeddata", onReady);
    video.addEventListener("error", onErr);
    video.src = chunks[index].url;
    video.load();
  });

  await loadChunk(0);

  return {
    element: video,
    async seek(virtualSec: number) {
      const { index, localSec } = virtualToLocal(playlist, virtualSec);
      if (index !== currentIndex) await loadChunk(index);
      video.currentTime = Math.max(0, localSec);
      await waitForFrameReady(video);
    },
    dispose() {
      video.removeAttribute("src");
      video.load();
      video.remove();
    },
  };
}

/* ------------------------------------------------------------------ */
/*  WebCodecs detection                                                */
/* ------------------------------------------------------------------ */

function supportsWebCodecs(): boolean {
  return typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined";
}

/* ------------------------------------------------------------------ */
/*  Audio extraction + encoding                                        */
/* ------------------------------------------------------------------ */

/** Decode a single chunk's full audio track, or null if it has none. */
async function decodeChunkAudio(url: string): Promise<AudioBuffer | null> {
  try {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const audioCtx = new OfflineAudioContext(2, 1, 44100); // temp context for decoding
    return await audioCtx.decodeAudioData(arrayBuffer);
  } catch {
    return null;
  }
}

/**
 * Extract and concatenate audio across the chunks overlapping [startTime, endTime)
 * into one AudioBuffer aligned to the export range. Chunks are decoded and copied
 * one at a time so a long multi-chunk recording never holds every track in memory
 * at once. Returns null if no chunk in range has audio.
 */
async function extractPlaylistAudio(
  chunks: ExportChunk[],
  startTime: number,
  endTime: number,
): Promise<AudioBuffer | null> {
  const overlapping = chunks.filter(
    (c) => c.startOffsetSec < endTime && c.startOffsetSec + c.durationSec > startTime,
  );
  if (overlapping.length === 0) return null;

  let out: AudioBuffer | null = null;
  let sampleRate = 0;
  let channels = 0;

  for (const chunk of overlapping) {
    const buf = await decodeChunkAudio(chunk.url);
    if (!buf) continue;

    // The first decoded chunk fixes the output format + length.
    if (!out) {
      sampleRate = buf.sampleRate;
      channels = buf.numberOfChannels;
      const totalLen = Math.max(1, Math.round((endTime - startTime) * sampleRate));
      out = new OfflineAudioContext(channels, totalLen, sampleRate).createBuffer(channels, totalLen, sampleRate);
    }

    const [seg] = planAudioSegments([chunk], startTime, endTime, sampleRate);
    if (!seg) continue;

    for (let ch = 0; ch < channels; ch++) {
      const src = buf.getChannelData(Math.min(ch, buf.numberOfChannels - 1));
      const dst = out.getChannelData(ch);
      const slice = src.subarray(seg.srcStartSample, seg.srcStartSample + seg.lenSamples);
      const writable = Math.min(slice.length, dst.length - seg.outStartSample);
      if (writable > 0) dst.set(slice.subarray(0, writable), seg.outStartSample);
    }
  }

  return out;
}

/**
 * Encode an AudioBuffer to AAC chunks and feed them to the muxer.
 * Returns true if audio was successfully encoded.
 */
async function encodeAudioToMuxer(
  audioBuffer: AudioBuffer,
  muxer: ExportMuxer,
): Promise<boolean> {
  if (typeof AudioEncoder === "undefined") {
    console.log("AudioEncoder not available, skipping audio");
    return false;
  }

  let hadError = false;

  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      muxer.addAudioChunk(chunk, meta ?? undefined);
    },
    error: (e) => {
      console.warn("AudioEncoder error:", e);
      hadError = true;
    },
  });

  const sampleRate = audioBuffer.sampleRate;
  const channels = audioBuffer.numberOfChannels;

  encoder.configure({
    codec: "mp4a.40.2", // AAC-LC
    sampleRate,
    numberOfChannels: channels,
    bitrate: 128_000,
  });

  try {
    // Feed audio in chunks of ~1024 samples (standard AAC frame size), with
    // backpressure — the old loop queued the whole track in one tight pass.
    const frameSize = 1024;
    const totalSamples = audioBuffer.length;

    for (let offset = 0; offset < totalSamples; offset += frameSize) {
      const remaining = Math.min(frameSize, totalSamples - offset);

      const timestamp = Math.round((offset / sampleRate) * 1_000_000); // microseconds

      const audioData = new AudioData({
        format: "f32-planar" as AudioSampleFormat,
        sampleRate,
        numberOfFrames: remaining,
        numberOfChannels: channels,
        timestamp,
        data: new Float32Array(buildPlanarBuffer(audioBuffer, offset, remaining, channels)),
      });

      encoder.encode(audioData);
      audioData.close();

      if (encoder.encodeQueueSize > MAX_AUDIO_ENCODE_QUEUE) {
        await waitForEncoderQueue(encoder, MAX_AUDIO_ENCODE_QUEUE);
      }
    }

    await encoder.flush();
    encoder.close();
    return !hadError;
  } catch {
    try { encoder.close(); } catch { /* encoder already closed during error handling */ }
    return false;
  }
}

/**
 * Build a planar Float32Array from an AudioBuffer for a given range.
 * Layout: [ch0_sample0..ch0_sampleN, ch1_sample0..ch1_sampleN, ...]
 */
function buildPlanarBuffer(
  audioBuffer: AudioBuffer,
  offset: number,
  length: number,
  channels: number,
): Float32Array {
  const buf = new Float32Array(length * channels);
  for (let ch = 0; ch < channels; ch++) {
    const src = audioBuffer.getChannelData(ch);
    buf.set(src.subarray(offset, offset + length), ch * length);
  }
  return buf;
}

/* ------------------------------------------------------------------ */
/*  Primary pipeline: WebCodecs + mp4-muxer                           */
/* ------------------------------------------------------------------ */

async function runWebCodecsExport(
  source: ExportSource,
  exportCtx: ExportContext | null,
  options: ExportOptions,
  callbacks: ExportCallbacks,
  isCancelled: () => boolean,
) {
  const liveVideo = source.liveVideo;
  let frameSource: FrameSource | null = null;
  let restorePlay = false;
  try {
    // All chunks of one recording share a resolution, so the player element's
    // dimensions describe every chunk.
    const vw = liveVideo.videoWidth;
    const vh = liveVideo.videoHeight;
    if (!vw || !vh) { callbacks.onError("Video has no dimensions"); return; }

    // Target resolution
    let targetW = vw;
    let targetH = vh;
    if (options.quality === "standard") {
      const scale = 720 / vh;
      if (scale < 1) {
        targetW = Math.round(vw * scale);
        targetH = 720;
      }
    }
    // Codec requires even dimensions
    targetW = targetW % 2 === 0 ? targetW : targetW + 1;
    targetH = targetH % 2 === 0 ? targetH : targetH + 1;

    const fps = 30;
    const startTime = options.startTime ?? 0;
    const endTime = options.endTime ?? source.totalDuration;
    const duration = endTime - startTime;
    const totalFrames = Math.ceil(duration * fps);
    const frameInterval = 1 / fps;
    const keyFrameInterval = fps; // keyframe every 1 second

    // Canvas for compositing
    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) { callbacks.onError("Failed to get canvas context"); return; }

    // Don't let the player keep advancing behind the export dialog. The export
    // reads a separate offscreen element, so the live element is only paused.
    restorePlay = !liveVideo.paused;
    liveVideo.pause();

    // Offscreen source seeked in virtual time + audio stitched across chunks,
    // both kicked off in parallel with encoder setup.
    const sourcePromise = createFrameSource(source.chunks);
    const audioPromise = extractPlaylistAudio(source.chunks, startTime, endTime);

    frameSource = await sourcePromise;
    // Wait for audio extraction
    const audioBuffer = await audioPromise;
    if (isCancelled()) return;

    // Pick a bitrate
    const bitrate = options.quality === "standard" ? 5_000_000 : 15_000_000;

    // Target: short exports keep the single in-memory buffer (classic MP4,
    // max compatibility). Long ones stream ~16 MiB chunks into a part list
    // and produce fragmented MP4 — a 20-min 15 Mbps export would otherwise
    // need one contiguous ~2.2 GB ArrayBuffer (guaranteed mobile OOM).
    const useStreaming = shouldStreamExport(duration, bitrate);
    const streamedParts: StreamedPart[] = [];
    const target = useStreaming
      ? new StreamTarget({
          chunked: true,
          onData: (data, position) => writeStreamChunk(streamedParts, data, position),
        })
      : new ArrayBufferTarget();

    // mp4-muxer setup — include audio track if we have audio
    const muxer: ExportMuxer = new Muxer({
      target,
      video: {
        codec: "avc" as const,
        width: targetW,
        height: targetH,
      },
      fastStart: useStreaming ? ("fragmented" as const) : ("in-memory" as const),
      ...(audioBuffer ? {
        audio: {
          codec: "aac" as const,
          numberOfChannels: audioBuffer.numberOfChannels,
          sampleRate: audioBuffer.sampleRate,
        },
      } : {}),
    });

    // VideoEncoder setup
    let encoderError: string | null = null;
    const encoder = new VideoEncoder({
      output: (chunk, meta) => {
        muxer.addVideoChunk(chunk, meta ?? undefined);
      },
      error: (e) => {
        encoderError = e.message;
      },
    });

    encoder.configure({
      codec: "avc1.42001f", // Baseline profile, level 3.1 — wide compat
      width: targetW,
      height: targetH,
      bitrate,
      framerate: fps,
    });

    const graphHistories = new Map<string, number[]>();

    // Frame-stepping loop
    for (let i = 0; i < totalFrames; i++) {
      if (isCancelled()) break;
      if (encoderError) { callbacks.onError(`Encoder error: ${encoderError}`); return; }

      const t = startTime + i * frameInterval;

      // Seek the offscreen source to this virtual time (crossing chunks as needed).
      await frameSource.seek(t);

      if (isCancelled()) break;

      // Draw video frame to canvas
      ctx.drawImage(frameSource.element, 0, 0, targetW, targetH);

      // Draw overlays
      if (options.includeOverlays && exportCtx) {
        const renderCtx = exportCtx.buildRenderCtx(t);
        if (renderCtx) {
          renderOverlaysToCanvas(ctx, targetW, targetH, exportCtx.overlays, renderCtx, graphHistories);
        }
      }

      // Create VideoFrame and encode, with backpressure: never let more than
      // a few frames queue inside the encoder (unbounded queueing buffers raw
      // frames in memory whenever encoding is slower than seeking).
      const timestamp = Math.round(i * frameInterval * 1_000_000); // microseconds
      const frame = new VideoFrame(canvas, { timestamp });
      const keyFrame = i % keyFrameInterval === 0;
      encoder.encode(frame, { keyFrame });
      frame.close();
      if (encoder.encodeQueueSize > MAX_ENCODE_QUEUE) {
        await waitForEncoderQueue(encoder, MAX_ENCODE_QUEUE);
      }

      callbacks.onProgress((i + 1) / totalFrames);
    }

    if (isCancelled()) {
      encoder.close();
      return;
    }

    // Flush video encoder
    await encoder.flush();
    encoder.close();

    // Encode audio if available
    if (audioBuffer) {
      await encodeAudioToMuxer(audioBuffer, muxer);
    }

    muxer.finalize();

    // Many small parts → Blob lets the browser keep the result off-heap;
    // the in-memory path keeps its single buffer (short exports only).
    const blob = useStreaming
      ? new Blob(streamedParts.map((p) => p.data), { type: "video/mp4" })
      : new Blob([(target as ArrayBufferTarget).buffer], { type: "video/mp4" });
    streamedParts.length = 0;

    callbacks.onComplete(blob);
  } catch (e) {
    callbacks.onError(e instanceof Error ? e.message : "Export failed");
  } finally {
    // Tear down the offscreen source and resume the player on every exit path
    // (success, cancel, encoder error, or throw).
    frameSource?.dispose();
    if (restorePlay) liveVideo.play();
  }
}

/* ------------------------------------------------------------------ */
/*  Fallback pipeline: MediaRecorder (for older browsers)              */
/* ------------------------------------------------------------------ */

async function runFallbackExport(
  video: HTMLVideoElement,
  exportCtx: ExportContext | null,
  options: ExportOptions,
  callbacks: ExportCallbacks,
  isCancelled: () => boolean,
) {
  try {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) { callbacks.onError("Video has no dimensions"); return; }

    let targetW = vw;
    let targetH = vh;
    if (options.quality === "standard") {
      const scale = 720 / vh;
      if (scale < 1) {
        targetW = Math.round(vw * scale);
        targetH = 720;
      }
    }
    targetW = targetW % 2 === 0 ? targetW : targetW + 1;
    targetH = targetH % 2 === 0 ? targetH : targetH + 1;

    const startTime = options.startTime ?? 0;
    const endTime = options.endTime ?? video.duration;

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) { callbacks.onError("Failed to get canvas context"); return; }

    const fps = 30;
    const bitrate = options.quality === "standard" ? 5_000_000 : 15_000_000;
    const stream = canvas.captureStream(fps);

    // Try MP4 first (Chrome 130+), fall back to WebM
    const mimeType = MediaRecorder.isTypeSupported("video/mp4;codecs=avc1")
      ? "video/mp4;codecs=avc1"
      : MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : "video/webm";

    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bitrate });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    let completed = false;
    const finalize = () => {
      if (completed) return;
      completed = true;
      if (isCancelled()) return;
      const blob = new Blob(chunks, { type: mimeType.split(";")[0] });
      callbacks.onComplete(blob);
    };

    recorder.onstop = finalize;
    recorder.onerror = () => callbacks.onError("MediaRecorder error");
    recorder.start(100);

    const wasMuted = video.muted;
    video.muted = true;
    video.currentTime = startTime;
    await waitForSeeked(video);

    if (isCancelled()) { recorder.stop(); video.muted = wasMuted; return; }

    video.play();

    const duration = endTime - startTime;
    const graphHistories = new Map<string, number[]>();

    const stopRecording = () => {
      ctx.drawImage(video, 0, 0, targetW, targetH);
      if (options.includeOverlays && exportCtx) {
        const renderCtx = exportCtx.buildRenderCtx(video.currentTime);
        if (renderCtx) {
          renderOverlaysToCanvas(ctx, targetW, targetH, exportCtx.overlays, renderCtx, graphHistories);
        }
      }
      callbacks.onProgress(1);
      video.muted = wasMuted;
      setTimeout(() => { if (recorder.state !== "inactive") recorder.stop(); }, 300);
    };

    const onEnded = () => { video.removeEventListener("ended", onEnded); stopRecording(); };
    video.addEventListener("ended", onEnded);

    const drawFrame = () => {
      if (isCancelled()) {
        video.removeEventListener("ended", onEnded);
        if (recorder.state !== "inactive") recorder.stop();
        video.pause();
        video.muted = wasMuted;
        return;
      }
      if (video.currentTime >= endTime) {
        video.pause();
        video.removeEventListener("ended", onEnded);
        stopRecording();
        return;
      }
      ctx.drawImage(video, 0, 0, targetW, targetH);
      if (options.includeOverlays && exportCtx) {
        const renderCtx = exportCtx.buildRenderCtx(video.currentTime);
        if (renderCtx) {
          renderOverlaysToCanvas(ctx, targetW, targetH, exportCtx.overlays, renderCtx, graphHistories);
        }
      }
      callbacks.onProgress(Math.min(1, (video.currentTime - startTime) / duration));
      if (!video.ended && !video.paused) {
        if ("requestVideoFrameCallback" in video) {
          video.requestVideoFrameCallback(drawFrame);
        } else {
          requestAnimationFrame(drawFrame);
        }
      }
    };

    if ("requestVideoFrameCallback" in video) {
      video.requestVideoFrameCallback(drawFrame);
    } else {
      requestAnimationFrame(drawFrame);
    }
  } catch (e) {
    callbacks.onError(e instanceof Error ? e.message : "Export failed");
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function waitForSeeked(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      resolve();
    };
    video.addEventListener("seeked", onSeeked);
  });
}

/**
 * Wait for a video seek to complete and the frame to be ready for canvas capture.
 * Uses double-rAF after seeked to ensure the frame is fully composited.
 * Includes a timeout guard in case the browser skips the seeked event
 * (e.g. when seeking to the current time).
 */
function waitForFrameReady(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    let resolved = false;
    const done = () => {
      if (resolved) return;
      resolved = true;
      video.removeEventListener("seeked", onSeeked);
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    };
    const onSeeked = () => done();
    video.addEventListener("seeked", onSeeked);
    // Guard: if seeked doesn't fire within 500ms, resolve anyway
    setTimeout(done, 500);
  });
}

/** Trigger download of the exported blob */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
