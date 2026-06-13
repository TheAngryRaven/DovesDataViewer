import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { toast } from '@/hooks/use-toast';
import { getDatabase } from '@/lib/db';
import type { DbTrack, DbCourse, DbCourseLayout } from '@/lib/db/types';
import type { SectorLine, CourseSector } from '@/types/racing';
import type { GpsPoint } from '@/components/track-editor/VisualEditor';
import type { SelectedLine } from '@/hooks/useTrackEditorForm';
import {
  normalizeCourseSectors, legacyMirror, isAtSectorLimit, centeredSectorLine,
} from '@/lib/courseSectors';
import { sectorsFromJson, sectorsToJson, type SectorJson } from '@/lib/trackStorage';
const CourseSectorEditor = lazy(() =>
  import('@/components/track-editor/CourseSectorEditor').then((m) => ({ default: m.CourseSectorEditor })),
);
import { Plus, Edit2, Check, X, Trash2, Star } from 'lucide-react';
import { calculatePolylineLength, formatTrackLength } from '@/lib/trackUtils';
import { METERS_TO_FEET } from '@/lib/parserUtils';
import L from 'leaflet';

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
  sectors: CourseSector[];
}

const emptyForm: CourseFormState = {
  name: '', startALat: '', startALng: '', startBLat: '', startBLng: '',
  sectors: [],
};

function formFromCourse(c: DbCourse): CourseFormState {
  // Prefer the canonical sectors_data; fall back to the legacy two-major columns.
  const fromJson = sectorsFromJson(c.sectors_data as SectorJson[] | undefined);
  let sectors = fromJson;
  if (!sectors) {
    const norm = normalizeCourseSectors({
      name: c.name,
      startFinishA: { lat: c.start_a_lat, lon: c.start_a_lng },
      startFinishB: { lat: c.start_b_lat, lon: c.start_b_lng },
      sector2: c.sector_2_a_lat != null && c.sector_2_a_lng != null && c.sector_2_b_lat != null && c.sector_2_b_lng != null
        ? { a: { lat: c.sector_2_a_lat, lon: c.sector_2_a_lng }, b: { lat: c.sector_2_b_lat, lon: c.sector_2_b_lng } } : undefined,
      sector3: c.sector_3_a_lat != null && c.sector_3_a_lng != null && c.sector_3_b_lat != null && c.sector_3_b_lng != null
        ? { a: { lat: c.sector_3_a_lat, lon: c.sector_3_a_lng }, b: { lat: c.sector_3_b_lat, lon: c.sector_3_b_lng } } : undefined,
    });
    sectors = norm.sectors;
  }
  return {
    name: c.name,
    startALat: String(c.start_a_lat), startALng: String(c.start_a_lng),
    startBLat: String(c.start_b_lat), startBLng: String(c.start_b_lng),
    sectors: sectors ?? [],
  };
}

