import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { getDatabase } from '@/lib/db';
import type { DbTrack, DbCourse } from '@/lib/db/types';
import { Plus, Trash2, Edit2, Check, X } from 'lucide-react';

export function CoursesTab() {
  const [tracks, setTracks] = useState<DbTrack[]>([]);
  const [selectedTrackId, setSelectedTrackId] = useState<string>('');
  const [courses, setCourses] = useState<DbCourse[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formStartALat, setFormStartALat] = useState('');
  const [formStartALng, setFormStartALng] = useState('');
  const [formStartBLat, setFormStartBLat] = useState('');
  const [formStartBLng, setFormStartBLng] = useState('');

  const db = getDatabase();

  const loadTracks = useCallback(async () => {
    try {
      setTracks(await db.getTracks());
    } catch (e: unknown) {
      toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' });
    }
  }, [db]);

  const loadCourses = useCallback(async () => {
    if (!selectedTrackId) { setCourses([]); return; }
    setLoading(true);
    try {
      setCourses(await db.getCourses(selectedTrackId));
    } catch (e: unknown) {
      toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' });
    }
    setLoading(false);
  }, [selectedTrackId, db]);

  useEffect(() => { loadTracks(); }, [loadTracks]);
  useEffect(() => { loadCourses(); }, [loadCourses]);

  const handleAdd = async () => {
    if (!formName.trim() || !selectedTrackId) return;
    try {
      await db.createCourse({
        track_id: selectedTrackId,
        name: formName.trim(),
        enabled: true,
        start_a_lat: parseFloat(formStartALat),
        start_a_lng: parseFloat(formStartALng),
        start_b_lat: parseFloat(formStartBLat),
        start_b_lng: parseFloat(formStartBLng),
        sector_2_a_lat: null, sector_2_a_lng: null, sector_2_b_lat: null, sector_2_b_lng: null,
        sector_3_a_lat: null, sector_3_a_lng: null, sector_3_b_lat: null, sector_3_b_lng: null,
        superseded_by: null,
      });
      resetForm();
      setShowAdd(false);
      toast({ title: 'Course created' });
      loadCourses();
    } catch (e: unknown) {
      toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' });
    }
  };

  const handleUpdate = async () => {
    if (!editingId || !formName.trim()) return;
    try {
      await db.updateCourse(editingId, {
        name: formName.trim(),
        start_a_lat: parseFloat(formStartALat),
        start_a_lng: parseFloat(formStartALng),
        start_b_lat: parseFloat(formStartBLat),
        start_b_lng: parseFloat(formStartBLng),
      });
      resetForm();
      setEditingId(null);
      toast({ title: 'Course updated' });
      loadCourses();
    } catch (e: unknown) {
      toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' });
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await db.toggleCourse(id, enabled);
      loadCourses();
    } catch (e: unknown) {
      toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' });
    }
  };

  const startEdit = (course: DbCourse) => {
    setEditingId(course.id);
    setFormName(course.name);
    setFormStartALat(String(course.start_a_lat));
    setFormStartALng(String(course.start_a_lng));
    setFormStartBLat(String(course.start_b_lat));
    setFormStartBLng(String(course.start_b_lng));
  };

  const resetForm = () => {
    setFormName('');
    setFormStartALat('');
    setFormStartALng('');
    setFormStartBLat('');
    setFormStartBLng('');
  };

  const courseForm = (
    <div className="racing-card p-4 space-y-3">
      <div>
        <Label>Course Name</Label>
        <Input value={formName} onChange={e => setFormName(e.target.value)} placeholder="Normal" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Start A Lat</Label>
          <Input type="number" step="any" value={formStartALat} onChange={e => setFormStartALat(e.target.value)} />
        </div>
        <div>
          <Label>Start A Lng</Label>
          <Input type="number" step="any" value={formStartALng} onChange={e => setFormStartALng(e.target.value)} />
        </div>
        <div>
          <Label>Start B Lat</Label>
          <Input type="number" step="any" value={formStartBLat} onChange={e => setFormStartBLat(e.target.value)} />
        </div>
        <div>
          <Label>Start B Lng</Label>
          <Input type="number" step="any" value={formStartBLng} onChange={e => setFormStartBLng(e.target.value)} />
        </div>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={editingId ? handleUpdate : handleAdd}>
          <Check className="w-4 h-4 mr-1" /> {editingId ? 'Update' : 'Create'}
        </Button>
        <Button size="sm" variant="outline" onClick={() => { resetForm(); setEditingId(null); setShowAdd(false); }}>
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
          <Button size="sm" onClick={() => { resetForm(); setShowAdd(!showAdd); setEditingId(null); }}>
            <Plus className="w-4 h-4 mr-1" /> Add Course
          </Button>
        )}
      </div>

      {(showAdd || editingId) && courseForm}

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
