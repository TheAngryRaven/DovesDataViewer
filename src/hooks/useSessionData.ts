import { useState, useCallback, useEffect } from "react";
import { ParsedData, FieldMapping, GpsSample, TrackCourseSelection, Course } from "@/types/racing";
import { parseDatalog } from "@/lib/nmeaParser";
import { loadTracks } from "@/lib/trackStorage";
import { calculateLaps } from "@/lib/lapCalculation";

/**
 * Manages the core session data: parsed GPS data, current file name,
 * field mappings, and the sample data loading flow.
 */
export function useSessionData(
  isFieldHiddenByDefault: (fieldName: string) => boolean,
  defaultHiddenFields: string[]
) {
  const [data, setData] = useState<ParsedData | null>(null);
  const [currentFileName, setCurrentFileName] = useState<string | null>(null);
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>([]);
  const [isLoadingSample, setIsLoadingSample] = useState(false);

  // Sync field visibility when settings change (real-time toggle)
  useEffect(() => {
    if (fieldMappings.length === 0) return;
    setFieldMappings((prev) =>
      prev.map((f) => ({
        ...f,
        enabled: !isFieldHiddenByDefault(f.name),
      }))
    );
  }, [defaultHiddenFields, isFieldHiddenByDefault]);

  const applyFieldMappings = useCallback(
    (parsedData: ParsedData) => {
      return parsedData.fieldMappings.map((f) => ({
        ...f,
        enabled: f.enabled && !isFieldHiddenByDefault(f.name),
      }));
    },
    [isFieldHiddenByDefault]
  );

  const loadParsedData = useCallback(
    (parsedData: ParsedData, fileName?: string) => {
      setData(parsedData);
      if (fileName) setCurrentFileName(fileName);
      setFieldMappings(applyFieldMappings(parsedData));
    },
    [applyFieldMappings]
  );

  const handleFieldToggle = useCallback((fieldName: string) => {
    setFieldMappings((prev) =>
      prev.map((f) => (f.name === fieldName ? { ...f, enabled: !f.enabled } : f))
    );
  }, []);

  const handleLoadSample = useCallback(async (
    onSelectionChange: (sel: TrackCourseSelection | null) => void,
    onLapsCalculated: (laps: ReturnType<typeof calculateLaps>, autoSelectLap?: number, autoSelectRef?: number) => void
  ) => {
    setIsLoadingSample(true);
    try {
      const tracks = await loadTracks();
      const okcTrack = tracks.find((t) => t.name === "Orlando Kart Center");
      const okcCourse = okcTrack?.courses[0] ?? null;

      const response = await fetch("/samples/okc-tillotson-plain.nmea");
      const text = await response.text();
      const parsedData = parseDatalog(text);
      loadParsedData(parsedData, "okc-tillotson-plain.nmea");

      if (okcTrack && okcCourse) {
        onSelectionChange({
          trackName: okcTrack.name,
          courseName: okcCourse.name,
          course: okcCourse,
        });
        const computedLaps = calculateLaps(parsedData.samples, okcCourse);
        onLapsCalculated(
          computedLaps,
          computedLaps.length >= 5 ? 5 : undefined,
          computedLaps.length >= 8 ? 8 : undefined
        );
      }
    } catch (e) {
      console.error("Failed to load sample data:", e);
    } finally {
      setIsLoadingSample(false);
    }
  }, [loadParsedData]);

  // Find first valid GPS sample for weather lookup
  const sessionGpsPoint = (() => {
    if (!data?.samples?.length) return undefined;
    const validSample = data.samples.find(
      (s) => s.lat !== 0 && s.lon !== 0 && Math.abs(s.lat) <= 90 && Math.abs(s.lon) <= 180
    );
    return validSample ? { lat: validSample.lat, lon: validSample.lon } : undefined;
  })();

  return {
    data,
    currentFileName,
    fieldMappings,
    isLoadingSample,
    loadParsedData,
    handleFieldToggle,
    handleLoadSample,
    sessionGpsPoint,
  };
}
