import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Edit2, Check, X, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Track, Course, TrackCourseSelection, SectorLine } from '@/types/racing';
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface TrackCourseEditorProps {
  selection: TrackCourseSelection | null;
  onSelectionChange: (selection: TrackCourseSelection | null) => void;
  compact?: boolean;
}

interface CourseFormProps {
  trackName: string;
  courseName: string;
  latA: string;
  lonA: string;
  latB: string;
  lonB: string;
  sector2: { aLat: string; aLon: string; bLat: string; bLon: string };
  sector3: { aLat: string; aLon: string; bLat: string; bLon: string };
  onTrackNameChange: (value: string) => void;
  onCourseNameChange: (value: string) => void;
  onLatAChange: (value: string) => void;
  onLonAChange: (value: string) => void;
  onLatBChange: (value: string) => void;
  onLonBChange: (value: string) => void;
  onSector2Change: (field: 'aLat' | 'aLon' | 'bLat' | 'bLon', value: string) => void;
  onSector3Change: (field: 'aLat' | 'aLon' | 'bLat' | 'bLon', value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitLabel: string;
  showTrackName?: boolean;
}

function CourseForm({
  trackName, courseName, latA, lonA, latB, lonB,
  sector2, sector3,
  onTrackNameChange, onCourseNameChange,
  onLatAChange, onLonAChange, onLatBChange, onLonBChange,
  onSector2Change, onSector3Change,
  onSubmit, onCancel, submitLabel, showTrackName = true,
}: CourseFormProps) {
  const [showSectors, setShowSectors] = useState(
    Boolean(sector2.aLat || sector2.aLon || sector3.aLat || sector3.aLon)
  );
  const stopKeys = (e: React.KeyboardEvent<HTMLInputElement>) => e.stopPropagation();

  return (
    <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
      {showTrackName && (
        <div>
          <Label htmlFor="trackName">Track Name</Label>
          <Input id="trackName" value={trackName} onChange={(e) => onTrackNameChange(e.target.value)} onKeyDownCapture={stopKeys} placeholder="e.g., Orlando Kart Center" className="font-mono" />
        </div>
      )}
      <div>
        <Label htmlFor="courseName">Course Name</Label>
        <Input id="courseName" value={courseName} onChange={(e) => onCourseNameChange(e.target.value)} onKeyDownCapture={stopKeys} placeholder="e.g., Full Track" className="font-mono" />
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium text-muted-foreground">Start/Finish Line (required)</p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Point A Lat</Label>
            <Input value={latA} onChange={(e) => onLatAChange(e.target.value)} onKeyDownCapture={stopKeys} placeholder="28.4127" className="font-mono text-sm" />
          </div>
          <div>
            <Label className="text-xs">Point A Lon</Label>
            <Input value={lonA} onChange={(e) => onLonAChange(e.target.value)} onKeyDownCapture={stopKeys} placeholder="-81.3797" className="font-mono text-sm" />
          </div>
          <div>
            <Label className="text-xs">Point B Lat</Label>
            <Input value={latB} onChange={(e) => onLatBChange(e.target.value)} onKeyDownCapture={stopKeys} placeholder="28.4128" className="font-mono text-sm" />
          </div>
          <div>
            <Label className="text-xs">Point B Lon</Label>
            <Input value={lonB} onChange={(e) => onLonBChange(e.target.value)} onKeyDownCapture={stopKeys} placeholder="-81.3795" className="font-mono text-sm" />
          </div>
        </div>
      </div>

      <Collapsible open={showSectors} onOpenChange={setShowSectors}>
        <CollapsibleTrigger asChild>
          <Button variant="outline" size="sm" className="w-full text-xs">
            {showSectors ? 'Hide Sector Lines (optional)' : 'Add Sector Lines (optional)'}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 mt-3">
          <p className="text-xs text-muted-foreground">Both sector 2 and sector 3 lines must be defined for sector timing to work.</p>
          
          <div className="space-y-2 p-3 border rounded bg-muted/20">
            <p className="text-sm font-medium text-purple-400">Sector 2 Line</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Point A Lat</Label>
                <Input value={sector2.aLat} onChange={(e) => onSector2Change('aLat', e.target.value)} onKeyDownCapture={stopKeys} placeholder="Lat" className="font-mono text-sm" />
              </div>
              <div>
                <Label className="text-xs">Point A Lon</Label>
                <Input value={sector2.aLon} onChange={(e) => onSector2Change('aLon', e.target.value)} onKeyDownCapture={stopKeys} placeholder="Lon" className="font-mono text-sm" />
              </div>
              <div>
                <Label className="text-xs">Point B Lat</Label>
                <Input value={sector2.bLat} onChange={(e) => onSector2Change('bLat', e.target.value)} onKeyDownCapture={stopKeys} placeholder="Lat" className="font-mono text-sm" />
              </div>
              <div>
                <Label className="text-xs">Point B Lon</Label>
                <Input value={sector2.bLon} onChange={(e) => onSector2Change('bLon', e.target.value)} onKeyDownCapture={stopKeys} placeholder="Lon" className="font-mono text-sm" />
              </div>
            </div>
          </div>

          <div className="space-y-2 p-3 border rounded bg-muted/20">
            <p className="text-sm font-medium text-purple-400">Sector 3 Line</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Point A Lat</Label>
                <Input value={sector3.aLat} onChange={(e) => onSector3Change('aLat', e.target.value)} onKeyDownCapture={stopKeys} placeholder="Lat" className="font-mono text-sm" />
              </div>
              <div>
                <Label className="text-xs">Point A Lon</Label>
                <Input value={sector3.aLon} onChange={(e) => onSector3Change('aLon', e.target.value)} onKeyDownCapture={stopKeys} placeholder="Lon" className="font-mono text-sm" />
              </div>
              <div>
                <Label className="text-xs">Point B Lat</Label>
                <Input value={sector3.bLat} onChange={(e) => onSector3Change('bLat', e.target.value)} onKeyDownCapture={stopKeys} placeholder="Lat" className="font-mono text-sm" />
              </div>
              <div>
                <Label className="text-xs">Point B Lon</Label>
                <Input value={sector3.bLon} onChange={(e) => onSector3Change('bLon', e.target.value)} onKeyDownCapture={stopKeys} placeholder="Lon" className="font-mono text-sm" />
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

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

// Helper to parse sector line from form
function parseSectorLine(sector: { aLat: string; aLon: string; bLat: string; bLon: string }): SectorLine | undefined {
  const aLat = parseFloat(sector.aLat);
  const aLon = parseFloat(sector.aLon);
  const bLat = parseFloat(sector.bLat);
  const bLon = parseFloat(sector.bLon);
  if (isNaN(aLat) || isNaN(aLon) || isNaN(bLat) || isNaN(bLon)) return undefined;
  return { a: { lat: aLat, lon: aLon }, b: { lat: bLat, lon: bLon } };
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
  const [formTrackName, setFormTrackName] = useState('');
  const [formCourseName, setFormCourseName] = useState('');
  const [formLatA, setFormLatA] = useState('');
  const [formLonA, setFormLonA] = useState('');
  const [formLatB, setFormLatB] = useState('');
  const [formLonB, setFormLonB] = useState('');
  const [formSector2, setFormSector2] = useState({ aLat: '', aLon: '', bLat: '', bLon: '' });
  const [formSector3, setFormSector3] = useState({ aLat: '', aLon: '', bLat: '', bLon: '' });
  const [editingCourse, setEditingCourse] = useState<{ trackName: string; courseName: string } | null>(null);

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

  const resetForm = () => {
    setFormTrackName(''); setFormCourseName('');
    setFormLatA(''); setFormLonA(''); setFormLatB(''); setFormLonB('');
    setFormSector2({ aLat: '', aLon: '', bLat: '', bLon: '' });
    setFormSector3({ aLat: '', aLon: '', bLat: '', bLon: '' });
  };

  const selectedTrack = tracks.find(t => t.name === tempTrackName);
  const availableCourses = selectedTrack?.courses ?? [];

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
    setFormTrackName(tempTrackName || '');
    resetForm();
    setFormTrackName(tempTrackName || '');
    setIsAddCourseOpen(true);
  };

  const openAddTrack = () => { resetForm(); setIsAddTrackOpen(true); };

  const buildCourse = (): Course | null => {
    const latA = parseFloat(formLatA); const lonA = parseFloat(formLonA);
    const latB = parseFloat(formLatB); const lonB = parseFloat(formLonB);
    if (!formCourseName.trim() || isNaN(latA) || isNaN(lonA) || isNaN(latB) || isNaN(lonB)) return null;
    const course: Course = {
      name: formCourseName.trim(),
      startFinishA: { lat: latA, lon: lonA },
      startFinishB: { lat: latB, lon: lonB },
      isUserDefined: true,
    };
    const s2 = parseSectorLine(formSector2);
    const s3 = parseSectorLine(formSector3);
    if (s2 && s3) { course.sector2 = s2; course.sector3 = s3; }
    return course;
  };

  const handleAddCourse = async () => {
    const course = buildCourse();
    if (!course || !formTrackName.trim()) return;
    await addCourseToStorage(formTrackName.trim(), course);
    await refreshTracks();
    setTempTrackName(formTrackName.trim());
    setTempCourseName(course.name);
    resetForm();
    setIsAddCourseOpen(false);
  };

  const handleAddTrack = async () => {
    const course = buildCourse();
    if (!course || !formTrackName.trim()) return;
    await addTrackToStorage(formTrackName.trim(), course);
    await refreshTracks();
    setTempTrackName(formTrackName.trim());
    setTempCourseName(course.name);
    resetForm();
    setIsAddTrackOpen(false);
  };

  const openEditCourse = (trackName: string, course: Course) => {
    setEditingCourse({ trackName, courseName: course.name });
    setFormTrackName(trackName);
    setFormCourseName(course.name);
    setFormLatA(course.startFinishA.lat.toString());
    setFormLonA(course.startFinishA.lon.toString());
    setFormLatB(course.startFinishB.lat.toString());
    setFormLonB(course.startFinishB.lon.toString());
    setFormSector2(course.sector2 ? {
      aLat: course.sector2.a.lat.toString(), aLon: course.sector2.a.lon.toString(),
      bLat: course.sector2.b.lat.toString(), bLon: course.sector2.b.lon.toString()
    } : { aLat: '', aLon: '', bLat: '', bLon: '' });
    setFormSector3(course.sector3 ? {
      aLat: course.sector3.a.lat.toString(), aLon: course.sector3.a.lon.toString(),
      bLat: course.sector3.b.lat.toString(), bLon: course.sector3.b.lon.toString()
    } : { aLat: '', aLon: '', bLat: '', bLon: '' });
  };

  const handleUpdateCourse = async () => {
    if (!editingCourse) return;
    const course = buildCourse();
    if (!course) return;
    if (course.name !== editingCourse.courseName) {
      await deleteCourse(editingCourse.trackName, editingCourse.courseName);
      await addCourseToStorage(editingCourse.trackName, course);
    } else {
      await updateCourse(editingCourse.trackName, editingCourse.courseName, {
        startFinishA: course.startFinishA,
        startFinishB: course.startFinishB,
        sector2: course.sector2,
        sector3: course.sector3,
      });
    }
    await refreshTracks();
    setTempCourseName(course.name);
    setEditingCourse(null);
    resetForm();
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

  const handleSector2Change = (field: 'aLat' | 'aLon' | 'bLat' | 'bLon', value: string) => {
    setFormSector2(prev => ({ ...prev, [field]: value }));
  };
  const handleSector3Change = (field: 'aLat' | 'aLon' | 'bLat' | 'bLon', value: string) => {
    setFormSector3(prev => ({ ...prev, [field]: value }));
  };

  if (isLoading) return <div className="text-muted-foreground text-sm">Loading tracks...</div>;

  const courseFormProps = {
    trackName: formTrackName, courseName: formCourseName,
    latA: formLatA, lonA: formLonA, latB: formLatB, lonB: formLonB,
    sector2: formSector2, sector3: formSector3,
    onTrackNameChange: setFormTrackName, onCourseNameChange: setFormCourseName,
    onLatAChange: setFormLatA, onLonAChange: setFormLonA,
    onLatBChange: setFormLatB, onLonBChange: setFormLonB,
    onSector2Change: handleSector2Change, onSector3Change: handleSector3Change,
  };

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

        <Dialog open={isSelectDialogOpen} onOpenChange={(open) => { setIsSelectDialogOpen(open); if (!open) { setIsManageMode(false); setEditingCourse(null); resetForm(); } }}>
          <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{isManageMode ? 'Manage Tracks & Courses' : 'Select Track & Course'}</DialogTitle></DialogHeader>
            {!isManageMode ? (
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
                <div className="flex gap-2 pt-4">
                  <Button onClick={handleApplySelection} className="flex-1">Apply</Button>
                  <Button variant="outline" onClick={() => setIsManageMode(true)}><Settings className="w-4 h-4 mr-2" />Manage</Button>
                </div>
              </div>
            ) : (
              <Tabs defaultValue="courses" className="w-full">
                <TabsList className="grid w-full grid-cols-2"><TabsTrigger value="courses">Courses</TabsTrigger><TabsTrigger value="tracks">Tracks</TabsTrigger></TabsList>
                <TabsContent value="courses" className="space-y-4">
                  {editingCourse ? (
                    <div className="space-y-4">
                      <h4 className="font-medium">Edit Course</h4>
                      <CourseForm {...courseFormProps} onSubmit={handleUpdateCourse} onCancel={() => { setEditingCourse(null); resetForm(); }} submitLabel="Update" showTrackName={false} />
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
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditCourse(selectedTrack.name, course)}><Edit2 className="w-3 h-3" /></Button>
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
                <div className="flex justify-end pt-4"><Button variant="outline" onClick={() => setIsManageMode(false)}>Back to Selection</Button></div>
              </Tabs>
            )}
          </DialogContent>
        </Dialog>

        <Dialog open={isAddCourseOpen} onOpenChange={setIsAddCourseOpen}>
          <DialogContent><DialogHeader><DialogTitle>Add New Course</DialogTitle></DialogHeader>
            <CourseForm {...courseFormProps} onSubmit={handleAddCourse} onCancel={() => { setIsAddCourseOpen(false); resetForm(); }} submitLabel="Create Course" />
          </DialogContent>
        </Dialog>

        <Dialog open={isAddTrackOpen} onOpenChange={setIsAddTrackOpen}>
          <DialogContent><DialogHeader><DialogTitle>Add New Track</DialogTitle></DialogHeader>
            <CourseForm {...courseFormProps} onSubmit={handleAddTrack} onCancel={() => { setIsAddTrackOpen(false); resetForm(); }} submitLabel="Create Track" />
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
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
      {tempTrackName && tempCourseName && (
        <Button onClick={() => {
          const track = tracks.find(t => t.name === tempTrackName);
          const course = track?.courses.find(c => c.name === tempCourseName);
          if (track && course) onSelectionChange({ trackName: tempTrackName, courseName: tempCourseName, course });
        }} className="w-full"><Check className="w-4 h-4 mr-2" />Apply Selection</Button>
      )}
      <Dialog open={isAddCourseOpen} onOpenChange={setIsAddCourseOpen}>
        <DialogContent><DialogHeader><DialogTitle>Add New Course</DialogTitle></DialogHeader>
          <CourseForm {...courseFormProps} onSubmit={handleAddCourse} onCancel={() => { setIsAddCourseOpen(false); resetForm(); }} submitLabel="Create Course" />
        </DialogContent>
      </Dialog>
      <Dialog open={isAddTrackOpen} onOpenChange={setIsAddTrackOpen}>
        <DialogContent><DialogHeader><DialogTitle>Add New Track</DialogTitle></DialogHeader>
          <CourseForm {...courseFormProps} onSubmit={handleAddTrack} onCancel={() => { setIsAddTrackOpen(false); resetForm(); }} submitLabel="Create Track" />
        </DialogContent>
      </Dialog>
    </div>
  );
}