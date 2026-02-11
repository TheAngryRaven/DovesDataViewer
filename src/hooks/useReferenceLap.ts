import { useState, useCallback, useMemo, useRef } from "react";
import { ParsedData, Lap, GpsSample, Course } from "@/types/racing";
import { FileEntry, listFiles, getFile } from "@/lib/fileStorage";
import { parseDatalogContent } from "@/lib/datalogParser";
import { calculateLaps, formatLapTime } from "@/lib/lapCalculation";
import { calculatePace, calculateReferenceSpeed } from "@/lib/referenceUtils";
import { findSpeedEvents } from "@/lib/speedEvents";

/**
 * Manages reference lap comparison: external reference loading, pace
 * calculation, speed deltas, and fastest-lap fallback comparison.
 */
export function useReferenceLap(
  data: ParsedData | null,
  laps: Lap[],
  selectedCourse: Course | null,
  filteredSamples: GpsSample[],
  selectedLapNumber: number | null,
  referenceLapNumber: number | null,
  externalRefSamples: GpsSample[] | null,
  useKph: boolean
) {
  // Get reference lap samples (external takes priority)
  const referenceSamples = useMemo((): GpsSample[] => {
    if (externalRefSamples) return externalRefSamples;
    if (!data || referenceLapNumber === null) return [];
    const refLap = laps.find((l) => l.lapNumber === referenceLapNumber);
    if (!refLap) return [];
    return data.samples.slice(refLap.startIndex, refLap.endIndex + 1);
  }, [data, laps, referenceLapNumber, externalRefSamples]);

  // Get fastest lap samples for pace comparison when no reference selected
  const fastestLapSamples = useMemo((): GpsSample[] => {
    if (!data || laps.length === 0) return [];
    const fastestLap = laps.reduce(
      (min, lap) => (lap.lapTimeMs < min.lapTimeMs ? lap : min),
      laps[0]
    );
    return data.samples.slice(fastestLap.startIndex, fastestLap.endIndex + 1);
  }, [data, laps]);

  // Calculate pace and reference speed when reference is selected
  const { paceData, referenceSpeedData } = useMemo(() => {
    if (referenceSamples.length === 0 || filteredSamples.length === 0) {
      return { paceData: [] as (number | null)[], referenceSpeedData: [] as (number | null)[] };
    }
    return {
      paceData: calculatePace(filteredSamples, referenceSamples),
      referenceSpeedData: calculateReferenceSpeed(filteredSamples, referenceSamples, useKph),
    };
  }, [filteredSamples, referenceSamples, useKph]);

  // Calculate lap to fastest delta (direct lap time difference)
  const lapToFastestDelta = useMemo((): number | null => {
    if (selectedLapNumber === null || laps.length === 0) return null;
    const selectedLap = laps.find((l) => l.lapNumber === selectedLapNumber);
    if (!selectedLap) return null;
    const fastestLap = laps.reduce(
      (min, lap) => (lap.lapTimeMs < min.lapTimeMs ? lap : min),
      laps[0]
    );
    return selectedLap.lapTimeMs - fastestLap.lapTimeMs;
  }, [laps, selectedLapNumber]);

  // Calculate pace diff for display (vs reference if selected, else vs best)
  const { paceDiff, paceDiffLabel, deltaTopSpeed, deltaMinSpeed, refAvgTopSpeed, refAvgMinSpeed } = useMemo((): {
    paceDiff: number | null;
    paceDiffLabel: "best" | "ref";
    deltaTopSpeed: number | null;
    deltaMinSpeed: number | null;
    refAvgTopSpeed: number | null;
    refAvgMinSpeed: number | null;
  } => {
    const defaultResult = {
      paceDiff: null as number | null,
      paceDiffLabel: "best" as const,
      deltaTopSpeed: null as number | null,
      deltaMinSpeed: null as number | null,
      refAvgTopSpeed: null as number | null,
      refAvgMinSpeed: null as number | null,
    };

    if (filteredSamples.length === 0 || selectedLapNumber === null) return defaultResult;

    // Calculate speed events for current lap
    const currentEvents = findSpeedEvents(filteredSamples);
    const currentPeaks = currentEvents.filter((e) => e.type === "peak");
    const currentValleys = currentEvents.filter((e) => e.type === "valley");
    const currentAvgTop =
      currentPeaks.length > 0 ? currentPeaks.reduce((sum, e) => sum + e.speed, 0) / currentPeaks.length : null;
    const currentAvgMin =
      currentValleys.length > 0 ? currentValleys.reduce((sum, e) => sum + e.speed, 0) / currentValleys.length : null;

    const calculateDeltas = (comparisonSamples: GpsSample[]) => {
      const compEvents = findSpeedEvents(comparisonSamples);
      const compPeaks = compEvents.filter((e) => e.type === "peak");
      const compValleys = compEvents.filter((e) => e.type === "valley");
      const compAvgTop =
        compPeaks.length > 0 ? compPeaks.reduce((sum, e) => sum + e.speed, 0) / compPeaks.length : null;
      const compAvgMin =
        compValleys.length > 0 ? compValleys.reduce((sum, e) => sum + e.speed, 0) / compValleys.length : null;
      return {
        deltaTop: currentAvgTop !== null && compAvgTop !== null ? currentAvgTop - compAvgTop : null,
        deltaMin: currentAvgMin !== null && compAvgMin !== null ? currentAvgMin - compAvgMin : null,
        refTop: compAvgTop,
        refMin: compAvgMin,
      };
    };

    // If reference is selected, use reference pace
    if (referenceSamples.length > 0 && paceData.length > 0) {
      const lastPace = paceData.filter((p) => p !== null).pop() ?? null;
      const { deltaTop, deltaMin, refTop, refMin } = calculateDeltas(referenceSamples);
      return {
        paceDiff: lastPace,
        paceDiffLabel: "ref",
        deltaTopSpeed: deltaTop,
        deltaMinSpeed: deltaMin,
        refAvgTopSpeed: refTop,
        refAvgMinSpeed: refMin,
      };
    }

    // Otherwise, compare to fastest lap
    if (fastestLapSamples.length > 0) {
      const bestPaceData = calculatePace(filteredSamples, fastestLapSamples);
      const lastPace = bestPaceData.filter((p) => p !== null).pop() ?? null;
      const { deltaTop, deltaMin, refTop, refMin } = calculateDeltas(fastestLapSamples);
      return {
        paceDiff: lastPace,
        paceDiffLabel: "best",
        deltaTopSpeed: deltaTop,
        deltaMinSpeed: deltaMin,
        refAvgTopSpeed: refTop,
        refAvgMinSpeed: refMin,
      };
    }

    return defaultResult;
  }, [filteredSamples, referenceSamples, fastestLapSamples, paceData, selectedLapNumber]);

  return {
    referenceSamples,
    paceData,
    referenceSpeedData,
    lapToFastestDelta,
    paceDiff,
    paceDiffLabel,
    deltaTopSpeed,
    deltaMinSpeed,
    refAvgTopSpeed,
    refAvgMinSpeed,
  };
}

