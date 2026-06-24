import { useCallback, useMemo } from 'react';
import { GpsSample, Course, FieldMapping, Lap } from '@/types/racing';
import type { OverlayLine } from '@/lib/lapOverlays';
import type { VideoSyncState } from '@/hooks/useVideoSync';
import { PlaybackProvider, usePlaybackContext, type PlaybackContextValue } from '@/contexts/PlaybackContext';
import {
  calculateDistanceArray,
  mapIndexByDistance,
  interpolateSampleByDistance,
  anchorSampleTimes,
} from '@/lib/referenceUtils';
import { GraphPanel } from './GraphPanel';
import { MiniMap } from './MiniMap';
import { SecondaryVideo } from './SecondaryVideo';

interface SecondaryGraphStackProps {
  /** The overlay lap this panel mirrors (its own samples + label/colour). */
  overlay: OverlayLine;
  /** Graph set + heights mirrored from the main panel. */
  activeGraphs: string[];
  graphHeights: Record<string, number>;
  /** Main panel's full lap + visible window, for distance-mapping the cursor. */
  mainFilteredSamples: GpsSample[];
  visibleRange: [number, number];
  // Passthrough chart inputs (shared with the main panel).
  referenceSamples: GpsSample[];
  fieldMappings: FieldMapping[];
  course: Course | null;
  laps: Lap[];
  selectedLapNumber: number | null;
  bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number };
  sessionFileName: string | null;
  /** Move the shared cursor (scrubbing the mirror maps back onto the main lap). */
  onScrub: (index: number) => void;
  /** When set, mirror the relocated video as a passive, lap-synced second player. */
  videoState?: VideoSyncState;
  videoEnabled?: boolean;
  /** Commit a rate-calibration anchor from the comparison video's manual nudge. */
  onCommitRateAnchor?: (lap: number, sessionMs: number, videoSec: number) => void;
}

const NO_OVERLAYS: OverlayLine[] = [];

/**
 * The right-hand stack of a split-graphs comparison. It mirrors the main panel's
 * graph set but renders them from the selected overlay lap's data, and overrides
 * the playback cursor for its subtree so every chart/map/video lands on the same
 * track position as the main cursor — in the overlay lap's own time.
 */
