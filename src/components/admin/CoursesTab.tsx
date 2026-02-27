import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { toast } from '@/hooks/use-toast';
import { getDatabase } from '@/lib/db';
import type { DbTrack, DbCourse, DbCourseLayout } from '@/lib/db/types';
import type { SectorLine } from '@/types/racing';
import type { GpsPoint } from '@/components/track-editor/VisualEditor';
import { VisualEditor, EditorModeToggle } from '@/components/track-editor/VisualEditor';
import { Plus, Edit2, Check, X, Trash2, Cpu, RefreshCw } from 'lucide-react';
import { resamplePolyline } from '@/lib/trackUtils';
import L from 'leaflet';

type EditorMode = 'manual' | 'visual';

const COURSE_COLORS = [
  '#ff6600',  // orange
  '#06b6d4',  // cyan
  '#a855f7',  // purple
  '#22c55e',  // green
  '#f43f5e',  // rose
  '#eab308',  // yellow
  '#3b82f6',  // blue
  '#ec4899',  // pink
];

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

/** Read-only Leaflet map showing all course layouts for a track */
function LayoutsOverviewMap({ courses, layouts }: { courses: DbCourse[]; layouts: DbCourseLayout[] }) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      zoomControl: true,
      attributionControl: false,
      dragging: true,
      scrollWheelZoom: true,
    }).setView([0, 0], 2);

    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 21,
      maxNativeZoom: 18,
    }).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Draw polylines whenever layouts change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear existing polylines
    map.eachLayer(layer => {
      if (layer instanceof L.Polyline && !(layer instanceof L.TileLayer)) {
        layer.remove();
      }
    });

    const allBounds: L.LatLngExpression[] = [];

    layouts.forEach(layout => {
      const courseIndex = courses.findIndex(c => c.id === layout.course_id);
      const color = COURSE_COLORS[courseIndex >= 0 ? courseIndex % COURSE_COLORS.length : 0];
      const coords = layout.layout_data.map(p => [p.lat, p.lon] as [number, number]);
      if (coords.length === 0) return;

      const courseName = courseIndex >= 0 ? courses[courseIndex].name : 'Unknown';
      L.polyline(coords, { color, weight: 5, opacity: 0.9 })
        .bindTooltip(courseName, { sticky: true })
        .addTo(map);
      allBounds.push(...coords.map(c => [c[0], c[1]] as [number, number]));
    });

    if (allBounds.length > 0) {
      map.fitBounds(L.latLngBounds(allBounds as [number, number][]), { padding: [30, 30] });
    }
  }, [courses, layouts]);

  return <div ref={mapContainerRef} className="h-64 sm:h-80 md:h-96 w-full rounded-md overflow-hidden" />;
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

  // Layout state (for edit form)
  const [layoutPoints, setLayoutPoints] = useState<Array<{ lat: number; lon: number }>>([]);
  const [hasExistingLayout, setHasExistingLayout] = useState(false);

  // All layouts for selected track (for overview map)
  const [trackLayouts, setTrackLayouts] = useState<DbCourseLayout[]>([]);

  const db = getDatabase();

  const loadTracks = useCallback(async () => {
    try { setTracks(await db.getTracks()); }
    catch (e: unknown) { toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' }); }
  }, [db]);

  const loadCourses = useCallback(async () => {
    if (!selectedTrackId) { setCourses([]); setTrackLayouts([]); return; }
    setLoading(true);
    try {
      const loadedCourses = await db.getCourses(selectedTrackId);
      setCourses(loadedCourses);
      // Batch-load all layouts for this track's courses
      const courseIds = loadedCourses.map(c => c.id);
      const layouts = await db.getLayoutsForCourses(courseIds);
      setTrackLayouts(layouts);
    }
    catch (e: unknown) { toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' }); }
    setLoading(false);
  }, [selectedTrackId, db]);

  useEffect(() => { loadTracks(); }, [loadTracks]);
  useEffect(() => { loadCourses(); }, [loadCourses]);

  // Build a set of course IDs that have layouts for quick lookup
  const courseIdsWithLayout = new Set(trackLayouts.map(l => l.course_id));

  const setField = (key: keyof CourseFormState, value: string) => setForm(prev => ({ ...prev, [key]: value }));

  // Load layout when editing a course
  const loadLayout = useCallback(async (courseId: string) => {
    try {
      const layout = await db.getLayout(courseId);
      if (layout) {
        setLayoutPoints(layout.layout_data);
        setHasExistingLayout(true);
      } else {
        setLayoutPoints([]);
        setHasExistingLayout(false);
      }
    } catch {
      setLayoutPoints([]);
      setHasExistingLayout(false);
    }
  }, [db]);

  const handleAdd = async () => {
    if (!form.name.trim() || !selectedTrackId) return;
    try {
      const data = formToCourseData(form);
      const course = await db.createCourse({ track_id: selectedTrackId, enabled: true, superseded_by: null, ...data });
      if (layoutPoints.length > 0) {
        await db.saveLayout(course.id, layoutPoints);
      }
      setForm(emptyForm); setShowAdd(false); setLayoutPoints([]); setHasExistingLayout(false);
      toast({ title: 'Course created' }); loadCourses();
    } catch (e: unknown) { toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' }); }
  };

  const handleUpdate = async () => {
    if (!editingId || !form.name.trim()) return;
    try {
      await db.updateCourse(editingId, formToCourseData(form));
      if (layoutPoints.length > 0) {
        await db.saveLayout(editingId, layoutPoints);
      } else if (hasExistingLayout) {
        await db.deleteLayout(editingId);
      }
      setForm(emptyForm); setEditingId(null); setLayoutPoints([]); setHasExistingLayout(false);
      toast({ title: 'Course updated' }); loadCourses();
    } catch (e: unknown) { toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' }); }
  };

  const handleDeleteLayout = async () => {
    if (!editingId) return;
    try {
      await db.deleteLayout(editingId);
      setLayoutPoints([]);
      setHasExistingLayout(false);
      toast({ title: 'Layout deleted' });
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
    loadLayout(course.id);
  };

  const cancel = () => {
    setForm(emptyForm); setEditingId(null); setShowAdd(false);
    setLayoutPoints([]); setHasExistingLayout(false);
  };

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

  const handleLayoutChange = useCallback((points: Array<{ lat: number; lon: number }>) => {
    setLayoutPoints(points);
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
          showDrawTool={true}
          layoutPoints={layoutPoints}
          onLayoutChange={handleLayoutChange}
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

      {/* Layout info */}
      {layoutPoints.length > 0 && (
        <div className="flex items-center justify-between p-2 bg-orange-500/10 border border-orange-500/30 rounded text-sm">
          <span className="text-orange-400">{layoutPoints.length} layout points drawn</span>
          {hasExistingLayout && (
            <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:text-destructive" onClick={handleDeleteLayout}>
              <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete Layout
            </Button>
          )}
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
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
          <Button size="sm" onClick={() => { setForm(emptyForm); setShowAdd(!showAdd); setEditingId(null); setEditorMode('visual'); setLayoutPoints([]); setHasExistingLayout(false); }}>
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
          {courses.map((course, index) => {
            const color = COURSE_COLORS[index % COURSE_COLORS.length];
            const hasLayout = courseIdsWithLayout.has(course.id);
            return (
              <div key={course.id} className="racing-card p-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Switch checked={course.enabled ?? true} onCheckedChange={val => handleToggle(course.id, val)} />
                  {hasLayout && (
                    <span
                      className="inline-block w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: color }}
                      title="Has layout drawing"
                    />
                  )}
                  <span className="font-medium text-foreground">{course.name}</span>
                  {course.superseded_by && <span className="text-xs text-muted-foreground">(superseded)</span>}
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => startEdit(course)}>
                    <Edit2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Layouts Overview Map */}
      {selectedTrackId && courses.length > 0 && (
        <div className="racing-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-base font-semibold">Course Layouts</Label>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                disabled={trackLayouts.length === 0}
                onClick={() => {
                  const resampled = trackLayouts.map(layout => ({
                    ...layout,
                    layout_data: resamplePolyline(layout.layout_data, 5),
                  }));
                  const totalBefore = trackLayouts.reduce((s, l) => s + l.layout_data.length, 0);
                  const totalAfter = resampled.reduce((s, l) => s + l.layout_data.length, 0);
                  setTrackLayouts(resampled);
                  toast({ title: 'Resampled (preview only)', description: `${totalBefore} → ${totalAfter} points (~5m spacing). Not saved.` });
                }}
              >
                <RefreshCw className="w-4 h-4" /> Resample
              </Button>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="sm" variant="outline" disabled className="gap-1.5 opacity-50">
                      <Cpu className="w-4 h-4" /> Generate Course Mapping
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Coming soon — will generate fingerprint data for automatic track detection</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
          {trackLayouts.length > 0 ? (
            <LayoutsOverviewMap courses={courses} layouts={trackLayouts} />
          ) : (
            <div className="h-32 flex items-center justify-center text-muted-foreground text-sm border border-dashed rounded-md">
              No layouts drawn yet. Edit a course and use the Draw tool to trace the track outline.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
