import { useState, useCallback, useMemo, useEffect } from 'react';
import type { ParsedData, Lap } from '@/types/racing';
import type { LapSnapshot } from '@/lib/lapSnapshot';
import { resolveOverlayLines, OverlayLine } from '@/lib/lapOverlays';

/**
 * Multi-lap overlay selection for the map: which laps / snapshots are shown as
 * extra racing lines. Selections are stable string ids (`lap:<n>`, `snap:<id>`)
 * resolved to drawable {@link OverlayLine}s against the current session + course
 * snapshots. Cleared automatically when a new file loads.
 */
export function useLapOverlays(
  data: ParsedData | null,
  laps: Lap[],
  snapshotsForCourse: LapSnapshot[],
) {
  const [overlaySelections, setOverlaySelections] = useState<string[]>([]);

  // A fresh session is a fresh slate — stale lap/snapshot ids don't carry over.
  useEffect(() => {
    setOverlaySelections([]);
  }, [data]);

  const toggleOverlay = useCallback((id: string) => {
    setOverlaySelections((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }, []);

  const clearOverlays = useCallback(() => setOverlaySelections([]), []);

  const overlayLines: OverlayLine[] = useMemo(
    () => resolveOverlayLines(overlaySelections, {
      laps,
      sessionSamples: data?.samples ?? [],
      snapshots: snapshotsForCourse,
    }),
    [overlaySelections, laps, data, snapshotsForCourse],
  );

  return { overlaySelections, overlayLines, toggleOverlay, clearOverlays };
}
