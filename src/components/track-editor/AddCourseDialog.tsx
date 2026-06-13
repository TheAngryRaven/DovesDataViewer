import { lazy, Suspense } from 'react';
import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import type { GpsPoint } from './VisualEditor';
import type { SelectedLine } from '@/hooks/useTrackEditorForm';
import type { CourseSector, SectorLine, Lap, GpsSample } from '@/types/racing';

// Lazy — CourseSectorEditor pulls in the Leaflet drawing map + the dnd-kit
// sector list, neither of which belongs in the eager landing bundle.
const CourseSectorEditor = lazy(() =>
  import('./CourseSectorEditor').then((m) => ({ default: m.CourseSectorEditor })),
);

interface AddCourseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseName: string;
  onCourseNameChange: (value: string) => void;
  canSubmit: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  startFinishA: GpsPoint | null;
  startFinishB: GpsPoint | null;
  sectors: CourseSector[];
  selectedLine: SelectedLine;
  onSelectLine: (id: SelectedLine) => void;
  onStartFinishChange: (a: GpsPoint, b: GpsPoint) => void;
  onSectorLineChange: (index: number, line: SectorLine) => void;
  onAddSector: (insertIndex?: number, center?: GpsPoint) => void;
  onRemoveSector: (index: number) => void;
  onToggleMajor: (index: number) => void;
  onReorder: (from: number, to: number) => void;
  initialCenter?: GpsPoint | null;
  /** Drawing support — draw the outline manually or generate it from a lap. */
  layoutPoints?: Array<{ lat: number; lon: number }>;
  onLayoutChange?: (points: Array<{ lat: number; lon: number }>) => void;
  laps?: Lap[];
  samples?: GpsSample[];
}

export function AddCourseDialog({
  open, onOpenChange,
  courseName, onCourseNameChange, canSubmit,
  onSubmit, onCancel,
  startFinishA, startFinishB, sectors, selectedLine, onSelectLine,
  onStartFinishChange, onSectorLineChange,
  onAddSector, onRemoveSector, onToggleMajor, onReorder,
  initialCenter,
  layoutPoints, onLayoutChange, laps, samples,
}: AddCourseDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild><span className="sr-only">Add course</span></DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add New Course</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Suspense fallback={null}>
          <CourseSectorEditor
            startFinishA={startFinishA}
            startFinishB={startFinishB}
            sectors={sectors}
            selectedLine={selectedLine}
            onSelectLine={onSelectLine}
            onStartFinishChange={onStartFinishChange}
            onSectorLineChange={onSectorLineChange}
            onAddSector={onAddSector}
            onRemoveSector={onRemoveSector}
            onToggleMajor={onToggleMajor}
            onReorder={onReorder}
            isNewTrack
            initialCenter={initialCenter}
            showDrawTool
            layoutPoints={layoutPoints}
            onLayoutChange={onLayoutChange}
            laps={laps}
            samples={samples}
          />
          </Suspense>
          <div className="space-y-3">
            <div>
              <Label htmlFor="addCourseName">Course Name</Label>
              <Input id="addCourseName" value={courseName} onChange={(e) => onCourseNameChange(e.target.value)} onKeyDownCapture={(e) => e.stopPropagation()} placeholder="e.g., Full Track" className="font-mono" />
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={onSubmit} className="flex-1" disabled={!canSubmit}>
              <Check className="w-4 h-4 mr-2" />
              Create Course
            </Button>
            <Button variant="outline" onClick={onCancel}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
