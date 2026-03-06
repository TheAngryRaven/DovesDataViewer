/**
 * Video export pipeline: plays video + captures frames with overlays via canvas + MediaRecorder.
 *
 * Uses requestVideoFrameCallback for frame-accurate capture. Overlays are rendered to the
 * export canvas via the overlayCanvasRenderer (pure canvas drawing, no DOM).
 * Listens for the video 'ended' event to reliably finalize recording.
 */

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

export function startVideoExport(
  videoElement: HTMLVideoElement,
  exportCtx: ExportContext | null,
  options: ExportOptions,
  callbacks: ExportCallbacks,
): ExportController {
  let cancelled = false;
  const graphHistories = new Map<string, number[]>();

  const run = async () => {
    try {
      const vw = videoElement.videoWidth;
      const vh = videoElement.videoHeight;
      if (!vw || !vh) {
        callbacks.onError("Video has no dimensions");
        return;
      }

      // Target resolution
      let targetW = vw;
      let targetH = vh;
      if (options.quality === "standard") {
        const scale = 720 / vh;
        if (scale < 1) {
          targetW = Math.round(vw * scale);
          targetH = 720;
          // Ensure even dimensions for codec
          targetW = targetW % 2 === 0 ? targetW : targetW + 1;
        }
      }

      // Time range
      const startTime = options.startTime ?? 0;
      const endTime = options.endTime ?? videoElement.duration;

      const canvas = document.createElement("canvas");
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        callbacks.onError("Failed to get canvas context");
        return;
      }

      // MediaRecorder setup
      const fps = 30;
      const bitrate = options.quality === "standard" ? 5_000_000 : 15_000_000;
      const stream = canvas.captureStream(fps);

      // Add audio track if available
      try {
        const audioTrack = (videoElement as any).captureStream?.()?.getAudioTracks?.()?.[0];
        if (audioTrack) stream.addTrack(audioTrack);
      } catch {}

      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : MediaRecorder.isTypeSupported("video/webm;codecs=vp8")
          ? "video/webm;codecs=vp8"
          : "video/webm";

      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: bitrate,
      });

      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      let completed = false;
      const finalize = () => {
        if (completed) return;
        completed = true;
        if (cancelled) return;
        const blob = new Blob(chunks, { type: mimeType });
        // Attempt to patch WebM duration for seekability
        patchWebmDuration(blob, endTime - startTime).then(
          (patched) => callbacks.onComplete(patched),
          () => callbacks.onComplete(blob),
        );
      };

      recorder.onstop = finalize;
      recorder.onerror = () => callbacks.onError("MediaRecorder error");

      // Start recording
      recorder.start(500);

      // Seek to start
      const wasMuted = videoElement.muted;
      videoElement.muted = true;
      videoElement.currentTime = startTime;

      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          videoElement.removeEventListener("seeked", onSeeked);
          resolve();
        };
        videoElement.addEventListener("seeked", onSeeked);
      });

      if (cancelled) { recorder.stop(); videoElement.muted = wasMuted; return; }

      videoElement.play();

      const duration = endTime - startTime;

      // Listen for video end
      const onEnded = () => {
        videoElement.removeEventListener("ended", onEnded);
        // Draw final frame
        ctx.drawImage(videoElement, 0, 0, targetW, targetH);
        drawOverlays(ctx, targetW, targetH, exportCtx, graphHistories);
        callbacks.onProgress(1);
        setTimeout(() => {
          if (recorder.state !== "inactive") recorder.stop();
        }, 200);
      };
      videoElement.addEventListener("ended", onEnded);

      // Frame loop
      const drawFrame = () => {
        if (cancelled) {
          videoElement.removeEventListener("ended", onEnded);
          if (recorder.state !== "inactive") recorder.stop();
          videoElement.pause();
          videoElement.muted = wasMuted;
          return;
        }

        // Check if past end time for lap-range exports
        if (videoElement.currentTime >= endTime) {
          videoElement.pause();
          videoElement.removeEventListener("ended", onEnded);
          ctx.drawImage(videoElement, 0, 0, targetW, targetH);
          drawOverlays(ctx, targetW, targetH, exportCtx, graphHistories);
          callbacks.onProgress(1);
          setTimeout(() => {
            if (recorder.state !== "inactive") recorder.stop();
          }, 200);
          return;
        }

        // Draw video frame
        ctx.drawImage(videoElement, 0, 0, targetW, targetH);

        // Draw overlays
        if (options.includeOverlays) {
          drawOverlays(ctx, targetW, targetH, exportCtx, graphHistories);
        }

        callbacks.onProgress(Math.min(1, (videoElement.currentTime - startTime) / duration));

        if (!videoElement.ended && !videoElement.paused) {
          if ("requestVideoFrameCallback" in videoElement) {
            (videoElement as any).requestVideoFrameCallback(drawFrame);
          } else {
            requestAnimationFrame(drawFrame);
          }
        }
      };

      if ("requestVideoFrameCallback" in videoElement) {
        (videoElement as any).requestVideoFrameCallback(drawFrame);
      } else {
        requestAnimationFrame(drawFrame);
      }
    } catch (e: any) {
      callbacks.onError(e.message || "Export failed");
    }
  };

  run();

  return {
    cancel: () => {
      cancelled = true;
    },
  };
}

function drawOverlays(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  exportCtx: ExportContext | null,
  graphHistories: Map<string, number[]>,
) {
  if (!exportCtx) return;
  // Build render context from current video time
  // The video element's currentTime is used by buildRenderCtx in VideoPlayer
  const renderCtx = exportCtx.buildRenderCtx(0); // time is read from video element internally
  if (!renderCtx) return;
  renderOverlaysToCanvas(ctx, w, h, exportCtx.overlays, renderCtx, graphHistories);
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

/**
 * Attempt to patch WebM blob with correct duration metadata.
 * WebM files from MediaRecorder often have unknown duration, making them non-seekable.
 * This patches the EBML Duration element in the Segment/Info section.
 */
async function patchWebmDuration(blob: Blob, durationSec: number): Promise<Blob> {
  try {
    const buffer = await blob.arrayBuffer();
    const view = new DataView(buffer);
    const durationMs = durationSec * 1000;

    // Search for the Duration element ID (0x4489) in the first 1024 bytes
    for (let i = 0; i < Math.min(buffer.byteLength - 12, 1024); i++) {
      if (view.getUint8(i) === 0x44 && view.getUint8(i + 1) === 0x89) {
        // Check if the size byte indicates 8 bytes (0x88)
        if (view.getUint8(i + 2) === 0x88) {
          // Write duration as float64
          view.setFloat64(i + 3, durationMs);
          return new Blob([buffer], { type: blob.type });
        }
      }
    }
  } catch {
    // Patch failed, return original
  }
  return blob;
}
