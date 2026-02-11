import { useState, useCallback, useMemo, useEffect } from "react";
import { ParsedData, Lap, GpsSample, TrackCourseSelection, Course } from "@/types/racing";
import { calculateLaps } from "@/lib/lapCalculation";
import { saveFileMetadata, getFileMetadata } from "@/lib/fileStorage";

/**
 * Manages track/course selection, lap calculation, lap/reference selection,
 * filtered samples, visible range, and current scrub index.
 */
export function useLapManagement(data: ParsedData | null, currentFileName: string | null) {
  const [selection, setSelection] = useState<TrackCourseSelection | null>(null);
  const [laps, setLaps] = useState<Lap[]>([]);
  const [selectedLapNumber, setSelectedLapNumber] = useState<number | null>(null);
  const [referenceLapNumber, setReferenceLapNumber] = useState<number | null>(null);
  const [visibleRange, setVisibleRange] = useState<[number, number]>([0, 0]);
  const [currentIndex, setCurrentIndex] = useState(0);

  const selectedCourse: Course | null = selection?.course ?? null;

  // Filter samples to selected lap
  const filteredSamples = useMemo((): GpsSample[] => {
    if (!data) return [];
    if (selectedLapNumber === null) return data.samples;
    const lap = laps.find((l) => l.lapNumber === selectedLapNumber);
    if (!lap) return data.samples;
    return data.samples.slice(lap.startIndex, lap.endIndex + 1);
  }, [data, laps, selectedLapNumber]);

  // Reset visible range when filtered samples change
  useEffect(() => {
    if (filteredSamples.length > 0) {
      setVisibleRange([0, filteredSamples.length - 1]);
    }
  }, [filteredSamples.length, selectedLapNumber]);

  // Visible samples based on range selection
  const visibleSamples = useMemo((): GpsSample[] => {
    if (filteredSamples.length === 0) return [];
    const [start, end] = visibleRange;
    return filteredSamples.slice(start, end + 1);
  }, [filteredSamples, visibleRange]);

  // Compute bounds for filtered samples
  const filteredBounds = useMemo(() => {
    if (filteredSamples.length === 0) return data?.bounds;
    let minLat = Infinity, maxLat = -Infinity;
    let minLon = Infinity, maxLon = -Infinity;
    for (const s of filteredSamples) {
      if (s.lat < minLat) minLat = s.lat;
      if (s.lat > maxLat) maxLat = s.lat;
      if (s.lon < minLon) minLon = s.lon;
      if (s.lon > maxLon) maxLon = s.lon;
    }
    return { minLat, maxLat, minLon, maxLon };
  }, [filteredSamples, data?.bounds]);

  const calculateAndSetLaps = useCallback(
    (course: Course, samples: GpsSample[]) => {
      const computedLaps = calculateLaps(samples, course);
      setLaps(computedLaps);
      if (computedLaps.length > 0) {
        const fastest = computedLaps.reduce(
          (min, lap) => (lap.lapTimeMs < min.lapTimeMs ? lap : min),
          computedLaps[0]
        );
        setSelectedLapNumber(fastest.lapNumber);
      }
      return computedLaps;
    },
    []
  );

  const handleSelectionChange = useCallback(
    (newSelection: TrackCourseSelection | null) => {
      setSelection(newSelection);

      // Persist track/course association for current file
      if (currentFileName && newSelection) {
        getFileMetadata(currentFileName).then((existing) => {
          saveFileMetadata({
            fileName: currentFileName,
            trackName: newSelection.trackName,
            courseName: newSelection.courseName,
            weatherStationId: existing?.weatherStationId,
            weatherStationName: existing?.weatherStationName,
            weatherStationDistanceKm: existing?.weatherStationDistanceKm,
          });
        });
      }

      // Recalculate laps
      if (newSelection?.course && data) {
        calculateAndSetLaps(newSelection.course, data.samples);
      } else {
        setLaps([]);
        setSelectedLapNumber(null);
      }
    },
    [data, currentFileName, calculateAndSetLaps]
  );

  const handleLapSelect = useCallback((lap: Lap) => {
    setSelectedLapNumber(lap.lapNumber);
    setCurrentIndex(0);
  }, []);

  const handleLapDropdownChange = useCallback((value: string) => {
    if (value === "all") {
      setSelectedLapNumber(null);
      setCurrentIndex(0);
    } else {
      setSelectedLapNumber(parseInt(value, 10));
      setCurrentIndex(0);
    }
  }, []);

  const handleSetReference = useCallback((lapNumber: number) => {
    setReferenceLapNumber((prev) => (prev === lapNumber ? null : lapNumber));
  }, []);

  const handleScrub = useCallback(
    (index: number) => {
      const clampedIndex = Math.max(0, Math.min(index, visibleRange[1] - visibleRange[0]));
      setCurrentIndex(clampedIndex);
    },
    [visibleRange]
  );

  const handleRangeChange = useCallback(
    (newRange: [number, number]) => {
      setVisibleRange(newRange);
      const visibleLength = newRange[1] - newRange[0];
      if (currentIndex > visibleLength) {
        setCurrentIndex(visibleLength);
      }
    },
    [currentIndex]
  );

  // Format range label helper
  const formatRangeLabel = useCallback(
    (idx: number) => {
      const sample = filteredSamples[idx];
      if (!sample) return "";
      const totalMs = sample.t - filteredSamples[0].t;
      const secs = Math.floor(totalMs / 1000);
      const mins = Math.floor(secs / 60);
      const remSecs = secs % 60;
      return `${mins}:${remSecs.toString().padStart(2, "0")}`;
    },
    [filteredSamples]
  );

  return {
    selection,
    setSelection,
    selectedCourse,
    laps,
    setLaps,
    selectedLapNumber,
    setSelectedLapNumber,
    referenceLapNumber,
    setReferenceLapNumber,
    filteredSamples,
    visibleSamples,
    visibleRange,
    currentIndex,
    setCurrentIndex,
    filteredBounds,
    calculateAndSetLaps,
    handleSelectionChange,
    handleLapSelect,
    handleLapDropdownChange,
    handleSetReference,
    handleScrub,
    handleRangeChange,
    formatRangeLabel,
  };
}
