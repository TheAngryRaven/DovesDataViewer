import { useState, useCallback } from 'react';
import { Course, CourseSector, SectorLine } from '@/types/racing';
import { deriveShortName, MAX_SHORT_NAME_LENGTH } from '@/lib/trackUtils';
import { normalizeCourseSectors, isAtSectorLimit, centeredSectorLine } from '@/lib/courseSectors';
import type { GpsPoint } from '@/components/track-editor/VisualEditor';

/** Selection in the visual editor: 'sf' = start/finish, a number = sectors[index]. */
export type SelectedLine = 'sf' | number | null;

export function useTrackEditorForm() {
  const [formTrackName, setFormTrackName] = useState('');
  const [formTrackShortName, setFormTrackShortName] = useState('');
  // Once the user edits the short name themselves, stop auto-deriving it from
  // the long name so we don't clobber their choice.
  const [shortNameTouched, setShortNameTouched] = useState(false);
  const [formCourseName, setFormCourseName] = useState('');
  const [formLatA, setFormLatA] = useState('');
  const [formLonA, setFormLonA] = useState('');
  const [formLatB, setFormLatB] = useState('');
  const [formLonB, setFormLonB] = useState('');
  // Ordered sector lines after start/finish (canonical model).
  const [formSectors, setFormSectors] = useState<CourseSector[]>([]);
  // Which line the map is currently editing (driven by the sector list).
  const [selectedLine, setSelectedLine] = useState<SelectedLine>(null);
  // The drawn/generated course outline (polyline). Travels into the created
  // course and rides cloud-sync + community submission.
  const [formLayout, setFormLayout] = useState<Array<{ lat: number; lon: number }>>([]);
  const [editingCourse, setEditingCourse] = useState<{ trackName: string; courseName: string } | null>(null);

  const resetForm = useCallback(() => {
    setFormTrackName(''); setFormTrackShortName(''); setShortNameTouched(false);
    setFormCourseName('');
    setFormLatA(''); setFormLonA(''); setFormLatB(''); setFormLonB('');
    setFormSectors([]);
    setSelectedLine(null);
    setFormLayout([]);
  }, []);

  // Editing the long name auto-fills the short name (until the user overrides it).
  const handleTrackNameChange = useCallback((value: string) => {
    setFormTrackName(value);
    setShortNameTouched((touched) => {
      if (!touched) setFormTrackShortName(deriveShortName(value));
      return touched;
    });
  }, []);

  const handleTrackShortNameChange = useCallback((value: string) => {
    setShortNameTouched(true);
    setFormTrackShortName(value.slice(0, MAX_SHORT_NAME_LENGTH));
  }, []);

  const buildCourse = useCallback((): Course | null => {
    const latA = parseFloat(formLatA); const lonA = parseFloat(formLonA);
    const latB = parseFloat(formLatB); const lonB = parseFloat(formLonB);
    if (!formCourseName.trim() || isNaN(latA) || isNaN(lonA) || isNaN(latB) || isNaN(lonB)) return null;
    const course: Course = {
      name: formCourseName.trim(),
      startFinishA: { lat: latA, lon: lonA },
      startFinishB: { lat: latB, lon: lonB },
      isUserDefined: true,
    };
    if (formSectors.length > 0) course.sectors = formSectors;
    if (formLayout.length >= 2) course.layout = formLayout;
    // Normalize so the legacy mirror (sector2/sector3) is written alongside.
    return normalizeCourseSectors(course);
  }, [formCourseName, formLatA, formLonA, formLatB, formLonB, formSectors, formLayout]);

  const openEditCourse = useCallback((trackName: string, course: Course) => {
    const norm = normalizeCourseSectors(course);
    setEditingCourse({ trackName, courseName: course.name });
    setFormTrackName(trackName);
    setFormCourseName(course.name);
    setFormLatA(course.startFinishA.lat.toString());
    setFormLonA(course.startFinishA.lon.toString());
    setFormLatB(course.startFinishB.lat.toString());
    setFormLonB(course.startFinishB.lon.toString());
    setFormSectors(norm.sectors ?? []);
    setSelectedLine(null);
    setFormLayout(course.layout ?? []);
  }, []);

  // ── Sector-list operations ─────────────────────────────────────────────────

  /**
   * Add a new sub-sector at `insertIndex` (appended when omitted). When `center`
   * (the live map view center) is given the line drops there — in the middle of
   * what the user is looking at; otherwise it falls back to a line near
   * start/finish. Either way the user then drags it into place.
   */
  const addSector = useCallback((insertIndex?: number, center?: GpsPoint) => {
    const course: Course = {
      name: formCourseName,
      startFinishA: { lat: parseFloat(formLatA), lon: parseFloat(formLonA) },
      startFinishB: { lat: parseFloat(formLatB), lon: parseFloat(formLonB) },
      sectors: formSectors,
    };
    if (isAtSectorLimit(course)) return;
    const line = center
      ? centeredSectorLine(center)
      : defaultSectorLine(formLatA, formLonA, formLatB, formLonB, formSectors.length);
    const at = insertIndex === undefined ? formSectors.length : Math.max(0, Math.min(insertIndex, formSectors.length));
    setFormSectors([...formSectors.slice(0, at), { line, major: false }, ...formSectors.slice(at)]);
    setSelectedLine(at);
  }, [formCourseName, formLatA, formLonA, formLatB, formLonB, formSectors]);

  const removeSector = useCallback((index: number) => {
    setFormSectors((prev) => prev.filter((_, i) => i !== index));
    setSelectedLine((sel) => (typeof sel === 'number' ? null : sel));
  }, []);

  const toggleSectorMajor = useCallback((index: number) => {
    setFormSectors((prev) => prev.map((s, i) => (i === index ? { ...s, major: !s.major } : s)));
  }, []);

  /** Move a sector from one position to another (drag-reorder). */
  const reorderSectors = useCallback((from: number, to: number) => {
    setFormSectors((prev) => {
      if (from === to || from < 0 || to < 0 || from >= prev.length || to >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setSelectedLine(null);
  }, []);

  // ── VisualEditor callbacks ──────────────────────────────────────────────────
  const handleVisualStartFinishChange = useCallback((a: GpsPoint, b: GpsPoint) => {
    setFormLatA(a.lat.toString());
    setFormLonA(a.lon.toString());
    setFormLatB(b.lat.toString());
    setFormLonB(b.lon.toString());
  }, []);

  const handleVisualSectorLineChange = useCallback((index: number, line: SectorLine) => {
    setFormSectors((prev) => prev.map((s, i) => (i === index ? { ...s, line } : s)));
  }, []);

  const handleVisualLayoutChange = useCallback((points: Array<{ lat: number; lon: number }>) => {
    setFormLayout(points);
  }, []);

  // Parsed form values for VisualEditor props
  const visualEditorStartFinishA = formLatA && formLonA ? { lat: parseFloat(formLatA), lon: parseFloat(formLonA) } : null;
  const visualEditorStartFinishB = formLatB && formLonB ? { lat: parseFloat(formLatB), lon: parseFloat(formLonB) } : null;

  return {
    formTrackName, setFormTrackName,
    formTrackShortName,
    handleTrackNameChange,
    handleTrackShortNameChange,
    formCourseName, setFormCourseName,
    formLatA, formLonA, formLatB, formLonB,
    formSectors,
    selectedLine, setSelectedLine,
    formLayout,
    editingCourse, setEditingCourse,
    resetForm,
    buildCourse,
    openEditCourse,
    addSector,
    removeSector,
    toggleSectorMajor,
    reorderSectors,
    handleVisualStartFinishChange,
    handleVisualSectorLineChange,
    handleVisualLayoutChange,
    visualEditorStartFinishA,
    visualEditorStartFinishB,
  };
}

/**
 * Default geometry for a freshly-added sector: a ~30m horizontal line offset
 * north of the start/finish midpoint, fanned out per sector so successive adds
 * don't stack exactly. The user then drags it onto the track.
 */
function defaultSectorLine(
  latA: string, lonA: string, latB: string, lonB: string, ordinal: number,
): SectorLine {
  const aLat = parseFloat(latA); const aLon = parseFloat(lonA);
  const bLat = parseFloat(latB); const bLon = parseFloat(lonB);
  if ([aLat, aLon, bLat, bLon].some((n) => isNaN(n))) {
    // No start/finish yet — fall back to a default near Orlando.
    return { a: { lat: 28.4123, lon: -81.3797 }, b: { lat: 28.4123, lon: -81.3794 } };
  }
  const midLat = (aLat + bLat) / 2;
  const midLon = (aLon + bLon) / 2;
  const offset = 0.0003 * (ordinal + 1); // ~33m steps north
  const half = 0.00015; // ~15m half-length
  return {
    a: { lat: midLat + offset, lon: midLon - half },
    b: { lat: midLat + offset, lon: midLon + half },
  };
}
