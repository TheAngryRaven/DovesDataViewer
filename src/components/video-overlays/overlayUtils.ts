/**
 * Shared utility functions used by overlay React components and the canvas export renderer.
 */
import type { GpsSample, Lap } from "@/types/racing";

/** Binary search for the nearest sample index to a target time in ms. */
export function findNearestIndex(samples: GpsSample[], targetMs: number): number {
  if (samples.length === 0) return 0;
  let lo = 0, hi = samples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t < targetMs) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(samples[lo - 1].t - targetMs) < Math.abs(samples[lo].t - targetMs)) {
    return lo - 1;
  }
  return lo;
}

/** Find the lap containing the current time, or the selected lap. */
export function findCurrentLap(
  laps: Lap[],
  selectedLapNumber: number | null,
  currentTimeMs: number,
): Lap | null {
  if (selectedLapNumber !== null) {
    return laps.find(l => l.lapNumber === selectedLapNumber) ?? null;
  }
  for (const lap of laps) {
    if (currentTimeMs >= lap.startTime && currentTimeMs <= lap.endTime) return lap;
  }
  return null;
}

/** Format seconds into a lap time string (e.g. "1:23.456" or "23.456"). */
export function formatOverlayLapTime(seconds: number): string {
  if (seconds < 0) seconds = 0;
  const mins = Math.floor(seconds / 60);
  const secs = seconds - mins * 60;
  const whole = Math.floor(secs);
  const ms = Math.round((secs - whole) * 1000);
  if (mins > 0) {
    return `${mins}:${String(whole).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
  }
  return `${whole}.${String(ms).padStart(3, "0")}`;
}

/** Get the start time (ms) of the current lap for the lap timer overlay. */
export function getOverlayLapStartTime(
  samples: GpsSample[],
  laps: Lap[],
  selectedLapNumber: number | null,
): number | undefined {
  if (selectedLapNumber == null || laps.length === 0) {
    return samples.length > 0 ? samples[0].t : undefined;
  }
  const lap = laps.find((l) => l.lapNumber === selectedLapNumber);
  return lap?.startTime;
}
