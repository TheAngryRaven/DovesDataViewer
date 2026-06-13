import { memo, useMemo, useState } from 'react';
import { Lap, courseHasSectors, Course, GpsSample } from '@/types/racing';
import { formatLapTime, formatSectorTime, calculateOptimalLap } from '@/lib/lapCalculation';
import { normalizeCourseSectors, sectorLabels } from '@/lib/courseSectors';
import { Trophy, Zap, Snail, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ExternalRefBar } from '@/components/ExternalRefBar';
import { LapSnapshotControls } from '@/components/LapSnapshotControls';
import type { LapSnapshot } from '@/lib/lapSnapshot';
import { type OverlayLine } from '@/lib/lapOverlays';
import type { SaveSnapshotResult } from '@/hooks/useLapSnapshots';
import { FileEntry } from '@/lib/fileStorage';
import { useSettingsContext } from '@/contexts/SettingsContext';
import { haversineDistance, METERS_TO_FEET } from '@/lib/parserUtils';

/**
 * Feature flag: the old "External Ref" bar at the top of the lap list is hidden
 * now that references are set from the header Overlays menu and the per-row Ref
 * buttons. Left in place (not deleted) so it can be re-enabled quickly.
 */
const SHOW_EXTERNAL_REF_BAR: boolean = false;

interface LapTableProps {
  laps: Lap[];
  course: Course | null;
  samples?: GpsSample[];
  onLapSelect?: (lap: Lap) => void;
  selectedLapNumber?: number | null;
  referenceLapNumber?: number | null;
  onSetReference?: (lapNumber: number) => void;
  // External reference props
  externalRefLabel?: string | null;
  savedFiles?: FileEntry[];
  onLoadFileForRef?: (fileName: string) => Promise<Array<{ lapNumber: number; lapTimeMs: number }> | null>;
  onSelectExternalLap?: (fileName: string, lapNumber: number) => void;
  onClearExternalRef?: () => void;
  onRefreshSavedFiles?: () => void;
  // Lap snapshots (loaded as the reference overlay)
  snapshotsForCourse?: LapSnapshot[];
  activeSnapshotId?: string | null;
  canSnapshot?: boolean;
  onLoadSnapshot?: (snap: LapSnapshot) => void;
  onClearSnapshot?: () => void;
  onSaveSnapshot?: (force?: boolean) => Promise<SaveSnapshotResult>;
  // Map overlays (extra racing lines)
  overlayLines?: OverlayLine[];
  onToggleOverlay?: (id: string) => void;
}

