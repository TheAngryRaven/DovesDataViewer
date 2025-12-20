import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Edit2, Check, X, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Track, Course, TrackCourseSelection } from '@/types/racing';
import { 
  loadTracks, 
  addTrack as addTrackToStorage, 
  addCourse as addCourseToStorage,
  updateTrackName,
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
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

// ============ Props ============

interface TrackCourseEditorProps {
  /** Current selection (track + course) */
  selection: TrackCourseSelection | null;
  /** Called when user selects a track + course */
  onSelectionChange: (selection: TrackCourseSelection | null) => void;
  /** Whether we're in "compact" mode (after data load) */
  compact?: boolean;
}

// ============ Course Form ============

interface CourseFormProps {
  trackName: string;
  courseName: string;
  latA: string;
  lonA: string;
  latB: string;
  lonB: string;
  onTrackNameChange: (value: string) => void;
  onCourseNameChange: (value: string) => void;
  onLatAChange: (value: string) => void;
  onLonAChange: (value: string) => void;
  onLatBChange: (value: string) => void;
  onLonBChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitLabel: string;
  showTrackName?: boolean;
}

function CourseForm({
  trackName,
  courseName,
  latA,
  lonA,
  latB,
  lonB,
  onTrackNameChange,
  onCourseNameChange,
  onLatAChange,
  onLonAChange,
  onLatBChange,
  onLonBChange,
  onSubmit,
  onCancel,
  submitLabel,
  showTrackName = true,
}: CourseFormProps) {
  const stopKeys = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
  };

  return (
    <div className="space-y-4">
      {showTrackName && (
        <div>
          <Label htmlFor="trackName">Track Name</Label>
          <Input
            id="trackName"
            value={trackName}
            onChange={(e) => onTrackNameChange(e.target.value)}
            onKeyDownCapture={stopKeys}
            placeholder="e.g., Orlando Kart Center"
            className="font-mono"
          />
        </div>
      )}

      <div>
        <Label htmlFor="courseName">Course Name</Label>
        <Input
          id="courseName"
          value={courseName}
          onChange={(e) => onCourseNameChange(e.target.value)}
          onKeyDownCapture={stopKeys}
          placeholder="e.g., Full Track"
          className="font-mono"
        />
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium text-muted-foreground">Start/Finish Line Point A</p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="latA" className="text-xs">Latitude</Label>
            <Input
              id="latA"
              value={latA}
              onChange={(e) => onLatAChange(e.target.value)}
              onKeyDownCapture={stopKeys}
              placeholder="28.4127"
              className="font-mono text-sm"
            />
          </div>
          <div>
            <Label htmlFor="lonA" className="text-xs">Longitude</Label>
            <Input
              id="lonA"
              value={lonA}
              onChange={(e) => onLonAChange(e.target.value)}
              onKeyDownCapture={stopKeys}
              placeholder="-81.3797"
              className="font-mono text-sm"
            />
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium text-muted-foreground">Start/Finish Line Point B</p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="latB" className="text-xs">Latitude</Label>
            <Input
              id="latB"
              value={latB}
              onChange={(e) => onLatBChange(e.target.value)}
              onKeyDownCapture={stopKeys}
              placeholder="28.4128"
              className="font-mono text-sm"
            />
          </div>
          <div>
            <Label htmlFor="lonB" className="text-xs">Longitude</Label>
            <Input
              id="lonB"
              value={lonB}
              onChange={(e) => onLonBChange(e.target.value)}
              onKeyDownCapture={stopKeys}
              placeholder="-81.3795"
              className="font-mono text-sm"
            />
          </div>
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <Button onClick={onSubmit} className="flex-1">
          <Check className="w-4 h-4 mr-2" />
          {submitLabel}
        </Button>
        <Button variant="outline" onClick={onCancel}>
          <X className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

// ============ Main Component ============

export function TrackEditor({ selection, onSelectionChange, compact = false }: TrackCourseEditorProps) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Dialog states
  const [isSelectDialogOpen, setIsSelectDialogOpen] = useState(false);
  const [isManageMode, setIsManageMode] = useState(false);
  const [isAddCourseOpen, setIsAddCourseOpen] = useState(false);
  const [isAddTrackOpen, setIsAddTrackOpen] = useState(false);
  
  // Temp selection in dialog
  const [tempTrackName, setTempTrackName] = useState<string>('');
  const [tempCourseName, setTempCourseName] = useState<string>('');
  
  // Form state for new course/track
  const [formTrackName, setFormTrackName] = useState('');
  const [formCourseName, setFormCourseName] = useState('');
  const [formLatA, setFormLatA] = useState('');
  const [formLonA, setFormLonA] = useState('');
  const [formLatB, setFormLatB] = useState('');
  const [formLonB, setFormLonB] = useState('');
  
  // Editing state
  const [editingCourse, setEditingCourse] = useState<{ trackName: string; courseName: string } | null>(null);

  // Load tracks on mount
  useEffect(() => {
    let mounted = true;
    loadTracks().then(loadedTracks => {
      if (mounted) {
        setTracks(loadedTracks);
        setIsLoading(false);
      }
    });
    return () => { mounted = false; };
  }, []);

  // Sync temp selection with actual selection when dialog opens
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

  const resetForm = () => {
    setFormTrackName('');
    setFormCourseName('');
    setFormLatA('');
    setFormLonA('');
    setFormLatB('');
    setFormLonB('');
  };

  const selectedTrack = tracks.find(t => t.name === tempTrackName);
  const availableCourses = selectedTrack?.courses ?? [];

  // Handle track selection change
  const handleTrackChange = (trackName: string) => {
    setTempTrackName(trackName);
    // Auto-select first course if available
    const track = tracks.find(t => t.name === trackName);
    if (track && track.courses.length > 0) {
      setTempCourseName(track.courses[0].name);
    } else {
      setTempCourseName('');
    }
  };

  // Handle course selection change
  const handleCourseChange = (courseName: string) => {
    setTempCourseName(courseName);
  };

  // Apply selection and close dialog
  const handleApplySelection = () => {
    if (!tempTrackName || !tempCourseName) {
      onSelectionChange(null);
    } else {
      const track = tracks.find(t => t.name === tempTrackName);
      const course = track?.courses.find(c => c.name === tempCourseName);
      if (track && course) {
        onSelectionChange({
          trackName: tempTrackName,
          courseName: tempCourseName,
          course,
        });
      }
    }
    setIsSelectDialogOpen(false);
    setIsManageMode(false);
  };

  // Open add course dialog with current track pre-filled
  const openAddCourse = () => {
    setFormTrackName(tempTrackName || '');
    setFormCourseName('');
    setFormLatA('');
    setFormLonA('');
    setFormLatB('');
    setFormLonB('');
    setIsAddCourseOpen(true);
  };

  // Open add track dialog
  const openAddTrack = () => {
    resetForm();
    setIsAddTrackOpen(true);
  };

  // Handle adding a new course
  const handleAddCourse = async () => {
    const latA = parseFloat(formLatA);
    const lonA = parseFloat(formLonA);
    const latB = parseFloat(formLatB);
    const lonB = parseFloat(formLonB);

    if (!formTrackName.trim() || !formCourseName.trim()) return;
    if (isNaN(latA) || isNaN(lonA) || isNaN(latB) || isNaN(lonB)) return;

    const course: Course = {
      name: formCourseName.trim(),
      startFinishA: { lat: latA, lon: lonA },
      startFinishB: { lat: latB, lon: lonB },
      isUserDefined: true,
    };

    await addCourseToStorage(formTrackName.trim(), course);
    await refreshTracks();
    
    setTempTrackName(formTrackName.trim());
    setTempCourseName(formCourseName.trim());
    resetForm();
    setIsAddCourseOpen(false);
  };

  // Handle adding a new track (with initial course)
  const handleAddTrack = async () => {
    const latA = parseFloat(formLatA);
    const lonA = parseFloat(formLonA);
    const latB = parseFloat(formLatB);
    const lonB = parseFloat(formLonB);

    if (!formTrackName.trim() || !formCourseName.trim()) return;
    if (isNaN(latA) || isNaN(lonA) || isNaN(latB) || isNaN(lonB)) return;

    const course: Course = {
      name: formCourseName.trim(),
      startFinishA: { lat: latA, lon: lonA },
      startFinishB: { lat: latB, lon: lonB },
      isUserDefined: true,
    };

    await addTrackToStorage(formTrackName.trim(), course);
    await refreshTracks();
    
    setTempTrackName(formTrackName.trim());
    setTempCourseName(formCourseName.trim());
    resetForm();
    setIsAddTrackOpen(false);
  };

  // Handle editing a course
  const openEditCourse = (trackName: string, course: Course) => {
    setEditingCourse({ trackName, courseName: course.name });
    setFormTrackName(trackName);
    setFormCourseName(course.name);
    setFormLatA(course.startFinishA.lat.toString());
    setFormLonA(course.startFinishA.lon.toString());
    setFormLatB(course.startFinishB.lat.toString());
    setFormLonB(course.startFinishB.lon.toString());
  };

  const handleUpdateCourse = async () => {
    if (!editingCourse) return;
    
    const latA = parseFloat(formLatA);
    const lonA = parseFloat(formLonA);
    const latB = parseFloat(formLatB);
    const lonB = parseFloat(formLonB);

    if (!formCourseName.trim()) return;
    if (isNaN(latA) || isNaN(lonA) || isNaN(latB) || isNaN(lonB)) return;

    // If course name changed, we need to delete old and add new
    if (formCourseName.trim() !== editingCourse.courseName) {
      await deleteCourse(editingCourse.trackName, editingCourse.courseName);
      const course: Course = {
        name: formCourseName.trim(),
        startFinishA: { lat: latA, lon: lonA },
        startFinishB: { lat: latB, lon: lonB },
        isUserDefined: true,
      };
      await addCourseToStorage(editingCourse.trackName, course);
    } else {
      await updateCourse(editingCourse.trackName, editingCourse.courseName, {
        startFinishA: { lat: latA, lon: lonA },
        startFinishB: { lat: latB, lon: lonB },
      });
    }

    await refreshTracks();
    setTempCourseName(formCourseName.trim());
    setEditingCourse(null);
    resetForm();
  };

  const handleDeleteCourse = async (trackName: string, courseName: string) => {
    await deleteCourse(trackName, courseName);
    const newTracks = await refreshTracks();
    
    // If we deleted the selected course, clear selection
    if (tempTrackName === trackName && tempCourseName === courseName) {
      const track = newTracks.find(t => t.name === trackName);
      if (track && track.courses.length > 0) {
        setTempCourseName(track.courses[0].name);
      } else {
        setTempCourseName('');
      }
    }
  };

  const handleDeleteTrack = async (trackName: string) => {
    await deleteTrack(trackName);
    const newTracks = await refreshTracks();
    
    if (tempTrackName === trackName) {
      if (newTracks.length > 0) {
        setTempTrackName(newTracks[0].name);
        if (newTracks[0].courses.length > 0) {
          setTempCourseName(newTracks[0].courses[0].name);
        } else {
          setTempCourseName('');
        }
      } else {
        setTempTrackName('');
        setTempCourseName('');
      }
    }
  };

  if (isLoading) {
    return <div className="text-muted-foreground text-sm">Loading tracks...</div>;
  }

  // ============ Compact Mode (after data load) ============
  if (compact) {
    const displayLabel = selection 
      ? `${abbreviateTrackName(selection.trackName)} : ${selection.courseName}`
      : 'No track selected';

    return (
      <>
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm">{displayLabel}</span>
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-7 w-7"
            onClick={() => setIsSelectDialogOpen(true)}
          >
            <Edit2 className="w-4 h-4" />
          </Button>
        </div>

        <Dialog open={isSelectDialogOpen} onOpenChange={(open) => {
          setIsSelectDialogOpen(open);
          if (!open) {
            setIsManageMode(false);
            setEditingCourse(null);
            resetForm();
          }
        }}>
          <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {isManageMode ? 'Manage Tracks & Courses' : 'Select Track & Course'}
              </DialogTitle>
            </DialogHeader>

            {!isManageMode ? (
              // Selection mode
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Track</Label>
                  <div className="flex gap-2">
                    <Select value={tempTrackName} onValueChange={handleTrackChange}>
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="Select track..." />
                      </SelectTrigger>
                      <SelectContent>
                        {tracks.map(track => (
                          <SelectItem key={track.name} value={track.name}>
                            {track.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button variant="outline" size="icon" onClick={openAddTrack}>
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                {tempTrackName && (
                  <div className="space-y-2">
                    <Label>Course</Label>
                    <div className="flex gap-2">
                      <Select 
                        value={tempCourseName} 
                        onValueChange={handleCourseChange}
                        disabled={availableCourses.length === 0}
                      >
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder={availableCourses.length === 0 ? 'No courses' : 'Select course...'} />
                        </SelectTrigger>
                        <SelectContent>
                          {availableCourses.map(course => (
                            <SelectItem key={course.name} value={course.name}>
                              {course.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button variant="outline" size="icon" onClick={openAddCourse}>
                        <Plus className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                )}

                <div className="flex gap-2 pt-4">
                  <Button onClick={handleApplySelection} className="flex-1">
                    Apply
                  </Button>
                  <Button 
                    variant="outline" 
                    onClick={() => setIsManageMode(true)}
                  >
                    <Settings className="w-4 h-4 mr-2" />
                    Manage
                  </Button>
                </div>
              </div>
            ) : (
              // Management mode
              <Tabs defaultValue="courses" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="courses">Courses</TabsTrigger>
                  <TabsTrigger value="tracks">Tracks</TabsTrigger>
                </TabsList>

                <TabsContent value="courses" className="space-y-4">
                  {editingCourse ? (
                    <div className="space-y-4">
                      <h4 className="font-medium">Edit Course</h4>
                      <CourseForm
                        trackName={formTrackName}
                        courseName={formCourseName}
                        latA={formLatA}
                        lonA={formLonA}
                        latB={formLatB}
                        lonB={formLonB}
                        onTrackNameChange={() => {}}
                        onCourseNameChange={setFormCourseName}
                        onLatAChange={setFormLatA}
                        onLonAChange={setFormLonA}
                        onLatBChange={setFormLatB}
                        onLonBChange={setFormLonB}
                        onSubmit={handleUpdateCourse}
                        onCancel={() => { setEditingCourse(null); resetForm(); }}
                        submitLabel="Update"
                        showTrackName={false}
                      />
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Label>Select track to view courses</Label>
                      <Select value={tempTrackName} onValueChange={handleTrackChange}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select track..." />
                        </SelectTrigger>
                        <SelectContent>
                          {tracks.map(track => (
                            <SelectItem key={track.name} value={track.name}>
                              {track.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {selectedTrack && (
                        <div className="mt-4 space-y-2">
                          {selectedTrack.courses.length === 0 ? (
                            <p className="text-muted-foreground text-sm">No courses defined</p>
                          ) : (
                            selectedTrack.courses.map(course => (
                              <div 
                                key={course.name} 
                                className="flex items-center justify-between p-2 border rounded bg-muted/30"
                              >
                                <div>
                                  <span className="font-mono text-sm">{course.name}</span>
                                  {!course.isUserDefined && (
                                    <span className="ml-2 text-xs text-muted-foreground">(default)</span>
                                  )}
                                </div>
                                <div className="flex gap-1">
                                  <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    className="h-7 w-7"
                                    onClick={() => openEditCourse(selectedTrack.name, course)}
                                  >
                                    <Edit2 className="w-3 h-3" />
                                  </Button>
                                  {course.isUserDefined && (
                                    <Button 
                                      variant="ghost" 
                                      size="icon" 
                                      className="h-7 w-7 text-destructive hover:text-destructive"
                                      onClick={() => handleDeleteCourse(selectedTrack.name, course.name)}
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </Button>
                                  )}
                                </div>
                              </div>
                            ))
                          )}
                          <Button variant="outline" size="sm" onClick={openAddCourse} className="w-full mt-2">
                            <Plus className="w-4 h-4 mr-2" />
                            Add Course
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="tracks" className="space-y-2">
                  {tracks.length === 0 ? (
                    <p className="text-muted-foreground text-sm">No tracks defined</p>
                  ) : (
                    tracks.map(track => (
                      <div 
                        key={track.name} 
                        className="flex items-center justify-between p-2 border rounded bg-muted/30"
                      >
                        <div>
                          <span className="font-mono text-sm">{track.name}</span>
                          <span className="ml-2 text-xs text-muted-foreground">
                            ({track.courses.length} course{track.courses.length !== 1 ? 's' : ''})
                          </span>
                          {!track.isUserDefined && (
                            <span className="ml-2 text-xs text-muted-foreground">(default)</span>
                          )}
                        </div>
                        <div className="flex gap-1">
                          {track.isUserDefined && (
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => handleDeleteTrack(track.name)}
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                  <Button variant="outline" size="sm" onClick={openAddTrack} className="w-full mt-2">
                    <Plus className="w-4 h-4 mr-2" />
                    Add Track
                  </Button>
                </TabsContent>

                <div className="flex justify-end pt-4">
                  <Button variant="outline" onClick={() => setIsManageMode(false)}>
                    Back to Selection
                  </Button>
                </div>
              </Tabs>
            )}
          </DialogContent>
        </Dialog>

        {/* Add Course Dialog */}
        <Dialog open={isAddCourseOpen} onOpenChange={setIsAddCourseOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Course</DialogTitle>
            </DialogHeader>
            <CourseForm
              trackName={formTrackName}
              courseName={formCourseName}
              latA={formLatA}
              lonA={formLonA}
              latB={formLatB}
              lonB={formLonB}
              onTrackNameChange={setFormTrackName}
              onCourseNameChange={setFormCourseName}
              onLatAChange={setFormLatA}
              onLonAChange={setFormLonA}
              onLatBChange={setFormLatB}
              onLonBChange={setFormLonB}
              onSubmit={handleAddCourse}
              onCancel={() => { setIsAddCourseOpen(false); resetForm(); }}
              submitLabel="Create Course"
            />
          </DialogContent>
        </Dialog>

        {/* Add Track Dialog */}
        <Dialog open={isAddTrackOpen} onOpenChange={setIsAddTrackOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Track</DialogTitle>
            </DialogHeader>
            <CourseForm
              trackName={formTrackName}
              courseName={formCourseName}
              latA={formLatA}
              lonA={formLonA}
              latB={formLatB}
              lonB={formLonB}
              onTrackNameChange={setFormTrackName}
              onCourseNameChange={setFormCourseName}
              onLatAChange={setFormLatA}
              onLonAChange={setFormLonA}
              onLatBChange={setFormLatB}
              onLonBChange={setFormLonB}
              onSubmit={handleAddTrack}
              onCancel={() => { setIsAddTrackOpen(false); resetForm(); }}
              submitLabel="Create Track"
            />
          </DialogContent>
        </Dialog>
      </>
    );
  }

  // ============ Full Mode (before data load) ============
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Track</Label>
        <div className="flex gap-2">
          <Select value={tempTrackName} onValueChange={handleTrackChange}>
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="Select track..." />
            </SelectTrigger>
            <SelectContent>
              {tracks.map(track => (
                <SelectItem key={track.name} value={track.name}>
                  {track.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={openAddTrack}>
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {tempTrackName && (
        <div className="space-y-2">
          <Label>Course</Label>
          <div className="flex gap-2">
            <Select 
              value={tempCourseName} 
              onValueChange={handleCourseChange}
              disabled={availableCourses.length === 0}
            >
              <SelectTrigger className="flex-1">
                <SelectValue placeholder={availableCourses.length === 0 ? 'No courses' : 'Select course...'} />
              </SelectTrigger>
              <SelectContent>
                {availableCourses.map(course => (
                  <SelectItem key={course.name} value={course.name}>
                    {course.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={openAddCourse}>
              <Plus className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {tempTrackName && tempCourseName && (
        <Button 
          onClick={() => {
            const track = tracks.find(t => t.name === tempTrackName);
            const course = track?.courses.find(c => c.name === tempCourseName);
            if (track && course) {
              onSelectionChange({
                trackName: tempTrackName,
                courseName: tempCourseName,
                course,
              });
            }
          }}
          className="w-full"
        >
          <Check className="w-4 h-4 mr-2" />
          Apply Selection
        </Button>
      )}

      {/* Add Course Dialog */}
      <Dialog open={isAddCourseOpen} onOpenChange={setIsAddCourseOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Course</DialogTitle>
          </DialogHeader>
          <CourseForm
            trackName={formTrackName}
            courseName={formCourseName}
            latA={formLatA}
            lonA={formLonA}
            latB={formLatB}
            lonB={formLonB}
            onTrackNameChange={setFormTrackName}
            onCourseNameChange={setFormCourseName}
            onLatAChange={setFormLatA}
            onLonAChange={setFormLonA}
            onLatBChange={setFormLatB}
            onLonBChange={setFormLonB}
            onSubmit={handleAddCourse}
            onCancel={() => { setIsAddCourseOpen(false); resetForm(); }}
            submitLabel="Create Course"
          />
        </DialogContent>
      </Dialog>

      {/* Add Track Dialog */}
      <Dialog open={isAddTrackOpen} onOpenChange={setIsAddTrackOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Track</DialogTitle>
          </DialogHeader>
          <CourseForm
            trackName={formTrackName}
            courseName={formCourseName}
            latA={formLatA}
            lonA={formLonA}
            latB={formLatB}
            lonB={formLonB}
            onTrackNameChange={setFormTrackName}
            onCourseNameChange={setFormCourseName}
            onLatAChange={setFormLatA}
            onLonAChange={setFormLonA}
            onLatBChange={setFormLatB}
            onLonBChange={setFormLonB}
            onSubmit={handleAddTrack}
            onCancel={() => { setIsAddTrackOpen(false); resetForm(); }}
            submitLabel="Create Track"
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