export function SecondaryGraphStack(props: SecondaryGraphStackProps) {
  const {
    overlay, activeGraphs, graphHeights, mainFilteredSamples, visibleRange,
    referenceSamples, fieldMappings, course, laps, selectedLapNumber, bounds,
    sessionFileName, onScrub, videoState, videoEnabled = false, onCommitRateAnchor,
  } = props;

  // The in-session lap number this overlay maps to (null for snap:/file: overlays).
  const overlayLapNumber = overlay.id.startsWith('lap:') ? Number(overlay.id.slice(4)) : null;

  // Cumulative distance for both laps — recomputed only when a lap changes, so
  // the per-tick cursor mapping is just a binary search.
  const { mainFullD, overlayFullD } = useMemo(() => ({
    mainFullD: calculateDistanceArray(mainFilteredSamples),
    overlayFullD: calculateDistanceArray(overlay.samples),
  }), [mainFilteredSamples, overlay.samples]);

  // Crop the overlay lap to the same track-position window as the main panel.
  const oStart = mapIndexByDistance(mainFullD, overlayFullD, visibleRange[0]);
  const oEnd = mapIndexByDistance(mainFullD, overlayFullD, visibleRange[1]);
  const secSamples = useMemo(
    () => overlay.samples.slice(oStart, oEnd + 1),
    [overlay.samples, oStart, oEnd],
  );

  // Anchor the overlay lap's time axis to its true (interpolated) start/finish
  // crossings. The lap is sliced on integer indices, so its first sample sits a
  // sub-sample fraction before the real crossing — a fraction that varies per lap,
  // which is what made the comparison video drift later lap-by-lap. Distances are
  // unchanged (only endpoint `t` differs), so `overlayFullD` stays valid here.
  const overlayTimeSamples = useMemo(() => {
    if (overlayLapNumber === null) return overlay.samples;
    const lap = laps.find((l) => l.lapNumber === overlayLapNumber);
    if (!lap) return overlay.samples;
    return anchorSampleTimes(overlay.samples, lap.startTime, lap.endTime);
  }, [overlayLapNumber, overlay.samples, laps]);

  // Override the playback cursor for the mirror subtree: the main cursor's track
  // position, resolved into the overlay lap. `currentIndex` is the snapped integer
  // the charts/minimap draw on; `currentSample` is *interpolated* by distance (so
  // its `t` — and thus the comparison video's seek — is sub-sample accurate and
  // boundary-anchored). The two are intentionally not 1:1 in this subtree.
  const mapToInner = useCallback((mainIndex: number): PlaybackContextValue => {
    const absMain = Math.max(0, Math.min(visibleRange[0] + mainIndex, mainFullD.length - 1));
    const oIdx = mapIndexByDistance(mainFullD, overlayFullD, absMain);
    const secIdx = Math.max(0, Math.min(oIdx - oStart, secSamples.length - 1));
    const currentSample = interpolateSampleByDistance(
      overlayTimeSamples, overlayFullD, mainFullD[absMain] ?? 0,
    );
    return { currentIndex: secIdx, currentSample };
  }, [visibleRange, mainFullD, overlayFullD, oStart, secSamples, overlayTimeSamples]);

  // Scrubbing the mirror moves the shared cursor: map the overlay index back
  // onto the main lap's visible window (onScrub indexes into that window).
  const handleSecondaryScrub = useCallback((secIndex: number) => {
    const absOverlay = oStart + secIndex;
    const mainAbs = mapIndexByDistance(overlayFullD, mainFullD, absOverlay);
    const windowMax = visibleRange[1] - visibleRange[0];
    const mainVisible = Math.max(0, Math.min(mainAbs - visibleRange[0], windowMax));
    onScrub(mainVisible);
  }, [oStart, overlayFullD, mainFullD, visibleRange, onScrub]);

  const renderVideo = videoEnabled && videoState
    ? () => (
      <SecondaryVideo
        videoState={videoState}
        overlayId={overlay.id}
        lapNumber={overlayLapNumber}
        onCommitRateAnchor={onCommitRateAnchor}
      />
    )
    : undefined;

  const renderMiniMap = useCallback(() => (
    <MiniMap
      samples={secSamples}
      allSamples={overlay.samples}
      course={course}
      bounds={bounds}
      rangeStart={oStart}
    />
  ), [secSamples, overlay.samples, course, bounds, oStart]);

  // The mirrored GraphPanel is created once per (non-cursor) render; CursorBridge
  // re-renders per playback tick but reuses this element, so only the cursor-
  // tracking children inside it re-render.
  const panel = (
    <GraphPanel
      secondary
      header={(
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: overlay.color }} />
          <span className="truncate font-mono text-xs text-muted-foreground">{overlay.label}</span>
        </span>
      )}
      controlledActiveGraphs={activeGraphs}
      controlledGraphHeights={graphHeights}
      samples={secSamples}
      filteredSamples={overlay.samples}
      referenceSamples={referenceSamples}
      fieldMappings={fieldMappings}
      onScrub={handleSecondaryScrub}
      visibleRange={[oStart, oEnd]}
      onRangeChange={() => {}}
      minRange={1}
      formatRangeLabel={() => ''}
      sessionFileName={sessionFileName}
      overlayLines={NO_OVERLAYS}
      course={course}
      laps={laps}
      selectedLapNumber={selectedLapNumber}
      renderVideo={renderVideo}
      renderMiniMap={renderMiniMap}
    />
  );

  return <CursorBridge mapToInner={mapToInner}>{panel}</CursorBridge>;
}

/**
 * Reads the shared (outer) playback cursor and supplies the mirror subtree a
 * remapped cursor. Isolated so a playback tick re-renders only this bridge plus
 * the cursor-tracking leaves — never the mirrored GraphPanel element above.
 */
function CursorBridge({
  mapToInner, children,
}: {
  mapToInner: (mainIndex: number) => PlaybackContextValue;
  children: React.ReactNode;
}) {
  const { currentIndex } = usePlaybackContext();
  const value = useMemo(() => mapToInner(currentIndex), [mapToInner, currentIndex]);
  return <PlaybackProvider value={value}>{children}</PlaybackProvider>;
}
