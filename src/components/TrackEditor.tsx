import { useState, useEffect, useCallback, useContext, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, Edit2, Check, Code, Copy, HelpCircle, Route, ArrowLeft, ChevronRight, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { Track, Course, TrackCourseSelection, courseHasSectors } from '@/types/racing';
import { legacyMirror, normalizeCourseSectors, validateCourseSectors } from '@/lib/courseSectors';
import {
  loadTracks,
  loadDefaultTracks,
  addTrack as addTrackToStorage,
  addCourse as addCourseToStorage,
  updateCourse,
  deleteCourse,
  deleteTrack,
  loadCourseDrawings,
  CourseDrawing,
  TRACKS_SYNC_STORE,
} from '@/lib/trackStorage';
import { onGarageChange } from '@/lib/garageEvents';
import { buildSubmissionPlan } from '@/lib/trackSubmission';
import { loadSubmittedRecords } from '@/lib/submittedTracksStorage';
import { abbreviateTrackName, buildCourseOutline } from '@/lib/trackUtils';
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
import { useTrackEditorForm } from '@/hooks/useTrackEditorForm';
import { useOptionalSettingsContext } from '@/contexts/SettingsContext';
import { formatTrackLength } from '@/lib/units';
// Lazy — CourseSectorEditor pulls in Leaflet drawing logic + the sector list;
// only loads when the track editor dialog is opened.
const CourseSectorEditor = lazy(() =>
  import('@/components/track-editor/CourseSectorEditor').then((m) => ({ default: m.CourseSectorEditor })),
);
import { AddCourseDialog } from '@/components/track-editor/AddCourseDialog';
import { AddTrackDialog } from '@/components/track-editor/AddTrackDialog';
import { SubmitTrackDialog } from '@/components/SubmitTrackDialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Send } from 'lucide-react';

import type { Lap, GpsSample } from '@/types/racing';

// The free-cloud-storage nudge only applies on builds where accounts exist.
const CLOUD_ENABLED = import.meta.env.VITE_ENABLE_CLOUD === 'true';

// List ergonomics: scroll a list once it gets past a handful of rows, and add a
// filter box for the tracks list once it's genuinely long.
const SCROLLABLE_LIST_THRESHOLD = 5;
const TRACK_SEARCH_THRESHOLD = 10;

interface TrackCourseEditorProps {
  selection?: TrackCourseSelection | null;
  onSelectionChange?: (selection: TrackCourseSelection | null) => void;
  compact?: boolean;
  laps?: Lap[];
  samples?: GpsSample[];
  /**
   * Render a custom button that opens the editor (e.g. the landing-page "Manage
   * Tracks" entry). When set, the editor renders only this trigger + its dialogs
   * instead of the compact selection label.
   */
  triggerButton?: React.ReactNode;
}

export function TrackEditor({
  selection = null,
  onSelectionChange,
  compact = false,
  laps,
  samples,
  triggerButton,
}: TrackCourseEditorProps) {
  const { t } = useTranslation('tracks');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSelectDialogOpen, setIsSelectDialogOpen] = useState(false);
  const [isAddCourseOpen, setIsAddCourseOpen] = useState(false);
  const [isAddTrackOpen, setIsAddTrackOpen] = useState(false);
  const [tempTrackName, setTempTrackName] = useState<string>('');
  const [tempCourseName, setTempCourseName] = useState<string>('');
  const [isJsonViewOpen, setIsJsonViewOpen] = useState(false);
  const [courseDrawings, setCourseDrawings] = useState<Record<string, CourseDrawing[]>>({});
  // Courses that still differ from the community DB (drives the always-visible
  // "Submit to DB" button: greyed out when there's nothing new to send).
  const [pendingSubmissionCount, setPendingSubmissionCount] = useState(0);
  // Manage mode is a drill-down: the Tracks list ('tracks') → a single track's
  // Course manager ('courses'). `tempTrackName` holds the track being drilled into.
  const [managePage, setManagePage] = useState<'tracks' | 'courses'>('tracks');
  const [trackSearch, setTrackSearch] = useState('');
  // Track length follows the distance unit setting; falls back to imperial when
  // rendered outside the provider (e.g. the landing-page "Manage Tracks" entry).
  const useMetricDistance = useOptionalSettingsContext()?.useMetricDistance ?? false;

  const form = useTrackEditorForm();
/** Mini SVG preview of a course drawing outline */
function CourseDrawingMini({ points, size = 36 }: { points: Array<{ lat: number; lon: number }>; size?: number }) {
  if (points.length < 2) return null;
  const padding = 2;
  const lats = points.map(p => p.lat);
  const lons = points.map(p => p.lon);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const rangeLat = maxLat - minLat || 0.0001;
  const rangeLon = maxLon - minLon || 0.0001;
  const scale = (size - padding * 2) / Math.max(rangeLat, rangeLon);
  const svgPoints = points.map(p => {
    const x = padding + (p.lon - minLon) * scale;
    const y = padding + (maxLat - p.lat) * scale; // flip Y
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width={size} height={size} className="shrink-0 rounded" style={{ background: 'hsl(var(--muted))' }}>
      <polyline points={svgPoints} fill="none" stroke="hsl(var(--primary))" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}


  useEffect(() => {
    let mounted = true;
    loadTracks().then(loadedTracks => {
      if (mounted) { setTracks(loadedTracks); setIsLoading(false); }
    });
    loadCourseDrawings().then(drawings => {
      if (mounted) setCourseDrawings(drawings);
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

  // Keep this instance's track list in sync with edits made anywhere — another
  // TrackEditor instance (e.g. the landing-page "Manage Tracks" dialog vs. the
  // in-session header selector) or a cloud-sync pull. Track CRUD emits a garage
  // change on the tracks store; refresh on any of those so a newly created
  // track shows up in the dropdown without a page reload.
  useEffect(() => {
    return onGarageChange((change) => {
      if (change.store === TRACKS_SYNC_STORE) {
        loadTracks().then(setTracks);
      }
    });
  }, []);

  // Recompute how many courses still need submitting (uses the same diffing the
  // submit dialog does, so the button greys out when nothing is pending).
  const refreshPendingSubmissionCount = useCallback(async () => {
    const defaults = await loadDefaultTracks();
    const plan = buildSubmissionPlan(tracks, defaults, loadSubmittedRecords());
    setPendingSubmissionCount(plan.pendingCount);
  }, [tracks]);

  useEffect(() => { refreshPendingSubmissionCount(); }, [refreshPendingSubmissionCount]);

  const selectedTrack = tracks.find(t => t.name === tempTrackName);
  const availableCourses = selectedTrack?.courses ?? [];

  // %any% substring filter for the tracks list (matches name or short name).
  const normalizedTrackSearch = trackSearch.trim().toLowerCase();
  const filteredTracks = normalizedTrackSearch
    ? tracks.filter(tk =>
        tk.name.toLowerCase().includes(normalizedTrackSearch) ||
        (tk.shortName?.toLowerCase().includes(normalizedTrackSearch) ?? false))
    : tracks;

  const resolveCourseDrawing = useCallback((track: Track | undefined, courseName?: string) => {
    if (!track || !courseName) return undefined;

    const shortNameCandidates = [track.shortName, abbreviateTrackName(track.name)]
      .filter((value): value is string => Boolean(value))
      .map(value => value.trim());

    for (const shortName of shortNameCandidates) {
      const exact = courseDrawings[`${shortName}/${courseName}`];
      if (exact) return exact;
    }

    const normalizedCourse = courseName.trim().toLowerCase();
    for (const [key, points] of Object.entries(courseDrawings)) {
      const slashIndex = key.indexOf('/');
      if (slashIndex === -1) continue;

      const short = key.slice(0, slashIndex).trim().toLowerCase();
      const name = key.slice(slashIndex + 1).trim().toLowerCase();
      if (shortNameCandidates.some(candidate => candidate.toLowerCase() === short) && name === normalizedCourse) {
        return points;
      }
    }

    return undefined;
  }, [courseDrawings]);

  // Generate JSON for the selected track in datalogger format
  const generateTrackJson = useCallback(() => {
    if (!selectedTrack) return '{}';

    const result: Record<string, {
      lengthFt?: number;
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

      if (course.lengthFt != null) {
        courseData.lengthFt = course.lengthFt;
      }

      // Device track JSON carries only the three major sectors (start/finish +
      // the two majors), byte-identical to the pre-overhaul format.
      const { sector2, sector3 } = legacyMirror(normalizeCourseSectors(course));
      if (sector2) {
        courseData.sector_2_a_lat = sector2.a.lat;
        courseData.sector_2_a_lng = sector2.a.lon;
        courseData.sector_2_b_lat = sector2.b.lat;
        courseData.sector_2_b_lng = sector2.b.lon;
      }
      if (sector3) {
        courseData.sector_3_a_lat = sector3.a.lat;
        courseData.sector_3_a_lng = sector3.a.lon;
        courseData.sector_3_b_lat = sector3.b.lat;
        courseData.sector_3_b_lng = sector3.b.lon;
      }

      result[course.name] = courseData;
    }

    return JSON.stringify(result, null, 2);
  }, [selectedTrack]);

  const handleCopyJson = () => {
    const json = generateTrackJson();
    navigator.clipboard.writeText(json).then(() => {
      toast({ title: t('trackEditor.toastCopied'), description: t('trackEditor.toastCopiedDesc') });
    }).catch(() => {
      toast({ title: t('trackEditor.toastCopyFailed'), variant: 'destructive' });
    });
  };

  const handleTrackChange = (trackName: string) => {
    setTempTrackName(trackName);
    const track = tracks.find(t => t.name === trackName);
    if (track && track.courses.length > 0) setTempCourseName(track.courses[0].name);
    else setTempCourseName('');
  };

  const handleCourseChange = (courseName: string) => setTempCourseName(courseName);

  const openAddCourse = () => {
    form.setFormTrackName(tempTrackName || '');
    form.resetForm();
    form.setFormTrackName(tempTrackName || '');
    // If a session is loaded, pre-generate the course outline from its fastest
    // lap (or the whole trace when no laps were detected) so the new course
    // already has a drawing — no need for the user to open the Generate picker.
    if (samples && samples.length >= 2) {
      const fastest = laps && laps.length > 0
        ? laps.reduce((best, l) => (l.lapTimeMs < best.lapTimeMs ? l : best))
        : null;
      const source = fastest ? samples.slice(fastest.startIndex, fastest.endIndex + 1) : samples;
      const outline = buildCourseOutline(source);
      if (outline.length >= 2) form.handleVisualLayoutChange(outline);
    }
    setIsAddCourseOpen(true);
  };

  const openAddTrack = () => { form.resetForm(); setIsAddTrackOpen(true); };

  // ── Manage-mode drill-down navigation ──────────────────────────────────────
  // Tap a track in the list → open its Course manager.
  const openTrackCourses = (trackName: string) => {
    handleTrackChange(trackName);
    form.setEditingCourse(null);
    form.resetForm();
    setManagePage('courses');
  };

  // Back from the Course manager to the Tracks list.
  const backToTrackList = () => {
    form.setEditingCourse(null);
    form.resetForm();
    setManagePage('tracks');
  };

  // Primary tap on a course row. In a loaded session this applies the course to
  // the session and closes (the fast path — no separate selection screen); on
  // the landing-page manager there's nothing to apply to, so it opens the editor.
  const handleCourseRowOpen = (track: Track, course: Course) => {
    if (onSelectionChange) {
      onSelectionChange({ trackName: track.name, courseName: course.name, course });
      setIsSelectDialogOpen(false);
    } else {
      form.openEditCourse(track.name, course);
    }
  };

  const handleAddCourse = async () => {
    const course = form.buildCourse();
    if (!course || !form.formTrackName.trim()) return;
    const trackName = form.formTrackName.trim();
    await addCourseToStorage(trackName, course);
    const loaded = await refreshTracks();
    setTempTrackName(trackName);
    setTempCourseName(course.name);
    form.resetForm();
    setIsAddCourseOpen(false);

    // If a session is loaded, immediately apply the just-created course so the
    // current file is re-processed against it (laps recompute) without a manual
    // re-select or a file reload. Close the manager so the user lands back on
    // the now-updated session. With no session (landing-page track manager)
    // there's no selection to drive, so we just stay in the dialog.
    if (onSelectionChange) {
      const stored = loaded.find((t) => t.name === trackName)?.courses.find((c) => c.name === course.name) ?? course;
      onSelectionChange({ trackName, courseName: course.name, course: stored });
      setIsSelectDialogOpen(false);
    }
  };

  const handleAddTrack = async () => {
    const name = form.formTrackName.trim();
    if (!name) return;
    // A track is just a name (+ short name); courses are added afterwards.
    await addTrackToStorage(name, undefined, form.formTrackShortName.trim() || undefined);
    await refreshTracks();
    setTempTrackName(name);
    setTempCourseName('');
    form.resetForm();
    setIsAddTrackOpen(false);
  };

  const handleUpdateCourse = async () => {
    if (!form.editingCourse) return;
    const course = form.buildCourse();
    if (!course) return;
    const { trackName, courseName: oldCourseName } = form.editingCourse;
    if (course.name !== oldCourseName) {
      await deleteCourse(trackName, oldCourseName);
      await addCourseToStorage(trackName, course);
    } else {
      await updateCourse(trackName, oldCourseName, {
        startFinishA: course.startFinishA,
        startFinishB: course.startFinishB,
        sectors: course.sectors,
        sector2: course.sector2,
        sector3: course.sector3,
        layout: course.layout,
      });
    }
    const loaded = await refreshTracks();
    setTempCourseName(course.name);
    form.setEditingCourse(null);
    form.resetForm();

    // If the course just edited is the one driving the live session, re-apply it
    // so the moved start/finish or sector lines re-process the laps immediately
    // (otherwise the change only takes effect on the next file reload).
    if (onSelectionChange && selection?.trackName === trackName && selection.courseName === oldCourseName) {
      const stored = loaded.find((t) => t.name === trackName)?.courses.find((c) => c.name === course.name) ?? course;
      onSelectionChange({ trackName, courseName: course.name, course: stored });
    }
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

  if (isLoading) return <div className="text-muted-foreground text-sm">{t('trackEditor.loading')}</div>;

  // Shared sector-list editor props (start/finish + sectors + list operations).
  const sectorEditorProps = {
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
  } as const;

  // Save is blocked unless the sector layout is valid (0 sectors or 3 majors).
  const sectorsValid = validateCourseSectors({
    name: form.formCourseName,
    startFinishA: form.visualEditorStartFinishA ?? { lat: 0, lon: 0 },
    startFinishB: form.visualEditorStartFinishB ?? { lat: 0, lon: 0 },
    sectors: form.formSectors,
  }).valid;

  const addCourseCanSubmit = Boolean(
    form.formCourseName.trim() && form.formLatA && form.formLonA && form.formLatB && form.formLonB && sectorsValid,
  );

  // Shared dialog props
  const addCourseDialogProps = {
    open: isAddCourseOpen,
    onOpenChange: (open: boolean) => { setIsAddCourseOpen(open); if (!open) form.resetForm(); },
    courseName: form.formCourseName,
    onCourseNameChange: form.setFormCourseName,
    canSubmit: addCourseCanSubmit,
    onSubmit: handleAddCourse,
    onCancel: () => { setIsAddCourseOpen(false); form.resetForm(); },
    ...sectorEditorProps,
    layoutPoints: form.formLayout,
    onLayoutChange: form.handleVisualLayoutChange,
    laps,
    samples,
  } as const;

  const addTrackDialogProps = {
    open: isAddTrackOpen,
    onOpenChange: (open: boolean) => { setIsAddTrackOpen(open); if (!open) form.resetForm(); },
    trackName: form.formTrackName,
    shortName: form.formTrackShortName,
    onTrackNameChange: form.handleTrackNameChange,
    onShortNameChange: form.handleTrackShortNameChange,
    onSubmit: handleAddTrack,
    onCancel: () => { setIsAddTrackOpen(false); form.resetForm(); },
  } as const;

  // Track/Course selection UI (shared between compact dialog and non-compact inline)
  const selectionUI = (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>{t('trackEditor.track')}</Label>
        <div className="flex gap-2">
          <Select value={tempTrackName} onValueChange={handleTrackChange}>
            <SelectTrigger className="flex-1"><SelectValue placeholder={t('trackEditor.selectTrack')} /></SelectTrigger>
            <SelectContent>{tracks.map(track => <SelectItem key={track.name} value={track.name}>{track.name}</SelectItem>)}</SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={openAddTrack}><Plus className="w-4 h-4" /></Button>
        </div>
      </div>
      {tempTrackName && (
        <div className="space-y-2">
          <Label>{t('trackEditor.course')}</Label>
          <div className="flex gap-2">
            <Select value={tempCourseName} onValueChange={handleCourseChange} disabled={availableCourses.length === 0}>
              <SelectTrigger className="flex-1"><SelectValue placeholder={availableCourses.length === 0 ? t('trackEditor.noCourses') : t('trackEditor.selectCourse')} /></SelectTrigger>
              <SelectContent>{availableCourses.map(course => <SelectItem key={course.name} value={course.name}>{course.name}</SelectItem>)}</SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={openAddCourse}><Plus className="w-4 h-4" /></Button>
          </div>
        </div>
      )}
    </div>
  );

  // Submit-to-DB control (button + "why?" tooltip), shared by the tracks list.
  const submitToDbControls = (
    <div className="flex items-center gap-1">
      <SubmitTrackDialog
        onSubmitted={refreshPendingSubmissionCount}
        trigger={
          <Button
            className={pendingSubmissionCount > 0 ? 'animate-attention-glow' : ''}
            disabled={pendingSubmissionCount === 0}
          >
            <Send className="w-4 h-4 mr-2" />
            {pendingSubmissionCount > 0 ? t('trackEditor.submitToDbCount', { count: pendingSubmissionCount }) : t('trackEditor.submitToDb')}
          </Button>
        }
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={t('trackEditor.whySubmit')}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p>{pendingSubmissionCount === 0
            ? t('trackEditor.submitTooltipEmpty')
            : t('trackEditor.submitTooltip')}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );

  // ── Manage mode: Tracks list (drill-down root) ─────────────────────────────
  const tracksListPage = (
    <div className="space-y-3">
      {tracks.length > TRACK_SEARCH_THRESHOLD && (
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={trackSearch}
            onChange={(e) => setTrackSearch(e.target.value)}
            onKeyDownCapture={(e) => e.stopPropagation()}
            placeholder={t('trackEditor.searchTracks')}
            className="pl-8 h-9"
          />
        </div>
      )}
      {tracks.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('trackEditor.noTracksDefined')}</p>
      ) : filteredTracks.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('trackEditor.noTracksMatch')}</p>
      ) : (
        <div className={cn('space-y-2', filteredTracks.length > SCROLLABLE_LIST_THRESHOLD && 'max-h-80 overflow-y-auto pr-1')}>
          {filteredTracks.map(track => (
            <div key={track.name} className="flex items-center gap-2 p-2 border rounded bg-muted/30 hover:bg-accent/40 transition-colors">
              <button type="button" onClick={() => openTrackCourses(track.name)} className="flex flex-1 items-center gap-2 min-w-0 text-left">
                <div className="flex-1 min-w-0">
                  <span className="font-mono text-sm">{track.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{t('trackEditor.courseCount', { count: track.courses.length })}</span>
                  {!track.isUserDefined && <span className="ml-2 text-xs text-muted-foreground">{t('trackEditor.defaultTag')}</span>}
                </div>
                <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />
              </button>
              {track.isUserDefined && (
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-destructive hover:text-destructive" onClick={() => handleDeleteTrack(track.name)}><Trash2 className="w-3 h-3" /></Button>
              )}
            </div>
          ))}
        </div>
      )}
      <Button variant="outline" size="sm" onClick={openAddTrack} className="w-full"><Plus className="w-4 h-4 mr-2" />{t('trackEditor.addTrack')}</Button>
      <div className="flex justify-start pt-2">{submitToDbControls}</div>
      {CLOUD_ENABLED && (
        <p className="flex items-center gap-1.5 text-xs text-primary">
          <span aria-hidden>🎁</span>
          {t('trackEditor.submitGift')}
        </p>
      )}
    </div>
  );

  // ── Manage mode: Course manager for the drilled-into track ─────────────────
  const courseManagerPage = (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2" onClick={backToTrackList}>
          <ArrowLeft className="w-4 h-4" />{t('trackEditor.tracksTab')}
        </Button>
        <span className="font-mono text-sm font-medium truncate">{tempTrackName}</span>
      </div>

      {form.editingCourse ? (
        <div className="space-y-4">
          <h4 className="font-medium">{t('trackEditor.editCourse')}</h4>
          <Suspense fallback={null}>
            <CourseSectorEditor
              {...sectorEditorProps}
              showDrawTool={true}
              laps={laps}
              samples={samples}
              layoutPoints={form.formLayout.length >= 2 ? form.formLayout : resolveCourseDrawing(selectedTrack, form.editingCourse?.courseName)}
              onLayoutChange={form.handleVisualLayoutChange}
              showKnownDrawingToggle={true}
            />
          </Suspense>
          <div className="flex gap-2">
            <Button onClick={handleUpdateCourse} className="flex-1" disabled={!sectorsValid}>
              <Check className="w-4 h-4 mr-2" />
              {t('trackEditor.update')}
            </Button>
            <Button variant="outline" onClick={() => { form.setEditingCourse(null); form.resetForm(); }}>
              {t('trackEditor.back')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {!selectedTrack || selectedTrack.courses.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('trackEditor.noCoursesDefined')}</p>
          ) : (
            <div className={cn('space-y-2', selectedTrack.courses.length > SCROLLABLE_LIST_THRESHOLD && 'max-h-80 overflow-y-auto pr-1')}>
              {selectedTrack.courses.map(course => {
                // Prefer the course's own drawn/generated outline; fall back to
                // a matching public (community-DB) drawing for built-in courses.
                const drawing = (course.layout && course.layout.length >= 2)
                  ? course.layout
                  : resolveCourseDrawing(selectedTrack, course.name);
                // Highlight the course currently driving the loaded session.
                const isActive = !!onSelectionChange && selection?.trackName === selectedTrack.name && selection?.courseName === course.name;
                return (
                <div key={course.name} className={cn('flex items-center gap-2 p-2 border rounded transition-colors', isActive ? 'border-primary bg-primary/10' : 'bg-muted/30 hover:bg-accent/40')}>
                  <button type="button" onClick={() => handleCourseRowOpen(selectedTrack, course)} className="flex flex-1 items-center gap-2 min-w-0 text-left">
                    {drawing && drawing.length >= 2 && (
                      <CourseDrawingMini points={drawing} />
                    )}
                    <div className="flex-1 min-w-0">
                      <span className="font-mono text-sm">{course.name}</span>
                      {!course.isUserDefined && <span className="ml-2 text-xs text-muted-foreground">{t('trackEditor.defaultTag')}</span>}
                      {courseHasSectors(course) && <span className="ml-2 text-xs text-accent-foreground/60">{t('trackEditor.sectorsTag')}</span>}
                      {course.lengthFt != null && course.lengthFt > 0 && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {formatTrackLength(course.lengthFt, useMetricDistance)}
                        </span>
                      )}
                    </div>
                  </button>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => form.openEditCourse(selectedTrack.name, course)}><Edit2 className="w-3 h-3" /></Button>
                    {course.isUserDefined && <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDeleteCourse(selectedTrack.name, course.name)}><Trash2 className="w-3 h-3" /></Button>}
                  </div>
                </div>
                );
              })}
            </div>
          )}
          <Button variant="outline" size="sm" onClick={openAddCourse} className="w-full"><Plus className="w-4 h-4 mr-2" />{t('trackEditor.addCourse')}</Button>
          <div className="flex justify-start pt-2">
            <Button variant="outline" onClick={() => setIsJsonViewOpen(true)} disabled={!selectedTrack}>
              <Code className="w-4 h-4 mr-2" />{t('trackEditor.viewJson')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );

  const manageModeContent = managePage === 'courses' ? courseManagerPage : tracksListPage;

  // JSON View Dialog (shared)
  const jsonViewDialog = (
    <Dialog open={isJsonViewOpen} onOpenChange={setIsJsonViewOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Code className="w-5 h-5" />
            {t('trackEditor.jsonTitle', { name: selectedTrack?.name ?? '' })}
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
              <Copy className="w-4 h-4 mr-2" />{t('trackEditor.copyToClipboard')}
            </Button>
            <Button variant="outline" onClick={() => setIsJsonViewOpen(false)}>{t('trackEditor.close')}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );

  // Landing-page entry ("Manage tracks"): open straight onto the Tracks list —
  // no session, so there's nothing to pre-select.
  const openEditor = () => {
    setManagePage('tracks');
    setTrackSearch('');
    setIsSelectDialogOpen(true);
  };

  // In-session entry (compact header button): skip the old selection screen and
  // open the manager directly. When a track is already assigned to the session,
  // drill straight into its Course manager so picking a course is one tap.
  const openInSessionManager = () => {
    setTrackSearch('');
    form.setEditingCourse(null);
    form.resetForm();
    if (selection?.trackName) {
      setTempTrackName(selection.trackName);
      setTempCourseName(selection.courseName);
      setManagePage('courses');
    } else {
      setManagePage('tracks');
    }
    setIsSelectDialogOpen(true);
  };

  // Dialog title reflects the current drill-down level.
  const dialogTitle = managePage === 'courses' && tempTrackName
    ? tempTrackName
    : t('trackEditor.manageTitle');

  const selectDialog = (
    <Dialog open={isSelectDialogOpen} onOpenChange={(open) => { setIsSelectDialogOpen(open); if (!open) { setManagePage('tracks'); setTrackSearch(''); form.setEditingCourse(null); form.resetForm(); } }}>
      <DialogTrigger asChild><span className="sr-only">{t('trackEditor.openSelector')}</span></DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{dialogTitle}</DialogTitle></DialogHeader>
        {manageModeContent}
      </DialogContent>
    </Dialog>
  );

  // Custom-trigger mode (e.g. the landing-page "Manage Tracks" button): render
  // just the trigger + the dialogs, no compact selection label.
  if (triggerButton) {
    return (
      <>
        <span onClick={openEditor} className="contents">{triggerButton}</span>
        {selectDialog}
        {jsonViewDialog}
        <AddCourseDialog {...addCourseDialogProps} />
        <AddTrackDialog {...addTrackDialogProps} />
      </>
    );
  }

  if (compact) {
    // A single course control: the race-course icon shows at every size; the
    // current track : course selection rides as the button label from tablet up
    // (and the title tooltip) so the header stays compact on mobile.
    const displayLabel = selection ? `${abbreviateTrackName(selection.trackName)} : ${selection.courseName}` : t('trackEditor.selectTrackShort');

    return (
      <>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 max-w-[220px] gap-1.5 px-2 md:px-3"
          onClick={openInSessionManager}
          title={displayLabel}
        >
          <Route className="w-4 h-4 shrink-0" />
          <span className="hidden truncate md:inline">{displayLabel}</span>
        </Button>

        {selectDialog}
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
          if (track && course) onSelectionChange?.({ trackName: tempTrackName, courseName: tempCourseName, course });
        }} className="w-full"><Check className="w-4 h-4 mr-2" />{t('trackEditor.applySelection')}</Button>
      )}
      <AddCourseDialog {...addCourseDialogProps} />
      <AddTrackDialog {...addTrackDialogProps} />
    </div>
  );
}
