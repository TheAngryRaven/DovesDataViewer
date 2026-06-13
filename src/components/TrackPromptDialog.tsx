import { useState, useEffect, useCallback, useMemo } from 'react';
import { MapPin, Plus, Check, AlertTriangle, Navigation } from 'lucide-react';
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
import { Track, TrackCourseSelection, CourseDetectionResult, Lap, GpsSample } from '@/types/racing';
import { AddCourseDialog } from '@/components/track-editor/AddCourseDialog';
import { AddTrackDialog } from '@/components/track-editor/AddTrackDialog';
import { useTrackEditorForm } from '@/hooks/useTrackEditorForm';
import { validateCourseSectors } from '@/lib/courseSectors';
import { addTrack as addTrackToStorage, addCourse as addCourseToStorage, loadTracks } from '@/lib/trackStorage';

interface TrackPromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The auto-detected track (null if none detected) */
  detectedTrack: Track | null;
  /** All available tracks */
  tracks: Track[];
  onSelect: (selection: TrackCourseSelection) => void;
  /** GPS center from loaded data for map positioning */
  initialCenter?: { lat: number; lon: number } | null;
  /** Auto-detection result with direction and waypoint info */
  detectionResult?: CourseDetectionResult | null;
  /** Current session laps (e.g. waypoint-mode laps) — feeds the create-course
   *  "Generate outline" picker so the outline can be drawn right here. */
  laps?: Lap[];
  /** Current session GPS samples — enables generating an outline from the whole
   *  session even when no laps were detected. */
  samples?: GpsSample[];
}

