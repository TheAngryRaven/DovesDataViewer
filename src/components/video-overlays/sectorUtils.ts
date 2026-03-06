/**
 * Shared sector status logic used by SectorOverlay and MapOverlay.
 */
import type { Lap, GpsSample } from "@/types/racing";

export type SectorStatus = "outlap" | "first" | "best" | "slower" | "active";

export interface SectorInfo {
  status: SectorStatus;
  /** Sample index in allSamples where this sector starts */
  startIdx: number;
  /** Sample index in allSamples where this sector ends (or current position) */
  endIdx: number;
}

export const SECTOR_COLORS: Record<SectorStatus, string> = {
  best: "rgba(168, 85, 247, 0.9)",   // purple
  slower: "rgba(239, 68, 68, 0.9)",  // red
  first: "rgba(34, 197, 94, 0.9)",   // green
  active: "rgba(59, 130, 246, 0.6)", // blue
  outlap: "rgba(128, 128, 128, 0.35)", // grey
};

/**
 * Compute best sector times across all laps.
 */
export function computeBestSectors(laps: Lap[]) {
  const best = { s1: Infinity, s2: Infinity, s3: Infinity };
  for (const lap of laps) {
    if (!lap.sectors) continue;
    if (lap.sectors.s1 !== undefined && lap.sectors.s1 < best.s1) best.s1 = lap.sectors.s1;
    if (lap.sectors.s2 !== undefined && lap.sectors.s2 < best.s2) best.s2 = lap.sectors.s2;
    if (lap.sectors.s3 !== undefined && lap.sectors.s3 < best.s3) best.s3 = lap.sectors.s3;
  }
  return best;
}

/**
 * Given samples, the current lap, and the current time,
 * returns 3 SectorInfo objects with status + index ranges.
 */
export function computeSectorSegments(
  samples: GpsSample[],
  currentLap: Lap | null,
  currentTime: number,
  laps: Lap[],
): SectorInfo[] {
  const fallback: SectorInfo[] = [
    { status: "outlap", startIdx: 0, endIdx: samples.length - 1 },
  ];

  if (!currentLap?.sectors) return fallback;
  const s = currentLap.sectors;
  const isFirstLap = currentLap.lapNumber === 1;
  const best = computeBestSectors(laps);

  const lapStartTime = currentLap.startTime;
  const s1Time = s.s1 !== undefined && s.s1 > 0 ? s.s1 : 0;
  const s2Time = s.s2 !== undefined && s.s2 > 0 ? s.s2 : 0;
  const s3Time = s.s3 !== undefined && s.s3 > 0 ? s.s3 : 0;

  const s2CrossingTime = s1Time > 0 ? lapStartTime + s1Time : Infinity;
  const s3CrossingTime = s2Time > 0 ? s2CrossingTime + s2Time : Infinity;

  // Find sample indices for sector boundaries
  const lapStartIdx = currentLap.startIndex;
  const lapEndIdx = currentLap.endIndex;

  const s2Idx = findIndexByTime(samples, s2CrossingTime, lapStartIdx, lapEndIdx);
  const s3Idx = findIndexByTime(samples, s3CrossingTime, lapStartIdx, lapEndIdx);

  // Find current position index
  const curIdx = findIndexByTime(samples, currentTime, lapStartIdx, lapEndIdx);

  const getStatus = (sectorTime: number, bestTime: number): SectorStatus => {
    if (isFirstLap && sectorTime === bestTime) return "first";
    if (sectorTime <= bestTime) return "best";
    return "slower";
  };

  const result: SectorInfo[] = [];

  // Sector 1: lapStart → s2Crossing
  if (s1Time > 0) {
    if (currentTime < s2CrossingTime) {
      result.push({ status: "active", startIdx: lapStartIdx, endIdx: curIdx });
    } else {
      result.push({ status: getStatus(s1Time, best.s1), startIdx: lapStartIdx, endIdx: s2Idx });
    }
  } else {
    result.push({ status: "outlap", startIdx: lapStartIdx, endIdx: s2Idx < Infinity ? s2Idx : lapEndIdx });
  }

  // Sector 2: s2Crossing → s3Crossing
  if (currentTime < s2CrossingTime) {
    result.push({ status: "outlap", startIdx: s2Idx, endIdx: s3Idx < Infinity ? s3Idx : lapEndIdx });
  } else if (s2Time > 0) {
    if (currentTime < s3CrossingTime) {
      result.push({ status: "active", startIdx: s2Idx, endIdx: curIdx });
    } else {
      result.push({ status: getStatus(s2Time, best.s2), startIdx: s2Idx, endIdx: s3Idx });
    }
  } else {
    result.push({ status: "outlap", startIdx: s2Idx, endIdx: s3Idx < Infinity ? s3Idx : lapEndIdx });
  }

  // Sector 3: s3Crossing → lapEnd
  if (currentTime < s3CrossingTime) {
    result.push({ status: "outlap", startIdx: s3Idx, endIdx: lapEndIdx });
  } else if (s3Time > 0) {
    if (currentTime < currentLap.endTime) {
      result.push({ status: "active", startIdx: s3Idx, endIdx: curIdx });
    } else {
      result.push({ status: getStatus(s3Time, best.s3), startIdx: s3Idx, endIdx: lapEndIdx });
    }
  } else {
    result.push({ status: "outlap", startIdx: s3Idx, endIdx: lapEndIdx });
  }

  return result;
}

/** Binary search for nearest sample index at a given time */
function findIndexByTime(samples: GpsSample[], time: number, lo: number, hi: number): number {
  if (time === Infinity) return hi;
  lo = Math.max(0, lo);
  hi = Math.min(samples.length - 1, hi);
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
