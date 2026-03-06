/**
 * Video export pipeline: plays video + captures frames with overlays via canvas + MediaRecorder.
 *
 * The approach: we play the video at 1x speed, capture each frame via requestVideoFrameCallback,
 * draw the video frame to an offscreen canvas, then overlay rendering is composited on top.
 * MediaRecorder encodes the canvas stream in real-time.
 *
 * This is a real-time pipeline — export takes as long as the video itself.
 */

import type { ExportOptions } from "@/components/video-overlays/VideoExportDialog";

export interface ExportController {
  cancel: () => void;
}

export interface ExportCallbacks {
  onProgress: (fraction: number) => void;
  onComplete: (blob: Blob) => void;
  onError: (error: string) => void;
}

export function startVideoExport(
  videoElement: HTMLVideoElement,
  overlayCanvas: HTMLCanvasElement | null,
  options: ExportOptions,
  callbacks: ExportCallbacks,
): ExportController {
  let cancelled = false;

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

      const canvas = document.createElement("canvas");
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        callbacks.onError("Failed to get canvas context");
        return;
      }

      // MediaRecorder setup
      const fps = options.quality === "standard" ? 30 : 30;
      const bitrate = options.quality === "standard" ? 5_000_000 : 15_000_000;
      const stream = canvas.captureStream(fps);

      // Add audio track if available
      const audioTrack = (videoElement as any).captureStream?.()?.getAudioTracks?.()?.[0];
      if (audioTrack) {
        stream.addTrack(audioTrack);
      }

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

      recorder.onstop = () => {
        if (cancelled) return;
        const blob = new Blob(chunks, { type: mimeType });
        callbacks.onComplete(blob);
      };

      recorder.onerror = () => {
        callbacks.onError("MediaRecorder error");
      };

      // Start recording
      recorder.start(1000); // chunk every second

      // Seek to start
      videoElement.currentTime = 0;
      videoElement.muted = true;

      await new Promise<void>((resolve) => {
        videoElement.onseeked = () => resolve();
      });

      videoElement.play();

      const duration = videoElement.duration;

      // Frame loop
      const drawFrame = () => {
        if (cancelled) {
          recorder.stop();
          videoElement.pause();
          return;
        }

        // Draw video
        ctx.drawImage(videoElement, 0, 0, targetW, targetH);

        // Draw overlay canvas if present
        if (options.includeOverlays && overlayCanvas) {
          ctx.drawImage(overlayCanvas, 0, 0, targetW, targetH);
        }

        callbacks.onProgress(videoElement.currentTime / duration);

        if (!videoElement.ended && !videoElement.paused) {
          if ("requestVideoFrameCallback" in videoElement) {
            (videoElement as any).requestVideoFrameCallback(drawFrame);
          } else {
            requestAnimationFrame(drawFrame);
          }
        } else {
          // Done
          setTimeout(() => {
            recorder.stop();
            callbacks.onProgress(1);
          }, 500);
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
