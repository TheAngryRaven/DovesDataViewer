import { useCallback, useState } from "react";
import {
  ParsedData,
  Track,
  TrackCourseSelection,
  CourseDetectionResult,
} from "@/types/racing";
import { getFileMetadata, updateFileMetadata } from "@/lib/fileStorage";
import { loadTracks } from "@/lib/trackStorage";
import { findNearestTrack } from "@/lib/trackUtils";
import { autoDetectCourse } from "@/lib/courseDetection";
import type { useSessionData } from "@/hooks/useSessionData";
import type { useLapManagement } from "@/hooks/useLapManagement";
import type { useSessionMetadata } from "@/hooks/useSessionMetadata";

interface UseDataLoaderOptions {
  sessionData: ReturnType<typeof useSessionData>;
  lapMgmt: ReturnType<typeof useLapManagement>;
  sessionMeta: ReturnType<typeof useSessionMetadata>;
  /** The sample-loader expects to restore metadata for this specific fixture file. */
  sampleFileName?: string;
}

export interface UseDataLoaderReturn {
  /** Main file-load orchestrator. Invoked from drag-drop, file manager, and sample loader. */
  handleDataLoaded: (parsedData: ParsedData, fileName?: string) => Promise<void>;
  /** Load the bundled sample fixture and restore its metadata. */
  handleLoadSample: () => Promise<void>;
  /** User picked a track/course in the prompt dialog — apply selection and recompute laps. */
  handleTrackPromptSelect: (sel: TrackCourseSelection) => void;

  // Track-prompt UI state owned by this hook (only relevant right after a load).
  trackPromptOpen: boolean;
  setTrackPromptOpen: (open: boolean) => void;
  detectedTrack: Track | null;
  detectionResult: CourseDetectionResult | null;
  allTracks: Track[];
  gpsCenter: { lat: number; lon: number } | null;
}

const DEFAULT_SAMPLE_FILE_NAME = "okc-tillotson-data.dovex";

/** Pick the lap with the lowest lapTimeMs (linear, no Math.min spread). */
function pickFastestLapNumber(laps: { lapNumber: number; lapTimeMs: number }[]): number | null {
  if (laps.length === 0) return null;
  let fastest = laps[0];
  for (let i = 1; i < laps.length; i++) {
    if (laps[i].lapTimeMs < fastest.lapTimeMs) fastest = laps[i];
  }
  return fastest.lapNumber;
}

/**
 * File-load orchestration: connects sessionData (parsing), lapMgmt (lap calc),
 * sessionMeta (per-file kart/setup/weather metadata), and the track-prompt UI.
 *
 * Pulled out of Index.tsx so the orchestration logic lives next to the other
 * session hooks instead of being inlined in the SPA root.
 */
