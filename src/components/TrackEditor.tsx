import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Edit2, Check, X, Settings, Code, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Track, TrackCourseSelection } from '@/types/racing';
import {
  loadTracks,
  addTrack as addTrackToStorage,
  addCourse as addCourseToStorage,
  updateCourse,
  deleteCourse,
  deleteTrack
} from '@/lib/trackStorage';
import { abbreviateTrackName } from '@/lib/trackUtils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTrackEditorForm } from '@/hooks/useTrackEditorForm';
import { VisualEditor, EditorModeToggle } from '@/components/track-editor/VisualEditor';
import { CourseForm } from '@/components/track-editor/CourseForm';
import { AddCourseDialog } from '@/components/track-editor/AddCourseDialog';
import { AddTrackDialog } from '@/components/track-editor/AddTrackDialog';
import { SubmitTrackDialog } from '@/components/SubmitTrackDialog';
import { Send } from 'lucide-react';

interface TrackCourseEditorProps {
  selection: TrackCourseSelection | null;
  onSelectionChange: (selection: TrackCourseSelection | null) => void;
  compact?: boolean;
}

export function TrackEditor({ selection, onSelectionChange, compact = false }: TrackCourseEditorProps) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSelectDialogOpen, setIsSelectDialogOpen] = useState(false);
  const [isManageMode, setIsManageMode] = useState(false);
  const [isAddCourseOpen, setIsAddCourseOpen] = useState(false);
  const [isAddTrackOpen, setIsAddTrackOpen] = useState(false);
  const [tempTrackName, setTempTrackName] = useState<string>('');
  const [tempCourseName, setTempCourseName] = useState<string>('');
  const [isJsonViewOpen, setIsJsonViewOpen] = useState(false);

  const form = useTrackEditorForm();

  useEffect(() => {
    let mounted = true;
    loadTracks().then(loadedTracks => {
      if (mounted) { setTracks(loadedTracks); setIsLoading(false); }
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (isSelectDialogOpen && selection) {
      setTempTrackName(selection.trackName);
      setTempCourseName(selection.courseName);
    }
  }, [isSelectDialogOpen, selection]);

  const refreshTracks = useCallback(async () => {
    const loaded = await loadTracks();
    setTracks(loaded);
    return loaded;
  }, []);

  const selectedTrack = tracks.find(t => t.name === tempTrackName);
  const availableCourses = selectedTrack?.courses ?? [];

  // Generate JSON for the selected track in datalogger format
  const generateTrackJson = useCallback(() => {
    if (!selectedTrack) return '{}';

    const result: Record<string, {
      start_a_lat: number; start_a_lng: number;
      start_b_lat: number; start_b_lng: number;
      sector_2_a_lat?: number; sector_2_a_lng?: number;
      sector_2_b_lat?: number; sector_2_b_lng?: number;
      sector_3_a_lat?: number; sector_3_a_lng?: number;
      sector_3_b_lat?: number; sector_3_b_lng?: number;
    }> = {};

    for (const course of selectedTrack.courses) {
      const courseData: typeof result[string] = {
        start_a_lat: course.startFinishA.lat,
        start_a_lng: course.startFinishA.lon,
        start_b_lat: course.startFinishB.lat,
        start_b_lng: course.startFinishB.lon,
      };

      if (course.sector2) {
        courseData.sector_2_a_lat = course.sector2.a.lat;
        courseData.sector_2_a_lng = course.sector2.a.lon;
        courseData.sector_2_b_lat = course.sector2.b.lat;
        courseData.sector_2_b_lng = course.sector2.b.lon;
      }

      if (course.sector3) {
        courseData.sector_3_a_lat = course.sector3.a.lat;
        courseData.sector_3_a_lng = course.sector3.a.lon;
        courseData.sector_3_b_lat = course.sector3.b.lat;
        courseData.sector_3_b_lng = course.sector3.b.lon;
      }

      result[course.name] = courseData;
    }

    return JSON.stringify(result, null, 2);
  }, [selectedTrack]);

  const handleCopyJson = () => {
    const json = generateTrackJson();
    navigator.clipboard.writeText(json).then(() => {
      toast({ title: 'Copied!', description: 'Track JSON copied to clipboard' });
    }).catch(() => {
      toast({ title: 'Failed to copy', variant: 'destructive' });
    });
  };

  const handleTrackChange = (trackName: string) => {
    setTempTrackName(trackName);
    const track = tracks.find(t => t.name === trackName);
    if (track && track.courses.length > 0) setTempCourseName(track.courses[0].name);
    else setTempCourseName('');
  };

  const handleCourseChange = (courseName: string) => setTempCourseName(courseName);

  const handleApplySelection = () => {
    if (!tempTrackName || !tempCourseName) { onSelectionChange(null); }
    else {
      const track = tracks.find(t => t.name === tempTrackName);
      const course = track?.courses.find(c => c.name === tempCourseName);
      if (track && course) onSelectionChange({ trackName: tempTrackName, courseName: tempCourseName, course });
    }
    setIsSelectDialogOpen(false);
    setIsManageMode(false);
  };

  const openAddCourse = () => {
    form.setFormTrackName(tempTrackName || '');
    form.resetForm();
    form.setFormTrackName(tempTrackName || '');
    setIsAddCourseOpen(true);
  };

  const openAddTrack = () => { form.resetForm(); setIsAddTrackOpen(true); };

  const handleAddCourse = async () => {
    const course = form.buildCourse();
    if (!course || !form.formTrackName.trim()) return;
    await addCourseToStorage(form.formTrackName.trim(), course);
    await refreshTracks();
    setTempTrackName(form.formTrackName.trim());
    setTempCourseName(course.name);
    form.resetForm();
    setIsAddCourseOpen(false);
  };

  const handleAddTrack = async () => {
    const course = form.buildCourse();
    if (!course || !form.formTrackName.trim()) return;
    await addTrackToStorage(form.formTrackName.trim(), course);
    await refreshTracks();
    setTempTrackName(form.formTrackName.trim());
    setTempCourseName(course.name);
    form.resetForm();
    setIsAddTrackOpen(false);
  };

  const handleUpdateCourse = async () => {
    if (!form.editingCourse) return;
    const course = form.buildCourse();
    if (!course) return;
    if (course.name !== form.editingCourse.courseName) {
      await deleteCourse(form.editingCourse.trackName, form.editingCourse.courseName);
      await addCourseToStorage(form.editingCourse.trackName, course);
    } else {
      await updateCourse(form.editingCourse.trackName, form.editingCourse.courseName, {
        startFinishA: course.startFinishA,
        startFinishB: course.startFinishB,
        sector2: course.sector2,
        sector3: course.sector3,
      });
    }
    await refreshTracks();
    setTempCourseName(course.name);
    form.setEditingCourse(null);
    form.resetForm();
  };

  const handleDeleteCourse = async (trackName: string, courseName: string) => {
    await deleteCourse(trackName, courseName);
    const newTracks = await refreshTracks();
    if (tempTrackName === trackName && tempCourseName === courseName) {
      const track = newTracks.find(t => t.name === trackName);
      if (track && track.courses.length > 0) setTempCourseName(track.courses[0].name);
      else setTempCourseName('');
    }
  };

  const handleDeleteTrack = async (trackName: string) => {
    await deleteTrack(trackName);
    const newTracks = await refreshTracks();
    if (tempTrackName === trackName) {
      if (newTracks.length > 0) {
        setTempTrackName(newTracks[0].name);
        if (newTracks[0].courses.length > 0) setTempCourseName(newTracks[0].courses[0].name);
        else setTempCourseName('');
      } else { setTempTrackName(''); setTempCourseName(''); }
    }
  };

  if (isLoading) return <div className="text-muted-foreground text-sm">Loading tracks...</div>;

  // Shared dialog props
  const addCourseDialogProps = {
    open: isAddCourseOpen,
    onOpenChange: (open: boolean) => { setIsAddCourseOpen(open); if (!open) form.setEditorMode('visual'); },
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
    onOpenChange: (open: boolean) => { setIsAddTrackOpen(open); if (!open) form.setEditorMode('visual'); },
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

  // Track/Course selection UI (shared between compact dialog and non-compact inline)
  const selectionUI = (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Track</Label>
        <div className="flex gap-2">
          <Select value={tempTrackName} onValueChange={handleTrackChange}>
            <SelectTrigger className="flex-1"><SelectValue placeholder="Select track..." /></SelectTrigger>
            <SelectContent>{tracks.map(track => <SelectItem key={track.name} value={track.name}>{track.name}</SelectItem>)}</SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={openAddTrack}><Plus className="w-4 h-4" /></Button>
        </div>
      </div>
      {tempTrackName && (
        <div className="space-y-2">
          <Label>Course</Label>
          <div className="flex gap-2">
            <Select value={tempCourseName} onValueChange={handleCourseChange} disabled={availableCourses.length === 0}>
              <SelectTrigger className="flex-1"><SelectValue placeholder={availableCourses.length === 0 ? 'No courses' : 'Select course...'} /></SelectTrigger>
              <SelectContent>{availableCourses.map(course => <SelectItem key={course.name} value={course.name}>{course.name}</SelectItem>)}</SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={openAddCourse}><Plus className="w-4 h-4" /></Button>
          </div>
        </div>
      )}
    </div>
  );

  // Manage mode content (Courses + Tracks tabs)
  const manageModeContent = (
    <Tabs defaultValue="courses" className="w-full">
      <TabsList className="grid w-full grid-cols-2"><TabsTrigger value="courses">Courses</TabsTrigger><TabsTrigger value="tracks">Tracks</TabsTrigger></TabsList>
      <TabsContent value="courses" className="space-y-4">
        {form.editingCourse ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-medium">Edit Course</h4>
              <EditorModeToggle mode={form.editorMode} onModeChange={form.setEditorMode} />
            </div>
            {form.editorMode === 'manual' ? (
              <CourseForm {...form.courseFormProps} onSubmit={handleUpdateCourse} onCancel={() => { form.setEditingCourse(null); form.resetForm(); form.setEditorMode('visual'); }} submitLabel="Update" showTrackName={false} />
            ) : (
              <div className="space-y-4">
                <VisualEditor
                  startFinishA={form.visualEditorStartFinishA}
                  startFinishB={form.visualEditorStartFinishB}
                  sector2={form.visualEditorSector2}
                  sector3={form.visualEditorSector3}
                  onStartFinishChange={form.handleVisualStartFinishChange}
                  onSector2Change={form.handleVisualSector2Change}
                  onSector3Change={form.handleVisualSector3Change}
                />
                <div className="flex gap-2">
                  <Button onClick={handleUpdateCourse} className="flex-1">
                    <Check className="w-4 h-4 mr-2" />
                    Update
                  </Button>
                  <Button variant="outline" onClick={() => { form.setEditingCourse(null); form.resetForm(); form.setEditorMode('visual'); }}>
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <Label>Select track to view courses</Label>
            <Select value={tempTrackName} onValueChange={handleTrackChange}>
              <SelectTrigger><SelectValue placeholder="Select track..." /></SelectTrigger>
              <SelectContent>{tracks.map(track => <SelectItem key={track.name} value={track.name}>{track.name}</SelectItem>)}</SelectContent>
            </Select>
            {selectedTrack && (
              <div className="mt-4 space-y-2">
                {selectedTrack.courses.length === 0 ? <p className="text-muted-foreground text-sm">No courses defined</p> : selectedTrack.courses.map(course => (
                  <div key={course.name} className="flex items-center justify-between p-2 border rounded bg-muted/30">
                    <div>
                      <span className="font-mono text-sm">{course.name}</span>
                      {!course.isUserDefined && <span className="ml-2 text-xs text-muted-foreground">(default)</span>}
                      {course.sector2 && course.sector3 && <span className="ml-2 text-xs text-purple-400">(sectors)</span>}
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => form.openEditCourse(selectedTrack.name, course)}><Edit2 className="w-3 h-3" /></Button>
                      {course.isUserDefined && <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDeleteCourse(selectedTrack.name, course.name)}><Trash2 className="w-3 h-3" /></Button>}
                    </div>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={openAddCourse} className="w-full mt-2"><Plus className="w-4 h-4 mr-2" />Add Course</Button>
              </div>
            )}
          </div>
        )}
      </TabsContent>
      <TabsContent value="tracks" className="space-y-2">
        {tracks.length === 0 ? <p className="text-muted-foreground text-sm">No tracks defined</p> : tracks.map(track => (
          <div key={track.name} className="flex items-center justify-between p-2 border rounded bg-muted/30">
            <div>
              <span className="font-mono text-sm">{track.name}</span>
              <span className="ml-2 text-xs text-muted-foreground">({track.courses.length} course{track.courses.length !== 1 ? 's' : ''})</span>
              {!track.isUserDefined && <span className="ml-2 text-xs text-muted-foreground">(default)</span>}
            </div>
            <div className="flex gap-1">{track.isUserDefined && <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDeleteTrack(track.name)}><Trash2 className="w-3 h-3" /></Button>}</div>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={openAddTrack} className="w-full mt-2"><Plus className="w-4 h-4 mr-2" />Add Track</Button>
      </TabsContent>
      <div className="flex justify-between pt-4">
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setIsJsonViewOpen(true)} disabled={!selectedTrack}>
            <Code className="w-4 h-4 mr-2" />View JSON
          </Button>
          {selectedTrack && (selectedTrack.isUserDefined || selectedTrack.courses.some(c => c.isUserDefined)) && (
            <SubmitTrackDialog
              trigger={
                <Button variant="outline">
                  <Send className="w-4 h-4 mr-2" />Submit
                </Button>
              }
              prefill={(() => {
                const userCourse = selectedTrack.courses.find(c => c.isUserDefined && c.name === tempCourseName)
                  || selectedTrack.courses.find(c => c.isUserDefined);
                if (!userCourse) return undefined;
                return {
                  type: selectedTrack.isUserDefined ? 'new_track' as const : 'new_course' as const,
                  trackName: selectedTrack.name,
                  trackShortName: selectedTrack.shortName,
                  courseName: userCourse.name,
                  course: userCourse,
                };
              })()}
            />
          )}
        </div>
        <Button variant="outline" onClick={() => setIsManageMode(false)}>Back to Selection</Button>
      </div>
    </Tabs>
  );

  // JSON View Dialog (shared)
  const jsonViewDialog = (
    <Dialog open={isJsonViewOpen} onOpenChange={setIsJsonViewOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Code className="w-5 h-5" />
            {selectedTrack?.name} JSON
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Textarea
            readOnly
            value={generateTrackJson()}
            className="font-mono text-xs h-64 resize-none bg-muted"
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={handleCopyJson}>
              <Copy className="w-4 h-4 mr-2" />Copy to Clipboard
            </Button>
            <Button variant="outline" onClick={() => setIsJsonViewOpen(false)}>Close</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );

  if (compact) {
    const displayLabel = selection ? `${abbreviateTrackName(selection.trackName)} : ${selection.courseName}` : 'No track selected';

    return (
      <>
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm">{displayLabel}</span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setIsSelectDialogOpen(true)}>
            <Edit2 className="w-4 h-4" />
          </Button>
        </div>

        <Dialog open={isSelectDialogOpen} onOpenChange={(open) => { setIsSelectDialogOpen(open); if (!open) { setIsManageMode(false); form.setEditingCourse(null); form.resetForm(); } }}>
          <DialogTrigger asChild><span className="sr-only">Open track selector</span></DialogTrigger>
          <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{isManageMode ? 'Manage Tracks & Courses' : 'Select Track & Course'}</DialogTitle></DialogHeader>
            {!isManageMode ? (
              <>
                {selectionUI}
                <div className="flex gap-2 pt-4">
                  <Button onClick={handleApplySelection} className="flex-1">Apply</Button>
                  <Button variant="outline" onClick={() => setIsManageMode(true)}><Settings className="w-4 h-4 mr-2" />Manage</Button>
                </div>
              </>
            ) : manageModeContent}
          </DialogContent>
        </Dialog>

        {jsonViewDialog}
        <AddCourseDialog {...addCourseDialogProps} />
        <AddTrackDialog {...addTrackDialogProps} />
      </>
    );
  }

  return (
    <div className="space-y-4">
      {selectionUI}
      {tempTrackName && tempCourseName && (
        <Button onClick={() => {
          const track = tracks.find(t => t.name === tempTrackName);
          const course = track?.courses.find(c => c.name === tempCourseName);
          if (track && course) onSelectionChange({ trackName: tempTrackName, courseName: tempCourseName, course });
        }} className="w-full"><Check className="w-4 h-4 mr-2" />Apply Selection</Button>
      )}
      <AddCourseDialog {...addCourseDialogProps} />
      <AddTrackDialog {...addTrackDialogProps} />
    </div>
  );
}
