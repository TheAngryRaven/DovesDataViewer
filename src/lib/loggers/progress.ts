/**
 * Transport-neutral display formatters + progress math for logger downloads.
 *
 * Pure functions, no transport imports — so both the BLE (Fledgling) and native
 * (MyChron over Tauri) flows can share them without dragging a protocol bundle
 * into the other's chunk. `src/lib/ble/format.ts` re-exports the formatters for
 * its existing callers.
 */

import type { LoggerDownloadProgress } from "./types";

/** Format bytes to human-readable string. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1048576).toFixed(1) + " MB";
}

/** Format transfer speed (bytes/sec) to human-readable string. */
export function formatSpeed(bytesPerSecond: number): string {
  if (isNaN(bytesPerSecond) || !isFinite(bytesPerSecond)) {
    return "0 B/s";
  }
  if (bytesPerSecond < 1024) return bytesPerSecond.toFixed(0) + " B/s";
  if (bytesPerSecond < 1048576) return (bytesPerSecond / 1024).toFixed(1) + " KB/s";
  return (bytesPerSecond / 1048576).toFixed(2) + " MB/s";
}

/** Format time remaining (seconds) as e.g. "12s" or "1m 30s". */
export function formatTime(seconds: number): string {
  if (isNaN(seconds) || !isFinite(seconds)) {
    return "--";
  }
  if (seconds < 60) return Math.ceil(seconds) + "s";
  const mins = Math.floor(seconds / 60);
  const secs = Math.ceil(seconds % 60);
  return `${mins}m ${secs}s`;
}

/**
 * Build a full `LoggerDownloadProgress` from raw byte counts. Speed/ETA are
 * derived from the elapsed time since `startTimeMs` (overall average), mirroring
 * the BLE transfer math. Used by transports whose progress source reports only
 * `received`/`total` (e.g. the MyChron native channel).
 */
export function computeProgress(
  received: number,
  total: number,
  startTimeMs: number,
): LoggerDownloadProgress {
  const percent = total > 0 ? (received / total) * 100 : 0;
  const elapsedSeconds = (Date.now() - startTimeMs) / 1000;
  const speed = elapsedSeconds > 0 ? received / elapsedSeconds : 0;
  // Unknown total → "--"; known total but no speed yet → 0s.
  const etaSeconds = total <= 0 ? NaN : speed > 0 ? (total - received) / speed : 0;
  return {
    received,
    total,
    percent,
    speed: formatSpeed(speed),
    eta: formatTime(etaSeconds),
  };
}
