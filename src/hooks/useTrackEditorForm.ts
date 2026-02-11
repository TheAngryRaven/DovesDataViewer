import { useState, useCallback } from 'react';
import { Course, SectorLine } from '@/types/racing';
import { parseSectorLine } from '@/lib/trackUtils';
import type { GpsPoint } from '@/components/track-editor/VisualEditor';

export type SectorFormState = { aLat: string; aLon: string; bLat: string; bLon: string };

export interface CourseFormProps {
  trackName: string;
  courseName: string;
  latA: string;
  lonA: string;
  latB: string;
  lonB: string;
  sector2: SectorFormState;
  sector3: SectorFormState;
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

export function useTrackEditorForm() {
  const [formTrackName, setFormTrackName] = useState('');
  const [formCourseName, setFormCourseName] = useState('');
  const [formLatA, setFormLatA] = useState('');
  const [formLonA, setFormLonA] = useState('');
  const [formLatB, setFormLatB] = useState('');
  const [formLonB, setFormLonB] = useState('');
  const [formSector2, setFormSector2] = useState<SectorFormState>({ aLat: '', aLon: '', bLat: '', bLon: '' });
  const [formSector3, setFormSector3] = useState<SectorFormState>({ aLat: '', aLon: '', bLat: '', bLon: '' });
  const [editingCourse, setEditingCourse] = useState<{ trackName: string; courseName: string } | null>(null);
  const [editorMode, setEditorMode] = useState<'manual' | 'visual'>('visual');

  const resetForm = useCallback(() => {
    setFormTrackName(''); setFormCourseName('');
    setFormLatA(''); setFormLonA(''); setFormLatB(''); setFormLonB('');
    setFormSector2({ aLat: '', aLon: '', bLat: '', bLon: '' });
    setFormSector3({ aLat: '', aLon: '', bLat: '', bLon: '' });
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
    const s2 = parseSectorLine(formSector2);
    const s3 = parseSectorLine(formSector3);
    if (s2 && s3) { course.sector2 = s2; course.sector3 = s3; }
    return course;
  }, [formCourseName, formLatA, formLonA, formLatB, formLonB, formSector2, formSector3]);

  const openEditCourse = useCallback((trackName: string, course: Course) => {
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
  }, []);

  const handleSector2Change = useCallback((field: 'aLat' | 'aLon' | 'bLat' | 'bLon', value: string) => {
    setFormSector2(prev => ({ ...prev, [field]: value }));
  }, []);

  const handleSector3Change = useCallback((field: 'aLat' | 'aLon' | 'bLat' | 'bLon', value: string) => {
    setFormSector3(prev => ({ ...prev, [field]: value }));
  }, []);

  // Memoized VisualEditor callbacks (eliminates 5x duplication)
  const handleVisualStartFinishChange = useCallback((a: GpsPoint, b: GpsPoint) => {
    setFormLatA(a.lat.toString());
    setFormLonA(a.lon.toString());
    setFormLatB(b.lat.toString());
    setFormLonB(b.lon.toString());
  }, []);

  const handleVisualSector2Change = useCallback((line: SectorLine) => {
    setFormSector2({
      aLat: line.a.lat.toString(),
      aLon: line.a.lon.toString(),
      bLat: line.b.lat.toString(),
      bLon: line.b.lon.toString(),
    });
  }, []);

  const handleVisualSector3Change = useCallback((line: SectorLine) => {
    setFormSector3({
      aLat: line.a.lat.toString(),
      aLon: line.a.lon.toString(),
      bLat: line.b.lat.toString(),
      bLon: line.b.lon.toString(),
    });
  }, []);

  // Parsed form values for VisualEditor props
  const visualEditorStartFinishA = formLatA && formLonA ? { lat: parseFloat(formLatA), lon: parseFloat(formLonA) } : null;
  const visualEditorStartFinishB = formLatB && formLonB ? { lat: parseFloat(formLatB), lon: parseFloat(formLonB) } : null;
  const visualEditorSector2 = parseSectorLine(formSector2);
  const visualEditorSector3 = parseSectorLine(formSector3);

  const courseFormProps = {
    trackName: formTrackName, courseName: formCourseName,
    latA: formLatA, lonA: formLonA, latB: formLatB, lonB: formLonB,
    sector2: formSector2, sector3: formSector3,
    onTrackNameChange: setFormTrackName, onCourseNameChange: setFormCourseName,
    onLatAChange: setFormLatA, onLonAChange: setFormLonA,
    onLatBChange: setFormLatB, onLonBChange: setFormLonB,
    onSector2Change: handleSector2Change, onSector3Change: handleSector3Change,
  };

  return {
    formTrackName, setFormTrackName,
    formCourseName, setFormCourseName,
    formLatA, formLonA, formLatB, formLonB,
    formSector2, formSector3,
    editingCourse, setEditingCourse,
    editorMode, setEditorMode,
    resetForm,
    buildCourse,
    openEditCourse,
    handleSector2Change,
    handleSector3Change,
    handleVisualStartFinishChange,
    handleVisualSector2Change,
    handleVisualSector3Change,
    visualEditorStartFinishA,
    visualEditorStartFinishB,
    visualEditorSector2,
    visualEditorSector3,
    courseFormProps,
  };
}