function formToCourseData(f: CourseFormState) {
  // Persist the legacy two-major mirror (for DB columns) AND the full sectors_data.
  const { sector2, sector3 } = legacyMirror({
    name: f.name,
    startFinishA: { lat: parseFloat(f.startALat), lon: parseFloat(f.startALng) },
    startFinishB: { lat: parseFloat(f.startBLat), lon: parseFloat(f.startBLng) },
    sectors: f.sectors,
  });
  return {
    name: f.name.trim(),
    start_a_lat: parseFloat(f.startALat),
    start_a_lng: parseFloat(f.startALng),
    start_b_lat: parseFloat(f.startBLat),
    start_b_lng: parseFloat(f.startBLng),
    sector_2_a_lat: sector2?.a.lat ?? null,
    sector_2_a_lng: sector2?.a.lon ?? null,
    sector_2_b_lat: sector2?.b.lat ?? null,
    sector_2_b_lng: sector2?.b.lon ?? null,
    sector_3_a_lat: sector3?.a.lat ?? null,
    sector_3_a_lng: sector3?.a.lon ?? null,
    sector_3_b_lat: sector3?.b.lat ?? null,
    sector_3_b_lng: sector3?.b.lon ?? null,
    sectors_data: sectorsToJson(f.sectors) ?? null,
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
      const course = await db.createCourse({ track_id: selectedTrackId, enabled: true, superseded_by: null, length_ft_override: null, ...data });
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
    loadLayout(course.id);
  };

  const cancel = () => {
    setForm(emptyForm); setEditingId(null); setShowAdd(false);
    setLayoutPoints([]); setHasExistingLayout(false);
  };

  // Editor bridge helpers
  const [selectedLine, setSelectedLine] = useState<SelectedLine>(null);
  const visualStartA = useMemo<GpsPoint | null>(() => (form.startALat && form.startALng
    ? { lat: parseFloat(form.startALat), lon: parseFloat(form.startALng) } : null), [form.startALat, form.startALng]);
  const visualStartB = useMemo<GpsPoint | null>(() => (form.startBLat && form.startBLng
    ? { lat: parseFloat(form.startBLat), lon: parseFloat(form.startBLng) } : null), [form.startBLat, form.startBLng]);

  const handleVisualStartFinish = useCallback((a: GpsPoint, b: GpsPoint) => {
    setForm(prev => ({ ...prev, startALat: String(a.lat), startALng: String(a.lon), startBLat: String(b.lat), startBLng: String(b.lon) }));
  }, []);
  const handleSectorLineChange = useCallback((index: number, line: SectorLine) => {
    setForm(prev => ({ ...prev, sectors: prev.sectors.map((s, i) => (i === index ? { ...s, line } : s)) }));
  }, []);
  const handleAddSector = useCallback((insertIndex?: number, center?: GpsPoint) => {
    const course = { name: form.name, startFinishA: { lat: 0, lon: 0 }, startFinishB: { lat: 0, lon: 0 }, sectors: form.sectors };
    if (isAtSectorLimit(course)) return;
    let line: SectorLine;
    if (center) {
      // Drop the new line in the middle of the current map view.
      line = centeredSectorLine(center);
    } else {
      const a = visualStartA, b = visualStartB;
      const midLat = a && b ? (a.lat + b.lat) / 2 : 28.4123;
      const midLon = a && b ? (a.lon + b.lon) / 2 : -81.3797;
      const offset = 0.0003 * (form.sectors.length + 1);
      line = { a: { lat: midLat + offset, lon: midLon - 0.00015 }, b: { lat: midLat + offset, lon: midLon + 0.00015 } };
    }
    const at = insertIndex === undefined ? form.sectors.length : Math.max(0, Math.min(insertIndex, form.sectors.length));
    const sectors = [...form.sectors.slice(0, at), { line, major: false }, ...form.sectors.slice(at)];
    setForm(prev => ({ ...prev, sectors }));
    setSelectedLine(at);
  }, [visualStartA, visualStartB, form.name, form.sectors]);
  const handleRemoveSector = useCallback((index: number) => {
    setForm(prev => ({ ...prev, sectors: prev.sectors.filter((_, i) => i !== index) }));
    setSelectedLine(sel => (typeof sel === 'number' ? null : sel));
  }, []);
  const handleToggleMajor = useCallback((index: number) => {
    setForm(prev => ({ ...prev, sectors: prev.sectors.map((s, i) => (i === index ? { ...s, major: !s.major } : s)) }));
  }, []);
  const handleReorder = useCallback((from: number, to: number) => {
    setForm(prev => {
      if (from === to || from < 0 || to < 0 || from >= prev.sectors.length || to >= prev.sectors.length) return prev;
      const sectors = [...prev.sectors];
      const [moved] = sectors.splice(from, 1);
      sectors.splice(to, 0, moved);
      return { ...prev, sectors };
    });
    setSelectedLine(null);
  }, []);

  const handleLayoutChange = useCallback((points: Array<{ lat: number; lon: number }>) => {
    setLayoutPoints(points);
  }, []);

  const isValid = form.name.trim() && form.startALat && form.startALng && form.startBLat && form.startBLng;

  const courseFormUI = (
    <div className="racing-card p-4 space-y-4">
      <Label className="text-base font-semibold">{editingId ? 'Edit Course' : 'New Course'}</Label>

      <div>
        <Label>Course Name</Label>
        <Input value={form.name} onChange={e => setField('name', e.target.value)} placeholder="Normal" />
      </div>

      <Suspense fallback={null}>
        <CourseSectorEditor
          startFinishA={visualStartA}
          startFinishB={visualStartB}
          sectors={form.sectors}
          selectedLine={selectedLine}
          onSelectLine={setSelectedLine}
          onStartFinishChange={handleVisualStartFinish}
          onSectorLineChange={handleSectorLineChange}
          onAddSector={handleAddSector}
          onRemoveSector={handleRemoveSector}
          onToggleMajor={handleToggleMajor}
          onReorder={handleReorder}
          isNewTrack={!editingId}
          showDrawTool={true}
          layoutPoints={layoutPoints}
          onLayoutChange={handleLayoutChange}
        />
      </Suspense>

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
          <Button size="sm" onClick={() => { setForm(emptyForm); setShowAdd(!showAdd); setEditingId(null); setLayoutPoints([]); setHasExistingLayout(false); }}>
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
            const layout = trackLayouts.find(l => l.course_id === course.id);
            const hasLayout = Boolean(layout);
            const selectedTrack = tracks.find(t => t.id === selectedTrackId);
            const isDefault = selectedTrack?.default_course_id === course.id;
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
                  {isDefault && <span className="text-xs text-primary font-medium">(default)</span>}
                  {course.sector_2_a_lat != null && course.sector_3_a_lat != null ? (
                    <span className="text-[10px] font-medium bg-green-500/15 text-green-500 px-1.5 py-0.5 rounded" title="Has sector 2 & 3 lines">Sectors</span>
                  ) : (
                    <span className="text-[10px] font-medium bg-muted text-muted-foreground px-1.5 py-0.5 rounded" title="No sector lines defined">No Sectors</span>
                  )}
                  {(() => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- length_ft_override column not in generated types; remove on next regen
                    const overrideFt = (course as any).length_ft_override;
                    if (overrideFt != null) {
                      return <span className="text-xs text-yellow-500" title="Manual override">{overrideFt} ft ⚡</span>;
                    }
                    if (layout && layout.layout_data.length >= 2) {
                      return <span className="text-xs text-muted-foreground">({formatTrackLength(calculatePolylineLength(layout.layout_data))})</span>;
                    }
                    return null;
                  })()}
                  {course.superseded_by && <span className="text-xs text-muted-foreground">(superseded)</span>}
                </div>
                <div className="flex items-center gap-1">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={`h-8 w-8 ${isDefault ? 'text-primary' : 'text-muted-foreground'}`}
                          onClick={async () => {
                            try {
                              await db.updateTrack(selectedTrackId, { default_course_id: course.id });
                              setTracks(prev => prev.map(t => t.id === selectedTrackId ? { ...t, default_course_id: course.id } : t));
                              toast({ title: `"${course.name}" set as default course` });
                            } catch (e: unknown) {
                              toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' });
                            }
                          }}
                        >
                          <Star className={`w-4 h-4 ${isDefault ? 'fill-current' : ''}`} />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent><p>Set as default course</p></TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
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
          </div>

          {/* Length overrides */}
          <div className="space-y-2">
            {courses.map((course) => {
              const layout = trackLayouts.find(l => l.course_id === course.id);
              const calculatedFt = layout && layout.layout_data.length >= 2
                ? Math.round(calculatePolylineLength(layout.layout_data) * METERS_TO_FEET)
                : null;
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- length_ft_override column not in generated types; remove on next regen
              const overrideVal = (course as any).length_ft_override as number | null;
              return (
                <div key={course.id} className="flex items-center gap-3 text-sm">
                  <span className="w-32 truncate font-medium text-foreground">{course.name}</span>
                  {calculatedFt != null && (
                    <span className="text-xs text-muted-foreground whitespace-nowrap">Drawn: {calculatedFt} ft</span>
                  )}
                  <div className="flex items-center gap-1.5 ml-auto">
                    <Label className="text-xs text-muted-foreground whitespace-nowrap">Override (ft)</Label>
                    <Input
                      type="number"
                      className="w-24 h-7 text-xs"
                      placeholder="auto"
                      value={overrideVal ?? ''}
                      onChange={async (e) => {
                        const val = e.target.value.trim();
                        const newOverride = val === '' ? null : parseInt(val, 10);
                        try {
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- length_ft_override column not in generated types; remove on next regen
                          await db.updateCourse(course.id, { length_ft_override: newOverride } as any);
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- length_ft_override column not in generated types; remove on next regen
                          setCourses(prev => prev.map(c => c.id === course.id ? { ...c, length_ft_override: newOverride } as any : c));
                        } catch (err: unknown) {
                          toast({ title: 'Error', description: (err as Error).message, variant: 'destructive' });
                        }
                      }}
                    />
                  </div>
                </div>
              );
            })}
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
