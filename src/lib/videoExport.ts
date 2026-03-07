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
 * Falls back to MediaRecorder (WebM) if WebCodecs is unavailable.
 */

import { Muxer, ArrayBufferTarget } from "mp4-muxer";
import type { ExportOptions } from "@/components/video-overlays/VideoExportDialog";
import type { OverlayInstance, OverlayRenderContext } from "@/components/video-overlays/types";
import { renderOverlaysToCanvas } from "@/lib/overlayCanvasRenderer";

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

/* ------------------------------------------------------------------ */
/*  Public entry point                                                 */
/* ------------------------------------------------------------------ */

export function startVideoExport(
  videoElement: HTMLVideoElement,
  exportCtx: ExportContext | null,
  options: ExportOptions,
  callbacks: ExportCallbacks,
): ExportController {
  let cancelled = false;

  const controller: ExportController = {
    cancel: () => { cancelled = true; },
  };

  if (supportsWebCodecs()) {
    runWebCodecsExport(videoElement, exportCtx, options, callbacks, () => cancelled);
  } else {
    runFallbackExport(videoElement, exportCtx, options, callbacks, () => cancelled);
  }

  return controller;
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

/**
 * Extract the audio from a video element's source as an AudioBuffer.
 * Returns null if the video has no audio or decoding fails.
 */
async function extractAudioBuffer(
  video: HTMLVideoElement,
  startTime: number,
  endTime: number,
): Promise<AudioBuffer | null> {
  try {
    // Fetch the raw video data from the blob URL
    const response = await fetch(video.src);
    const arrayBuffer = await response.arrayBuffer();

    // Decode audio from the video file
    const audioCtx = new OfflineAudioContext(2, 1, 44100); // temp context for decoding
    let fullBuffer: AudioBuffer;
    try {
      fullBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    } catch {
      console.log("Video has no audio track or audio decode failed");
      return null;
    }

    // If we need a sub-range, slice the buffer
    const sampleRate = fullBuffer.sampleRate;
    const channels = fullBuffer.numberOfChannels;
    const startSample = Math.floor(startTime * sampleRate);
    const endSample = Math.min(Math.ceil(endTime * sampleRate), fullBuffer.length);
    const length = endSample - startSample;

    if (length <= 0) return null;

    const sliced = new OfflineAudioContext(channels, length, sampleRate);
    const slicedBuffer = sliced.createBuffer(channels, length, sampleRate);
    for (let ch = 0; ch < channels; ch++) {
      const src = fullBuffer.getChannelData(ch);
      const dst = slicedBuffer.getChannelData(ch);
      dst.set(src.subarray(startSample, endSample));
    }

    return slicedBuffer;
  } catch (e) {
    console.warn("Audio extraction failed:", e);
    return null;
  }
}

/**
 * Encode an AudioBuffer to AAC chunks and feed them to the muxer.
 * Returns true if audio was successfully encoded.
 */
async function encodeAudioToMuxer(
  audioBuffer: AudioBuffer,
  muxer: Muxer<ArrayBufferTarget>,
): Promise<boolean> {
  if (typeof AudioEncoder === "undefined") {
    console.log("AudioEncoder not available, skipping audio");
    return false;
  }

  return new Promise<boolean>((resolve) => {
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

    // Feed audio in chunks of ~1024 samples (standard AAC frame size)
    const frameSize = 1024;
    const totalSamples = audioBuffer.length;

    for (let offset = 0; offset < totalSamples; offset += frameSize) {
      const remaining = Math.min(frameSize, totalSamples - offset);

      // Interleave channels into a single Float32Array for AudioData
      const interleaved = new Float32Array(remaining * channels);
      for (let ch = 0; ch < channels; ch++) {
        const channelData = audioBuffer.getChannelData(ch);
        for (let i = 0; i < remaining; i++) {
          interleaved[i * channels + ch] = channelData[offset + i];
        }
      }

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
    }

    encoder.flush().then(() => {
      encoder.close();
      resolve(!hadError);
    }).catch(() => {
      try { encoder.close(); } catch {}
      resolve(false);
    });
  });
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
    const endTime = options.endTime ?? video.duration;
    const duration = endTime - startTime;
    const totalFrames = Math.ceil(duration * fps);
    const frameInterval = 1 / fps;
    const keyFrameInterval = fps; // keyframe every 1 second

    // Extract audio in parallel with video setup
    const audioPromise = extractAudioBuffer(video, startTime, endTime);

    // Canvas for compositing
    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) { callbacks.onError("Failed to get canvas context"); return; }

    // Wait for audio extraction
    const audioBuffer = await audioPromise;
    if (isCancelled()) return;

    // mp4-muxer setup — include audio track if we have audio
    const muxerConfig: any = {
      target: new ArrayBufferTarget(),
      video: {
        codec: "avc",
        width: targetW,
        height: targetH,
      },
      fastStart: "in-memory",
    };

    if (audioBuffer) {
      muxerConfig.audio = {
        codec: "aac",
        numberOfChannels: audioBuffer.numberOfChannels,
        sampleRate: audioBuffer.sampleRate,
      };
    }

    const muxer = new Muxer<ArrayBufferTarget>(muxerConfig);

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

    // Pick a bitrate
    const bitrate = options.quality === "standard" ? 5_000_000 : 15_000_000;

    encoder.configure({
      codec: "avc1.42001f", // Baseline profile, level 3.1 — wide compat
      width: targetW,
      height: targetH,
      bitrate,
      framerate: fps,
    });

    // Pause video for seeking
    const wasMuted = video.muted;
    const wasPlaying = !video.paused;
    video.pause();
    video.muted = true;

    const graphHistories = new Map<string, number[]>();

    // Frame-stepping loop
    for (let i = 0; i < totalFrames; i++) {
      if (isCancelled()) break;
      if (encoderError) { callbacks.onError(`Encoder error: ${encoderError}`); return; }

      const t = startTime + i * frameInterval;

      // Seek to frame time and wait for frame to be fully ready
      video.currentTime = t;
      await waitForFrameReady(video);

      if (isCancelled()) break;

      // Draw video frame to canvas
      ctx.drawImage(video, 0, 0, targetW, targetH);

      // Draw overlays
      if (options.includeOverlays && exportCtx) {
        const renderCtx = exportCtx.buildRenderCtx(t);
        if (renderCtx) {
          renderOverlaysToCanvas(ctx, targetW, targetH, exportCtx.overlays, renderCtx, graphHistories);
        }
      }

      // Create VideoFrame and encode
      const timestamp = Math.round(i * frameInterval * 1_000_000); // microseconds
      const frame = new VideoFrame(canvas, { timestamp });
      const keyFrame = i % keyFrameInterval === 0;
      encoder.encode(frame, { keyFrame });
      frame.close();

      callbacks.onProgress((i + 1) / totalFrames);
    }

    if (isCancelled()) {
      encoder.close();
      video.muted = wasMuted;
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

    const buf = (muxer.target as ArrayBufferTarget).buffer;
    const blob = new Blob([buf], { type: "video/mp4" });

    video.muted = wasMuted;
    if (wasPlaying) video.play();

    callbacks.onComplete(blob);
  } catch (e: any) {
    callbacks.onError(e.message || "Export failed");
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
          (video as any).requestVideoFrameCallback(drawFrame);
        } else {
          requestAnimationFrame(drawFrame);
        }
      }
    };

    if ("requestVideoFrameCallback" in video) {
      (video as any).requestVideoFrameCallback(drawFrame);
    } else {
      requestAnimationFrame(drawFrame);
    }
  } catch (e: any) {
    callbacks.onError(e.message || "Export failed");
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
 * Note: requestVideoFrameCallback does NOT fire on paused videos, so we avoid it here.
 */
function waitForFrameReady(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      // Double rAF ensures the decoded frame has been composited
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    };
    video.addEventListener("seeked", onSeeked);
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