export const LapTable = memo(function LapTable({ laps, course, samples, onLapSelect, selectedLapNumber, referenceLapNumber, onSetReference, externalRefLabel, savedFiles, onLoadFileForRef, onSelectExternalLap, onClearExternalRef, onRefreshSavedFiles, snapshotsForCourse, activeSnapshotId, canSnapshot, onLoadSnapshot, onClearSnapshot, onSaveSnapshot, overlayLines = [], onToggleOverlay }: LapTableProps) {
  const { useKph } = useSettingsContext();

  const showSectors = courseHasSectors(course);
  const [view, setView] = useState<'simple' | 'full'>('simple');

  // Full view = one column per fine-grained sector. Only offered when the course
  // has sub-sectors beyond the three majors.
  const full = useMemo(() => {
    if (!course) return null;
    const sectors = normalizeCourseSectors(course).sectors ?? [];
    const hasSubSectors = sectors.some((s) => !s.major);
    if (!hasSubSectors) return null;

    const labels = sectorLabels(course); // length = lineCount (incl. start/finish)
    const lineCount = labels.length;
    // Major-group index per segment, for zebra striping.
    const groupOf: number[] = [];
    let g = 0;
    for (let k = 0; k < lineCount; k++) {
      if (k > 0 && sectors[k - 1].major) g++;
      groupOf.push(g);
    }
    // Fastest (min) time per segment across laps.
    const fastestIdx: (number | null)[] = new Array(lineCount).fill(null);
    const best: number[] = new Array(lineCount).fill(Infinity);
    laps.forEach((lap, idx) => {
      lap.sectorTimes?.forEach((t, k) => {
        if (t !== undefined && t < best[k]) { best[k] = t; fastestIdx[k] = idx; }
      });
    });
    return { labels, lineCount, groupOf, fastestIdx };
  }, [course, laps]);

  const showFull = view === 'full' && full !== null;

  // Memoize expensive lap statistics computation
  const lapStats = useMemo(() => {
    if (laps.length === 0) return null;

    const fastestLapIdx = laps.reduce((minIdx, lap, idx, arr) =>
      lap.lapTimeMs < arr[minIdx].lapTimeMs ? idx : minIdx, 0);

    const fastestSpeedIdx = laps.reduce((maxIdx, lap, idx, arr) => {
      const currentMax = useKph ? arr[maxIdx].maxSpeedKph : arr[maxIdx].maxSpeedMph;
      const lapMax = useKph ? lap.maxSpeedKph : lap.maxSpeedMph;
      return lapMax > currentMax ? idx : maxIdx;
    }, 0);

    const slowestMinSpeedIdx = laps.reduce((minIdx, lap, idx, arr) => {
      const currentMin = useKph ? arr[minIdx].minSpeedKph : arr[minIdx].minSpeedMph;
      const lapMin = useKph ? lap.minSpeedKph : lap.minSpeedMph;
      return lapMin < currentMin ? idx : minIdx;
    }, 0);

    let fastestS1Idx: number | null = null;
    let fastestS2Idx: number | null = null;
    let fastestS3Idx: number | null = null;

    if (showSectors) {
      let fastestS1 = Infinity;
      let fastestS2 = Infinity;
      let fastestS3 = Infinity;
      laps.forEach((lap, idx) => {
        if (lap.sectors?.s1 !== undefined && lap.sectors.s1 < fastestS1) {
          fastestS1 = lap.sectors.s1;
          fastestS1Idx = idx;
        }
        if (lap.sectors?.s2 !== undefined && lap.sectors.s2 < fastestS2) {
          fastestS2 = lap.sectors.s2;
          fastestS2Idx = idx;
        }
        if (lap.sectors?.s3 !== undefined && lap.sectors.s3 < fastestS3) {
          fastestS3 = lap.sectors.s3;
          fastestS3Idx = idx;
        }
      });
    }

    const optimalLap = showSectors ? calculateOptimalLap(laps) : null;

    return { fastestLapIdx, fastestSpeedIdx, slowestMinSpeedIdx, fastestS1Idx, fastestS2Idx, fastestS3Idx, optimalLap };
  }, [laps, useKph, showSectors]);

  // Calculate average lap distance
  const avgLapLength = useMemo(() => {
    if (!samples || samples.length === 0 || laps.length === 0) return null;
    let totalDist = 0;
    let validLaps = 0;
    for (const lap of laps) {
      let lapDist = 0;
      for (let i = lap.startIndex + 1; i <= lap.endIndex && i < samples.length; i++) {
        lapDist += haversineDistance(
          samples[i - 1].lat, samples[i - 1].lon,
          samples[i].lat, samples[i].lon
        );
      }
      if (lapDist > 0) {
        totalDist += lapDist;
        validLaps++;
      }
    }
    return validLaps > 0 ? totalDist / validLaps : null;
  }, [samples, laps]);

  if (laps.length === 0 || !lapStats) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p className="text-center">
          No laps detected.<br />
          <span className="text-sm">Select a track with a start/finish line</span>
        </p>
      </div>
    );
  }

  const { fastestLapIdx, fastestSpeedIdx, slowestMinSpeedIdx, fastestS1Idx, fastestS2Idx, fastestS3Idx, optimalLap } = lapStats;
  const speedUnit = useKph ? 'kph' : 'mph';
  const getMaxSpeed = (lap: Lap) => useKph ? lap.maxSpeedKph : lap.maxSpeedMph;
  const getMinSpeed = (lap: Lap) => useKph ? lap.minSpeedKph : lap.minSpeedMph;

  const hasExternalRefProps = savedFiles && onLoadFileForRef && onSelectExternalLap && onClearExternalRef;
  const hasSnapshotProps = onLoadSnapshot && onClearSnapshot && onSaveSnapshot;

  return (
    <div className="h-full overflow-auto scrollbar-thin">
      {/* The external-reference bar is superseded by the header "Overlays" menu
          (set references there) + the per-row Ref/Map controls below. Kept
          mounted-but-hidden for now in case we need to fall back. */}
      {SHOW_EXTERNAL_REF_BAR && hasExternalRefProps && (
        <ExternalRefBar
          externalRefLabel={externalRefLabel ?? null}
          savedFiles={savedFiles}
          onLoadFileForRef={onLoadFileForRef}
          onSelectExternalLap={onSelectExternalLap}
          onClearExternalRef={onClearExternalRef}
          onOpen={onRefreshSavedFiles}
          trailing={hasSnapshotProps ? (
            <LapSnapshotControls
              snapshotsForCourse={snapshotsForCourse ?? []}
              activeSnapshotId={activeSnapshotId ?? null}
              canSnapshot={!!canSnapshot}
              hasCourse={!!course}
              onLoad={onLoadSnapshot}
              onClear={onClearSnapshot}
              onSave={onSaveSnapshot}
              triggerLabel="Load snapshot as reference"
              showSave={false}
              overlayLines={overlayLines}
              onToggleOverlay={onToggleOverlay}
            />
          ) : undefined}
        />
      )}
      {/* Simple/Full toggle — only when the course has sub-sectors. */}
      {full && (
        <div className="flex items-center justify-end gap-1 px-2 py-1.5">
          <div className="inline-flex rounded-md border border-border p-0.5 text-xs">
            <button
              className={`rounded px-2 py-0.5 transition-colors ${!showFull ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              onClick={() => setView('simple')}
            >
              Simple
            </button>
            <button
              className={`rounded px-2 py-0.5 transition-colors ${showFull ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              onClick={() => setView('full')}
            >
              Full
            </button>
          </div>
        </div>
      )}
      <table className={showFull ? 'min-w-max' : 'w-full'}>
        <thead className="sticky top-0 bg-card">
          <tr className="text-left text-xs text-muted-foreground uppercase tracking-wider">
            <th className="px-2 py-3 font-medium w-16">Ref</th>
            <th className="px-4 py-3 font-medium">Lap</th>
            <th className="px-4 py-3 font-medium">Time</th>
            {showFull ? (
              full.labels.map((label, k) => (
                <th
                  key={k}
                  className={`px-3 py-3 font-medium text-center whitespace-nowrap ${full.groupOf[k] % 2 === 1 ? 'bg-muted/40' : ''}`}
                >
                  {label}
                </th>
              ))
            ) : showSectors && (
              <>
                <th className="px-3 py-3 font-medium text-center">S1</th>
                <th className="px-3 py-3 font-medium text-center">S2</th>
                <th className="px-3 py-3 font-medium text-center">S3</th>
              </>
            )}
            <th className="px-4 py-3 font-medium">Top Speed</th>
            <th className="px-4 py-3 font-medium">Min Speed</th>
          </tr>
        </thead>
        <tbody>
        {laps.map((lap, idx) => {
            const isFastest = idx === fastestLapIdx;
            const hasFastestSpeed = idx === fastestSpeedIdx;
            const hasSlowestMinSpeed = idx === slowestMinSpeedIdx;
            const isReference = referenceLapNumber === lap.lapNumber;
            const hasFastestS1 = idx === fastestS1Idx;
            const hasFastestS2 = idx === fastestS2Idx;
            const hasFastestS3 = idx === fastestS3Idx;
            
            return (
              <tr
                key={lap.lapNumber}
                onClick={() => onLapSelect?.(lap)}
                className={`
                  border-t border-border cursor-pointer transition-colors
                  ${selectedLapNumber === lap.lapNumber ? 'bg-primary/20 ring-1 ring-primary/50' : ''}
                  ${isReference && selectedLapNumber !== lap.lapNumber ? 'bg-muted/30' : ''}
                  ${isFastest && selectedLapNumber !== lap.lapNumber && !isReference ? 'bg-racing-lapBest/10' : ''}
                  ${!isFastest && selectedLapNumber !== lap.lapNumber && !isReference ? 'hover:bg-muted/50' : ''}
                `}
              >
                <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                  <Button
                    variant={isReference ? "secondary" : "ghost"}
                    size="sm"
                    className={`h-7 px-2 text-xs ${isReference ? 'bg-muted-foreground/20 text-foreground' : ''}`}
                    onClick={() => onSetReference?.(lap.lapNumber)}
                  >
                    {isReference ? (
                      <Target className="w-3 h-3 mr-1" />
                    ) : null}
                    {isReference ? 'Ref' : 'Set Ref'}
                  </Button>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm">{lap.lapNumber}</span>
                    {isFastest && (
                      <Trophy className="w-4 h-4 text-racing-lapBest" />
                    )}
                  </div>
                </td>
                <td className={`px-4 py-3 font-mono text-sm ${isFastest ? 'text-racing-lapBest font-semibold' : ''}`}>
                  {formatLapTime(lap.lapTimeMs)}
                </td>
                {showFull ? (
                  full.labels.map((_, k) => {
                    const t = lap.sectorTimes?.[k];
                    const isFastestSeg = full.fastestIdx[k] === idx;
                    const zebra = full.groupOf[k] % 2 === 1 ? 'bg-muted/30' : '';
                    return (
                      <td
                        key={k}
                        className={`px-3 py-3 font-mono text-xs text-center whitespace-nowrap ${isFastestSeg ? 'text-purple-400 font-semibold bg-purple-500/10' : zebra}`}
                      >
                        {t !== undefined ? formatSectorTime(t) : '—'}
                      </td>
                    );
                  })
                ) : showSectors && (
                  <>
                    <td className={`px-3 py-3 font-mono text-xs text-center ${hasFastestS1 ? 'text-purple-400 font-semibold bg-purple-500/10' : ''}`}>
                      {lap.sectors?.s1 !== undefined ? formatSectorTime(lap.sectors.s1) : '—'}
                    </td>
                    <td className={`px-3 py-3 font-mono text-xs text-center ${hasFastestS2 ? 'text-purple-400 font-semibold bg-purple-500/10' : ''}`}>
                      {lap.sectors?.s2 !== undefined ? formatSectorTime(lap.sectors.s2) : '—'}
                    </td>
                    <td className={`px-3 py-3 font-mono text-xs text-center ${hasFastestS3 ? 'text-purple-400 font-semibold bg-purple-500/10' : ''}`}>
                      {lap.sectors?.s3 !== undefined ? formatSectorTime(lap.sectors.s3) : '—'}
                    </td>
                  </>
                )}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm">
                      {getMaxSpeed(lap).toFixed(1)} {speedUnit}
                    </span>
                    {hasFastestSpeed && (
                      <Zap className="w-4 h-4 text-accent" />
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className={`font-mono text-sm ${hasSlowestMinSpeed ? 'text-orange-500' : ''}`}>
                      {getMinSpeed(lap).toFixed(1)} {speedUnit}
                    </span>
                    {hasSlowestMinSpeed && (
                      <Snail className="w-4 h-4 text-orange-500" />
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Summary */}
      <div className="sticky bottom-0 bg-card border-t border-border px-4 py-3">
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <div>
            <span className="text-muted-foreground">Best Lap: </span>
            <span className="font-mono text-racing-lapBest font-semibold">
              {formatLapTime(laps[fastestLapIdx].lapTimeMs)}
            </span>
          </div>
          {optimalLap && (
            <>
              <div>
                <span className="text-muted-foreground">Optimal: </span>
                <span className="font-mono text-purple-400 font-semibold">
                  {formatLapTime(optimalLap.optimalTimeMs)}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Delta: </span>
                <span className="font-mono text-muted-foreground font-semibold">
                  +{formatSectorTime(optimalLap.deltaToFastest)}
                </span>
              </div>
            </>
          )}
          {avgLapLength !== null && (
            <div>
              <span className="text-muted-foreground">Avg Lap Length: </span>
              <span className="font-mono text-foreground font-semibold">
                {`${(avgLapLength * METERS_TO_FEET).toLocaleString(undefined, { maximumFractionDigits: 0 })} ft / ${avgLapLength.toLocaleString(undefined, { maximumFractionDigits: 0 })} m`}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});