export function useDataLoader({
  sessionData,
  lapMgmt,
  sessionMeta,
  sampleFileName = DEFAULT_SAMPLE_FILE_NAME,
}: UseDataLoaderOptions): UseDataLoaderReturn {
  const [trackPromptOpen, setTrackPromptOpen] = useState(false);
  const [detectedTrack, setDetectedTrack] = useState<Track | null>(null);
  const [allTracks, setAllTracks] = useState<Track[]>([]);
  const [gpsCenter, setGpsCenter] = useState<{ lat: number; lon: number } | null>(null);
  const [detectionResult, setDetectionResult] = useState<CourseDetectionResult | null>(null);

  const handleDataLoaded = useCallback(
    async (parsedData: ParsedData, fileName?: string) => {
      sessionData.loadParsedData(parsedData, fileName);
      lapMgmt.setCurrentIndex(0);

      // Try to restore track selection from metadata
      let courseToUse = lapMgmt.selectedCourse;
      let restoredFromMeta = false;
      if (fileName) {
        const meta = await getFileMetadata(fileName);
        if (meta) {
          // Backfill the session start time for files saved before this existed,
          // so the browser's date/time display name works on older logs too.
          if (meta.sessionStartTime == null && parsedData.startDate) {
            updateFileMetadata(fileName, { sessionStartTime: parsedData.startDate.getTime() });
          }
          const tracks = await loadTracks();
          const track = tracks.find((t) => t.name === meta.trackName);
          const course = track?.courses.find((c) => c.name === meta.courseName);
          if (track && course) {
            const restoredSelection: TrackCourseSelection = {
              trackName: track.name,
              courseName: course.name,
              course,
            };
            lapMgmt.setSelection(restoredSelection);
            courseToUse = course;
            restoredFromMeta = true;
          }
          sessionMeta.restoreFromMetadata(meta);
        } else {
          sessionMeta.restoreFromMetadata(null);
        }
      } else {
        sessionMeta.restoreFromMetadata(null);
      }

      // Calculate laps if a course is known
      if (courseToUse) {
        const computedLaps = lapMgmt.calculateAndSetLaps(courseToUse, parsedData.samples, fileName);
        lapMgmt.setSelectedLapNumber(pickFastestLapNumber(computedLaps));
      } else {
        lapMgmt.setSelectedLapNumber(null);
      }

      // Auto-detect track + course only when metadata didn't already restore one
      if (restoredFromMeta) return;

      const tracks = await loadTracks();
      setAllTracks(tracks);
      const validSample = parsedData.samples.find(
        (s) => s.lat !== 0 && s.lon !== 0 && Math.abs(s.lat) <= 90 && Math.abs(s.lon) <= 180,
      );
      if (!validSample) return;

      setGpsCenter({ lat: validSample.lat, lon: validSample.lon });

      const detection = autoDetectCourse(parsedData.samples, tracks);
      setDetectionResult(detection);

      if (detection && !detection.isWaypointMode) {
        // Auto-detected a real course — apply directly, no prompt needed
        lapMgmt.setSelection({
          trackName: detection.track.name,
          courseName: detection.course.name,
          course: detection.course,
          direction: detection.direction,
        });
        lapMgmt.setLaps(detection.laps);
        lapMgmt.setSelectedLapNumber(pickFastestLapNumber(detection.laps));
        return;
      }

      if (detection && detection.isWaypointMode) {
        // Waypoint mode — apply laps and prompt the user to confirm
        lapMgmt.setLaps(detection.laps);
        lapMgmt.setSelectedLapNumber(pickFastestLapNumber(detection.laps));
        setDetectedTrack(null);
        setTrackPromptOpen(true);
        return;
      }

      // No detection — fall back to nearest track and prompt
      const nearest = findNearestTrack(validSample.lat, validSample.lon, tracks);
      setDetectedTrack(nearest as Track | null);
      setTrackPromptOpen(true);
    },
    [sessionData, lapMgmt, sessionMeta],
  );

  const handleLoadSample = useCallback(async () => {
    await sessionData.handleLoadSample(
      lapMgmt.handleSelectionChange,
      (computedLaps, autoSelectLap, autoSelectRef) => {
        lapMgmt.setLaps(computedLaps);
        if (autoSelectLap !== undefined) lapMgmt.setSelectedLapNumber(autoSelectLap);
        if (autoSelectRef !== undefined) lapMgmt.setReferenceLapNumber(autoSelectRef);
      },
    );
    // Restore session metadata (kart/setup link) for the sample file
    const meta = await getFileMetadata(sampleFileName);
    sessionMeta.restoreFromMetadata(meta);
  }, [sessionData, lapMgmt, sessionMeta, sampleFileName]);

  const handleTrackPromptSelect = useCallback(
    (sel: TrackCourseSelection) => {
      lapMgmt.handleSelectionChange(sel);
      const samples = sessionData.data?.samples;
      if (!samples) return;
      const computedLaps = lapMgmt.calculateAndSetLaps(sel.course, samples);
      lapMgmt.setSelectedLapNumber(pickFastestLapNumber(computedLaps));
    },
    [lapMgmt, sessionData.data],
  );

  return {
    handleDataLoaded,
    handleLoadSample,
    handleTrackPromptSelect,
    trackPromptOpen,
    setTrackPromptOpen,
    detectedTrack,
    detectionResult,
    allTracks,
    gpsCenter,
  };
}
