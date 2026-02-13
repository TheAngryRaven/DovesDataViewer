import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { getDatabase } from '@/lib/db';
import type { DbTrack, DbCourse } from '@/lib/db/types';
import type { SectorLine } from '@/types/racing';
import type { GpsPoint } from '@/components/track-editor/VisualEditor';
import { VisualEditor, EditorModeToggle } from '@/components/track-editor/VisualEditor';
import { Plus, Edit2, Check, X } from 'lucide-react';

type EditorMode = 'manual' | 'visual';

interface CourseFormState {
  name: string;
  startALat: string;
  startALng: string;
  startBLat: string;
  startBLng: string;
  s2aLat: string;
  s2aLng: string;
  s2bLat: string;
  s2bLng: string;
  s3aLat: string;
  s3aLng: string;
  s3bLat: string;
  s3bLng: string;
}

const emptyForm: CourseFormState = {
  name: '', startALat: '', startALng: '', startBLat: '', startBLng: '',
  s2aLat: '', s2aLng: '', s2bLat: '', s2bLng: '',
  s3aLat: '', s3aLng: '', s3bLat: '', s3bLng: '',
};

function formFromCourse(c: DbCourse): CourseFormState {
  return {
    name: c.name,
    startALat: String(c.start_a_lat), startALng: String(c.start_a_lng),
    startBLat: String(c.start_b_lat), startBLng: String(c.start_b_lng),
    s2aLat: c.sector_2_a_lat != null ? String(c.sector_2_a_lat) : '',
    s2aLng: c.sector_2_a_lng != null ? String(c.sector_2_a_lng) : '',
    s2bLat: c.sector_2_b_lat != null ? String(c.sector_2_b_lat) : '',
    s2bLng: c.sector_2_b_lng != null ? String(c.sector_2_b_lng) : '',
    s3aLat: c.sector_3_a_lat != null ? String(c.sector_3_a_lat) : '',
    s3aLng: c.sector_3_a_lng != null ? String(c.sector_3_a_lng) : '',
    s3bLat: c.sector_3_b_lat != null ? String(c.sector_3_b_lat) : '',
    s3bLng: c.sector_3_b_lng != null ? String(c.sector_3_b_lng) : '',
  };
}

