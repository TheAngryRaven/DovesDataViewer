import { lazy, Suspense, useCallback, useMemo, useRef } from 'react';
import { Course, CourseSector, SectorLine, Lap, GpsSample } from '@/types/racing';
import { centeredSectorLine } from '@/lib/courseSectors';
import { SectorListEditor } from './SectorListEditor';
import type { GpsPoint, LineId } from './VisualEditor';
import type { SelectedLine } from '@/hooks/useTrackEditorForm';

const VisualEditor = lazy(() => import('./VisualEditor').then((m) => ({ default: m.VisualEditor })));

interface CourseSectorEditorProps {
  startFinishA: GpsPoint | null;
  startFinishB: GpsPoint | null;
  sectors: CourseSector[];
  selectedLine: SelectedLine;
  onSelectLine: (id: SelectedLine) => void;
  onStartFinishChange: (a: GpsPoint, b: GpsPoint) => void;
  onSectorLineChange: (index: number, line: SectorLine) => void;
  /** Add a sector; `center` (when provided) is the live map view center so the
   *  new line drops in the middle of what the user is looking at. */
  onAddSector: (insertIndex?: number, center?: GpsPoint) => void;
  onRemoveSector: (index: number) => void;
  onToggleMajor: (index: number) => void;
  onReorder: (from: number, to: number) => void;
  isNewTrack?: boolean;
  initialCenter?: GpsPoint | null;
  showDrawTool?: boolean;
  showKnownDrawingToggle?: boolean;
  layoutPoints?: Array<{ lat: number; lon: number }>;
  onLayoutChange?: (points: Array<{ lat: number; lon: number }>) => void;
  laps?: Lap[];
  samples?: GpsSample[];
}

/**
 * The shared course geometry editor: the satellite map (start/finish + sector
 * line placement) paired with the reorderable sector list below it. The list is
 * the control surface — selecting a row puts that line into drag-edit on the map.
 */
export function CourseSectorEditor({
  startFinishA, startFinishB, sectors, selectedLine, onSelectLine,
  onStartFinishChange, onSectorLineChange,
  onAddSector, onRemoveSector, onToggleMajor, onReorder,
  isNewTrack, initialCenter, showDrawTool, showKnownDrawingToggle,
  layoutPoints, onLayoutChange, laps, samples,
}: CourseSectorEditorProps) {
  // The map's current view center, kept fresh by VisualEditor — read on add so a
  // new sector drops in the middle of the current view.
  const viewCenterRef = useRef<GpsPoint | null>(null);

  // Re-drop the start/finish line in the center of the current map view (used by
  // the reset button on the start/finish row, and the only way to (re)place it
  // on a brand-new course where it has no coordinates yet).
  const handleResetStartFinish = useCallback(() => {
    const center = viewCenterRef.current;
    if (!center) return;
    const line = centeredSectorLine(center);
    onStartFinishChange(line.a, line.b);
    onSelectLine('sf');
  }, [onStartFinishChange, onSelectLine]);

  // Minimal course for the list's labels + validation (coords unused there).
  const course = useMemo<Course>(() => ({
    name: '',
    startFinishA: startFinishA ?? { lat: 0, lon: 0 },
    startFinishB: startFinishB ?? { lat: 0, lon: 0 },
    sectors,
  }), [startFinishA, startFinishB, sectors]);

  return (
    <div className="space-y-3">
      <Suspense fallback={null}>
        <VisualEditor
          startFinishA={startFinishA}
          startFinishB={startFinishB}
          sectors={sectors}
          selectedLine={selectedLine as LineId | null}
          onSelectLine={(id) => onSelectLine(id)}
          onStartFinishChange={onStartFinishChange}
          onSectorLineChange={onSectorLineChange}
          isNewTrack={isNewTrack}
          initialCenter={initialCenter}
          showDrawTool={showDrawTool}
          showKnownDrawingToggle={showKnownDrawingToggle}
          layoutPoints={layoutPoints}
          onLayoutChange={onLayoutChange}
          laps={laps}
          samples={samples}
          viewCenterRef={viewCenterRef}
        />
      </Suspense>
      <SectorListEditor
        course={course}
        sectors={sectors}
        selectedLine={selectedLine}
        onSelectLine={onSelectLine}
        onAddSector={(insertIndex) => onAddSector(insertIndex, viewCenterRef.current ?? undefined)}
        onRemoveSector={onRemoveSector}
        onToggleMajor={onToggleMajor}
        onReorder={onReorder}
        onResetStartFinish={isNewTrack ? handleResetStartFinish : undefined}
      />
    </div>
  );
}
