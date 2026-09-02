/**
 * Native overlay-video export bridge (plan 0024).
 *
 * Inside the LapWing shell, export doesn't frame-step a <video> element — the
 * shell transcodes on the platform's hardware codecs (`video_export_*` IPC →
 * tauri-plugin-videopipe; Android: Media3 Transformer) and composites our
 * overlay layers on the GPU. This module stages the job and drives it:
 *
 *   1. `video_export_begin` with the trim/size/bitrate params. If the shell
 *      answers `unsupported:` (desktop stub) or doesn't know the command (an
 *      older shell), we report "unavailable" and the caller falls back to the
 *      in-WebView exporter.
 *   2. Stream the source MP4 in 8 MB raw-body chunks.
 *   3. Render transparent overlay layers with the SAME unified scene renderer
 *      the preview uses (plan 0023), at telemetry cadence (~15 Hz — overlays
 *      change with data, not video frames), PNG-encoded, timestamps relative
 *      to the export start.
 *   4. `video_export_run` (progress channel) → `video_export_collect` (raw
 *      MP4 bytes) → the caller's normal save/share flow → dispose.
 *
 * Contract: LapWing `docs/video-pipeline.md`.
 */

import { api } from "@/lib/loggers/native/ipc";
import { isNativeApp } from "@/lib/platform";
import {
  renderOverlaysToCanvas,
  DEFAULT_OVERLAY_LABELS,
  type GraphHistories,
} from "@/lib/overlayCanvasRenderer";
import type { ExportCallbacks, ExportContext, ExportSource } from "@/lib/videoExport";
import type { ExportOptions } from "@/components/video-overlays/VideoExportDialog";

const SOURCE_CHUNK_BYTES = 8 * 1024 * 1024;
/** Overlay layer cadence. Data changes at sample rate (10–25 Hz); 15 Hz keeps
 * every visible change without paying video-rate layer generation. */
const OVERLAY_FPS = 15;
/** Share of the progress bar spent staging (source + layers); the transcode
 * gets the rest. */
const STAGE_FRACTION = 0.35;

export interface NativeExportController {
  cancel: () => void;
}

/** True for the errors that mean "this shell can't do native export" — the
 * desktop stub's sentinel, or a shell predating the command. */
function isUnavailable(err: unknown): boolean {
  const msg = String(err);
  return msg.startsWith("unsupported:") || /unknown|not found|not allowed/i.test(msg);
}

/**
 * Try to run the export natively. Resolves `null` when the native pipeline is
 * unavailable (caller falls back to the in-WebView exporter — nothing has been
 * staged); otherwise returns a controller and drives `callbacks` to completion.
 *
 * v1 limitation: single-recording exports only — multi-chunk playlists keep
 * the WebView path.
 */