function parseOptional(v: string): number | null {
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function formToCourseData(f: CourseFormState) {
  return {
    name: f.name.trim(),
    start_a_lat: parseFloat(f.startALat),
    start_a_lng: parseFloat(f.startALng),
    start_b_lat: parseFloat(f.startBLat),
    start_b_lng: parseFloat(f.startBLng),
    sector_2_a_lat: parseOptional(f.s2aLat),
    sector_2_a_lng: parseOptional(f.s2aLng),
    sector_2_b_lat: parseOptional(f.s2bLat),
    sector_2_b_lng: parseOptional(f.s2bLng),
    sector_3_a_lat: parseOptional(f.s3aLat),
    sector_3_a_lng: parseOptional(f.s3aLng),
    sector_3_b_lat: parseOptional(f.s3bLat),
    sector_3_b_lng: parseOptional(f.s3bLng),
  };
}

export function CoursesTab() {
  const [tracks, setTracks] = useState<DbTrack[]>([]);
  const [selectedTrackId, setSelectedTrackId] = useState<string>('');
  const [courses, setCourses] = useState<DbCourse[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>('visual');
  const [form, setForm] = useState<CourseFormState>(emptyForm);

  const db = getDatabase();

  const loadTracks = useCallback(async () => {
    try { setTracks(await db.getTracks()); }
    catch (e: unknown) { toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' }); }
  }, [db]);

  const loadCourses = useCallback(async () => {
    if (!selectedTrackId) { setCourses([]); return; }
    setLoading(true);
    try { setCourses(await db.getCourses(selectedTrackId)); }
    catch (e: unknown) { toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' }); }
    setLoading(false);
  }, [selectedTrackId, db]);

  useEffect(() => { loadTracks(); }, [loadTracks]);
  useEffect(() => { loadCourses(); }, [loadCourses]);

  const setField = (key: keyof CourseFormState, value: string) => setForm(prev => ({ ...prev, [key]: value }));

  const handleAdd = async () => {
    if (!form.name.trim() || !selectedTrackId) return;
    try {
      const data = formToCourseData(form);
      await db.createCourse({ track_id: selectedTrackId, enabled: true, superseded_by: null, ...data });
      setForm(emptyForm); setShowAdd(false);
      toast({ title: 'Course created' }); loadCourses();
    } catch (e: unknown) { toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' }); }
  };

  const handleUpdate = async () => {
    if (!editingId || !form.name.trim()) return;
    try {
      await db.updateCourse(editingId, formToCourseData(form));
      setForm(emptyForm); setEditingId(null);
      toast({ title: 'Course updated' }); loadCourses();
    } catch (e: unknown) { toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' }); }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    try { await db.toggleCourse(id, enabled); loadCourses(); }
    catch (e: unknown) { toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' }); }
  };

  const startEdit = (course: DbCourse) => {
    setEditingId(course.id);
    setForm(formFromCourse(course));
    setEditorMode('visual');
  };

  const cancel = () => { setForm(emptyForm); setEditingId(null); setShowAdd(false); };

  // VisualEditor bridge helpers
  const visualStartA: GpsPoint | null = form.startALat && form.startALng
    ? { lat: parseFloat(form.startALat), lon: parseFloat(form.startALng) } : null;
  const visualStartB: GpsPoint | null = form.startBLat && form.startBLng
    ? { lat: parseFloat(form.startBLat), lon: parseFloat(form.startBLng) } : null;
  const visualSector2: SectorLine | undefined = form.s2aLat && form.s2aLng && form.s2bLat && form.s2bLng
    ? { a: { lat: parseFloat(form.s2aLat), lon: parseFloat(form.s2aLng) }, b: { lat: parseFloat(form.s2bLat), lon: parseFloat(form.s2bLng) } } : undefined;
  const visualSector3: SectorLine | undefined = form.s3aLat && form.s3aLng && form.s3bLat && form.s3bLng
    ? { a: { lat: parseFloat(form.s3aLat), lon: parseFloat(form.s3aLng) }, b: { lat: parseFloat(form.s3bLat), lon: parseFloat(form.s3bLng) } } : undefined;

  const handleVisualStartFinish = useCallback((a: GpsPoint, b: GpsPoint) => {
    setForm(prev => ({ ...prev, startALat: String(a.lat), startALng: String(a.lon), startBLat: String(b.lat), startBLng: String(b.lon) }));
  }, []);
  const handleVisualSector2 = useCallback((line: SectorLine) => {
    setForm(prev => ({ ...prev, s2aLat: String(line.a.lat), s2aLng: String(line.a.lon), s2bLat: String(line.b.lat), s2bLng: String(line.b.lon) }));
  }, []);
  const handleVisualSector3 = useCallback((line: SectorLine) => {
    setForm(prev => ({ ...prev, s3aLat: String(line.a.lat), s3aLng: String(line.a.lon), s3bLat: String(line.b.lat), s3bLng: String(line.b.lon) }));
  }, []);

  const isValid = form.name.trim() && form.startALat && form.startALng && form.startBLat && form.startBLng;

  const courseFormUI = (
    <div className="racing-card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <Label className="text-base font-semibold">{editingId ? 'Edit Course' : 'New Course'}</Label>
        <EditorModeToggle mode={editorMode} onModeChange={setEditorMode} />
      </div>

      <div>
        <Label>Course Name</Label>
        <Input value={form.name} onChange={e => setField('name', e.target.value)} placeholder="Normal" />
      </div>

      {editorMode === 'visual' ? (
        <VisualEditor
          startFinishA={visualStartA}
          startFinishB={visualStartB}
          sector2={visualSector2}
          sector3={visualSector3}
          onStartFinishChange={handleVisualStartFinish}
          onSector2Change={handleVisualSector2}
          onSector3Change={handleVisualSector3}
          isNewTrack={!editingId}
        />
      ) : (
        <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-1">
          {/* Start/Finish */}
          <div className="space-y-2 p-3 border rounded bg-muted/20">
            <p className="text-sm font-medium text-green-400">Start/Finish Line</p>
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">A Lat</Label><Input type="number" step="any" value={form.startALat} onChange={e => setField('startALat', e.target.value)} /></div>
              <div><Label className="text-xs">A Lng</Label><Input type="number" step="any" value={form.startALng} onChange={e => setField('startALng', e.target.value)} /></div>
              <div><Label className="text-xs">B Lat</Label><Input type="number" step="any" value={form.startBLat} onChange={e => setField('startBLat', e.target.value)} /></div>
              <div><Label className="text-xs">B Lng</Label><Input type="number" step="any" value={form.startBLng} onChange={e => setField('startBLng', e.target.value)} /></div>
            </div>
          </div>
          {/* Sector 2 */}
          <div className="space-y-2 p-3 border rounded bg-muted/20">
            <p className="text-sm font-medium text-purple-400">Sector 2 Line</p>
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">A Lat</Label><Input type="number" step="any" value={form.s2aLat} onChange={e => setField('s2aLat', e.target.value)} /></div>
              <div><Label className="text-xs">A Lng</Label><Input type="number" step="any" value={form.s2aLng} onChange={e => setField('s2aLng', e.target.value)} /></div>
              <div><Label className="text-xs">B Lat</Label><Input type="number" step="any" value={form.s2bLat} onChange={e => setField('s2bLat', e.target.value)} /></div>
              <div><Label className="text-xs">B Lng</Label><Input type="number" step="any" value={form.s2bLng} onChange={e => setField('s2bLng', e.target.value)} /></div>
            </div>
          </div>
          {/* Sector 3 */}
          <div className="space-y-2 p-3 border rounded bg-muted/20">
            <p className="text-sm font-medium text-purple-400">Sector 3 Line</p>
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">A Lat</Label><Input type="number" step="any" value={form.s3aLat} onChange={e => setField('s3aLat', e.target.value)} /></div>
              <div><Label className="text-xs">A Lng</Label><Input type="number" step="any" value={form.s3aLng} onChange={e => setField('s3aLng', e.target.value)} /></div>
              <div><Label className="text-xs">B Lat</Label><Input type="number" step="any" value={form.s3bLat} onChange={e => setField('s3bLat', e.target.value)} /></div>
              <div><Label className="text-xs">B Lng</Label><Input type="number" step="any" value={form.s3bLng} onChange={e => setField('s3bLng', e.target.value)} /></div>
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <Button size="sm" onClick={editingId ? handleUpdate : handleAdd} disabled={!isValid}>
          <Check className="w-4 h-4 mr-1" /> {editingId ? 'Update' : 'Create'}
        </Button>
        <Button size="sm" variant="outline" onClick={cancel}>
          <X className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center gap-4">
        <Select value={selectedTrackId} onValueChange={setSelectedTrackId}>
          <SelectTrigger className="w-64"><SelectValue placeholder="Select track..." /></SelectTrigger>
          <SelectContent>
            {tracks.map(t => <SelectItem key={t.id} value={t.id}>{t.name} ({t.short_name})</SelectItem>)}
          </SelectContent>
        </Select>
        {selectedTrackId && (
          <Button size="sm" onClick={() => { setForm(emptyForm); setShowAdd(!showAdd); setEditingId(null); setEditorMode('visual'); }}>
            <Plus className="w-4 h-4 mr-1" /> Add Course
          </Button>
        )}
      </div>

      {(showAdd || editingId) && courseFormUI}

      {loading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : !selectedTrackId ? (
        <p className="text-muted-foreground">Select a track to view courses.</p>
      ) : courses.length === 0 ? (
        <p className="text-muted-foreground">No courses for this track.</p>
      ) : (
        <div className="space-y-2">
          {courses.map(course => (
            <div key={course.id} className="racing-card p-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Switch checked={course.enabled ?? true} onCheckedChange={val => handleToggle(course.id, val)} />
                <span className="font-medium text-foreground">{course.name}</span>
                {course.superseded_by && <span className="text-xs text-muted-foreground">(superseded)</span>}
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => startEdit(course)}>
                  <Edit2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
