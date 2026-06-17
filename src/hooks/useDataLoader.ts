import { useCallback, useState } from "react";
import {
  ParsedData,
  Track,
  TrackCourseSelection,
  CourseDetectionResult,
} from "@/types/racing";
import { getFileMetadata, updateFileMetadata, type FileMetadata } from "@/lib/fileStorage";
import { loadTracks } from "@/lib/trackStorage";
import { findNearestTrack } from "@/lib/trackUtils";
import { autoDetectCourse } from "@/lib/courseDetection";
import { parseDatalogFile } from "@/lib/datalogParser";
import { ensureSampleFile, SAMPLE_FILE_NAME } from "@/lib/sampleData";
import type { useSessionData } from "@/hooks/useSessionData";
import type { useLapManagement } from "@/hooks/useLapManagement";
import type { useSessionMetadata } from "@/hooks/useSessionMetadata";

interface UseDataLoaderOptions {
  sessionData: ReturnType<typeof useSessionData>;
  lapMgmt: ReturnType<typeof useLapManagement>;
  sessionMeta: ReturnType<typeof useSessionMetadata>;
}

export interface UseDataLoaderReturn {
  /** Main file-load orchestrator. Invoked from drag-drop, file manager, and sample loader. */
  handleDataLoaded: (parsedData: ParsedData, fileName?: string) => Promise<void>;
  /** Seed (if needed) and open the bundled sample log, exactly like any saved file. */
  handleLoadSample: () => Promise<void>;
  /** True while the sample log is being seeded/opened (drives the button spinner). */
  isLoadingSample: boolean;
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

/** Pick the lap with the lowest lapTimeMs (linear, no Math.min spread). */
function pickFastestLap<T extends { lapTimeMs: number }>(laps: T[]): T | null {
  if (laps.length === 0) return null;
  let fastest = laps[0];
  for (let i = 1; i < laps.length; i++) {
    if (laps[i].lapTimeMs < fastest.lapTimeMs) fastest = laps[i];
  }
  return fastest;
}

/** Pick the lap number with the lowest lapTimeMs. */
function pickFastestLapNumber(laps: { lapNumber: number; lapTimeMs: number }[]): number | null {
  return pickFastestLap(laps)?.lapNumber ?? null;
}

/**
 * The metadata patch to persist when auto-detection resolves a real course, so a
 * freshly-loaded session is filed under its track/course in the browser without
 * any manual save — including the session start time (display name) and fastest
 * lap (the browser badge). Pure so the tag-on-detect behaviour stays testable.
 */
export function detectionMetadataPatch(
  trackName: string,
  courseName: string,
  laps: { lapNumber: number; lapTimeMs: number }[],
  startDate?: Date,
): Partial<Omit<FileMetadata, "fileName">> {
  const patch: Partial<Omit<FileMetadata, "fileName">> = { trackName, courseName };
  if (startDate) patch.sessionStartTime = startDate.getTime();
  const fastest = pickFastestLap(laps);
  if (fastest) {
    patch.fastestLapMs = fastest.lapTimeMs;
    patch.fastestLapNumber = fastest.lapNumber;
  }
  return patch;
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
}: UseDataLoaderOptions): UseDataLoaderReturn {
  const [trackPromptOpen, setTrackPromptOpen] = useState(false);
  const [detectedTrack, setDetectedTrack] = useState<Track | null>(null);
  const [allTracks, setAllTracks] = useState<Track[]>([]);
  const [gpsCenter, setGpsCenter] = useState<{ lat: number; lon: number } | null>(null);
  const [detectionResult, setDetectionResult] = useState<CourseDetectionResult | null>(null);
  const [isLoadingSample, setIsLoadingSample] = useState(false);

  const handleDataLoaded = useCallback(
    async (parsedData: ParsedData, fileName?: string) => {
      sessionData.loadParsedData(parsedData, fileName);
      lapMgmt.setCurrentIndex(0);

      // Try to restore track selection from metadata
      let courseToUse = lapMgmt.selectedCourse;
      let restoredFromMeta = false;
      if (fileName) {
        const meta = await getFileMetadata(fileName);
        // Always record the session start time when the file carries one, so the
        // browser shows a date/time name (and the weather lookup has a timestamp)
        // even for *untagged* sessions whose track isn't in the database yet —
        // common for AiM XRK logs from unknown venues. updateFileMetadata creates
        // the row if there isn't one.
        if (parsedData.startDate && (!meta || meta.sessionStartTime == null)) {
          updateFileMetadata(fileName, { sessionStartTime: parsedData.startDate.getTime() });
        }
        if (meta) {
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
        // setSelection is the raw setter and does NOT persist — so write the
        // detected tag straight to metadata here, otherwise a confidently
        // auto-detected session would stay "Untagged" until some later manual
        // selection happened to save it.
        if (fileName) {
          updateFileMetadata(
            fileName,
            detectionMetadataPatch(
              detection.track.name,
              detection.course.name,
              detection.laps,
              parsedData.startDate,
            ),
          );
        }
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

  // The sample log is an ordinary seeded file now: ensure it exists, parse it,
  // and open it through the normal load path (which auto-detects its course and
  // selects the fastest lap) — no bespoke sample handling.
  const handleLoadSample = useCallback(async () => {
    setIsLoadingSample(true);
    try {
      const blob = await ensureSampleFile();
      if (!blob) return;
      const parsed = await parseDatalogFile(new File([blob], SAMPLE_FILE_NAME));
      await handleDataLoaded(parsed, SAMPLE_FILE_NAME);
    } catch (e) {
      console.error("Failed to load sample data:", e);
    } finally {
      setIsLoadingSample(false);
    }
  }, [handleDataLoaded]);

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
    isLoadingSample,
    handleTrackPromptSelect,
    trackPromptOpen,
    setTrackPromptOpen,
    detectedTrack,
    detectionResult,
    allTracks,
    gpsCenter,
  };
}