export function TrackPromptDialog({
  open, onOpenChange, detectedTrack, tracks: initialTracks, onSelect, initialCenter, detectionResult,
  laps, samples,
}: TrackPromptDialogProps) {
  const [tracks, setTracks] = useState(initialTracks);
  const [selectedCourseName, setSelectedCourseName] = useState('');
  const [isAddCourseOpen, setIsAddCourseOpen] = useState(false);
  const [isAddTrackOpen, setIsAddTrackOpen] = useState(false);
  // A track is just a name now, so creating one here is a two-step flow: make
  // the bare track, then add its first course (timing needs a course). Once a
  // track is created we pivot the prompt onto it via this name.
  const [createdTrackName, setCreatedTrackName] = useState<string | null>(null);
  const form = useTrackEditorForm();

  const track = useMemo(() => {
    if (createdTrackName) return tracks.find(t => t.name === createdTrackName) ?? null;
    return detectedTrack ? tracks.find(t => t.name === detectedTrack.name) ?? detectedTrack : null;
  }, [createdTrackName, tracks, detectedTrack]);
  const courses = useMemo(() => track?.courses ?? [], [track]);
  // True once the user has created a bare track here and is adding its course.
  const inCourseStep = createdTrackName != null;

  useEffect(() => {
    setTracks(initialTracks);
  }, [initialTracks]);

  // Each fresh open starts clean — drop any in-progress track creation.
  useEffect(() => {
    if (open) setCreatedTrackName(null);
  }, [open]);

  useEffect(() => {
    if (open && detectionResult && !detectionResult.isWaypointMode) {
      setSelectedCourseName(detectionResult.course.name);
    } else if (open && courses.length === 1) {
      setSelectedCourseName(courses[0].name);
    } else if (open) {
      setSelectedCourseName('');
    }
  }, [open, courses, detectionResult]);

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
    const name = form.formTrackName.trim();
    if (!name) return;
    // Create the bare track (name + short name), then continue straight into
    // adding its first course so lap timing can still be set up in one sitting.
    await addTrackToStorage(name, undefined, form.formTrackShortName.trim() || undefined);
    await refreshTracks();
    setCreatedTrackName(name);
    setIsAddTrackOpen(false);
    form.resetForm();
    form.setFormTrackName(name);
    setIsAddCourseOpen(true);
  };

  const addCourseCanSubmit = Boolean(
    form.formCourseName.trim() && form.formLatA && form.formLonA && form.formLatB && form.formLonB &&
    validateCourseSectors({
      name: form.formCourseName,
      startFinishA: form.visualEditorStartFinishA ?? { lat: 0, lon: 0 },
      startFinishB: form.visualEditorStartFinishB ?? { lat: 0, lon: 0 },
      sectors: form.formSectors,
    }).valid,
  );

  const addCourseDialogProps = {
    open: isAddCourseOpen,
    onOpenChange: (o: boolean) => { setIsAddCourseOpen(o); if (!o) form.resetForm(); },
    courseName: form.formCourseName,
    onCourseNameChange: form.setFormCourseName,
    canSubmit: addCourseCanSubmit,
    onSubmit: handleAddCourse,
    onCancel: () => { setIsAddCourseOpen(false); form.resetForm(); },
    startFinishA: form.visualEditorStartFinishA,
    startFinishB: form.visualEditorStartFinishB,
    sectors: form.formSectors,
    selectedLine: form.selectedLine,
    onSelectLine: form.setSelectedLine,
    onStartFinishChange: form.handleVisualStartFinishChange,
    onSectorLineChange: form.handleVisualSectorLineChange,
    onAddSector: form.addSector,
    onRemoveSector: form.removeSector,
    onToggleMajor: form.toggleSectorMajor,
    onReorder: form.reorderSectors,
    initialCenter,
    // Carry the drawing through so a generated/drawn outline is saved on the new
    // course (buildCourse reads form.formLayout), and feed laps/samples so the
    // "Generate" outline tool is available in this post-import create flow.
    layoutPoints: form.formLayout,
    onLayoutChange: form.handleVisualLayoutChange,
    laps,
    samples,
  } as const;

  const addTrackDialogProps = {
    open: isAddTrackOpen,
    onOpenChange: (o: boolean) => { setIsAddTrackOpen(o); if (!o) form.resetForm(); },
    trackName: form.formTrackName,
    shortName: form.formTrackShortName,
    onTrackNameChange: form.handleTrackNameChange,
    onShortNameChange: form.handleTrackShortNameChange,
    onSubmit: handleAddTrack,
    onCancel: () => { setIsAddTrackOpen(false); form.resetForm(); },
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

          {/* Course step: a track is selected/created — pick (or add) its course */}
          {track && (inCourseStep || !detectionResult?.isWaypointMode) ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {inCourseStep ? (
                  <>Add a course to <span className="font-medium text-foreground">{track.name}</span> to enable lap timing.</>
                ) : (
                  <>
                    Detected <span className="font-medium text-foreground">{track.name}</span>.
                    {detectionResult?.direction && (
                      <span className="inline-flex items-center gap-1 ml-1">
                        <Navigation className="w-3 h-3" />
                        <span className="font-medium text-foreground capitalize">{detectionResult.direction}</span>
                      </span>
                    )}
                    {' '}Which course layout?
                  </>
                )}
              </p>
              <div className="space-y-2">
                <Label>Course</Label>
                <div className="flex gap-2">
                  <Select value={selectedCourseName} onValueChange={setSelectedCourseName} disabled={courses.length === 0}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder={courses.length === 0 ? 'No courses yet — add one' : 'Select course...'} />
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
          ) : detectionResult?.isWaypointMode ? (
            /* Waypoint mode notice */
            <div className="space-y-4">
              <div className="p-3 rounded-md border border-yellow-500/30 bg-yellow-500/5">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-yellow-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-foreground">Waypoint Timing</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      No known track matched this data. Lap times are estimated using a GPS waypoint — accuracy is lower than normal.
                      Create a track (then add a course) for precise timing.
                    </p>
                    {detectionResult.laps.length > 0 && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Detected <span className="font-medium text-foreground">{detectionResult.laps.length} laps</span> from waypoint.
                      </p>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={() => { form.resetForm(); setIsAddTrackOpen(true); }} className="flex-1">
                  <Plus className="w-4 h-4 mr-2" /> Create Track
                </Button>
                <Button variant="outline" onClick={() => onOpenChange(false)}>Use Waypoint</Button>
              </div>
            </div>
          ) : (
            /* No track detected */
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                No known track matches this GPS data. Create a new track, then add a course to enable lap timing.
              </p>
              <div className="flex gap-2">
                <Button onClick={() => { form.resetForm(); setIsAddTrackOpen(true); }} className="flex-1">
                  <Plus className="w-4 h-4 mr-2" /> Create Track
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
