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
import { VisualEditor, EditorModeToggle } from './VisualEditor';
import { CourseForm } from './CourseForm';
import type { CourseFormProps } from '@/hooks/useTrackEditorForm';
import type { GpsPoint } from './VisualEditor';
import type { SectorLine } from '@/types/racing';

interface AddTrackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editorMode: 'manual' | 'visual';
  onEditorModeChange: (mode: 'manual' | 'visual') => void;
  courseFormProps: Omit<CourseFormProps, 'onSubmit' | 'onCancel' | 'submitLabel' | 'showTrackName'>;
  onSubmit: () => void;
  onCancel: () => void;
  startFinishA: GpsPoint | null;
  startFinishB: GpsPoint | null;
  sector2: SectorLine | undefined;
  sector3: SectorLine | undefined;
  onStartFinishChange: (a: GpsPoint, b: GpsPoint) => void;
  onSector2Change: (line: SectorLine) => void;
  onSector3Change: (line: SectorLine) => void;
}

export function AddTrackDialog({
  open, onOpenChange,
  editorMode, onEditorModeChange,
  courseFormProps,
  onSubmit, onCancel,
  startFinishA, startFinishB, sector2, sector3,
  onStartFinishChange, onSector2Change, onSector3Change,
}: AddTrackDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild><span className="sr-only">Add track</span></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add New Track</DialogTitle>
        </DialogHeader>
        <EditorModeToggle mode={editorMode} onModeChange={onEditorModeChange} />
        {editorMode === 'manual' ? (
          <CourseForm {...courseFormProps} onSubmit={onSubmit} onCancel={onCancel} submitLabel="Create Track" />
        ) : (
          <div className="space-y-4">
            {/* Track/Course inputs above the map for better UX */}
            <div className="space-y-3">
              <div>
                <Label htmlFor="newTrackName">Track Name</Label>
                <Input id="newTrackName" value={courseFormProps.trackName} onChange={(e) => courseFormProps.onTrackNameChange(e.target.value)} onKeyDownCapture={(e) => e.stopPropagation()} placeholder="e.g., Orlando Kart Center" className="font-mono" />
              </div>
              <div>
                <Label htmlFor="newCourseName">Course Name</Label>
                <Input id="newCourseName" value={courseFormProps.courseName} onChange={(e) => courseFormProps.onCourseNameChange(e.target.value)} onKeyDownCapture={(e) => e.stopPropagation()} placeholder="e.g., Full Track" className="font-mono" />
              </div>
            </div>
            <VisualEditor
              startFinishA={startFinishA}
              startFinishB={startFinishB}
              sector2={sector2}
              sector3={sector3}
              isNewTrack={true}
              onStartFinishChange={onStartFinishChange}
              onSector2Change={onSector2Change}
              onSector3Change={onSector3Change}
            />
            <div className="flex gap-2">
              <Button onClick={onSubmit} className="flex-1" disabled={!courseFormProps.trackName.trim() || !courseFormProps.courseName.trim() || !courseFormProps.latA || !courseFormProps.lonA || !courseFormProps.latB || !courseFormProps.lonB}>
                <Check className="w-4 h-4 mr-2" />
                Create Track
              </Button>
              <Button variant="outline" onClick={onCancel}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
