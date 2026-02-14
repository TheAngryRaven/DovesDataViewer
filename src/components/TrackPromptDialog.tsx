import { useState, useEffect, useCallback } from 'react';
import { MapPin, Plus, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Track, TrackCourseSelection, Course } from '@/types/racing';
import { AddCourseDialog } from '@/components/track-editor/AddCourseDialog';
import { AddTrackDialog } from '@/components/track-editor/AddTrackDialog';
import { useTrackEditorForm } from '@/hooks/useTrackEditorForm';
import { addTrack as addTrackToStorage, addCourse as addCourseToStorage, loadTracks } from '@/lib/trackStorage';

interface TrackPromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The auto-detected track (null if none detected) */
  detectedTrack: Track | null;
  /** All available tracks */
  tracks: Track[];
  onSelect: (selection: TrackCourseSelection) => void;
}

export function TrackPromptDialog({
  open, onOpenChange, detectedTrack, tracks: initialTracks, onSelect,
}: TrackPromptDialogProps) {
  const [tracks, setTracks] = useState(initialTracks);
  const [selectedCourseName, setSelectedCourseName] = useState('');
  const [isAddCourseOpen, setIsAddCourseOpen] = useState(false);
  const [isAddTrackOpen, setIsAddTrackOpen] = useState(false);
  const form = useTrackEditorForm();

  const track = detectedTrack ? tracks.find(t => t.name === detectedTrack.name) ?? detectedTrack : null;
  const courses = track?.courses ?? [];

  useEffect(() => {
    setTracks(initialTracks);
  }, [initialTracks]);

  useEffect(() => {
    if (open && courses.length === 1) {
      setSelectedCourseName(courses[0].name);
    } else if (open) {
      setSelectedCourseName('');
    }
  }, [open, courses]);

  const refreshTracks = useCallback(async () => {
    const loaded = await loadTracks();
    setTracks(loaded);
    return loaded;
  }, []);

  const handleApply = () => {
    if (!track || !selectedCourseName) return;
    const course = track.courses.find(c => c.name === selectedCourseName);
    if (!course) return;
    onSelect({ trackName: track.name, courseName: course.name, course });
    onOpenChange(false);
  };

  const handleAddCourse = async () => {
    const course = form.buildCourse();
    if (!course || !track) return;
    await addCourseToStorage(track.name, course);
    const loaded = await refreshTracks();
    setSelectedCourseName(course.name);
    form.resetForm();
    setIsAddCourseOpen(false);
  };

  const handleAddTrack = async () => {
    const course = form.buildCourse();
    if (!course || !form.formTrackName.trim()) return;
    await addTrackToStorage(form.formTrackName.trim(), course);
    const loaded = await refreshTracks();
    // Auto-select the newly created track+course
    const newTrack = loaded.find(t => t.name === form.formTrackName.trim());
    if (newTrack && course) {
      onSelect({ trackName: newTrack.name, courseName: course.name, course });
    }
    form.resetForm();
    setIsAddTrackOpen(false);
    onOpenChange(false);
  };

  const addCourseDialogProps = {
    open: isAddCourseOpen,
    onOpenChange: (o: boolean) => { setIsAddCourseOpen(o); if (!o) form.setEditorMode('visual'); },
    editorMode: form.editorMode,
    onEditorModeChange: form.setEditorMode,
    courseFormProps: form.courseFormProps,
    onSubmit: handleAddCourse,
    onCancel: () => { setIsAddCourseOpen(false); form.resetForm(); },
    startFinishA: form.visualEditorStartFinishA,
    startFinishB: form.visualEditorStartFinishB,
    sector2: form.visualEditorSector2,
    sector3: form.visualEditorSector3,
    onStartFinishChange: form.handleVisualStartFinishChange,
    onSector2Change: form.handleVisualSector2Change,
    onSector3Change: form.handleVisualSector3Change,
  } as const;

  const addTrackDialogProps = {
    open: isAddTrackOpen,
    onOpenChange: (o: boolean) => { setIsAddTrackOpen(o); if (!o) form.setEditorMode('visual'); },
    editorMode: form.editorMode,
    onEditorModeChange: form.setEditorMode,
    courseFormProps: form.courseFormProps,
    onSubmit: handleAddTrack,
    onCancel: () => { setIsAddTrackOpen(false); form.resetForm(); },
    startFinishA: form.visualEditorStartFinishA,
    startFinishB: form.visualEditorStartFinishB,
    sector2: form.visualEditorSector2,
    sector3: form.visualEditorSector3,
    onStartFinishChange: form.handleVisualStartFinishChange,
    onSector2Change: form.handleVisualSector2Change,
    onSector3Change: form.handleVisualSector3Change,
  } as const;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MapPin className="w-5 h-5 text-primary" />
              {track ? 'Select Course' : 'No Track Detected'}
            </DialogTitle>
          </DialogHeader>

          {track ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Detected <span className="font-medium text-foreground">{track.name}</span>. Which course layout?
              </p>
              <div className="space-y-2">
                <Label>Course</Label>
                <div className="flex gap-2">
                  <Select value={selectedCourseName} onValueChange={setSelectedCourseName}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Select course..." />
                    </SelectTrigger>
                    <SelectContent>
                      {courses.map(c => (
                        <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="icon" onClick={() => {
                    form.resetForm();
                    form.setFormTrackName(track.name);
                    setIsAddCourseOpen(true);
                  }}>
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={handleApply} className="flex-1" disabled={!selectedCourseName}>
                  <Check className="w-4 h-4 mr-2" /> Apply
                </Button>
                <Button variant="outline" onClick={() => onOpenChange(false)}>Skip</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                No known track matches this GPS data. Create a new track and course to enable lap timing.
              </p>
              <div className="flex gap-2">
                <Button onClick={() => { form.resetForm(); setIsAddTrackOpen(true); }} className="flex-1">
                  <Plus className="w-4 h-4 mr-2" /> Create Track & Course
                </Button>
                <Button variant="outline" onClick={() => onOpenChange(false)}>Skip</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <AddCourseDialog {...addCourseDialogProps} />
      <AddTrackDialog {...addTrackDialogProps} />
    </>
  );
}
