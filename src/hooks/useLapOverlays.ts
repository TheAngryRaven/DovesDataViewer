import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { ParsedData, Lap, Course, GpsSample } from '@/types/racing';
import type { LapSnapshot } from '@/lib/lapSnapshot';
import {
  resolveOverlayLines,
  externalOverlayId,
  OverlayLine,
  ExternalOverlay,
} from '@/lib/lapOverlays';
import { alignLapToReference } from '@/lib/lapAlignment';
import { getFile } from '@/lib/fileStorage';
import { parseDatalogFile } from '@/lib/datalogParser';
import { calculateLaps, formatLapTime } from '@/lib/lapCalculation';

interface UseLapOverlaysArgs {
  data: ParsedData | null;
  laps: Lap[];
  snapshotsForCourse: LapSnapshot[];
  /** Course used to compute laps for externally-loaded files. */
  selectedCourse: Course | null;
  /** Current lap samples — the alignment target for cross-session overlays. */
  currentLapSamples: GpsSample[];
}

/**
 * Multi-lap overlay selection for the maps + graphs. Selections are stable
 * string ids (`lap:<n>`, `snap:<id>`, `file:…`) resolved to drawable
 * {@link OverlayLine}s. Current-session laps + course snapshots resolve from
 * in-memory state; laps from *other saved files* are loaded/parsed on demand and
 * cached. Cleared when a new file or course loads.
 *
 * When `alignOverlays` is on, cross-session overlays (`snap:`/`file:`) are
 * rigidly registered onto the current lap to cancel GPS drift; same-session
 * `lap:` overlays are always left at raw GPS (shared receiver — no drift).
 */
export function useLapOverlays({
  data,
  laps,
  snapshotsForCourse,
  selectedCourse,
  currentLapSamples,
}: UseLapOverlaysArgs) {
  const [overlaySelections, setOverlaySelections] = useState<string[]>([]);
  const [externalOverlays, setExternalOverlays] = useState<Record<string, ExternalOverlay>>({});
  const [alignOverlays, setAlignOverlays] = useState(true);
  // View-only toggle: collapse the overlay *legend* (the per-lap list shown on
  // the maps) without touching the racing lines themselves, so a crowded line-up
  // (5+ overlays) doesn't bury the map under labels. Lines stay drawn.
  const [showOverlayLegend, setShowOverlayLegend] = useState(true);
  // Parsed external files (samples + laps) cached by name, for the picker.
  const parsedFiles = useRef<Map<string, { samples: GpsSample[]; laps: Lap[] }>>(new Map());

  // A fresh session is a fresh slate.
  useEffect(() => {
    setOverlaySelections([]);
    setExternalOverlays({});
    parsedFiles.current.clear();
  }, [data]);

  // Changing the course re-derives laps, so external overlays (lap indices for
  // the old course) no longer apply — drop them.
  useEffect(() => {
    setExternalOverlays({});
    parsedFiles.current.clear();
    setOverlaySelections((prev) => prev.filter((id) => !id.startsWith('file:')));
  }, [selectedCourse]);

  const toggleOverlay = useCallback((id: string) => {
    setOverlaySelections((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }, []);

  const clearOverlays = useCallback(() => setOverlaySelections([]), []);
  const toggleAlignOverlays = useCallback(() => setAlignOverlays((v) => !v), []);
  const toggleOverlayLegend = useCallback(() => setShowOverlayLegend((v) => !v), []);

  // Load another saved file and compute its laps for the current course (for the
  // overlay picker). Returns the lap list, or null when it can't be used.
  const loadOverlayFile = useCallback(
    async (fileName: string): Promise<Array<{ lapNumber: number; lapTimeMs: number }> | null> => {
      if (!selectedCourse) return null;
      const cached = parsedFiles.current.get(fileName);
      if (cached) return cached.laps.map((l) => ({ lapNumber: l.lapNumber, lapTimeMs: l.lapTimeMs }));

      const blob = await getFile(fileName);
      if (!blob) return null;
      // Async parse so binary formats that need a worker (AiM XRK/XRZ) work as
      // overlay sources too; results are cached above so this runs once per file.
      const parsed = await parseDatalogFile(new File([blob], fileName));
      const computed = calculateLaps(parsed.samples, selectedCourse);
      if (computed.length === 0) return null;

      parsedFiles.current.set(fileName, { samples: parsed.samples, laps: computed });
      return computed.map((l) => ({ lapNumber: l.lapNumber, lapTimeMs: l.lapTimeMs }));
    },
    [selectedCourse],
  );

  // Add (or no-op if present) a lap from a loaded external file as an overlay.
  // `displayName` (the session's date/time label) is preferred for the legend so
  // raw file names never leak into the UI — falls back to the file name.
  const addExternalOverlay = useCallback((fileName: string, lapNumber: number, displayName?: string) => {
    const cached = parsedFiles.current.get(fileName);
    if (!cached) return;
    const lap = cached.laps.find((l) => l.lapNumber === lapNumber);
    if (!lap) return;
    const samples = cached.samples.slice(lap.startIndex, lap.endIndex + 1);
    if (samples.length < 2) return;

    const id = externalOverlayId(fileName, lapNumber);
    const baseName = displayName?.trim() || fileName;
    const shortName = baseName.length > 22 ? `${baseName.slice(0, 21)}…` : baseName;
    const label = `${shortName} · L${lapNumber} · ${formatLapTime(lap.lapTimeMs)}`;
    setExternalOverlays((prev) => ({ ...prev, [id]: { samples, label } }));
    setOverlaySelections((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);

  const overlayLines: OverlayLine[] = useMemo(() => {
    const lines = resolveOverlayLines(overlaySelections, {
      laps,
      sessionSamples: data?.samples ?? [],
      snapshots: snapshotsForCourse,
      externalOverlays,
    });
    if (!alignOverlays || currentLapSamples.length < 3) return lines;
    // Align only cross-session overlays; same-session laps register as-is.
    return lines.map((line) =>
      line.id.startsWith('lap:')
        ? line
        : { ...line, samples: alignLapToReference(line.samples, currentLapSamples) },
    );
  }, [overlaySelections, laps, data, snapshotsForCourse, externalOverlays, alignOverlays, currentLapSamples]);

  return {
    overlaySelections,
    overlayLines,
    toggleOverlay,
    clearOverlays,
    alignOverlays,
    toggleAlignOverlays,
    showOverlayLegend,
    toggleOverlayLegend,
    loadOverlayFile,
    addExternalOverlay,
  };
}