export async function startNativeVideoExport(
  source: ExportSource,
  exportCtx: ExportContext,
  options: ExportOptions,
  callbacks: ExportCallbacks,
): Promise<NativeExportController | null> {
  if (!isNativeApp()) return null;
  if (source.chunks.length !== 1) return null;

  const video = source.liveVideo;
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;

  // Same quality mapping as the WebView exporter.
  let targetW = vw;
  let targetH = vh;
  if (options.quality === "standard") {
    const scale = 720 / vh;
    if (scale < 1) {
      targetW = Math.round(vw * scale);
      targetH = 720;
    }
  }
  targetW += targetW % 2;
  targetH += targetH % 2;
  const bitrate = options.quality === "standard" ? 5_000_000 : 15_000_000;

  const startTime = options.startTime ?? 0;
  const endTime = options.endTime ?? source.totalDuration;

  const { invoke, Channel } = await api();

  const baseParams = {
    width: targetW,
    height: targetH,
    bitrate,
    startMs: Math.round(startTime * 1000),
    endMs: Math.round(endTime * 1000),
  };

  // Prefer the session's stored copy as the source (no upload at all); a
  // stale key just means we upload the blob like any other export.
  let useStoredSource = !!source.nativeSourceKey;
  let jobId: string;
  try {
    try {
      jobId = await invoke<string>("video_export_begin", {
        params: useStoredSource ? { ...baseParams, sourceKey: source.nativeSourceKey } : baseParams,
      });
    } catch (err) {
      if (!useStoredSource || isUnavailable(err)) throw err;
      useStoredSource = false;
      jobId = await invoke<string>("video_export_begin", { params: baseParams });
    }
  } catch (err) {
    if (isUnavailable(err)) return null;
    callbacks.onError(String(err));
    return { cancel: () => {} };
  }

  let cancelled = false;
  const controller: NativeExportController = {
    cancel: () => {
      cancelled = true;
      void invoke("video_export_cancel").catch(() => {});
    },
  };

  void (async () => {
    try {
      // ── Stage the source (unless the shell already holds it) ─────────
      const blob = useStoredSource ? null : await (await fetch(source.chunks[0].url)).blob();
      const sourceBytes = blob?.size ?? 0;
      const overlays = options.includeOverlays ? exportCtx.overlays : [];
      const durMs = Math.max(0, Math.round((endTime - startTime) * 1000));
      const layerCount = overlays.length > 0 ? Math.ceil((durMs / 1000) * OVERLAY_FPS) : 0;
      // Weight staging progress by actual work: bytes for the source, one
      // unit per overlay layer (a layer costs roughly a chunk's IPC trip).
      const totalUnits = Math.max(1, sourceBytes + layerCount * SOURCE_CHUNK_BYTES * 0.01);
      let doneUnits = 0;
      const stageProgress = () =>
        callbacks.onProgress(Math.min(1, doneUnits / totalUnits) * STAGE_FRACTION);

      for (let offset = 0; blob && offset < blob.size; offset += SOURCE_CHUNK_BYTES) {
        if (cancelled) return;
        const end = Math.min(offset + SOURCE_CHUNK_BYTES, blob.size);
        const bytes = new Uint8Array(await blob.slice(offset, end).arrayBuffer());
        await invoke("video_export_push_source", bytes, {
          headers: { "job-id": jobId, offset: String(offset) },
        });
        doneUnits += bytes.length;
        stageProgress();
      }

      // ── Render + stage the overlay layers ────────────────────────────
      if (overlays.length > 0) {
        const canvas = document.createElement("canvas");
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx2d = canvas.getContext("2d");
        if (!ctx2d) throw new Error("Failed to get canvas context");
        const histories: GraphHistories = new Map();
        const labels = exportCtx.labels ?? DEFAULT_OVERLAY_LABELS;

        for (let i = 0; i < layerCount; i++) {
          if (cancelled) return;
          const tMs = Math.round((i * 1000) / OVERLAY_FPS);
          const renderCtx = exportCtx.buildRenderCtx(startTime + tMs / 1000);
          if (!renderCtx) continue; // t stays increasing; a gap just holds the last layer
          ctx2d.clearRect(0, 0, targetW, targetH);
          renderOverlaysToCanvas(ctx2d, targetW, targetH, overlays, renderCtx, histories, labels);
          const png = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
          if (!png) throw new Error("PNG encode failed");
          const bytes = new Uint8Array(await png.arrayBuffer());
          await invoke("video_export_push_overlay", bytes, {
            headers: { "job-id": jobId, "t-ms": String(tMs) },
          });
          doneUnits += SOURCE_CHUNK_BYTES * 0.01;
          stageProgress();
        }
      }

      // ── Transcode ────────────────────────────────────────────────────
      if (cancelled) return;
      const onProgress = new Channel<{ fraction: number }>();
      onProgress.onmessage = (p) =>
        callbacks.onProgress(STAGE_FRACTION + p.fraction * (1 - STAGE_FRACTION));
      await invoke("video_export_run", { jobId, onProgress });

      // "Save to device" on native means the gallery: the shell copies the
      // finished MP4 straight out of its job dir — nothing comes back through
      // the WebView. "Save to app" (and callers without the hook) collect it.
      if (options.destination === "device" && callbacks.onSavedToDevice) {
        const base = (source.fileName ?? "export").replace(/\.[^.]+$/, "");
        const uri = await invoke<string>("video_export_save", {
          jobId,
          fileName: `${base}-overlay.mp4`,
        });
        callbacks.onSavedToDevice(uri);
      } else {
        const buf = await invoke<ArrayBuffer>("video_export_collect", { jobId });
        callbacks.onComplete(new Blob([buf], { type: "video/mp4" }));
      }
    } catch (err) {
      if (!cancelled) callbacks.onError(String(err));
    } finally {
      void invoke("video_export_dispose", { jobId }).catch(() => {});
    }
  })();

  return controller;
}