/**
 * Manages external reference lap state and file loading.
 */
export function useExternalReference(selectedCourse: Course | null) {
  const [externalRefSamples, setExternalRefSamples] = useState<GpsSample[] | null>(null);
  const [externalRefLabel, setExternalRefLabel] = useState<string | null>(null);
  const [savedFiles, setSavedFiles] = useState<FileEntry[]>([]);
  const externalParsedRef = useRef<{ fileName: string; samples: GpsSample[]; laps: Lap[] } | null>(null);

  const refreshSavedFiles = useCallback(async () => {
    const files = await listFiles();
    setSavedFiles(files);
  }, []);

  const handleLoadFileForRef = useCallback(
    async (fileName: string): Promise<Array<{ lapNumber: number; lapTimeMs: number }> | null> => {
      if (!selectedCourse) return null;
      const blob = await getFile(fileName);
      if (!blob) return null;

      const arrayBuffer = await blob.arrayBuffer();
      const parsed = parseDatalogContent(arrayBuffer);
      const computedLaps = calculateLaps(parsed.samples, selectedCourse);

      if (computedLaps.length === 0) return null;

      externalParsedRef.current = { fileName, samples: parsed.samples, laps: computedLaps };
      return computedLaps.map((l) => ({ lapNumber: l.lapNumber, lapTimeMs: l.lapTimeMs }));
    },
    [selectedCourse]
  );

  const handleSelectExternalLap = useCallback((fileName: string, lapNumber: number) => {
    const cached = externalParsedRef.current;
    if (!cached || cached.fileName !== fileName) return;

    const lap = cached.laps.find((l) => l.lapNumber === lapNumber);
    if (!lap) return;

    const samples = cached.samples.slice(lap.startIndex, lap.endIndex + 1);
    setExternalRefSamples(samples);
    setExternalRefLabel(`${fileName} : Lap ${lapNumber} : ${formatLapTime(lap.lapTimeMs)}`);
  }, []);

  const handleClearExternalRef = useCallback(() => {
    setExternalRefSamples(null);
    setExternalRefLabel(null);
  }, []);

  return {
    externalRefSamples,
    setExternalRefSamples,
    externalRefLabel,
    setExternalRefLabel,
    savedFiles,
    refreshSavedFiles,
    handleLoadFileForRef,
    handleSelectExternalLap,
    handleClearExternalRef,
  };
}
